import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentMeHost } from "../../apps/host/src/server.js";
import {
	ProcessSkillEvaluator,
	SkillWorkshop,
} from "../../packages/skill-workshop/src/index.js";

const token = "agentme-skill-workshop-token-00000001";
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

describe("skill workshop API", () => {
	it("requires evaluation, explicit hash approval, apply and rollback", async () => {
		const root = await mkdtemp(join(tmpdir(), "agentme-skill-api-"));
		directories.push(root);
		const skillRoot = join(root, "skills");
		const auditEvents: unknown[] = [];
		const host = new AgentMeHost({
			databasePath: join(root, "agentme.sqlite"),
			authToken: token,
			skillWorkshop: new SkillWorkshop(
				skillRoot,
				join(root, "workshop.sqlite"),
			),
			skillEvaluator: new ProcessSkillEvaluator({
				isolationRoot: join(root, "isolate"),
			}),
			skillWorkshopAudit: (event) => {
				auditEvents.push(event);
			},
		});
		await host.start(0);
		hosts.push(host);

		expect((await fetch(`${host.url}/skills/proposals`)).status).toBe(401);
		const created = await request(host, "/skills/proposals", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				skillId: "test-reviewer",
				content: "Review verified changes and report bounded evidence.",
			}),
		});
		expect(created.status).toBe(201);
		const proposal = (await created.json()) as {
			id: string;
			contentHash: string;
			status: string;
		};
		expect(proposal.status).toBe("pending");

		const earlyApply = await request(
			host,
			`/skills/proposals/${proposal.id}/apply`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ contentHash: proposal.contentHash }),
			},
		);
		expect(earlyApply.status).toBe(409);

		const evaluated = await request(
			host,
			`/skills/proposals/${proposal.id}/evaluate`,
			{ method: "POST" },
		);
		expect(await evaluated.json()).toMatchObject({
			status: "evaluated",
			evaluation: {
				passed: true,
				evaluatorId: "agentme-node-isolate-v1",
			},
		});

		const approved = await request(
			host,
			`/skills/proposals/${proposal.id}/approve`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ contentHash: proposal.contentHash }),
			},
		);
		expect(await approved.json()).toMatchObject({ status: "approved" });
		const applied = await request(
			host,
			`/skills/proposals/${proposal.id}/apply`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ contentHash: proposal.contentHash }),
			},
		);
		expect(await applied.json()).toMatchObject({ status: "applied" });
		expect(readFileSync(join(skillRoot, "test-reviewer.md"), "utf8")).toBe(
			"Review verified changes and report bounded evidence.",
		);

		const listed = await request(host, "/skills/proposals?limit=10&offset=0");
		expect(await listed.json()).toMatchObject({
			data: [{ id: proposal.id, status: "applied" }],
			pagination: { totalItems: 1 },
		});
		const rolledBack = await request(
			host,
			`/skills/proposals/${proposal.id}/rollback`,
			{ method: "POST" },
		);
		expect(await rolledBack.json()).toMatchObject({ status: "rolled_back" });
		expect(existsSync(join(skillRoot, "test-reviewer.md"))).toBe(false);
		expect(auditEvents).toHaveLength(5);
		expect(JSON.stringify(auditEvents)).not.toContain(
			"Review verified changes",
		);
	});
});
