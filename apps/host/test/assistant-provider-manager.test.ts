import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
	AssistantEvent,
	AssistantModel,
} from "../../../packages/contracts/src/index.js";
import type { SecretStore } from "../../../packages/platform-runtime/src/index.js";
import {
	AssistantProviderManager,
	type AssistantProviderSettingsStore,
	defaultAssistantProviderSettings,
	JsonAssistantProviderSettingsStore,
} from "../src/assistant-provider-manager.js";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true })),
	);
});

function memorySecrets(values: Record<string, string>): SecretStore {
	const stored = new Map(Object.entries(values));
	return {
		set: async (reference, value) => {
			stored.set(reference.id, value);
		},
		get: async (reference) => {
			const value = stored.get(reference.id);
			if (value === undefined) throw new Error("missing");
			return value;
		},
		delete: async (reference) => {
			stored.delete(reference.id);
		},
	};
}

describe("assistant provider manager", () => {
	it("persists provider settings while preserving unrelated voice settings", async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "agentme-provider-settings-"),
		);
		directories.push(directory);
		const path = join(directory, "settings.json");
		await writeFile(
			path,
			JSON.stringify({ voice: { localExecutable: "python" } }),
			"utf8",
		);
		const settings = {
			...defaultAssistantProviderSettings(),
			activeProfileId: "aliyun" as const,
		};

		await new JsonAssistantProviderSettingsStore(path).save(
			settings,
			new AbortController().signal,
		);

		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
			voice: { localExecutable: "python" },
			assistant: settings,
		});
	});

	it("lists profile readiness without returning credentials", async () => {
		const manager = new AssistantProviderManager({
			settings: defaultAssistantProviderSettings(),
			settingsStore: { save: vi.fn() },
			secrets: memorySecrets({ "deepseek-api-key": "private-key" }),
			createModel: () => ({
				converse: async function* () {},
			}),
		});

		const catalog = await manager.list(new AbortController().signal);

		expect(catalog.activeProfileId).toBe("deepseek");
		expect(catalog.profiles).toMatchObject([
			{ id: "deepseek", isActive: true, isConfigured: true },
			{ id: "aliyun", isActive: false, isConfigured: false },
		]);
		expect(JSON.stringify(catalog)).not.toContain("private-key");
	});

	it("stores a changed key behind the fixed profile secret reference", async () => {
		const set = vi.fn<SecretStore["set"]>();
		const save = vi.fn<AssistantProviderSettingsStore["save"]>();
		const manager = new AssistantProviderManager({
			settings: defaultAssistantProviderSettings(),
			settingsStore: { save },
			secrets: {
				set,
				get: async () => "configured",
				delete: async () => undefined,
			},
			createModel: () => ({ converse: async function* () {} }),
		});

		await manager.configure(
			"aliyun",
			{
				endpoint:
					"https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
				model: "qwen3.7-flash",
				apiKey: "new-private-key",
			},
			new AbortController().signal,
		);

		expect(set).toHaveBeenCalledWith(
			{ type: "secret-reference", id: "aliyun-api-key" },
			"new-private-key",
			expect.any(AbortSignal),
		);
		expect(JSON.stringify(save.mock.calls[0]?.[0])).not.toContain(
			"new-private-key",
		);
	});

	it("switches the model used for the next conversation without restart", async () => {
		const save = vi.fn<AssistantProviderSettingsStore["save"]>();
		const created: string[] = [];
		const manager = new AssistantProviderManager({
			settings: defaultAssistantProviderSettings(),
			settingsStore: { save },
			secrets: memorySecrets({
				"deepseek-api-key": "deepseek-key",
				"aliyun-api-key": "aliyun-key",
			}),
			createModel: (profile): AssistantModel => {
				created.push(profile.id);
				return {
					converse: async function* (request): AsyncIterable<AssistantEvent> {
						yield {
							type: "assistant.response.completed",
							sessionId: request.sessionId,
							runId: "run-one",
							message: `reply from ${profile.id}`,
							at: "2026-08-24T00:00:00.000Z",
						};
					},
				};
			},
		});

		await manager.activate("aliyun", new AbortController().signal);
		const response = await manager.respond(
			{
				sessionId: "session-one",
				messages: [{ role: "user", content: "你好" }],
				allowedRepositoryIds: ["agentme"],
				allowedRuntimeIds: ["runtime-codex"],
			},
			new AbortController().signal,
		);

		expect(response).toMatchObject({
			message: "reply from aliyun",
			provider: { id: "aliyun", model: "qwen3.7-flash" },
		});
		expect(created).toEqual(["aliyun"]);
		expect(save).toHaveBeenCalledOnce();
	});

	it("applies concurrent profile changes in invocation order", async () => {
		let releaseFirstSave: (() => void) | undefined;
		const firstSave = new Promise<void>((resolve) => {
			releaseFirstSave = resolve;
		});
		let saveCount = 0;
		const manager = new AssistantProviderManager({
			settings: defaultAssistantProviderSettings(),
			settingsStore: {
				save: async () => {
					saveCount += 1;
					if (saveCount === 1) await firstSave;
				},
			},
			secrets: memorySecrets({
				"deepseek-api-key": "deepseek-key",
				"aliyun-api-key": "aliyun-key",
			}),
			createModel: () => ({ converse: async function* () {} }),
		});
		const signal = new AbortController().signal;

		const first = manager.activate("aliyun", signal);
		await vi.waitFor(() => expect(saveCount).toBe(1));
		const second = manager.activate("deepseek", signal);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(saveCount).toBe(1);
		releaseFirstSave?.();
		await Promise.all([first, second]);

		expect((await manager.list(signal)).activeProfileId).toBe("deepseek");
	});

	it("rejects an endpoint outside the provider allowlist", async () => {
		const manager = new AssistantProviderManager({
			settings: defaultAssistantProviderSettings(),
			settingsStore: { save: vi.fn() },
			secrets: memorySecrets({}),
			createModel: () => ({ converse: async function* () {} }),
		});

		await expect(
			manager.configure(
				"aliyun",
				{
					endpoint: "http://127.0.0.1:8080/chat/completions",
					model: "qwen3.7-flash",
				},
				new AbortController().signal,
			),
		).rejects.toMatchObject({ code: "INVALID_PROVIDER_CONFIG" });
	});
});
