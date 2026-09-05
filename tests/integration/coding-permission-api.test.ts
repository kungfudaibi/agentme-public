import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	CodingPermissionManager,
	JsonCodingPermissionSettingsStore,
} from "../../apps/host/src/coding-permission-manager.js";
import { AgentMeHost } from "../../apps/host/src/server.js";
import { ApprovalStore } from "../../packages/policy-engine/src/index.js";

const token = "agentme-coding-permission-token-0001";
const hosts: AgentMeHost[] = [];
const managers: CodingPermissionManager[] = [];
const directories: string[] = [];

function request(host: AgentMeHost, path: string, init: RequestInit = {}) {
	return fetch(`${host.url}${path}`, {
		...init,
		headers: { authorization: `Bearer ${token}`, ...init.headers },
	});
}

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.stop()));
	for (const manager of managers.splice(0)) {
		try {
			manager.close();
		} catch {}
	}
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("coding permission API", () => {
	it("authenticates, confirms, persists and audits a full-access activation", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-coding-api-"));
		directories.push(directory);
		const settingsPath = join(directory, "settings.json");
		const manager = new CodingPermissionManager({
			settings: { activeProfileId: "safe-auto" },
			settingsStore: new JsonCodingPermissionSettingsStore(settingsPath),
			approvals: new ApprovalStore(join(directory, "approvals.sqlite")),
			apply: () => undefined,
		});
		managers.push(manager);
		const audit: unknown[] = [];
		const host = new AgentMeHost({
			databasePath: join(directory, "host.sqlite"),
			authToken: token,
			codingPermissions: manager,
			codingPermissionAudit: (event) => {
				audit.push(event);
			},
		});
		await host.start(0);
		hosts.push(host);

		expect((await fetch(`${host.url}/coding/permissions`)).status).toBe(401);
		const listed = await request(host, "/coding/permissions");
		expect(listed.status).toBe(200);
		expect(await listed.json()).toMatchObject({
			activeProfileId: "safe-auto",
		});

		const denied = await request(host, "/coding/permissions/activate", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				profileId: "full-auto",
				acknowledgeFullAccess: false,
			}),
		});
		expect(denied.status).toBe(403);

		const activated = await request(host, "/coding/permissions/activate", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				profileId: "full-auto",
				acknowledgeFullAccess: true,
			}),
		});
		expect(activated.status).toBe(200);
		expect(await activated.json()).toMatchObject({
			activeProfileId: "full-auto",
		});
		expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
			codingPermissions: { activeProfileId: "full-auto" },
		});
		expect(audit).toEqual([
			{
				type: "coding-permissions.activated",
				profileId: "full-auto",
			},
		]);
	});
});
