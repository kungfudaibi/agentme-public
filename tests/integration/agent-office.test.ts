import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AgentMeHost } from "../../apps/host/src/server.js";

it("authenticates office tasks and retains them across host restart", async () => {
	const directory = await mkdtemp(join(tmpdir(), "office-api-"));
	const options = {
		databasePath: join(directory, "host.sqlite"),
		authToken: "o".repeat(64),
	};
	let host = new AgentMeHost(options);
	const headers = {
		authorization: `Bearer ${options.authToken}`,
		"content-type": "application/json",
	};
	try {
		await host.start();
		expect((await fetch(`${host.url}/office`)).status).toBe(401);
		const created = await fetch(`${host.url}/office/tasks`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				agentId: "schedule",
				instruction: "准备周报",
				mode: "todo",
			}),
		});
		expect(created.status).toBe(201);
		const task = (await created.json()) as { id: string };
		const bad = await fetch(`${host.url}/office/tasks`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				agentId: "shell",
				instruction: "anything",
				mode: "assist",
			}),
		});
		expect(bad.status).toBe(422);
		await host.stop();
		host = new AgentMeHost(options);
		await host.start();
		const state = (await (
			await fetch(`${host.url}/office`, { headers })
		).json()) as { tasks: { id: string }[]; agents: unknown[] };
		expect(state.agents).toHaveLength(5);
		expect(state.tasks[0]?.id).toBe(task.id);
		expect(
			(
				await fetch(`${host.url}/office/tasks/${task.id}/complete`, {
					method: "POST",
					headers,
					body: "{}",
				})
			).status,
		).toBe(200);
	} finally {
		await host.stop();
		await rm(directory, { recursive: true, force: true });
	}
});
