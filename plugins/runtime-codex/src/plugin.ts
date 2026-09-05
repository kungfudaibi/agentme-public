import type {
	CapabilityProvider,
	HealthStatus,
	ProviderContext,
} from "../../../packages/contracts/src/index.js";
import { CodexCliRuntime, type CodexRuntimeConfig } from "./runtime.js";

class CodexRuntimeProvider
	implements CapabilityProvider<unknown, CodexCliRuntime>
{
	readonly id = "runtime-codex";
	readonly kind = "coding.runtime" as const;
	readonly version = "0.1.0";
	#runtime: CodexCliRuntime | undefined;

	validate(config: unknown): CodexRuntimeConfig {
		if (typeof config !== "object" || config === null || Array.isArray(config))
			throw new TypeError("Invalid Codex configuration");
		const record = config as Record<string, unknown>;
		if (typeof record.executable !== "string" || record.executable.length === 0)
			throw new TypeError("Invalid Codex executable");
		if (record.model !== undefined && typeof record.model !== "string")
			throw new TypeError("Invalid Codex model");
		if (
			record.windowsSandbox !== undefined &&
			record.windowsSandbox !== "elevated" &&
			record.windowsSandbox !== "unelevated"
		)
			throw new TypeError("Invalid Windows sandbox mode");
		if (
			record.resourceDirectory !== undefined &&
			typeof record.resourceDirectory !== "string"
		)
			throw new TypeError("Invalid Codex resource directory");
		return {
			executable: record.executable,
			...(record.model === undefined ? {} : { model: record.model as string }),
			...(record.windowsSandbox === undefined
				? {}
				: {
						windowsSandbox: record.windowsSandbox as "elevated" | "unelevated",
					}),
			...(record.resourceDirectory === undefined
				? {}
				: { resourceDirectory: record.resourceDirectory as string }),
		};
	}

	async start(
		_context: ProviderContext,
		config: unknown,
	): Promise<CodexCliRuntime> {
		this.#runtime ??= new CodexCliRuntime(config as CodexRuntimeConfig);
		return this.#runtime;
	}

	async stop(): Promise<void> {
		this.#runtime = undefined;
	}

	async health(): Promise<HealthStatus> {
		return { status: this.#runtime === undefined ? "stopped" : "healthy" };
	}
}

export function createProviders(): readonly CapabilityProvider<
	unknown,
	unknown
>[] {
	return [new CodexRuntimeProvider()];
}
