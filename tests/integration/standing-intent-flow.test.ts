import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentMeHost } from "../../apps/host/src/server.js";
import { StandingIntentStore } from "../../packages/automation-runtime/src/index.js";

const token = "agentme-standing-intent-token-00001";
const hosts: AgentMeHost[] = [];
const directories: string[] = [];

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

describe("standing intent flow", () => {
	it("turns one authenticated terminal task event into one observable delegated task", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-intent-flow-"));
		directories.push(directory);
		const audit: unknown[] = [];
		const host = new AgentMeHost({
			databasePath: join(directory, "host.sqlite"),
			authToken: token,
			fakeRuntimeDelayMs: 1,
			standingIntents: new StandingIntentStore(
				join(directory, "standing-intents.sqlite"),
			),
			standingIntentAudit: (event) => {
				audit.push(event);
			},
		});
		await host.start(0);
		hosts.push(host);

		const created = await request(host, "/automations/intents", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				eventType: "task.completed",
				expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
				cooldownMinutes: 0,
				maxFires: 1,
				instruction: "Review the completed task evidence once",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});
		expect(created.status).toBe(201);

		const initial = await request(host, "/assistant/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				message: "Complete the source task",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});
		expect(initial.status).toBe(202);

		const deadline = Date.now() + 3_000;
		let triggered: { lastParentId?: string; firedCount: number } | undefined;
		while (Date.now() < deadline) {
			const response = await request(host, "/automations/intents");
			const page = (await response.json()) as {
				data: { lastParentId?: string; firedCount: number }[];
			};
			triggered = page.data[0];
			if (triggered?.lastParentId !== undefined) break;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		expect(triggered).toMatchObject({ firedCount: 1 });
		expect(triggered?.lastParentId).toBeTruthy();
		expect(
			(
				await request(
					host,
					`/assistant/parents/${triggered?.lastParentId as string}`,
				)
			).status,
		).toBe(200);
		expect(JSON.stringify(audit)).not.toContain("Review the completed");
	});
});
