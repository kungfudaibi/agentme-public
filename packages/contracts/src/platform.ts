import { AgentMeError } from "./errors.js";

export interface SecretReference {
	readonly type: "secret-reference";
	readonly id: string;
}

export type DesktopStatus =
	| { readonly type: "starting" }
	| { readonly type: "listening"; readonly isMuted: boolean }
	| { readonly type: "thinking"; readonly taskId?: string }
	| { readonly type: "speaking" }
	| { readonly type: "degraded"; readonly reason: string };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
	const allowed = new Set(keys);
	return Object.keys(value).every((key) => allowed.has(key));
}

function identifier(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const id = value.trim();
	return id.length > 0 && id.length <= 128 && /^[a-z0-9][a-z0-9._-]*$/i.test(id)
		? id
		: undefined;
}

function invalidPlatformContract(): never {
	throw new AgentMeError({
		code: "INVALID_CONTRACT",
		message: "Invalid platform contract",
		isRetryable: false,
	});
}

export function parseSecretReference(input: unknown): SecretReference {
	if (
		!isRecord(input) ||
		!hasOnlyKeys(input, ["type", "id"]) ||
		input.type !== "secret-reference"
	)
		return invalidPlatformContract();
	const id = identifier(input.id);
	if (!id) return invalidPlatformContract();
	return { type: input.type, id };
}

export function parseDesktopStatus(input: unknown): DesktopStatus {
	if (!isRecord(input) || typeof input.type !== "string")
		return invalidPlatformContract();
	switch (input.type) {
		case "starting":
		case "speaking":
			if (!hasOnlyKeys(input, ["type"])) return invalidPlatformContract();
			return { type: input.type };
		case "listening":
			if (
				!hasOnlyKeys(input, ["type", "isMuted"]) ||
				typeof input.isMuted !== "boolean"
			)
				return invalidPlatformContract();
			return { type: input.type, isMuted: input.isMuted };
		case "thinking": {
			if (!hasOnlyKeys(input, ["type", "taskId"]))
				return invalidPlatformContract();
			if (input.taskId === undefined) return { type: input.type };
			const taskId = identifier(input.taskId);
			if (!taskId) return invalidPlatformContract();
			return { type: input.type, taskId };
		}
		case "degraded": {
			if (
				!hasOnlyKeys(input, ["type", "reason"]) ||
				typeof input.reason !== "string" ||
				input.reason.trim().length < 1 ||
				input.reason.length > 1_000
			)
				return invalidPlatformContract();
			return { type: input.type, reason: input.reason.trim() };
		}
		default:
			return invalidPlatformContract();
	}
}
