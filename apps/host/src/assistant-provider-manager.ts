import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
	AgentMeError,
	type AssistantModel,
	type AssistantRequest,
	type SecretReference,
} from "../../../packages/contracts/src/index.js";
import type { SecretStore } from "../../../packages/platform-runtime/src/index.js";

export type AssistantProviderProfileId = "deepseek" | "aliyun";

export interface AssistantProviderProfileSettings {
	readonly endpoint: string;
	readonly model: string;
}

export interface AssistantProviderSettings {
	readonly activeProfileId: AssistantProviderProfileId;
	readonly profiles: Readonly<
		Record<AssistantProviderProfileId, AssistantProviderProfileSettings>
	>;
}

export interface AssistantProviderSettingsStore {
	save(settings: AssistantProviderSettings, signal: AbortSignal): Promise<void>;
}

export class JsonAssistantProviderSettingsStore
	implements AssistantProviderSettingsStore
{
	readonly #path: string;

	constructor(path: string) {
		this.#path = resolve(path);
	}

	async save(
		settings: AssistantProviderSettings,
		signal: AbortSignal,
	): Promise<void> {
		const assistant = parseAssistantProviderSettings(settings);
		let current: unknown = {};
		try {
			current = JSON.parse(
				await readFile(this.#path, { encoding: "utf8", signal }),
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (!isRecord(current)) throw invalidConfig();
		const temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
		await mkdir(dirname(this.#path), { recursive: true });
		try {
			await writeFile(
				temporary,
				`${JSON.stringify({ ...current, assistant }, null, 2)}\n`,
				{ encoding: "utf8", mode: 0o600, signal },
			);
			if (signal.aborted) throw signal.reason;
			await rename(temporary, this.#path);
		} catch (error) {
			await rm(temporary, { force: true });
			throw error;
		}
	}
}

export interface AssistantProviderProfileView
	extends AssistantProviderProfileSettings {
	readonly id: AssistantProviderProfileId;
	readonly name: string;
	readonly isActive: boolean;
	readonly isConfigured: boolean;
	readonly health: "ready" | "missing-key";
}

export interface AssistantProviderCatalog {
	readonly activeProfileId: AssistantProviderProfileId;
	readonly profiles: readonly AssistantProviderProfileView[];
}

export interface AssistantProviderResponse {
	readonly message: string;
	readonly provider: {
		readonly id: AssistantProviderProfileId;
		readonly model: string;
	};
}

export interface AssistantProviderManagerDependencies {
	readonly settings: AssistantProviderSettings;
	readonly settingsStore: AssistantProviderSettingsStore;
	readonly secrets: SecretStore;
	readonly createModel: (
		profile: AssistantProviderProfileSettings & {
			readonly id: AssistantProviderProfileId;
			readonly secret: SecretReference;
		},
	) => AssistantModel;
}

export interface AssistantProviderService {
	list(signal: AbortSignal): Promise<AssistantProviderCatalog>;
	configure(
		id: AssistantProviderProfileId,
		input: {
			readonly endpoint: string;
			readonly model: string;
			readonly apiKey?: string;
		},
		signal: AbortSignal,
	): Promise<void>;
	activate(id: AssistantProviderProfileId, signal: AbortSignal): Promise<void>;
	respond(
		request: AssistantRequest,
		signal: AbortSignal,
	): Promise<AssistantProviderResponse>;
}

const profileIds = ["deepseek", "aliyun"] as const;
const profileMetadata = {
	deepseek: {
		name: "DeepSeek",
		secret: { type: "secret-reference", id: "deepseek-api-key" },
	},
	aliyun: {
		name: "阿里云百炼",
		secret: { type: "secret-reference", id: "aliyun-api-key" },
	},
} as const satisfies Record<
	AssistantProviderProfileId,
	{ readonly name: string; readonly secret: SecretReference }
>;

function invalidConfig(): AgentMeError {
	return new AgentMeError({
		code: "INVALID_PROVIDER_CONFIG",
		message: "Assistant provider configuration is invalid",
		isRetryable: false,
	});
}

function providerUnavailable(): AgentMeError {
	return new AgentMeError({
		code: "PROVIDER_UNAVAILABLE",
		message: "Assistant provider did not complete a response",
		isRetryable: true,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProfileId(value: unknown): value is AssistantProviderProfileId {
	return value === "deepseek" || value === "aliyun";
}

function withCancellation<T>(
	operation: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		operation.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", abort);
		});
	});
}

function validatedProfile(
	id: AssistantProviderProfileId,
	value: unknown,
): AssistantProviderProfileSettings {
	if (!isRecord(value)) throw invalidConfig();
	if (Object.keys(value).some((key) => !["endpoint", "model"].includes(key)))
		throw invalidConfig();
	if (
		typeof value.endpoint !== "string" ||
		typeof value.model !== "string" ||
		value.model.length < 1 ||
		value.model.length > 128 ||
		!/^[a-z0-9][a-z0-9._:-]*$/iu.test(value.model)
	)
		throw invalidConfig();
	let endpoint: URL;
	try {
		endpoint = new URL(value.endpoint);
	} catch {
		throw invalidConfig();
	}
	if (
		endpoint.protocol !== "https:" ||
		endpoint.username ||
		endpoint.password ||
		endpoint.search ||
		endpoint.hash ||
		endpoint.pathname.endsWith("/chat/completions") === false
	)
		throw invalidConfig();
	if (
		id === "deepseek" &&
		(endpoint.hostname !== "api.deepseek.com" ||
			endpoint.pathname !== "/chat/completions")
	)
		throw invalidConfig();
	if (
		id === "aliyun" &&
		endpoint.hostname !== "dashscope.aliyuncs.com" &&
		!endpoint.hostname.endsWith(".maas.aliyuncs.com")
	)
		throw invalidConfig();
	return { endpoint: endpoint.href, model: value.model };
}

export function defaultAssistantProviderSettings(
	aliyunWorkspaceBaseUrl = "https://dashscope.aliyuncs.com",
): AssistantProviderSettings {
	const aliyunBase = aliyunWorkspaceBaseUrl.replace(/\/$/u, "");
	const aliyunEndpoint = aliyunBase.includes("/compatible-mode/v1")
		? `${aliyunBase}/chat/completions`
		: `${aliyunBase}/compatible-mode/v1/chat/completions`;
	return parseAssistantProviderSettings({
		activeProfileId: "deepseek",
		profiles: {
			deepseek: {
				endpoint: "https://api.deepseek.com/chat/completions",
				model: "deepseek-v4-flash",
			},
			aliyun: { endpoint: aliyunEndpoint, model: "qwen3.7-flash" },
		},
	});
}

export function parseAssistantProviderSettings(
	value: unknown,
): AssistantProviderSettings {
	if (
		!isRecord(value) ||
		Object.keys(value).some(
			(key) => !["activeProfileId", "profiles"].includes(key),
		) ||
		!isProfileId(value.activeProfileId) ||
		!isRecord(value.profiles)
	)
		throw invalidConfig();
	const profiles = value.profiles as Record<string, unknown>;
	if (
		Object.keys(profiles).some((key) => !isProfileId(key)) ||
		profileIds.some((id) => profiles[id] === undefined)
	)
		throw invalidConfig();
	return {
		activeProfileId: value.activeProfileId,
		profiles: {
			deepseek: validatedProfile("deepseek", profiles.deepseek),
			aliyun: validatedProfile("aliyun", profiles.aliyun),
		},
	};
}

export class AssistantProviderManager implements AssistantProviderService {
	readonly #settingsStore: AssistantProviderSettingsStore;
	readonly #secrets: SecretStore;
	readonly #createModel: AssistantProviderManagerDependencies["createModel"];
	#changes: Promise<void> = Promise.resolve();
	#settings: AssistantProviderSettings;

	constructor(dependencies: AssistantProviderManagerDependencies) {
		this.#settings = parseAssistantProviderSettings(dependencies.settings);
		this.#settingsStore = dependencies.settingsStore;
		this.#secrets = dependencies.secrets;
		this.#createModel = dependencies.createModel;
	}

	async list(signal: AbortSignal): Promise<AssistantProviderCatalog> {
		await withCancellation(this.#changes, signal);
		const profiles = await Promise.all(
			profileIds.map(async (id): Promise<AssistantProviderProfileView> => {
				let isConfigured = false;
				try {
					await this.#secrets.get(profileMetadata[id].secret, signal);
					isConfigured = true;
				} catch {
					if (signal.aborted) throw signal.reason;
				}
				return {
					id,
					name: profileMetadata[id].name,
					...this.#settings.profiles[id],
					isActive: this.#settings.activeProfileId === id,
					isConfigured,
					health: isConfigured ? "ready" : "missing-key",
				};
			}),
		);
		return { activeProfileId: this.#settings.activeProfileId, profiles };
	}

	async configure(
		id: AssistantProviderProfileId,
		input: {
			readonly endpoint: string;
			readonly model: string;
			readonly apiKey?: string;
		},
		signal: AbortSignal,
	): Promise<void> {
		return this.#serializeChange(signal, async () => {
			if (!isProfileId(id)) throw invalidConfig();
			const profile = validatedProfile(id, {
				endpoint: input.endpoint,
				model: input.model,
			});
			if (
				input.apiKey !== undefined &&
				(input.apiKey.length < 1 || input.apiKey.length > 65_536)
			)
				throw invalidConfig();
			if (input.apiKey !== undefined)
				await this.#secrets.set(
					profileMetadata[id].secret,
					input.apiKey,
					signal,
				);
			const settings = parseAssistantProviderSettings({
				...this.#settings,
				profiles: { ...this.#settings.profiles, [id]: profile },
			});
			await this.#settingsStore.save(settings, signal);
			this.#settings = settings;
		});
	}

	async activate(
		id: AssistantProviderProfileId,
		signal: AbortSignal,
	): Promise<void> {
		return this.#serializeChange(signal, async () => {
			if (!isProfileId(id)) throw invalidConfig();
			await this.#secrets.get(profileMetadata[id].secret, signal);
			const settings = parseAssistantProviderSettings({
				...this.#settings,
				activeProfileId: id,
			});
			await this.#settingsStore.save(settings, signal);
			this.#settings = settings;
		});
	}

	async respond(
		request: AssistantRequest,
		signal: AbortSignal,
	): Promise<AssistantProviderResponse> {
		await withCancellation(this.#changes, signal);
		const id = this.#settings.activeProfileId;
		const profile = this.#settings.profiles[id];
		const model = this.#createModel({
			id,
			...profile,
			secret: profileMetadata[id].secret,
		});
		let message: string | undefined;
		for await (const event of model.converse(request, signal)) {
			if (event.type === "assistant.response.failed") throw event.error;
			if (event.type === "assistant.response.completed")
				message = event.message;
		}
		if (message === undefined) throw providerUnavailable();
		return { message, provider: { id, model: profile.model } };
	}

	#serializeChange(
		signal: AbortSignal,
		change: () => Promise<void>,
	): Promise<void> {
		const operation = this.#changes.then(async () => {
			if (signal.aborted) throw signal.reason;
			await change();
		});
		this.#changes = operation.then(
			() => undefined,
			() => undefined,
		);
		return withCancellation(operation, signal);
	}
}
