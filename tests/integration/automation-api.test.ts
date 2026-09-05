import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentMeHost } from "../../apps/host/src/server.js";

const token = "agentme-automation-api-token-00000001";
const hosts: AgentMeHost[] = [];
const directories: string[] = [];

function request(host: AgentMeHost, path: string, init: RequestInit = {}) {
	return fetch(`${host.url}${path}`, {
		...init,
		headers: { authorization: `Bearer ${token}`, ...init.headers },
	});
}

async function waitForDispatched(host: AgentMeHost, id: string) {
	const deadline = Date.now() + 3_000;
	while (Date.now() < deadline) {
		const response = await request(host, "/automations/jobs");
		const page = (await response.json()) as {
			data: { id: string; state: string; parentId?: string }[];
		};
		const job = page.data.find((candidate) => candidate.id === id);
		if (job?.state === "dispatched") return job;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("Scheduled job was not dispatched");
}

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.stop()));
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("automation API", () => {
	it("persists, dispatches, observes and cancels owner-scoped assistant jobs", async () => {
		const root = await mkdtemp(join(tmpdir(), "agentme-automation-api-"));
		directories.push(root);
		const databasePath = join(root, "agentme.sqlite");
		const auditEvents: unknown[] = [];
		const host = new AgentMeHost({
			databasePath,
			authToken: token,
			fakeRuntimeDelayMs: 1,
			automationAudit: (event) => {
				auditEvents.push(event);
			},
		});
		await host.start(0);
		hosts.push(host);

		expect((await fetch(`${host.url}/automations/jobs`)).status).toBe(401);
		const created = await request(host, "/automations/jobs", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				runAt: new Date(Date.now() - 1_000).toISOString(),
				instruction: "Run the bounded fixture verification",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});
		expect(created.status).toBe(201);
		const job = (await created.json()) as { id: string; state: string };
		expect(job.state).toBe("scheduled");
		const dispatched = await waitForDispatched(host, job.id);
		expect(dispatched.parentId).toBeTruthy();
		expect(
			(
				await request(
					host,
					`/assistant/parents/${encodeURIComponent(dispatched.parentId as string)}`,
				)
			).status,
		).toBe(200);

		const future = await request(host, "/automations/jobs", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				runAt: "2030-01-01T00:00:00.000Z",
				instruction: "Review future evidence",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});
		const futureJob = (await future.json()) as { id: string };
		const cancelled = await request(
			host,
			`/automations/jobs/${futureJob.id}/cancel`,
			{ method: "POST" },
		);
		expect(await cancelled.json()).toMatchObject({ state: "cancelled" });
		expect(JSON.stringify(auditEvents)).not.toContain("bounded fixture");

		await host.stop();
		hosts.splice(hosts.indexOf(host), 1);
		const restarted = new AgentMeHost({ databasePath, authToken: token });
		await restarted.start(0);
		hosts.push(restarted);
		const afterRestart = await request(restarted, "/automations/jobs");
		expect(await afterRestart.json()).toMatchObject({
			data: expect.arrayContaining([
				expect.objectContaining({ id: job.id, state: "dispatched" }),
				expect.objectContaining({ id: futureJob.id, state: "cancelled" }),
			]),
		});
	});

	it("rejects unbounded or malformed task descriptions", async () => {
		const root = await mkdtemp(join(tmpdir(), "agentme-automation-invalid-"));
		directories.push(root);
		const host = new AgentMeHost({
			databasePath: join(root, "agentme.sqlite"),
			authToken: token,
		});
		await host.start(0);
		hosts.push(host);
		const response = await request(host, "/automations/jobs", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				runAt: "tomorrow",
				instruction: "x",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
				extra: "no",
			}),
		});
		expect(response.status).toBe(422);
	});
});
