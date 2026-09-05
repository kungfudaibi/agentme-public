import type {
	AudioFrame,
	WakeEvent,
} from "../../../packages/contracts/src/index.js";

export interface KeywordEngine {
	infer(
		frame: AudioFrame,
		signal: AbortSignal,
	): Promise<{ phrase: string; confidence: number } | undefined>;
}
export interface WakeConfig {
	readonly phrase: string;
	readonly threshold: number;
	readonly debounceMs: number;
}

export class LocalWakeDetector {
	readonly #engine: KeywordEngine;
	#config: WakeConfig;
	#lastWake = -Infinity;
	constructor(engine: KeywordEngine, config: WakeConfig) {
		validate(config);
		this.#engine = engine;
		this.#config = config;
	}
	reconfigure(config: WakeConfig): void {
		validate(config);
		this.#config = config;
		this.#lastWake = -Infinity;
	}
	async accept(
		frame: AudioFrame,
		signal: AbortSignal,
	): Promise<WakeEvent | undefined> {
		const result = await this.#engine.infer(frame, signal);
		if (
			!result ||
			result.phrase !== this.#config.phrase ||
			result.confidence < this.#config.threshold ||
			frame.capturedAt - this.#lastWake < this.#config.debounceMs
		)
			return undefined;
		this.#lastWake = frame.capturedAt;
		return {
			phrase: result.phrase,
			confidence: result.confidence,
			at: new Date(frame.capturedAt).toISOString(),
		};
	}
}
function validate(config: WakeConfig): void {
	if (
		!config.phrase.trim() ||
		config.threshold < 0 ||
		config.threshold > 1 ||
		config.debounceMs < 0
	)
		throw new TypeError("Invalid wake configuration");
}
