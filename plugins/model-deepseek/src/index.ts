import { resolve } from "node:path";

import {
	AgentMeError,
	type AssistantModel,
	type CapabilityProvider,
	type HealthStatus,
	type ProviderContext,
} from "../../../packages/contracts/src/index.js";
import {
	createPlatformSecretStore,
	type SecretStore,
} from "../../../packages/platform-runtime/src/index.js";
import {
	DeepSeekAssistantModel,
	type DeepSeekConfig,
	type DeepSeekDependencies,
} from "./client.js";

const defaultConfig: DeepSeekConfig = {
	endpoint: "https://api.deepseek.com/chat/completions",
	model: "deepseek-v4-flash",
	secret: { type: "secret-reference", id: "deepseek-api-key" },
	timeoutMs: 120_000,
};

function invalidConfig(): never {
	throw new AgentMeError({
		code: "INVALID_PROVIDER_CONFIG",
		message: "Invalid DeepSeek configuration",
		isRetryable: false,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class DeepSeekModelProvider
	implements CapabilityProvider<unknown, AssistantModel>
{
	readonly id = "model-deepseek";
	readonly kind = "assistant.model" as const;
	readonly version = "0.1.0";
	readonly #dependencies: Omit<DeepSeekDependencies, "lifecycleSignal">;
	#model: AssistantModel | undefined;

	constructor(dependencies: Omit<DeepSeekDependencies, "lifecycleSignal">) {
		this.#dependencies = dependencies;
	}

	validate(input: unknown): DeepSeekConfig {
		if (!isRecord(input)) return invalidConfig();
		const allowed = new Set(["endpoint", "model", "timeoutMs"]);
		if (Object.keys(input).some((key) => !allowed.has(key)))
			return invalidConfig();
		const endpoint = input.endpoint ?? defaultConfig.endpoint;
		const model = input.model ?? defaultConfig.model;
		const timeoutMs = input.timeoutMs ?? defaultConfig.timeoutMs;
		if (
			typeof endpoint !== "string" ||
			typeof model !== "string" ||
			model.length < 1 ||
			model.length > 128 ||
			!Number.isSafeInteger(timeoutMs) ||
			(timeoutMs as number) < 1_000 ||
			(timeoutMs as number) > 600_000
		)
			return invalidConfig();
		let url: URL;
		try {
			url = new URL(endpoint);
		} catch {
			return invalidConfig();
		}
		if (
			url.origin !== "https://api.deepseek.com" ||
			url.pathname !== "/chat/completions" ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		)
			return invalidConfig();
		return {
			endpoint: url.href,
			model,
			secret: defaultConfig.secret,
			timeoutMs: timeoutMs as number,
		};
	}

	async start(
		context: ProviderContext,
		config: unknown,
	): Promise<AssistantModel> {
		this.#model ??= new DeepSeekAssistantModel(config as DeepSeekConfig, {
			...this.#dependencies,
			lifecycleSignal: context.signal,
		});
		return this.#model;
	}

	async stop(): Promise<void> {
		this.#model = undefined;
	}

	async health(): Promise<HealthStatus> {
		return { status: this.#model === undefined ? "stopped" : "healthy" };
	}
}

export function createDeepSeekProvider(
	secretStore: SecretStore,
): DeepSeekModelProvider {
	return new DeepSeekModelProvider({ secretStore });
}

export function createProviders(): readonly CapabilityProvider<
	unknown,
	unknown
>[] {
	const secretStore = createPlatformSecretStore({
		dataDirectory: resolve(process.cwd(), ".agentme", "secrets"),
	});
	return [createDeepSeekProvider(secretStore)];
}

export * from "./client.js";
