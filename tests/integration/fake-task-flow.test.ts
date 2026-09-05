import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentMeHost } from "../../apps/host/src/server.js";

const token = "agentme-integration-token-000000000001";
const hosts: AgentMeHost[] = [];

async function startHost(
	databasePath: string,
	delayMs = 30,
): Promise<AgentMeHost> {
	const host = new AgentMeHost({
		databasePath,
		authToken: token,
		fakeRuntimeDelayMs: delayMs,
	});
	await host.start(0);
	hosts.push(host);
	return host;
}

function request(
	host: AgentMeHost,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${host.url}${path}`, {
		...init,
		headers: { authorization: `Bearer ${token}`, ...init.headers },
	});
}

async function waitForState(
	host: AgentMeHost,
	taskId: string,
	expected: string,
): Promise<Record<string, unknown>> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const response = await request(host, `/tasks/${taskId}`);
		const task = (await response.json()) as Record<string, unknown>;
		if (task.state === expected) return task;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Task ${taskId} did not reach ${expected}`);
}

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.stop()));
});

describe("fake task vertical slice", () => {
	it("authenticates, creates, streams and completes a fake task", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-host-complete-"));
		const host = await startHost(join(directory, "agentme.sqlite"));

		const unauthorized = await fetch(`${host.url}/tasks/missing`);
		expect(unauthorized.status).toBe(401);

		const invalid = await request(host, "/tasks", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ instruction: "" }),
		});
		expect(invalid.status).toBe(422);

		const created = await request(host, "/tasks", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ instruction: "Run the fake coding task" }),
		});
		expect(created.status).toBe(202);
		const { taskId } = (await created.json()) as { taskId: string };

		const stream = await request(host, `/tasks/${taskId}/events`);
		expect(stream.status).toBe(200);
		expect(stream.headers.get("content-type")).toContain("text/event-stream");
		const body = await stream.text();
		expect(body).toContain('"type":"task.started"');
		expect(body).toContain('"type":"task.completed"');
		expect(body).toContain('"message":"Worker started"');
		expect(body).not.toContain('"message":"Fake runtime started"');
		expect(body).not.toContain('"message":"Verifying fake result"');

		const task = await waitForState(host, taskId, "completed");
		expect(task.actorId).toBe("local-owner");
	});

	it("cancels an active task and does not duplicate terminal work after restart", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-host-cancel-"));
		const databasePath = join(directory, "agentme.sqlite");
		const first = await startHost(databasePath, 500);
		const created = await request(first, "/tasks", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ instruction: "Wait until cancelled" }),
		});
		const { taskId } = (await created.json()) as { taskId: string };

		const cancelled = await request(first, `/tasks/${taskId}/cancel`, {
			method: "POST",
		});
		expect(cancelled.status).toBe(202);
		await waitForState(first, taskId, "cancelled");
		const eventCount = first.getTaskEvents(taskId).length;
		await first.stop();
		hosts.splice(hosts.indexOf(first), 1);

		const restarted = await startHost(databasePath, 10);
		await new Promise((resolve) => setTimeout(resolve, 50));
		const task = await request(restarted, `/tasks/${taskId}`);
		expect(await task.json()).toMatchObject({ state: "cancelled" });
		expect(restarted.getTaskEvents(taskId)).toHaveLength(eventCount);
	});
});
