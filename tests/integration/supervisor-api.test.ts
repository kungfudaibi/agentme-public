import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AssistantProviderService } from "../../apps/host/src/assistant-provider-manager.js";
import { AgentMeHost } from "../../apps/host/src/server.js";
import {
	AllowlistedDesktopActionRuntime,
	type DesktopApplicationLauncher,
} from "../../packages/platform-runtime/src/index.js";
import { MemoryStore } from "../../plugins/memory-core/src/index.js";

const token = "agentme-supervisor-token-0000000001";
const hosts: AgentMeHost[] = [];
const directories: string[] = [];

async function start(delayMs = 30): Promise<AgentMeHost> {
	const directory = await mkdtemp(join(tmpdir(), "agentme-supervisor-api-"));
	directories.push(directory);
	const host = new AgentMeHost({
		databasePath: join(directory, "agentme.sqlite"),
		authToken: token,
		fakeRuntimeDelayMs: delayMs,
	});
	await host.start(0);
	hosts.push(host);
	return host;
}

function request(host: AgentMeHost, path: string, init: RequestInit = {}) {
	return fetch(`${host.url}${path}`, {
		...init,
		headers: { authorization: `Bearer ${token}`, ...init.headers },
	});
}

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.stop()));
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("supervisor API", () => {
	it("records one redacted inspectable experience when a parent completes", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-task-experience-"));
		directories.push(directory);
		const memory = new MemoryStore(
			join(directory, "memory"),
			join(directory, "memory-index.sqlite"),
		);
		const auditEvents: unknown[] = [];
		const host = new AgentMeHost({
			databasePath: join(directory, "agentme.sqlite"),
			authToken: token,
			fakeRuntimeDelayMs: 5,
			memory,
			memoryAudit: (event) => {
				auditEvents.push(event);
			},
		});
		await host.start(0);
		hosts.push(host);

		const secret = "sk-browser-acceptance-secret-123456789";
		const submitted = await request(host, "/assistant/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				message: `运行核验，不得保留原始指令 ${secret}`,
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});
		const { parentId } = (await submitted.json()) as { parentId: string };
		await (await request(host, `/assistant/parents/${parentId}/events`)).text();

		const page = await request(host, "/memories?kind=experience&limit=100");
		expect(page.status).toBe(200);
		const first = (await page.json()) as {
			data: Array<{ id: string; content: string; source: string }>;
		};
		expect(first.data).toHaveLength(1);
		expect(first.data[0]).toMatchObject({ source: `task:${parentId}` });
		expect(first.data[0]?.content).toContain("已完成并通过核验");
		expect(JSON.stringify(first)).not.toContain(secret);
		expect(JSON.stringify(first)).not.toContain("不得保留原始指令");
		expect(auditEvents).toMatchObject([
			{ type: "memory.mutated", operation: "created", kind: "experience" },
		]);
		expect(JSON.stringify(auditEvents)).not.toContain(secret);

		const memoryId = first.data[0]?.id ?? "";
		const revised = await request(
			host,
			`/memories/${encodeURIComponent(memoryId)}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "主人核验后的经验" }),
			},
		);
		expect(revised.status).toBe(200);
		await request(host, `/assistant/parents/${parentId}`);
		await request(host, `/assistant/parents/${parentId}`);
		const replayed = await request(host, "/memories?kind=experience&limit=100");
		expect(
			(await replayed.json()) as { data: Array<{ content: string }> },
		).toMatchObject({ data: [{ content: "主人核验后的经验" }] });

		await request(host, "/memories/removals", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: memoryId }),
		});
		await request(host, `/assistant/parents/${parentId}`);
		const forgotten = await request(
			host,
			"/memories?kind=experience&limit=100",
		);
		expect(((await forgotten.json()) as { data: unknown[] }).data).toEqual([]);
	});

	it("switches provider profiles and uses the active supervisor model for conversation", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-provider-api-"));
		directories.push(directory);
		let activeProfileId = "deepseek" as "deepseek" | "aliyun";
		let configuredApiKey: string | undefined;
		const providers: AssistantProviderService = {
			list: async () => ({
				activeProfileId,
				profiles: [
					{
						id: "deepseek",
						name: "DeepSeek",
						endpoint: "https://api.deepseek.com/chat/completions",
						model: "deepseek-v4-flash",
						isActive: activeProfileId === "deepseek",
						isConfigured: true,
						health: "ready",
					},
				],
			}),
			configure: async (_id, input) => {
				configuredApiKey = input.apiKey;
			},
			activate: async (id) => {
				activeProfileId = id;
			},
			respond: async () => ({
				message: "我是 AgentMe 主调度助手。",
				provider: { id: activeProfileId, model: "qwen3.7-flash" },
			}),
		};
		const host = new AgentMeHost({
			databasePath: join(directory, "agentme.sqlite"),
			authToken: token,
			assistantProviders: providers,
		});
		await host.start(0);
		hosts.push(host);

		const catalog = await request(host, "/assistant/providers");
		expect(await catalog.json()).toMatchObject({
			activeProfileId: "deepseek",
			profiles: [{ isConfigured: true }],
		});

		const configured = await request(
			host,
			"/assistant/providers/aliyun/configure",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					endpoint:
						"https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
					model: "qwen3.7-flash",
					apiKey: "private-key",
				}),
			},
		);
		expect(configured.status).toBe(200);
		expect(configuredApiKey).toBe("private-key");
		expect(JSON.stringify(await configured.json())).not.toContain(
			"private-key",
		);

		const activated = await request(
			host,
			"/assistant/providers/aliyun/activate",
			{ method: "POST" },
		);
		expect(activated.status).toBe(200);

		const conversation = await request(host, "/assistant/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				message: "你好，你是谁",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});
		expect(conversation.status).toBe(200);
		expect(await conversation.json()).toMatchObject({
			type: "assistant.responded",
			responseKind: "conversation",
			message: "我是 AgentMe 主调度助手。",
			provider: { id: "aliyun" },
		});
	});

	it("answers the latest task status from durable state without creating another task", async () => {
		const host = await start();
		const submitted = await request(host, "/assistant/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				message: "运行测试并修复失败",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});
		const identity = (await submitted.json()) as {
			sessionId: string;
			parentId: string;
		};
		await (
			await request(host, `/assistant/parents/${identity.parentId}/events`)
		).text();

		const status = await request(host, "/assistant/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				sessionId: identity.sessionId,
				message: "刚才的任务怎么样了",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});

		expect(status.status).toBe(200);
		expect(await status.json()).toEqual({
			type: "assistant.responded",
			responseKind: "task-status",
			sessionId: identity.sessionId,
			message: "最近任务「运行测试并修复失败」已完成。",
		});
	});

	it("executes an allowlisted desktop action instead of creating a fake coding task", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-desktop-action-"));
		directories.push(directory);
		let launches = 0;
		const launcher: DesktopApplicationLauncher = {
			launch: async () => {
				launches += 1;
			},
		};
		const host = new AgentMeHost({
			databasePath: join(directory, "agentme.sqlite"),
			authToken: token,
			desktopActions: new AllowlistedDesktopActionRuntime(launcher),
		});
		await host.start(0);
		hosts.push(host);

		const response = await request(host, "/assistant/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				message: "帮我打开微信",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});

		expect(response.status).toBe(200);
		const result = (await response.json()) as {
			type: string;
			sessionId: string;
			actionId: string;
			acknowledgement: string;
		};
		expect(result).toMatchObject({
			type: "desktop-action.completed",
			actionId: "open.wechat",
			acknowledgement: "已打开微信。",
		});
		expect(result).not.toHaveProperty("parentId");
		expect(launches).toBe(1);

		const messages = await request(
			host,
			`/assistant/sessions/${result.sessionId}/messages`,
		);
		expect(await messages.json()).toMatchObject({
			messages: [
				{ role: "user", content: "帮我打开微信" },
				{ role: "assistant", content: "已打开微信。" },
			],
		});
	});

	it("creates a conversation task and replays its committed task tree", async () => {
		const host = await start();
		expect(
			(await fetch(`${host.url}/assistant/messages`, { method: "POST" }))
				.status,
		).toBe(401);

		const submitted = await request(host, "/assistant/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				message: "运行测试并修复失败",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});
		expect(submitted.status).toBe(202);
		const identity = (await submitted.json()) as {
			sessionId: string;
			parentId: string;
		};
		expect(identity.sessionId).toMatch(/^[0-9a-f-]+$/);
		expect(identity.parentId).toMatch(/^[0-9a-f-]+$/);

		const stream = await request(
			host,
			`/assistant/parents/${identity.parentId}/events`,
		);
		expect(stream.headers.get("content-type")).toContain("text/event-stream");
		const firstReplay = await stream.text();
		expect(firstReplay).toContain('"type":"supervisor.child.created"');
		expect(firstReplay).toContain('"type":"supervisor.child.completed"');

		const tree = await request(host, `/assistant/parents/${identity.parentId}`);
		expect(await tree.json()).toMatchObject({
			parent: { parentId: identity.parentId, state: "completed" },
			children: [{ state: "completed", request: { repositoryId: "fake" } }],
		});
		const replay = await request(
			host,
			`/assistant/parents/${identity.parentId}/events`,
		);
		expect(await replay.text()).toBe(firstReplay);

		const continued = await request(host, "/assistant/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				sessionId: identity.sessionId,
				message: "继续检查类型",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});
		expect(await continued.json()).toMatchObject({
			sessionId: identity.sessionId,
		});
		const messages = await request(
			host,
			`/assistant/sessions/${identity.sessionId}/messages`,
		);
		expect(await messages.json()).toMatchObject({
			sessionId: identity.sessionId,
			messages: [
				{ role: "user", content: "运行测试并修复失败" },
				{ role: "user", content: "继续检查类型" },
			],
		});
	});

	it("deletes one conversation without deleting its task evidence", async () => {
		const host = await start();
		const submitted = await request(host, "/assistant/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				message: "删除这段会话",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});
		const identity = (await submitted.json()) as {
			sessionId: string;
			parentId: string;
		};

		const deleted = await request(
			host,
			`/assistant/sessions/${identity.sessionId}/messages`,
			{ method: "DELETE" },
		);
		expect(deleted.status).toBe(200);
		expect(await deleted.json()).toEqual({ deleted: true });
		expect(
			(
				await request(
					host,
					`/assistant/sessions/${identity.sessionId}/messages`,
				)
			).status,
		).toBe(422);
		expect(
			(await request(host, `/assistant/parents/${identity.parentId}`)).status,
		).toBe(200);
	});

	it("discovers durable tasks and exposes a read-only worker activity view", async () => {
		const host = await start();
		const submitted = await request(host, "/assistant/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				message: "运行测试",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});
		const { parentId } = (await submitted.json()) as { parentId: string };
		await (await request(host, `/assistant/parents/${parentId}/events`)).text();

		const recent = await request(host, "/assistant/parents?limit=10");
		expect(recent.status).toBe(200);
		const page = (await recent.json()) as {
			items: Array<{ children: Array<{ childId: string }> }>;
		};
		expect(page.items[0]).toMatchObject({
			parent: { parentId },
			children: [{ state: "completed" }],
		});
		const childId = page.items[0]?.children[0]?.childId ?? "";

		const activity = await request(
			host,
			`/assistant/parents/${parentId}/children/${childId}/activity`,
		);
		expect(await activity.json()).toMatchObject({
			child: { childId, request: { runtimeId: "runtime-fake" } },
			task: { state: "completed" },
			canContinue: false,
			events: expect.any(Array),
		});

		const turn = await request(
			host,
			`/assistant/parents/${parentId}/children/${childId}/turns`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ message: "继续" }),
			},
		);
		expect(turn.status).toBe(409);
	});

	it("cancels one child through the authenticated task tree", async () => {
		const host = await start(500);
		const submitted = await request(host, "/assistant/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				message: "等待取消",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});
		const { parentId } = (await submitted.json()) as { parentId: string };
		const tree = await request(host, `/assistant/parents/${parentId}`);
		const childId = ((await tree.json()) as { children: [{ childId: string }] })
			.children[0].childId;

		const cancelled = await request(
			host,
			`/assistant/parents/${parentId}/children/${childId}/cancel`,
			{ method: "POST" },
		);
		expect(cancelled.status).toBe(202);
		const after = await request(host, `/assistant/parents/${parentId}`);
		expect(await after.json()).toMatchObject({
			children: [{ childId, state: "cancelled" }],
		});
	});
});
