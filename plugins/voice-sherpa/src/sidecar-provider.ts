import { AgentMeError } from "../../../packages/contracts/src/index.js";
import {
	type NativeCommandRunner,
	SpawnNativeCommandRunner,
} from "../../../packages/platform-runtime/src/index.js";
import type {
	SpeechProvider,
	SpokenAudioInput,
	SynthesizedSpeech,
} from "../../../packages/voice-runtime/src/index.js";

export interface SidecarSpeechConfig {
	readonly executable: string;
	readonly args?: readonly string[];
}

export interface LocalWakeDetection {
	readonly awake: boolean;
	readonly phrase: string;
	readonly confidence: number;
}

function failed(message: string, cause?: unknown): AgentMeError {
	return new AgentMeError({
		code: "EXECUTION_FAILED",
		message,
		isRetryable: true,
		cause,
	});
}

function commandPart(value: string): string {
	if (value.length < 1 || value.length > 2_048 || /[\r\n\0]/u.test(value))
		throw failed("Local voice sidecar configuration is invalid");
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class SidecarSpeechProvider implements SpeechProvider {
	readonly id = "voice-local";
	readonly #executable: string;
	readonly #args: readonly string[];
	readonly #runner: NativeCommandRunner;

	constructor(
		config: SidecarSpeechConfig,
		dependencies: {
			readonly run: NativeCommandRunner["run"];
		} = new SpawnNativeCommandRunner(),
	) {
		this.#executable = commandPart(config.executable);
		if ((config.args?.length ?? 0) > 32)
			throw failed("Local voice sidecar configuration is invalid");
		this.#args = (config.args ?? []).map(commandPart);
		this.#runner = dependencies;
	}

	async transcribe(
		input: Omit<SpokenAudioInput, "route">,
		signal: AbortSignal,
	): Promise<string> {
		const value = await this.#invoke(
			"transcribe",
			{
				audioBase64: Buffer.from(input.audio).toString("base64"),
				mimeType: input.mimeType,
			},
			signal,
		);
		if (typeof value.transcript !== "string")
			throw failed("Local voice sidecar returned an invalid transcript");
		return value.transcript;
	}

	async synthesize(
		text: string,
		signal: AbortSignal,
	): Promise<SynthesizedSpeech> {
		const value = await this.#invoke("synthesize", { text }, signal);
		if (
			(value.mimeType !== "audio/wav" &&
				value.mimeType !== "audio/mpeg" &&
				value.mimeType !== "audio/ogg") ||
			typeof value.audioBase64 !== "string" ||
			value.audioBase64.length < 4 ||
			value.audioBase64.length > 13_981_016 ||
			!/^[A-Za-z0-9+/]+={0,2}$/u.test(value.audioBase64)
		)
			throw failed("Local voice sidecar returned invalid audio");
		return { mimeType: value.mimeType, audioBase64: value.audioBase64 };
	}

	async detectWake(
		input: Omit<SpokenAudioInput, "route">,
		signal: AbortSignal,
	): Promise<LocalWakeDetection> {
		const value = await this.#invoke(
			"wake",
			{
				audioBase64: Buffer.from(input.audio).toString("base64"),
				mimeType: input.mimeType,
			},
			signal,
		);
		if (
			typeof value.awake !== "boolean" ||
			typeof value.phrase !== "string" ||
			value.phrase.length < 1 ||
			value.phrase.length > 100 ||
			typeof value.confidence !== "number" ||
			!Number.isFinite(value.confidence) ||
			value.confidence < 0 ||
			value.confidence > 1
		)
			throw failed("Local voice sidecar returned invalid wake detection");
		return {
			awake: value.awake,
			phrase: value.phrase,
			confidence: value.confidence,
		};
	}

	async health(
		signal: AbortSignal,
	): Promise<{ readonly networkPolicy: "loopback-only" }> {
		const value = await this.#invoke("health", {}, signal);
		if (value.networkPolicy !== "loopback-only")
			throw failed("Local voice sidecar network policy is invalid");
		return { networkPolicy: value.networkPolicy };
	}

	async #invoke(
		operation: "health" | "transcribe" | "synthesize" | "wake",
		input: unknown,
		signal: AbortSignal,
	): Promise<Record<string, unknown>> {
		const result = await this.#runner.run({
			executable: this.#executable,
			args: [...this.#args, operation],
			stdin: JSON.stringify(input),
			signal,
			maxOutputBytes: 14 * 1024 * 1024,
			script: `voice-sidecar ${operation}`,
		});
		if (result.exitCode !== 0) throw failed("Local voice sidecar failed");
		try {
			const value: unknown = JSON.parse(result.stdout);
			if (!isRecord(value)) throw new TypeError("Invalid sidecar output");
			return value;
		} catch (error) {
			throw failed("Local voice sidecar returned invalid output", error);
		}
	}
}
