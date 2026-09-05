import { AgentMeError } from "../../../packages/contracts/src/index.js";
import type {
	SpeechProvider,
	SpokenAudioInput,
	SynthesizedSpeech,
} from "../../../packages/voice-runtime/src/index.js";
import type { SecretResolver } from "./client.js";

const MAX_JSON_BYTES = 14 * 1024 * 1024;
const MAX_AUDIO_BASE64_LENGTH = 13_981_016;

export interface AliyunSpeechConfig {
	readonly workspaceBaseUrl: string;
	readonly asrModel: string;
	readonly ttsModel: string;
	readonly voice: string;
}

function providerFailure(message: string, cause?: unknown): AgentMeError {
	return new AgentMeError({
		code: "EXECUTION_FAILED",
		message,
		isRetryable: true,
		cause,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeBaseUrl(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch (error) {
		throw providerFailure("Alibaba voice configuration is invalid", error);
	}
	const supportedHost =
		url.hostname === "dashscope.aliyuncs.com" ||
		url.hostname.endsWith(".cn-beijing.maas.aliyuncs.com");
	if (
		url.protocol !== "https:" ||
		!supportedHost ||
		(url.pathname !== "/" && url.pathname !== "") ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw providerFailure("Alibaba voice configuration is invalid");
	return url;
}

function modelName(value: string): string {
	if (!/^[a-z0-9][a-z0-9.-]{0,127}$/u.test(value))
		throw providerFailure("Alibaba voice configuration is invalid");
	return value;
}

function voiceName(value: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value))
		throw providerFailure("Alibaba voice configuration is invalid");
	return value;
}

function formatFor(mimeType: SpokenAudioInput["mimeType"]): string {
	return {
		"audio/wav": "wav",
		"audio/webm": "webm",
		"audio/ogg": "ogg",
		"audio/mp3": "mp3",
	}[mimeType];
}

async function json(response: Response): Promise<Record<string, unknown>> {
	let value: unknown;
	try {
		const declaredLength = Number(response.headers.get("content-length"));
		if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES)
			throw new RangeError("Alibaba voice response is too large");
		const body = await response.text();
		if (Buffer.byteLength(body) > MAX_JSON_BYTES)
			throw new RangeError("Alibaba voice response is too large");
		value = JSON.parse(body);
	} catch (error) {
		throw providerFailure("Alibaba voice returned an invalid response", error);
	}
	if (!isRecord(value))
		throw providerFailure("Alibaba voice returned an invalid response");
	return value;
}

export class AliyunSpeechProvider implements SpeechProvider {
	readonly id = "voice-aliyun";
	readonly #baseUrl: URL;
	readonly #asrModel: string;
	readonly #ttsModel: string;
	readonly #voice: string;
	readonly #secrets: SecretResolver;
	readonly #fetch: typeof fetch;

	constructor(
		config: AliyunSpeechConfig,
		secrets: SecretResolver,
		fetcher: typeof fetch = fetch,
	) {
		this.#baseUrl = safeBaseUrl(config.workspaceBaseUrl);
		this.#asrModel = modelName(config.asrModel);
		this.#ttsModel = modelName(config.ttsModel);
		this.#voice = voiceName(config.voice);
		this.#secrets = secrets;
		this.#fetch = fetcher;
	}

	async transcribe(
		input: Omit<SpokenAudioInput, "route">,
		signal: AbortSignal,
	): Promise<string> {
		const response = await this.#request(
			"api/v1/services/aigc/multimodal-generation/generation",
			{
				model: this.#asrModel,
				input: {
					messages: [
						{
							role: "user",
							content: [
								{
									type: "input_audio",
									input_audio: {
										data: `data:${input.mimeType};base64,${Buffer.from(input.audio).toString("base64")}`,
									},
								},
							],
						},
					],
				},
				parameters: { format: formatFor(input.mimeType) },
			},
			signal,
		);
		const body = await json(response);
		const output = body.output;
		if (!isRecord(output) || typeof output.text !== "string")
			throw providerFailure("Alibaba voice returned an invalid transcript");
		return output.text;
	}

	async synthesize(
		text: string,
		signal: AbortSignal,
	): Promise<SynthesizedSpeech> {
		const response = await this.#request(
			"api/v1/services/audio/tts/SpeechSynthesizer",
			{
				model: this.#ttsModel,
				input: {
					text,
					voice: this.#voice,
					format: "wav",
					sample_rate: 24_000,
				},
			},
			signal,
		);
		const body = await json(response);
		const output = body.output;
		const audio = isRecord(output) ? output.audio : undefined;
		if (!isRecord(audio))
			throw providerFailure("Alibaba voice returned invalid audio");
		if (typeof audio.data === "string") {
			if (
				audio.data.length < 4 ||
				audio.data.length > MAX_AUDIO_BASE64_LENGTH ||
				!/^[A-Za-z0-9+/]+={0,2}$/u.test(audio.data)
			)
				throw providerFailure("Alibaba voice returned invalid audio");
			return { mimeType: "audio/wav", audioBase64: audio.data };
		}
		if (typeof audio.url !== "string")
			throw providerFailure("Alibaba voice returned invalid audio");
		const url = new URL(audio.url);
		if (url.protocol !== "https:" || !url.hostname.endsWith(".aliyuncs.com"))
			throw providerFailure("Alibaba voice returned an unsafe audio URL");
		const audioResponse = await this.#fetch(url, {
			signal,
			redirect: "error",
		});
		if (!audioResponse.ok)
			throw providerFailure(
				`Alibaba voice audio download failed (${audioResponse.status})`,
			);
		const bytes = new Uint8Array(await audioResponse.arrayBuffer());
		if (bytes.length < 1 || bytes.length > 10 * 1024 * 1024)
			throw providerFailure("Alibaba voice returned invalid audio");
		return {
			mimeType: "audio/wav",
			audioBase64: Buffer.from(bytes).toString("base64"),
		};
	}

	async #request(
		path: string,
		body: unknown,
		signal: AbortSignal,
	): Promise<Response> {
		const key = await this.#secrets.resolve("aliyun-api-key");
		const response = await this.#fetch(new URL(path, this.#baseUrl), {
			method: "POST",
			headers: {
				authorization: `Bearer ${key}`,
				"content-type": "application/json",
				"x-dashscope-sse": "disable",
			},
			body: JSON.stringify(body),
			signal,
		});
		if (!response.ok)
			throw providerFailure(
				`Alibaba voice request failed (${response.status})`,
			);
		return response;
	}
}
