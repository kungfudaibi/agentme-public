import { describe, expect, it, vi } from "vitest";
import { routeWithFallback } from "../../../packages/voice-runtime/src/index.js";
import { AliyunSpeechProvider, AliyunVoiceClient } from "../src/index.js";

describe("Alibaba voice route", () => {
	it("resolves secrets only at call time and never serializes them", async () => {
		const resolve = vi.fn(async () => "secret-value");
		const fetcher = vi.fn(
			async (_url, _init) =>
				new Response(JSON.stringify({ text: "好" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		const client = new AliyunVoiceClient(
			{ endpoint: "https://example.invalid", model: "qwen-audio" },
			{ resolve },
			fetcher as typeof fetch,
		);
		expect(JSON.stringify(client)).not.toContain("secret-value");
		await client.invoke({ audio: "post-wake" }, new AbortController().signal);
		expect(resolve).toHaveBeenCalledOnce();
	});
	it("uses fallback only when explicitly supplied", async () => {
		const primary = {
			id: "cloud",
			execute: async () => {
				throw new Error("offline");
			},
		};
		const fallback = { id: "local", execute: async () => "本地结果" };
		expect(
			await routeWithFallback(
				primary,
				fallback,
				"audio",
				new AbortController().signal,
			),
		).toEqual({ providerId: "local", value: "本地结果", fallbackUsed: true });
	});

	it("uses the documented workspace ASR shape and validates its transcript", async () => {
		const resolve = vi.fn(async () => "call-time-key");
		const fetcher = vi.fn(
			async (_url: string | URL | Request, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
				expect(body).toMatchObject({
					model: "qwen-audio-3.0-asr-flash",
					input: {
						messages: [
							{
								role: "user",
								content: [
									{
										type: "input_audio",
										input_audio: {
											data: "data:audio/webm;base64,UklGRg==",
										},
									},
								],
							},
						],
					},
				});
				return new Response(
					JSON.stringify({ output: { text: "检查 AgentMe 的测试" } }),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		);
		const provider = new AliyunSpeechProvider(
			{
				workspaceBaseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com",
				asrModel: "qwen-audio-3.0-asr-flash",
				ttsModel: "qwen-audio-3.0-tts-flash",
				voice: "longanhuan_v3.6",
			},
			{ resolve },
			fetcher as typeof fetch,
		);

		expect(
			await provider.transcribe(
				{ audio: new Uint8Array(Buffer.from("RIFF")), mimeType: "audio/webm" },
				new AbortController().signal,
			),
		).toBe("检查 AgentMe 的测试");
		expect(resolve).toHaveBeenCalledOnce();
	});

	it("uses the documented workspace TTS shape and accepts bounded WAV data", async () => {
		const fetcher = vi.fn(
			async (_url: string | URL | Request, init?: RequestInit) => {
				expect(JSON.parse(String(init?.body))).toMatchObject({
					model: "qwen-audio-3.0-tts-flash",
					input: {
						text: "任务已开始",
						voice: "longanhuan_v3.6",
						format: "wav",
					},
				});
				return new Response(
					JSON.stringify({ output: { audio: { data: "UklGRg==" } } }),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		);
		const provider = new AliyunSpeechProvider(
			{
				workspaceBaseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com",
				asrModel: "qwen-audio-3.0-asr-flash",
				ttsModel: "qwen-audio-3.0-tts-flash",
				voice: "longanhuan_v3.6",
			},
			{ resolve: async () => "call-time-key" },
			fetcher as typeof fetch,
		);

		expect(
			await provider.synthesize("任务已开始", new AbortController().signal),
		).toEqual({ mimeType: "audio/wav", audioBase64: "UklGRg==" });
	});

	it("rejects unsafe cloud audio URLs", async () => {
		const fetcher = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						output: { audio: { url: "http://example.aliyuncs.com/audio.wav" } },
					}),
					{ status: 200 },
				),
		);
		const provider = new AliyunSpeechProvider(
			{
				workspaceBaseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com",
				asrModel: "qwen-audio-3.0-asr-flash",
				ttsModel: "qwen-audio-3.0-tts-flash",
				voice: "longanhuan_v3.6",
			},
			{ resolve: async () => "call-time-key" },
			fetcher as typeof fetch,
		);

		await expect(
			provider.synthesize("任务已开始", new AbortController().signal),
		).rejects.toMatchObject({ code: "EXECUTION_FAILED" });
		expect(fetcher).toHaveBeenCalledOnce();
	});
});
