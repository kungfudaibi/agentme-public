import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentMeHost } from "../../apps/host/src/server.js";
import {
	AllowlistedDesktopActionRuntime,
	type DesktopApplicationLauncher,
} from "../../packages/platform-runtime/src/index.js";

const token = "agentme-spoken-supervisor-token-00001";
const hosts: AgentMeHost[] = [];
const directories: string[] = [];

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.stop()));
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("spoken supervisor", () => {
	it("opens WeChat as a desktop action without creating a supervisor task", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-spoken-action-"));
		directories.push(directory);
		const launch = vi.fn<DesktopApplicationLauncher["launch"]>();
		const synthesize = vi.fn(async (text: string) => ({
			providerId: "voice-local",
			value: { mimeType: "audio/wav" as const, audioBase64: "UklGRg==" },
			fallbackUsed: false,
			text,
		}));
		const host = new AgentMeHost({
			databasePath: join(directory, "agentme.sqlite"),
			authToken: token,
			desktopActions: new AllowlistedDesktopActionRuntime({ launch }),
			voice: {
				transcribe: async () => ({
					providerId: "voice-local",
					value: "帮我打开微信",
					fallbackUsed: false,
				}),
				synthesize,
			},
		});
		await host.start(0);
		hosts.push(host);

		const response = await fetch(`${host.url}/assistant/voice/messages`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				audioBase64: "UklGRg==",
				mimeType: "audio/wav",
				route: "local",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			type: "desktop-action.completed",
			actionId: "open.wechat",
			acknowledgement: "已打开微信。",
			transcript: "帮我打开微信",
		});
		expect(launch).toHaveBeenCalledOnce();
		expect(synthesize).toHaveBeenCalledWith(
			"已打开微信。",
			"local",
			expect.any(AbortSignal),
		);
	});

	it("keeps pre-wake audio on the local provider without creating a task", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-local-wake-"));
		directories.push(directory);
		const transcribe = vi.fn(async () => ({
			providerId: "voice-local",
			value: "你好小麦",
			fallbackUsed: false,
		}));
		const synthesize = vi.fn();
		const host = new AgentMeHost({
			databasePath: join(directory, "agentme.sqlite"),
			authToken: token,
			voice: { transcribe, synthesize },
		});
		await host.start(0);
		hosts.push(host);

		const response = await fetch(`${host.url}/assistant/voice/wake`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				audioBase64: "UklGRg==",
				mimeType: "audio/wav",
			}),
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			awake: true,
			phrase: "你好小麦",
		});
		expect(transcribe).toHaveBeenCalledWith(
			expect.objectContaining({ route: "local" }),
			expect.any(AbortSignal),
		);
		expect(synthesize).not.toHaveBeenCalled();
	});

	it("turns post-wake audio into the same durable supervisor task", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-spoken-"));
		directories.push(directory);
		const transcribe = vi.fn(async () => ({
			providerId: "voice-local",
			value: "运行测试并修复失败",
			fallbackUsed: false,
		}));
		const synthesize = vi.fn(async () => ({
			providerId: "voice-local",
			value: { mimeType: "audio/wav" as const, audioBase64: "UklGRg==" },
			fallbackUsed: false,
		}));
		const host = new AgentMeHost({
			databasePath: join(directory, "agentme.sqlite"),
			authToken: token,
			voice: { transcribe, synthesize },
		});
		await host.start(0);
		hosts.push(host);

		expect(transcribe).not.toHaveBeenCalled();
		const response = await fetch(`${host.url}/assistant/voice/messages`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				audioBase64: "UklGRg==",
				mimeType: "audio/wav",
				route: "local",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});

		expect(response.status).toBe(202);
		const result = (await response.json()) as {
			parentId: string;
			transcript: string;
			voice: { providerId: string; fallbackUsed: boolean };
			speech: { audioBase64: string };
		};
		expect(result).toMatchObject({
			transcript: "运行测试并修复失败",
			voice: { providerId: "voice-local", fallbackUsed: false },
			speech: { audioBase64: "UklGRg==" },
		});
		expect(transcribe).toHaveBeenCalledOnce();
		expect(synthesize).toHaveBeenCalledOnce();
		const tree = await fetch(
			`${host.url}/assistant/parents/${result.parentId}`,
			{ headers: { authorization: `Bearer ${token}` } },
		);
		expect(await tree.json()).toMatchObject({
			children: [
				{
					request: {
						instruction: "运行测试并修复失败",
						repositoryId: "fake",
					},
				},
			],
		});
	});

	it("treats a spoken stop as conversation control instead of a task", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-spoken-stop-"));
		directories.push(directory);
		const synthesize = vi.fn();
		const host = new AgentMeHost({
			databasePath: join(directory, "agentme.sqlite"),
			authToken: token,
			voice: {
				transcribe: async () => ({
					providerId: "voice-local",
					value: "停止",
					fallbackUsed: false,
				}),
				synthesize,
			},
		});
		await host.start(0);
		hosts.push(host);

		const response = await fetch(`${host.url}/assistant/voice/messages`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				audioBase64: "UklGRg==",
				mimeType: "audio/wav",
				route: "local",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ control: "stop" });
		expect(synthesize).not.toHaveBeenCalled();
	});

	it("propagates client cancellation to speech inference", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-spoken-cancel-"));
		directories.push(directory);
		let providerSignal: AbortSignal | undefined;
		const host = new AgentMeHost({
			databasePath: join(directory, "agentme.sqlite"),
			authToken: token,
			voice: {
				transcribe: async (_input, signal) => {
					providerSignal = signal;
					await new Promise<void>((_resolve, reject) => {
						signal.addEventListener("abort", () => reject(signal.reason), {
							once: true,
						});
					});
					throw new Error("unreachable");
				},
				synthesize: async () => {
					throw new Error("unreachable");
				},
			},
		});
		await host.start(0);
		hosts.push(host);
		const controller = new AbortController();
		const pending = fetch(`${host.url}/assistant/voice/messages`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				audioBase64: "UklGRg==",
				mimeType: "audio/wav",
				route: "local",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
			signal: controller.signal,
		});
		await expect.poll(() => providerSignal !== undefined).toBe(true);
		controller.abort();
		await expect(pending).rejects.toThrow();
		await expect.poll(() => providerSignal?.aborted).toBe(true);
	});

	it("cancels speech inference before host shutdown waits for connections", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-spoken-stop-"));
		directories.push(directory);
		let providerSignal: AbortSignal | undefined;
		const host = new AgentMeHost({
			databasePath: join(directory, "agentme.sqlite"),
			authToken: token,
			voice: {
				transcribe: async (_input, signal) => {
					providerSignal = signal;
					await new Promise<void>((_resolve, reject) => {
						signal.addEventListener("abort", () => reject(signal.reason), {
							once: true,
						});
					});
					throw new Error("unreachable");
				},
				synthesize: async () => {
					throw new Error("unreachable");
				},
			},
		});
		await host.start(0);
		const pending = fetch(`${host.url}/assistant/voice/messages`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				audioBase64: "UklGRg==",
				mimeType: "audio/wav",
				route: "local",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});
		await expect.poll(() => providerSignal !== undefined).toBe(true);

		await expect(host.stop()).resolves.toBeUndefined();
		await expect.poll(() => providerSignal?.aborted).toBe(true);
		await expect(pending).resolves.toMatchObject({ status: 500 });
	});
});
