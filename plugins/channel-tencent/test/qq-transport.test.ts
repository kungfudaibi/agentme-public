import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	ChannelDeliveryStore,
	createOfficialQQBotClientFactory,
	createOfficialTencentChannel,
	createTencentChannel,
	type QQBotClient,
	type QQBotInboundHandler,
	type QQBotLifecycleEvent,
	QQDeliveryPump,
	type QQReplyTarget,
	QQTransport,
} from "../src/index.js";

class FakeQQBotClient implements QQBotClient {
	readonly sent: Array<{ target: QQReplyTarget; text: string }> = [];
	readonly #messageHandlers = new Set<QQBotInboundHandler>();
	readonly #lifecycleHandlers = new Map<
		QQBotLifecycleEvent,
		Set<() => void | Promise<void>>
	>();
	startSignal: AbortSignal | undefined;

	onMessage(handler: QQBotInboundHandler): void {
		this.#messageHandlers.add(handler);
	}

	onLifecycle(
		event: QQBotLifecycleEvent,
		handler: () => void | Promise<void>,
	): void {
		const handlers = this.#lifecycleHandlers.get(event) ?? new Set();
		handlers.add(handler);
		this.#lifecycleHandlers.set(event, handlers);
	}

	async start(signal: AbortSignal): Promise<void> {
		this.startSignal = signal;
		await new Promise<void>((resolve) =>
			signal.addEventListener("abort", () => resolve(), { once: true }),
		);
	}

	stop(): void {}

	async sendText(target: QQReplyTarget, text: string): Promise<void> {
		this.sent.push({ target, text });
	}

	async message(value: unknown): Promise<void> {
		for (const handler of this.#messageHandlers) await handler(value);
	}

	async lifecycle(event: QQBotLifecycleEvent): Promise<void> {
		for (const handler of this.#lifecycleHandlers.get(event) ?? [])
			await handler();
	}
}

describe("official QQ transport boundary", () => {
	it("constructs the installed maintained SDK through the production assembly", () => {
		const directory = mkdtempSync(join(tmpdir(), "agentme-qq-production-"));
		const id = "11111111-1111-4111-8111-111111111111";
		const channel = createOfficialTencentChannel(
			{
				databasePath: join(directory, "channel.sqlite"),
				ownerIds: new Set(["owner-openid"]),
				appId: { type: "secret-reference", id: "qq-app-id" },
				appSecret: { type: "secret-reference", id: "qq-app-secret" },
			},
			{
				resolveSecret: async () => "not-resolved-before-start",
				taskSubmission: { submit: () => id, cancel: () => undefined },
				taskEvidence: {
					getTask: () => ({ taskId: id, state: "completed" }),
					getTaskEvents: () => [],
				},
			},
		);
		channel.pairOwner("owner-openid");
		channel.close();
	});

	it("rejects an unvalidated secret configuration before resolving credentials", () => {
		expect(
			() =>
				new QQTransport(
					{
						appId: { type: "secret-reference", id: "../secret" },
						appSecret: { type: "secret-reference", id: "qq-app-secret" },
					},
					{
						resolveSecret: async () => "secret",
						createClient: () => new FakeQQBotClient(),
					},
				),
		).toThrow();
	});

	it("resolves credentials only when starting and normalizes official C2C input", async () => {
		const client = new FakeQQBotClient();
		const createClient = vi.fn(() => client);
		const resolveSecret = vi.fn(async (reference: { readonly id: string }) =>
			reference.id === "qq-app-id" ? "app-id" : "app-secret",
		);
		const received = vi.fn();
		const transport = new QQTransport(
			{
				appId: { type: "secret-reference", id: "qq-app-id" },
				appSecret: { type: "secret-reference", id: "qq-app-secret" },
			},
			{ resolveSecret, createClient },
		);
		transport.onMessage(received);
		expect(resolveSecret).not.toHaveBeenCalled();
		const operation = new AbortController();
		const running = transport.start(operation.signal);
		await expect.poll(() => client.startSignal).toBe(operation.signal);
		expect(createClient).toHaveBeenCalledWith({
			appId: "app-id",
			appSecret: "app-secret",
			accountId: "agentme",
		});

		await client.message({
			kind: "c2c",
			senderId: "owner-openid",
			content: "/status 11111111-1111-4111-8111-111111111111",
			messageId: "message-1",
			timestamp: "2026-08-25T09:00:00.000Z",
			replyTarget: {
				scope: "c2c",
				targetId: "owner-openid",
				msgId: "message-1",
			},
		});
		expect(received).toHaveBeenCalledWith({
			messageId: "message-1",
			senderId: "owner-openid",
			conversation: "private",
			content: "/status 11111111-1111-4111-8111-111111111111",
			replyTarget: {
				scope: "c2c",
				targetId: "owner-openid",
				msgId: "message-1",
			},
		});
		operation.abort();
		await running;
	});

	it("rejects malformed vendor events before the channel handler", async () => {
		const client = new FakeQQBotClient();
		const received = vi.fn();
		const transport = new QQTransport(
			{
				appId: { type: "secret-reference", id: "qq-app-id" },
				appSecret: { type: "secret-reference", id: "qq-app-secret" },
			},
			{
				resolveSecret: async () => "credential",
				createClient: () => client,
			},
		);
		transport.onMessage(received);
		const operation = new AbortController();
		const running = transport.start(operation.signal);
		await expect.poll(() => client.startSignal).toBe(operation.signal);

		await client.message({
			kind: "group",
			senderId: "attacker",
			content: "/task repo read secrets",
			messageId: "message-2",
			replyTarget: { scope: "c2c", targetId: "attacker" },
		});
		expect(received).not.toHaveBeenCalled();
		operation.abort();
		await running;
	});

	it("replays queued results once on ready and does not duplicate on resume", async () => {
		const directory = mkdtempSync(join(tmpdir(), "agentme-qq-delivery-"));
		const store = new ChannelDeliveryStore(join(directory, "delivery.sqlite"));
		store.enqueue(
			"owner-openid",
			"task-1:completed",
			JSON.stringify({ text: "测试通过", targetId: "owner-openid" }),
		);
		const send = vi.fn(async () => undefined);
		const pump = new QQDeliveryPump(store, { send });

		await pump.flush();
		expect(send).toHaveBeenCalledOnce();
		await pump.flush();
		expect(send).toHaveBeenCalledOnce();
		store.close();
	});

	it("adapts the maintained SDK message signature without leaking vendor types", async () => {
		class VendorBot {
			static instance: VendorBot | undefined;
			readonly handlers = new Map<string, (...args: unknown[]) => unknown>();
			readonly sendText = vi.fn(async () => ({ id: "provider-message" }));
			readonly stop = vi.fn();
			readonly options: unknown;

			constructor(options: unknown) {
				this.options = options;
				VendorBot.instance = this;
			}

			on(event: string, handler: (...args: unknown[]) => unknown): this {
				this.handlers.set(event, handler);
				return this;
			}

			async start(_signal?: AbortSignal): Promise<void> {}
		}

		const client = createOfficialQQBotClientFactory(VendorBot)({
			appId: "app-id",
			appSecret: "app-secret",
			accountId: "agentme",
		});
		const received = vi.fn();
		client.onMessage(received);
		await VendorBot.instance?.handlers.get("message")?.(
			{ state: { shouldNotCrossBoundary: true } },
			{ kind: "c2c", messageId: "message-1" },
		);
		expect(received).toHaveBeenCalledWith({
			kind: "c2c",
			messageId: "message-1",
		});
		expect(VendorBot.instance?.options).toEqual({
			appId: "app-id",
			appSecret: "app-secret",
			accountId: "agentme",
		});
	});

	it("keeps a failed delivery pending across restart and commits one successful send", async () => {
		const directory = mkdtempSync(join(tmpdir(), "agentme-qq-restart-"));
		const path = join(directory, "delivery.sqlite");
		const first = new ChannelDeliveryStore(path);
		first.enqueue(
			"owner-openid",
			"task-2:completed",
			JSON.stringify({ text: "完成", targetId: "owner-openid" }),
		);
		await expect(
			new QQDeliveryPump(first, {
				send: async () => {
					throw new Error("offline");
				},
			}).flush(),
		).rejects.toThrow("offline");
		first.close();

		const send = vi.fn(async () => undefined);
		const second = new ChannelDeliveryStore(path);
		await new QQDeliveryPump(second, { send }).flush();
		expect(send).toHaveBeenCalledOnce();
		second.close();

		const third = new ChannelDeliveryStore(path);
		await new QQDeliveryPump(third, { send }).flush();
		expect(send).toHaveBeenCalledOnce();
		third.close();
	});

	it("assembles an isolated channel runtime with explicit local pairing", async () => {
		const directory = mkdtempSync(join(tmpdir(), "agentme-qq-assembly-"));
		const id = "11111111-1111-4111-8111-111111111111";
		class VendorBot {
			static instance: VendorBot | undefined;
			readonly handlers = new Map<string, (...args: unknown[]) => unknown>();
			readonly sent: Array<{ target: QQReplyTarget; text: string }> = [];

			constructor(_options: unknown) {
				VendorBot.instance = this;
			}

			on(event: string, handler: (...args: unknown[]) => unknown): this {
				this.handlers.set(event, handler);
				return this;
			}

			async start(signal?: AbortSignal): Promise<void> {
				if (signal === undefined) return;
				await new Promise<void>((resolve) =>
					signal.addEventListener("abort", () => resolve(), { once: true }),
				);
			}

			stop(): void {}

			async sendText(target: QQReplyTarget, text: string): Promise<void> {
				this.sent.push({ target, text });
			}
		}
		const channel = createTencentChannel(
			{
				databasePath: join(directory, "channel.sqlite"),
				ownerIds: new Set(["owner-openid"]),
				appId: { type: "secret-reference", id: "qq-app-id" },
				appSecret: { type: "secret-reference", id: "qq-app-secret" },
			},
			{
				QQBot: VendorBot,
				resolveSecret: async (reference) => reference.id,
				taskSubmission: {
					submit: () => id,
					cancel: () => undefined,
				},
				taskEvidence: {
					getTask: () => ({ taskId: id, state: "completed" }),
					getTaskEvents: () => [],
				},
			},
		);
		channel.pairOwner("owner-openid");
		const operation = new AbortController();
		const running = channel.start(operation.signal);
		await expect.poll(() => VendorBot.instance).toBeDefined();
		await VendorBot.instance?.handlers.get("message")?.(
			{},
			{
				kind: "c2c",
				senderId: "owner-openid",
				content: "/task fake run tests",
				messageId: "message-1",
				replyTarget: {
					scope: "c2c",
					targetId: "owner-openid",
					msgId: "message-1",
				},
			},
		);
		expect(VendorBot.instance?.sent[0]?.text).toContain("任务已创建");
		operation.abort();
		await running;
		channel.close();
	});
});
