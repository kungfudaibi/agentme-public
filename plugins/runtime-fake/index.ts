import type {
	CapabilityProvider,
	HealthStatus,
	ProviderContext,
} from "../../packages/contracts/src/index.js";

export interface FakeRuntimeInstance {
	readonly providerId: "runtime-fake";
	execute(
		instruction: string,
		signal: AbortSignal,
	): Promise<{ summary: string }>;
}

interface FakeRuntimeConfig {
	readonly delayMs: number;
}

class FakeRuntimeProvider
	implements CapabilityProvider<unknown, FakeRuntimeInstance>
{
	readonly id = "runtime-fake";
	readonly kind = "coding.runtime" as const;
	readonly version = "0.1.0";
	#instance: FakeRuntimeInstance | undefined;

	validate(config: unknown): FakeRuntimeConfig {
		if (
			typeof config !== "object" ||
			config === null ||
			Array.isArray(config)
		) {
			throw new TypeError("Fake runtime configuration is invalid");
		}
		const delayMs = (config as Record<string, unknown>).delayMs;
		if (
			typeof delayMs !== "number" ||
			!Number.isSafeInteger(delayMs) ||
			delayMs < 0 ||
			delayMs > 60_000
		) {
			throw new TypeError("Fake runtime delay is invalid");
		}
		return { delayMs };
	}

	async start(
		_context: ProviderContext,
		config: unknown,
	): Promise<FakeRuntimeInstance> {
		const { delayMs } = config as FakeRuntimeConfig;
		this.#instance ??= {
			providerId: "runtime-fake",
			execute: async (instruction, signal) => {
				await wait(delayMs, signal);
				return { summary: `Fake runtime completed: ${instruction}` };
			},
		};
		return this.#instance;
	}

	async stop(): Promise<void> {
		this.#instance = undefined;
	}

	async health(): Promise<HealthStatus> {
		return { status: this.#instance === undefined ? "stopped" : "healthy" };
	}
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		const onAbort = () => {
			clearTimeout(timeout);
			reject(signal.reason);
		};
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, delayMs);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

export function createProviders(): readonly CapabilityProvider<
	unknown,
	unknown
>[] {
	return [new FakeRuntimeProvider()];
}
