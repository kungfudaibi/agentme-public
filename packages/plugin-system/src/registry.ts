import { realpath } from "node:fs/promises";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";

import {
	AgentMeError,
	type CapabilityProvider,
	type ProviderContext,
} from "../../contracts/src/index.js";
import { type DiscoveredPlugin, discoverPlugin } from "./manifest.js";

export type AnyCapabilityProvider = CapabilityProvider<unknown, unknown>;

export interface PluginEntryModule {
	readonly createProviders: () => readonly AnyCapabilityProvider[];
}

export type PluginLifecycleEvent =
	| { readonly type: "plugin.discovered"; readonly pluginId: string }
	| { readonly type: "plugin.enabled"; readonly pluginId: string }
	| { readonly type: "plugin.started"; readonly pluginId: string }
	| { readonly type: "plugin.stopped"; readonly pluginId: string };

export type PluginEntryLoader = (
	entryPath: string,
) => Promise<PluginEntryModule>;

export interface PluginRegistryOptions {
	readonly agentmeVersion: string;
	readonly loadEntry?: PluginEntryLoader;
	readonly onEvent?: (event: PluginLifecycleEvent) => void | Promise<void>;
}

type PluginState = "discovered" | "enabled" | "started" | "stopped";

interface RegistryRecord {
	readonly discovered: DiscoveredPlugin;
	state: PluginState;
	operation: Promise<void>;
	providers?: readonly AnyCapabilityProvider[];
	instances?: ReadonlyMap<string, unknown>;
}

async function defaultEntryLoader(
	entryPath: string,
): Promise<PluginEntryModule> {
	return (await import(pathToFileURL(entryPath).href)) as PluginEntryModule;
}

function loadFailed(cause?: unknown): AgentMeError {
	return new AgentMeError({
		code: "PLUGIN_LOAD_FAILED",
		message: "Plugin could not be loaded",
		isRetryable: false,
		cause,
	});
}

export class PluginRegistry {
	readonly #agentmeVersion: string;
	readonly #loadEntry: PluginEntryLoader;
	readonly #onEvent: (event: PluginLifecycleEvent) => void | Promise<void>;
	readonly #records = new Map<string, RegistryRecord>();

	constructor(options: PluginRegistryOptions) {
		this.#agentmeVersion = options.agentmeVersion;
		this.#loadEntry = options.loadEntry ?? defaultEntryLoader;
		this.#onEvent = options.onEvent ?? (() => undefined);
	}

	async discover(manifestPath: string): Promise<DiscoveredPlugin> {
		const discovered = await discoverPlugin(manifestPath, this.#agentmeVersion);
		if (!this.#records.has(discovered.manifest.id)) {
			this.#records.set(discovered.manifest.id, {
				discovered,
				state: "discovered",
				operation: Promise.resolve(),
			});
			await this.#onEvent({
				type: "plugin.discovered",
				pluginId: discovered.manifest.id,
			});
		}
		return discovered;
	}

	async enable(pluginId: string): Promise<void> {
		const record = this.#require(pluginId);
		return this.#enqueue(record, () => this.#enable(pluginId, record));
	}

	async #enable(pluginId: string, record: RegistryRecord): Promise<void> {
		if (record.state !== "discovered") return;
		try {
			const entryPath = await realpath(record.discovered.entryPath);
			const fromRoot = relative(
				await realpath(record.discovered.pluginRoot),
				entryPath,
			);
			if (
				fromRoot === ".." ||
				fromRoot.startsWith(`..\\`) ||
				fromRoot.startsWith("../")
			) {
				throw loadFailed();
			}
			const module = await this.#loadEntry(entryPath);
			if (typeof module.createProviders !== "function") throw loadFailed();
			const providers = module.createProviders();
			if (!Array.isArray(providers) || providers.length === 0)
				throw loadFailed();
			const providerIds = new Set<string>();
			for (const provider of providers) {
				if (
					typeof provider?.id !== "string" ||
					typeof provider.version !== "string" ||
					typeof provider.validate !== "function" ||
					typeof provider.start !== "function" ||
					typeof provider.stop !== "function" ||
					typeof provider.health !== "function" ||
					providerIds.has(provider.id) ||
					!record.discovered.manifest.capabilities.includes(provider.kind)
				) {
					throw loadFailed();
				}
				providerIds.add(provider.id);
			}
			record.providers = providers;
			record.state = "enabled";
			await this.#onEvent({ type: "plugin.enabled", pluginId });
		} catch (error) {
			if (error instanceof AgentMeError) throw error;
			throw loadFailed(error);
		}
	}

	async start(
		pluginId: string,
		context: ProviderContext,
		configs: Readonly<Record<string, unknown>>,
	): Promise<void> {
		const record = this.#require(pluginId);
		return this.#enqueue(record, () =>
			this.#start(pluginId, record, context, configs),
		);
	}

	async #start(
		pluginId: string,
		record: RegistryRecord,
		context: ProviderContext,
		configs: Readonly<Record<string, unknown>>,
	): Promise<void> {
		if (record.state === "started") return;
		if (
			(record.state !== "enabled" && record.state !== "stopped") ||
			record.providers === undefined
		) {
			throw loadFailed();
		}
		const instances = new Map<string, unknown>();
		for (const provider of record.providers) {
			const config = provider.validate(configs[provider.id]);
			instances.set(
				provider.id,
				await provider.start({ ...context, providerId: provider.id }, config),
			);
		}
		record.instances = instances;
		record.state = "started";
		await this.#onEvent({ type: "plugin.started", pluginId });
	}

	async stop(pluginId: string): Promise<void> {
		const record = this.#require(pluginId);
		return this.#enqueue(record, () => this.#stop(pluginId, record));
	}

	async #stop(pluginId: string, record: RegistryRecord): Promise<void> {
		if (record.state !== "started" || record.providers === undefined) return;
		for (const provider of record.providers) await provider.stop();
		delete record.instances;
		record.state = "stopped";
		await this.#onEvent({ type: "plugin.stopped", pluginId });
	}

	getInstance(pluginId: string, providerId: string): unknown {
		const instance = this.#require(pluginId).instances?.get(providerId);
		if (instance === undefined) throw loadFailed();
		return instance;
	}

	#enqueue(
		record: RegistryRecord,
		operation: () => Promise<void>,
	): Promise<void> {
		const result = record.operation.then(operation);
		record.operation = result.catch(() => undefined);
		return result;
	}

	#require(pluginId: string): RegistryRecord {
		const record = this.#records.get(pluginId);
		if (record === undefined) throw loadFailed();
		return record;
	}
}
