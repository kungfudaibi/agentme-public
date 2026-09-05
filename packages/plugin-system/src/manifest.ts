import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { satisfies, valid, validRange } from "semver";

import {
	AgentMeError,
	type CapabilityKind,
	isCapabilityKind,
} from "../../contracts/src/index.js";

const MAX_MANIFEST_BYTES = 64 * 1024;
const pluginIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const permissionPattern = /^[a-z][a-z0-9.-]*:[a-z0-9][a-z0-9._-]*$/;

export interface PluginManifest {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly version: string;
	readonly entry: string;
	readonly capabilities: readonly CapabilityKind[];
	readonly permissions: readonly string[];
	readonly configSchema?: string;
	readonly compatibility: { readonly agentme: string };
}

export interface DiscoveredPlugin {
	readonly manifestPath: string;
	readonly pluginRoot: string;
	readonly entryPath: string;
	readonly manifest: PluginManifest;
}

function invalidManifest(cause?: unknown): never {
	throw new AgentMeError({
		code: "INVALID_PLUGIN_MANIFEST",
		message: "Invalid plugin manifest",
		isRetryable: false,
		cause,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(
	root: string,
	candidate: unknown,
): candidate is string {
	if (
		typeof candidate !== "string" ||
		candidate.length === 0 ||
		isAbsolute(candidate)
	)
		return false;
	const resolved = resolve(root, candidate);
	const fromRoot = relative(root, resolved);
	return (
		fromRoot !== "" &&
		fromRoot !== ".." &&
		!fromRoot.startsWith(`..\\`) &&
		!fromRoot.startsWith("../")
	);
}

export function parsePluginManifest(
	input: unknown,
	pluginRoot: string,
	agentmeVersion: string,
): PluginManifest {
	if (!isRecord(input) || input.schemaVersion !== 1) return invalidManifest();
	if (typeof input.id !== "string" || !pluginIdPattern.test(input.id))
		return invalidManifest();
	if (typeof input.version !== "string" || valid(input.version) === null)
		return invalidManifest();
	if (!isSafeRelativePath(pluginRoot, input.entry)) return invalidManifest();
	if (
		!Array.isArray(input.capabilities) ||
		input.capabilities.length === 0 ||
		!input.capabilities.every(isCapabilityKind) ||
		new Set(input.capabilities).size !== input.capabilities.length
	) {
		return invalidManifest();
	}
	if (
		!Array.isArray(input.permissions) ||
		!input.permissions.every(
			(permission) =>
				typeof permission === "string" && permissionPattern.test(permission),
		) ||
		new Set(input.permissions).size !== input.permissions.length
	) {
		return invalidManifest();
	}
	if (
		input.configSchema !== undefined &&
		!isSafeRelativePath(pluginRoot, input.configSchema)
	) {
		return invalidManifest();
	}
	if (
		!isRecord(input.compatibility) ||
		typeof input.compatibility.agentme !== "string" ||
		validRange(input.compatibility.agentme) === null ||
		valid(agentmeVersion) === null
	) {
		return invalidManifest();
	}
	if (!satisfies(agentmeVersion, input.compatibility.agentme)) {
		throw new AgentMeError({
			code: "INCOMPATIBLE_PLUGIN",
			message: "Plugin is not compatible with this AgentMe version",
			isRetryable: false,
		});
	}

	const base = {
		schemaVersion: 1 as const,
		id: input.id,
		version: input.version,
		entry: input.entry,
		capabilities: input.capabilities,
		permissions: input.permissions,
		compatibility: { agentme: input.compatibility.agentme },
	};
	return input.configSchema === undefined
		? base
		: { ...base, configSchema: input.configSchema as string };
}

/** Reads and validates metadata without importing or otherwise evaluating the entry module. */
export async function discoverPlugin(
	manifestPath: string,
	agentmeVersion: string,
): Promise<DiscoveredPlugin> {
	try {
		const metadata = await stat(manifestPath);
		if (!metadata.isFile() || metadata.size > MAX_MANIFEST_BYTES)
			return invalidManifest();
		const pluginRoot = dirname(resolve(manifestPath));
		const input: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
		const manifest = parsePluginManifest(input, pluginRoot, agentmeVersion);
		return {
			manifestPath: resolve(manifestPath),
			pluginRoot,
			entryPath: resolve(pluginRoot, manifest.entry),
			manifest,
		};
	} catch (error) {
		if (error instanceof AgentMeError) throw error;
		return invalidManifest(error);
	}
}
