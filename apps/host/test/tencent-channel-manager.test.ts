import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { SecretStore } from "../../../packages/platform-runtime/src/index.js";
import type {
	TencentChannel,
	TencentChannelConfig,
	TencentChannelDependencies,
} from "../../../plugins/channel-tencent/src/index.js";
import {
	JsonTencentChannelSettingsStore,
	TencentChannelManager,
} from "../src/tencent-channel-manager.js";

const directories: string[] = [];

afterEach(async () => {
	for (const directory of directories.splice(0))
		await rm(directory, { recursive: true, force: true });
});

function memorySecrets(): SecretStore & { values: Map<string, string> } {
	const values = new Map<string, string>();
	return {
		values,
		set: async (reference, value) => void values.set(reference.id, value),
		get: async (reference) => {
			const value = values.get(reference.id);
			if (value === undefined) throw new Error("missing");
			return value;
		},
		delete: async (reference) => void values.delete(reference.id),
	};
}

describe("Tencent channel manager", () => {
	it("persists only non-secret settings and starts a locally paired channel", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-qq-manager-"));
		directories.push(directory);
		const settingsPath = join(directory, "settings.json");
		await writeFile(
			settingsPath,
			JSON.stringify({ assistant: { preserved: true } }),
			"utf8",
		);
		const secrets = memorySecrets();
		const aborts: AbortSignal[] = [];
		const pairOwner = vi.fn();
		const close = vi.fn();
		const createChannel = vi.fn(
			(
				_config: TencentChannelConfig,
				_dependencies: Omit<TencentChannelDependencies, "QQBot">,
			): TencentChannel => ({
				pairOwner,
				unpairOwner: () => true,
				start: async (signal) => {
					aborts.push(signal);
					await new Promise<void>((resolve) =>
						signal.addEventListener("abort", () => resolve(), { once: true }),
					);
				},
				commitResult: () => undefined,
				close,
			}),
		);
		const manager = new TencentChannelManager({
			settings: { isEnabled: false, ownerId: "", accountId: "agentme" },
			settingsStore: new JsonTencentChannelSettingsStore(settingsPath),
			secrets,
			databasePath: join(directory, "channel.sqlite"),
			createChannel,
		});
		const host = new AbortController();
		await manager.bind(
			{
				taskSubmission: {
					submit: () => crypto.randomUUID(),
					cancel: () => undefined,
				},
				taskEvidence: { getTask: vi.fn(), getTaskEvents: vi.fn() },
			},
			host.signal,
		);

		const view = await manager.configure(
			{
				isEnabled: true,
				ownerId: "owner-openid",
				accountId: "agentme",
				appId: "qq-app-id-value",
				appSecret: "qq-app-secret-value",
			},
			new AbortController().signal,
		);

		await expect.poll(() => createChannel).toHaveBeenCalledOnce();
		expect(pairOwner).toHaveBeenCalledWith("owner-openid");
		expect(view).toMatchObject({
			id: "tencent-qq",
			isEnabled: true,
			isConfigured: true,
			status: "running",
		});
		expect(secrets.values).toEqual(
			new Map([
				["qq-app-id", "qq-app-id-value"],
				["qq-app-secret", "qq-app-secret-value"],
			]),
		);
		const persisted = await readFile(settingsPath, "utf8");
		expect(persisted).toContain("owner-openid");
		expect(persisted).not.toContain("qq-app-id-value");
		expect(persisted).not.toContain("qq-app-secret-value");
		expect(JSON.parse(persisted)).toMatchObject({
			assistant: { preserved: true },
		});

		host.abort();
		await manager.close();
		expect(aborts[0]?.aborted).toBe(true);
		expect(close).toHaveBeenCalledOnce();
	});

	it("does not enable the channel without both protected credentials", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-qq-manager-"));
		directories.push(directory);
		const manager = new TencentChannelManager({
			settings: { isEnabled: false, ownerId: "", accountId: "agentme" },
			settingsStore: new JsonTencentChannelSettingsStore(
				join(directory, "settings.json"),
			),
			secrets: memorySecrets(),
			databasePath: join(directory, "channel.sqlite"),
			createChannel: vi.fn(),
		});

		await expect(
			manager.configure(
				{
					isEnabled: true,
					ownerId: "owner-openid",
					accountId: "agentme",
					appId: "only-one-credential",
				},
				new AbortController().signal,
			),
		).rejects.toThrow("credentials");
	});
});
