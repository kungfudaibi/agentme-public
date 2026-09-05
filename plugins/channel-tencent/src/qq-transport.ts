import {
	parseSecretReference,
	type SecretReference,
} from "../../../packages/contracts/src/index.js";

export type QQBotLifecycleEvent = "ready" | "resumed";

export interface QQReplyTarget {
	readonly scope: "c2c" | "group";
	readonly targetId: string;
	readonly msgId?: string;
}

export interface TencentInboundMessage {
	readonly messageId: string;
	readonly senderId: string;
	readonly conversation: "private" | "group";
	readonly content: string;
	readonly replyTarget: QQReplyTarget;
}

export type QQBotInboundHandler = (message: unknown) => void | Promise<void>;

export interface QQBotClient {
	onMessage(handler: QQBotInboundHandler): void;
	onLifecycle(
		event: QQBotLifecycleEvent,
		handler: () => void | Promise<void>,
	): void;
	start(signal: AbortSignal): Promise<void>;
	stop(): void;
	sendText(target: QQReplyTarget, text: string): Promise<void>;
}

export type QQBotClientFactory = (options: {
	readonly appId: string;
	readonly appSecret: string;
	readonly accountId: string;
}) => QQBotClient;

export interface QQTransportConfig {
	readonly appId: SecretReference;
	readonly appSecret: SecretReference;
	readonly accountId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length >= 1 &&
		value.length <= 256 &&
		/^[A-Za-z0-9._:-]+$/u.test(value)
	);
}

function credential(value: string): string {
	if (value.length < 1 || value.length > 4_096 || /[\r\n\0]/u.test(value))
		throw new TypeError("QQ credential is invalid");
	return value;
}

export function parseQQInboundMessage(
	value: unknown,
): TencentInboundMessage | undefined {
	if (!isRecord(value) || (value.kind !== "c2c" && value.kind !== "group"))
		return undefined;
	if (
		!identifier(value.senderId) ||
		!identifier(value.messageId) ||
		typeof value.content !== "string" ||
		value.content.trim().length < 1 ||
		value.content.length > 4_000 ||
		!isRecord(value.replyTarget) ||
		!identifier(value.replyTarget.targetId) ||
		value.replyTarget.msgId !== value.messageId
	)
		return undefined;
	const expectedScope = value.kind === "c2c" ? "c2c" : "group";
	if (
		value.replyTarget.scope !== expectedScope ||
		(value.kind === "c2c" && value.replyTarget.targetId !== value.senderId)
	)
		return undefined;
	return {
		messageId: value.messageId,
		senderId: value.senderId,
		conversation: value.kind === "c2c" ? "private" : "group",
		content: value.content.trim(),
		replyTarget: {
			scope: expectedScope,
			targetId: value.replyTarget.targetId,
			msgId: value.messageId,
		},
	};
}

export class QQTransport {
	readonly #config: QQTransportConfig;
	readonly #resolveSecret: (
		reference: SecretReference,
		signal: AbortSignal,
	) => Promise<string>;
	readonly #createClient: QQBotClientFactory;
	readonly #messageHandlers = new Set<
		(message: TencentInboundMessage) => void | Promise<void>
	>();
	readonly #lifecycleHandlers = new Map<
		QQBotLifecycleEvent,
		Set<() => void | Promise<void>>
	>();
	#client: QQBotClient | undefined;

	constructor(
		config: QQTransportConfig,
		dependencies: {
			readonly resolveSecret: (
				reference: SecretReference,
				signal: AbortSignal,
			) => Promise<string>;
			readonly createClient: QQBotClientFactory;
		},
	) {
		const accountId = config.accountId ?? "agentme";
		if (!identifier(accountId)) throw new TypeError("QQ account id is invalid");
		this.#config = {
			appId: parseSecretReference(config.appId),
			appSecret: parseSecretReference(config.appSecret),
			accountId,
		};
		this.#resolveSecret = dependencies.resolveSecret;
		this.#createClient = dependencies.createClient;
	}

	onMessage(
		handler: (message: TencentInboundMessage) => void | Promise<void>,
	): void {
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
		if (this.#client !== undefined)
			throw new TypeError("QQ transport is active");
		signal.throwIfAborted();
		const [appId, appSecret] = await Promise.all([
			this.#resolveSecret(this.#config.appId, signal),
			this.#resolveSecret(this.#config.appSecret, signal),
		]);
		signal.throwIfAborted();
		const client = this.#createClient({
			appId: credential(appId),
			appSecret: credential(appSecret),
			accountId: this.#config.accountId ?? "agentme",
		});
		this.#client = client;
		client.onMessage(async (raw) => {
			const parsed = parseQQInboundMessage(raw);
			if (parsed === undefined) return;
			for (const handler of this.#messageHandlers) await handler(parsed);
		});
		for (const event of ["ready", "resumed"] as const)
			client.onLifecycle(event, async () => {
				for (const handler of this.#lifecycleHandlers.get(event) ?? [])
					await handler();
			});
		const stop = () => client.stop();
		signal.addEventListener("abort", stop, { once: true });
		try {
			await client.start(signal);
		} finally {
			signal.removeEventListener("abort", stop);
			client.stop();
			if (this.#client === client) this.#client = undefined;
		}
	}

	async sendText(target: QQReplyTarget, text: string): Promise<void> {
		if (this.#client === undefined)
			throw new TypeError("QQ transport is offline");
		if (text.trim().length < 1 || text.length > 4_000)
			throw new TypeError("QQ reply is invalid");
		await this.#client.sendText(target, text);
	}
}
