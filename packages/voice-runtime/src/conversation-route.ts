import { AgentMeError } from "../../contracts/src/index.js";
import {
	type RoutedVoiceResult,
	routeWithFallback,
	type VoiceRoute,
} from "./fallback-router.js";

export type VoiceRouteSelection = "local" | "aliyun" | "auto";

export interface SpokenAudioInput {
	readonly audio: Uint8Array;
	readonly mimeType: "audio/wav" | "audio/webm" | "audio/ogg" | "audio/mp3";
	readonly route: VoiceRouteSelection;
}

export interface SynthesizedSpeech {
	readonly mimeType: "audio/wav" | "audio/mpeg" | "audio/ogg";
	readonly audioBase64?: string;
	readonly audioUrl?: string;
}

export interface SpokenVoiceRuntime {
	transcribe(
		input: SpokenAudioInput,
		signal: AbortSignal,
	): Promise<RoutedVoiceResult<string>>;
	synthesize(
		text: string,
		route: VoiceRouteSelection,
		signal: AbortSignal,
	): Promise<RoutedVoiceResult<SynthesizedSpeech>>;
}

export interface SpeechProvider {
	readonly id: string;
	transcribe(
		input: Omit<SpokenAudioInput, "route">,
		signal: AbortSignal,
	): Promise<string>;
	synthesize(text: string, signal: AbortSignal): Promise<SynthesizedSpeech>;
}

function unavailable(): AgentMeError {
	return new AgentMeError({
		code: "PROVIDER_UNAVAILABLE",
		message: "The selected voice provider is unavailable",
		isRetryable: true,
	});
}

function requireProvider(provider: SpeechProvider | undefined): SpeechProvider {
	if (provider === undefined) throw unavailable();
	return provider;
}

function asTranscriptionRoute(
	provider: SpeechProvider,
): VoiceRoute<Omit<SpokenAudioInput, "route">, string> {
	return {
		id: provider.id,
		execute: (input, signal) => provider.transcribe(input, signal),
	};
}

function asSynthesisRoute(
	provider: SpeechProvider,
): VoiceRoute<string, SynthesizedSpeech> {
	return {
		id: provider.id,
		execute: (text, signal) => provider.synthesize(text, signal),
	};
}

export class SpokenConversationRouter implements SpokenVoiceRuntime {
	readonly #local: SpeechProvider | undefined;
	readonly #aliyun: SpeechProvider | undefined;

	constructor(options: {
		readonly local?: SpeechProvider;
		readonly aliyun?: SpeechProvider;
	}) {
		this.#local = options.local;
		this.#aliyun = options.aliyun;
	}

	async transcribe(
		input: SpokenAudioInput,
		signal: AbortSignal,
	): Promise<RoutedVoiceResult<string>> {
		const result = await this.#route(
			input.route,
			(provider) => asTranscriptionRoute(provider),
			{ audio: input.audio, mimeType: input.mimeType },
			signal,
		);
		const transcript = result.value.trim();
		if (transcript.length < 1 || transcript.length > 4_000)
			throw new AgentMeError({
				code: "EXECUTION_FAILED",
				message: "Voice provider returned an invalid transcript",
				isRetryable: true,
			});
		return { ...result, value: transcript };
	}

	async synthesize(
		text: string,
		route: VoiceRouteSelection,
		signal: AbortSignal,
	): Promise<RoutedVoiceResult<SynthesizedSpeech>> {
		if (text.length < 1 || text.length > 1_000) throw unavailable();
		return this.#route(
			route,
			(provider) => asSynthesisRoute(provider),
			text,
			signal,
		);
	}

	async #route<TInput, TOutput>(
		selection: VoiceRouteSelection,
		adapt: (provider: SpeechProvider) => VoiceRoute<TInput, TOutput>,
		input: TInput,
		signal: AbortSignal,
	): Promise<RoutedVoiceResult<TOutput>> {
		switch (selection) {
			case "local":
				return routeWithFallback(
					adapt(requireProvider(this.#local)),
					undefined,
					input,
					signal,
				);
			case "aliyun":
				return routeWithFallback(
					adapt(requireProvider(this.#aliyun)),
					undefined,
					input,
					signal,
				);
			case "auto":
				return routeWithFallback(
					adapt(requireProvider(this.#local ?? this.#aliyun)),
					this.#local !== undefined && this.#aliyun !== undefined
						? adapt(this.#aliyun)
						: undefined,
					input,
					signal,
				);
		}
	}
}
