import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMeHost } from "../../apps/host/src/server.js";

const hosts: AgentMeHost[] = [];
afterEach(async () => Promise.all(hosts.splice(0).map((host) => host.stop())));

describe("operator task flow", () => {
	it("serves a keyboard-operable local task console without exposing its token", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-ui-"));
		const host = new AgentMeHost({
			databasePath: join(directory, "db.sqlite"),
			authToken: "operator-test-token-000000000000001",
		});
		await host.start();
		hosts.push(host);
		const response = await fetch(host.url);
		const html = await response.text();
		expect(response.status).toBe(200);
		expect(html).toContain('<form id="task-form">');
		expect(html).toContain('id="cancel"');
		expect(html).not.toContain("operator-test-token");
	});

	it("exposes a credential-free loopback health probe", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-health-"));
		const host = new AgentMeHost({
			databasePath: join(directory, "db.sqlite"),
			authToken: "operator-health-token-0000000000001",
		});
		await host.start();
		hosts.push(host);
		const response = await fetch(`${host.url}/health`);
		expect(await response.json()).toEqual({
			status: "healthy",
			service: "agentme-host",
		});
	});
});
