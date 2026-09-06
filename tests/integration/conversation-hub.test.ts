import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { AssistantProviderService } from "../../apps/host/src/assistant-provider-manager.js";
import { AgentMeHost } from "../../apps/host/src/server.js";

it("keeps office execution and follow-ups in one authenticated durable conversation", async () => {
	const directory = await mkdtemp(join(tmpdir(), "conversation-api-"));
	const requests: string[] = [];
	const providers: AssistantProviderService = {
		list: async () => ({ activeProfileId: "deepseek", profiles: [] }),
		configure: async () => {},
		activate: async () => {},
		respond: async (request) => {
			requests.push(JSON.stringify(request));
			return {
				message: "资料整理结果",
				provider: { id: "deepseek", model: "test" },
			};
		},
	};
	const options = {
		databasePath: join(directory, "host.sqlite"),
		authToken: "h".repeat(64),
		assistantProviders: providers,
	};
	let host = new AgentMeHost(options);
	const headers = {
		authorization: `Bearer ${options.authToken}`,
		"content-type": "application/json",
	};
	try {
		await host.start();
		expect((await fetch(`${host.url}/conversations`)).status).toBe(401);
		const created = await fetch(`${host.url}/conversations`, {
			method: "POST",
			headers,
			body: "{}",
		});
		expect(created.status).toBe(201);
		const c = (await created.json()) as { id: string };
		const send = async (value: unknown) =>
			fetch(`${host.url}/conversations/${c.id}/messages`, {
				method: "POST",
				headers,
				body: JSON.stringify(value),
			});
		expect(
			(
				await send({
					message: "整理用户提供的材料",
					mode: "office",
					agentId: "research",
					constraints: ["保留来源"],
				})
			).status,
		).toBe(200);
		const snapshot = async () =>
			(await (
				await fetch(`${host.url}/conversations/${c.id}`, { headers })
			).json()) as {
				tasks: {
					id: string;
					state: string;
					constraints: string[];
					decisions: string[];
				}[];
				messages: { content: string; kind: string }[];
			};
		await vi.waitFor(async () =>
			expect((await snapshot()).tasks[0]?.state).toBe("completed"),
		);
		const task = (await snapshot()).tasks[0];
		if (!task) throw new Error("Expected task");
		await send({ message: "控制在一页", mode: "update", taskId: task.id });
		await vi.waitFor(async () =>
			expect((await snapshot()).tasks[0]?.state).toBe("completed"),
		);
		expect(requests.at(-1)).toContain("保留来源");
		expect(requests.at(-1)).toContain("控制在一页");
		await host.stop();
		host = new AgentMeHost(options);
		await host.start();
		expect((await snapshot()).tasks[0]?.decisions).toContain("控制在一页");
		expect(
			(await snapshot()).messages.filter((m) => m.kind === "result"),
		).toHaveLength(2);
	} finally {
		await host.stop();
		await rm(directory, { recursive: true, force: true });
	}
});
