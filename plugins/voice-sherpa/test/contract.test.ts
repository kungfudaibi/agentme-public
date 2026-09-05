import { describe, expect, it, vi } from "vitest";
import { LocalWakeDetector, SidecarSpeechProvider } from "../src/index.js";

describe("local sherpa wake contract", () => {
	it("applies phrase, threshold and debounce without network", async () => {
		const infer = vi.fn(async () => ({ phrase: "你好小麦", confidence: 0.9 }));
		const detector = new LocalWakeDetector(
			{ infer },
			{ phrase: "你好小麦", threshold: 0.8, debounceMs: 1000 },
		);
		const signal = new AbortController().signal;
		expect(
			await detector.accept(
				{ pcm: new Uint8Array(), capturedAt: 1000 },
				signal,
			),
		).toMatchObject({ phrase: "你好小麦" });
		expect(
			await detector.accept(
				{ pcm: new Uint8Array(), capturedAt: 1500 },
				signal,
			),
		).toBeUndefined();
		detector.reconfigure({ phrase: "开始工作", threshold: 0.5, debounceMs: 0 });
		expect(
			await detector.accept(
				{ pcm: new Uint8Array(), capturedAt: 1600 },
				signal,
			),
		).toBeUndefined();
		expect(infer).toHaveBeenCalledTimes(3);
	});
});

describe("local speech sidecar", () => {
	it("passes audio and text through JSON stdin without constructing a shell command", async () => {
		const run = vi
			.fn()
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: JSON.stringify({ transcript: "修复测试" }),
				stderr: "",
			})
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: JSON.stringify({
					mimeType: "audio/wav",
					audioBase64: "UklGRg==",
				}),
				stderr: "",
			});
		const provider = new SidecarSpeechProvider(
			{ executable: "voice-sidecar", args: ["--config", "local.json"] },
			{ run },
		);
		const signal = new AbortController().signal;

		expect(
			await provider.transcribe(
				{ audio: new Uint8Array([1, 2]), mimeType: "audio/wav" },
				signal,
			),
		).toBe("修复测试");
		expect(await provider.synthesize("任务已开始", signal)).toEqual({
			mimeType: "audio/wav",
			audioBase64: "UklGRg==",
		});
		expect(run).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				executable: "voice-sidecar",
				args: ["--config", "local.json", "synthesize"],
				stdin: JSON.stringify({ text: "任务已开始" }),
				signal,
				script: "voice-sidecar synthesize",
			}),
		);
		expect(run.mock.calls[1]?.[0]?.args).not.toContain("任务已开始");
	});

	it("uses the dedicated local keyword operation without transcribing", async () => {
		const run = vi.fn().mockResolvedValue({
			exitCode: 0,
			stdout: JSON.stringify({
				awake: true,
				phrase: "你好小麦",
				confidence: 0.91,
			}),
			stderr: "",
		});
		const provider = new SidecarSpeechProvider(
			{ executable: "voice-sidecar", args: ["--config", "local.json"] },
			{ run },
		);
		const signal = new AbortController().signal;

		expect(
			await provider.detectWake(
				{ audio: new Uint8Array([1, 2]), mimeType: "audio/wav" },
				signal,
			),
		).toEqual({ awake: true, phrase: "你好小麦", confidence: 0.91 });
		expect(run).toHaveBeenCalledWith(
			expect.objectContaining({
				args: ["--config", "local.json", "wake"],
				script: "voice-sidecar wake",
			}),
		);
	});

	it("reports the enforced loopback-only network policy", async () => {
		const run = vi.fn().mockResolvedValue({
			exitCode: 0,
			stdout: JSON.stringify({ networkPolicy: "loopback-only" }),
			stderr: "",
		});
		const provider = new SidecarSpeechProvider(
			{ executable: "voice-sidecar" },
			{ run },
		);

		await expect(
			provider.health(new AbortController().signal),
		).resolves.toEqual({ networkPolicy: "loopback-only" });
		expect(run).toHaveBeenCalledWith(
			expect.objectContaining({
				args: ["health"],
				stdin: "{}",
				script: "voice-sidecar health",
			}),
		);
	});
});
