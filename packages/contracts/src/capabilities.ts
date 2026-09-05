import type { TaskEvent } from "./events.js";

export const capabilityKinds = [
	"assistant.model",
	"voice.wake",
	"voice.stt",
	"voice.tts",
	"voice.realtime",
	"channel",
	"coding.runtime",
	"memory.engine",
	"execution.target",
] as const;

export type CapabilityKind = (typeof capabilityKinds)[number];

export type ProviderActor =
	| { readonly type: "user"; readonly id: string }
	| { readonly type: "agent"; readonly id: string }
	| { readonly type: "channel"; readonly id: string }
	| { readonly type: "system"; readonly id: string };

export interface ProviderContext {
	readonly taskId: string;
	readonly actor: ProviderActor;
	readonly providerId: string;
	readonly signal: AbortSignal;
	readonly emit: (event: TaskEvent) => void | Promise<void>;
}

export type HealthStatus =
	| { readonly status: "healthy"; readonly checkedAt?: string }
	| {
			readonly status: "degraded";
			readonly message: string;
			readonly checkedAt?: string;
	  }
	| {
			readonly status: "unhealthy";
			readonly message: string;
			readonly checkedAt?: string;
	  }
	| { readonly status: "stopped"; readonly checkedAt?: string };

/** Implementations must make start and stop idempotent. */
export interface CapabilityProvider<TConfig, TInstance> {
	readonly id: string;
	readonly kind: CapabilityKind;
	readonly version: string;
	validate(config: unknown): TConfig;
	start(context: ProviderContext, config: TConfig): Promise<TInstance>;
	stop(): Promise<void>;
	health(): Promise<HealthStatus>;
}

export function isCapabilityKind(value: unknown): value is CapabilityKind {
	return (
		typeof value === "string" &&
		(capabilityKinds as readonly string[]).includes(value)
	);
}
