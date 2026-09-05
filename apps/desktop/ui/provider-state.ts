export type ProviderProfileId = "deepseek" | "aliyun";

export interface ProviderProfile {
	readonly id: ProviderProfileId;
	readonly name: string;
	readonly endpoint: string;
	readonly model: string;
	readonly isActive: boolean;
	readonly isConfigured: boolean;
	readonly health: "ready" | "missing-key";
}

export interface ProviderCatalog {
	readonly activeProfileId: ProviderProfileId;
	readonly profiles: readonly ProviderProfile[];
}

export interface ProviderConfigurationInput {
	readonly endpoint: string;
	readonly model: string;
	readonly apiKey: string;
}

export interface ProviderConfiguration {
	readonly endpoint: string;
	readonly model: string;
	readonly apiKey?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProfileId(value: unknown): value is ProviderProfileId {
	return value === "deepseek" || value === "aliyun";
}

function invalidCatalog(): never {
	throw new TypeError("Invalid provider catalog");
}

export function parseProviderCatalog(value: unknown): ProviderCatalog {
	if (
		!isRecord(value) ||
		Object.keys(value).some(
			(key) => !["activeProfileId", "profiles"].includes(key),
		) ||
		!isProfileId(value.activeProfileId) ||
		!Array.isArray(value.profiles) ||
		value.profiles.length > 20
	)
		return invalidCatalog();
	const profiles = value.profiles.map((input): ProviderProfile => {
		if (
			!isRecord(input) ||
			Object.keys(input).some(
				(key) =>
					![
						"id",
						"name",
						"endpoint",
						"model",
						"isActive",
						"isConfigured",
						"health",
					].includes(key),
			) ||
			!isProfileId(input.id) ||
			typeof input.name !== "string" ||
			input.name.length < 1 ||
			input.name.length > 100 ||
			typeof input.endpoint !== "string" ||
			input.endpoint.length < 1 ||
			input.endpoint.length > 2_048 ||
			typeof input.model !== "string" ||
			input.model.length < 1 ||
			input.model.length > 128 ||
			typeof input.isActive !== "boolean" ||
			typeof input.isConfigured !== "boolean" ||
			(input.health !== "ready" && input.health !== "missing-key")
		)
			return invalidCatalog();
		return {
			id: input.id,
			name: input.name,
			endpoint: input.endpoint,
			model: input.model,
			isActive: input.isActive,
			isConfigured: input.isConfigured,
			health: input.health,
		};
	});
	return { activeProfileId: value.activeProfileId, profiles };
}

export function buildProviderConfiguration(
	input: ProviderConfigurationInput,
): ProviderConfiguration {
	const endpoint = input.endpoint.trim();
	const model = input.model.trim();
	const apiKey = input.apiKey.trim();
	if (
		endpoint.length < 1 ||
		endpoint.length > 2_048 ||
		model.length < 1 ||
		model.length > 128 ||
		apiKey.length > 65_536
	)
		throw new TypeError("Invalid provider configuration");
	return {
		endpoint,
		model,
		...(apiKey.length === 0 ? {} : { apiKey }),
	};
}
