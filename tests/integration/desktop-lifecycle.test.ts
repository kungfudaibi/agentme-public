import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AgentMeHost } from "../../apps/host/src/server.js";

describe("desktop host lifecycle", () => {
	it("allows desktop WebView preflight without opening CORS to other origins", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-desktop-cors-"));
		const token = "desktop-ephemeral-token-000000000001";
		const host = new AgentMeHost({
			databasePath: join(directory, "agentme.sqlite"),
			authToken: token,
		});
		await host.start(0);

		const allowed = await fetch(`${host.url}/assistant/messages`, {
			method: "OPTIONS",
			headers: {
				origin: "http://127.0.0.1:1420",
				"access-control-request-method": "POST",
				"access-control-request-headers": "authorization,content-type",
			},
		});
		expect(allowed.status).toBe(204);
		expect(allowed.headers.get("access-control-allow-origin")).toBe(
			"http://127.0.0.1:1420",
		);
		expect(allowed.headers.get("access-control-allow-headers")).toBe(
			"authorization, content-type",
		);

		const denied = await fetch(`${host.url}/assistant/messages`, {
			method: "OPTIONS",
			headers: {
				origin: "https://attacker.example",
				"access-control-request-method": "POST",
			},
		});
		expect(denied.status).toBe(403);
		expect(denied.headers.has("access-control-allow-origin")).toBe(false);

		await host.stop();
		await rm(directory, { recursive: true, force: true });
	});

	it("accepts an authenticated graceful shutdown and releases its port", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-desktop-host-"));
		const token = "desktop-ephemeral-token-000000000001";
		const host = new AgentMeHost({
			databasePath: join(directory, "agentme.sqlite"),
			authToken: token,
		});
		await host.start(0);
		const url = host.url;

		const response = await fetch(`${url}/shutdown`, {
			method: "POST",
			headers: { authorization: `Bearer ${token}` },
		});
		expect(response.status).toBe(202);
		await expect
			.poll(async () => {
				try {
					await fetch(`${url}/health`);
					return "listening";
				} catch {
					return "stopped";
				}
			})
			.toBe("stopped");

		await host.stop();
		await rm(directory, { recursive: true, force: true });
	});
});
