import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
	CapabilityProvider,
	ProviderContext,
} from "../../contracts/src/index.js";
import {
	discoverPlugin,
	type PluginEntryModule,
	PluginRegistry,
} from "../src/index.js";

const fixtureManifest = fileURLToPath(
	new URL("./fixtures/malicious/agentme.plugin.json", import.meta.url),
);
const fakeRuntimeManifest = fileURLToPath(
	new URL("../../../plugins/runtime-fake/agentme.plugin.json", import.meta.url),
);

const context: ProviderContext = {
	taskId: "task-1",
	actor: { type: "user", id: "owner" },
	providerId: "fake-runtime",
	signal: AbortSignal.timeout(10_000),
	emit: () => undefined,
};

afterEach(() => {
	delete (globalThis as Record<string, unknown>)
		.__agentMeMaliciousEntryExecuted;
});

describe("manifest discovery", () => {
	it("does not evaluate the entry module", async () => {
		const discovered = await discoverPlugin(fixtureManifest, "0.0.0");

		expect(discovered.manifest.id).toBe("malicious-fixture");
		expect(
			(globalThis as Record<string, unknown>).__agentMeMaliciousEntryExecuted,
		).toBeUndefined();
	});

	it("rejects invalid manifests with a stable public error", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-invalid-plugin-"));
		const manifestPath = join(directory, "agentme.plugin.json");
		await writeFile(
			manifestPath,
			JSON.stringify({ schemaVersion: 1, id: "../escape" }),
		);

		await expect(discoverPlugin(manifestPath, "0.0.0")).rejects.toMatchObject({
			code: "INVALID_PLUGIN_MANIFEST",
			message: "Invalid plugin manifest",
			isRetryable: false,
		});
	});

	it("rejects an entry path that escapes the plugin root", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-escaping-plugin-"));
		const manifestPath = join(directory, "agentme.plugin.json");
		await writeFile(
			manifestPath,
			JSON.stringify({
				schemaVersion: 1,
				id: "escaping-plugin",
				version: "1.0.0",
				entry: "../entry.js",
				capabilities: ["coding.runtime"],
				permissions: [],
				compatibility: { agentme: ">=0.0.0 <0.1.0" },
			}),
		);

		await expect(discoverPlugin(manifestPath, "0.0.0")).rejects.toMatchObject({
			code: "INVALID_PLUGIN_MANIFEST",
		});
	});

	it("rejects an incompatible AgentMe version before activation", async () => {
		await expect(
			discoverPlugin(fixtureManifest, "1.0.0"),
		).rejects.toMatchObject({
			code: "INCOMPATIBLE_PLUGIN",
			message: "Plugin is not compatible with this AgentMe version",
			isRetryable: false,
		});
	});
});

describe("plugin lifecycle", () => {
	it("activates and runs the built-in fake runtime through the real entry loader", async () => {
		const events: string[] = [];
		const registry = new PluginRegistry({
			agentmeVersion: "0.0.0",
			onEvent: (event) => {
				events.push(event.type);
			},
		});

		await registry.discover(fakeRuntimeManifest);
		await registry.enable("runtime-fake");
		await registry.start("runtime-fake", context, {
			"runtime-fake": { delayMs: 0 },
		});
		await registry.stop("runtime-fake");

		expect(events).toEqual([
			"plugin.discovered",
			"plugin.enabled",
			"plugin.started",
			"plugin.stopped",
		]);
	});

	it("enables, starts and stops providers idempotently with observable events", async () => {
		const start = vi.fn(async () => ({ runtime: "fake" }));
		const stop = vi.fn(async () => undefined);
		const provider: CapabilityProvider<
			Record<string, never>,
			{ runtime: string }
		> = {
			id: "fake-runtime",
			kind: "coding.runtime",
			version: "1.0.0",
			validate: () => ({}),
			start,
			stop,
			health: async () => ({ status: "healthy" }),
		};
		const loadEntry = vi.fn(
			async (): Promise<PluginEntryModule> => ({
				createProviders: () => [provider],
			}),
		);
		const events: string[] = [];
		const registry = new PluginRegistry({
			agentmeVersion: "0.0.0",
			loadEntry,
			onEvent: (event) => {
				events.push(event.type);
			},
		});

		await registry.discover(fixtureManifest);
		await Promise.all([
			registry.enable("malicious-fixture"),
			registry.enable("malicious-fixture"),
		]);
		await Promise.all([
			registry.start("malicious-fixture", context, { "fake-runtime": {} }),
			registry.start("malicious-fixture", context, { "fake-runtime": {} }),
		]);
		await Promise.all([
			registry.stop("malicious-fixture"),
			registry.stop("malicious-fixture"),
		]);

		expect(loadEntry).toHaveBeenCalledTimes(1);
		expect(start).toHaveBeenCalledTimes(1);
		expect(stop).toHaveBeenCalledTimes(1);
		expect(events).toEqual([
			"plugin.discovered",
			"plugin.enabled",
			"plugin.started",
			"plugin.stopped",
		]);
	});
});
