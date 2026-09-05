import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentMeHost } from "../../apps/host/src/server.js";
import type { TencentChannelService } from "../../apps/host/src/tencent-channel-manager.js";

const token = "agentme-tencent-api-token-00000001";
const hosts: AgentMeHost[] = [];
const directories: string[] = [];

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.stop()));
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("Tencent channel API", () => {
	it("binds channel lifecycle and returns only redacted configuration state", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-tencent-api-"));
		directories.push(directory);
		const bind = vi.fn(async () => undefined);
		const configure = vi.fn(async () => ({
			id: "tencent-qq" as const,
			isEnabled: true,
			isConfigured: true,
			status: "running" as const,
			ownerId: "owner-openid",
			accountId: "agentme",
		}));
		const close = vi.fn(async () => undefined);
		const channel: TencentChannelService = {
			bind,
			configure,
			view: async () => ({
				id: "tencent-qq",
				isEnabled: false,
				isConfigured: false,
				status: "disabled",
				ownerId: "",
				accountId: "agentme",
			}),
			close,
		};
		const host = new AgentMeHost({
			databasePath: join(directory, "host.sqlite"),
			authToken: token,
			tencentChannel: channel,
		});
		await host.start(0);
		hosts.push(host);
		expect(bind).toHaveBeenCalledWith(
			expect.objectContaining({
				taskSubmission: expect.any(Object),
				taskEvidence: expect.any(Object),
			}),
			expect.any(AbortSignal),
		);

		const response = await fetch(`${host.url}/channels/tencent-qq`, {
			method: "PUT",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				isEnabled: true,
				ownerId: "owner-openid",
				accountId: "agentme",
				appId: "private-app-id",
				appSecret: "private-app-secret",
			}),
		});
		expect(response.status).toBe(200);
		expect(configure).toHaveBeenCalledWith(
			expect.objectContaining({ appSecret: "private-app-secret" }),
			expect.any(AbortSignal),
		);
		const body = JSON.stringify(await response.json());
		expect(body).toContain("running");
		expect(body).not.toContain("private-app-id");
		expect(body).not.toContain("private-app-secret");

		await host.stop();
		expect(close).toHaveBeenCalledOnce();
	});

	it("rejects untrusted fields before channel configuration", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-tencent-api-"));
		directories.push(directory);
		const configure = vi.fn();
		const channel: TencentChannelService = {
			bind: async () => undefined,
			configure,
			view: async () => ({
				id: "tencent-qq",
				isEnabled: false,
				isConfigured: false,
				status: "disabled",
				ownerId: "",
				accountId: "agentme",
			}),
			close: async () => undefined,
		};
		const host = new AgentMeHost({
			databasePath: join(directory, "host.sqlite"),
			authToken: token,
			tencentChannel: channel,
		});
		await host.start(0);
		hosts.push(host);

		const response = await fetch(`${host.url}/channels/tencent-qq`, {
			method: "PUT",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				isEnabled: false,
				ownerId: "",
				accountId: "agentme",
				shellCommand: "read secrets",
			}),
		});
		expect(response.status).toBe(422);
		expect(configure).not.toHaveBeenCalled();
	});
});
