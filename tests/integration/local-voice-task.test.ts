import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentMeHost } from "../../apps/host/src/server.js";
import { SpokenConversationRouter } from "../../packages/voice-runtime/src/index.js";
import { SidecarSpeechProvider } from "../../plugins/voice-sherpa/src/index.js";

const token = "local-voice-acceptance-token-000000000000";
const directories: string[] = [];
const hosts: AgentMeHost[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function realLocalProvider(): Promise<SidecarSpeechProvider> {
	const settingsPath = process.env.AGENTME_REAL_LOCAL_VOICE_SETTINGS;
	if (settingsPath === undefined)
		throw new Error("Real voice settings are missing");
	const settings: unknown = JSON.parse(await readFile(settingsPath, "utf8"));
	if (!isRecord(settings) || !isRecord(settings.voice))
		throw new TypeError("Real voice settings are invalid");
	const { localExecutable, localArgs } = settings.voice;
	if (
		typeof localExecutable !== "string" ||
		!Array.isArray(localArgs) ||
		localArgs.some((value) => typeof value !== "string")
	)
		throw new TypeError("Real voice settings are invalid");
	return new SidecarSpeechProvider({
		executable: localExecutable,
		args: localArgs as string[],
	});
}

afterEach(async () => {
	for (const host of hosts.splice(0)) await host.stop();
	for (const directory of directories.splice(0))
		await rm(directory, { recursive: true, force: true });
});

describe("local wake to task acceptance", () => {
	it("uses dedicated wake detection then creates the normal supervisor task", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-local-voice-"));
		directories.push(directory);
		const detectWake = vi.fn(async () => ({
			awake: true,
			phrase: "你好小麦",
			confidence: 0.95,
		}));
		const transcribe = vi.fn(async () => ({
			providerId: "voice-local",
			value: "运行测试",
			fallbackUsed: false,
		}));
		const synthesize = vi.fn(async () => ({
			providerId: "voice-local",
			value: { mimeType: "audio/wav" as const, audioBase64: "UklGRg==" },
			fallbackUsed: false,
		}));
		const host = new AgentMeHost({
			databasePath: join(directory, "agentme.sqlite"),
			authToken: token,
			wake: { detectWake },
			voice: { transcribe, synthesize },
		});
		await host.start(0);
		hosts.push(host);

		const wake = await fetch(`${host.url}/assistant/voice/wake`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ audioBase64: "UklGRg==", mimeType: "audio/wav" }),
		});
		expect(await wake.json()).toEqual({
			awake: true,
			phrase: "你好小麦",
			confidence: 0.95,
		});
		expect(detectWake).toHaveBeenCalledOnce();
		expect(transcribe).not.toHaveBeenCalled();

		const message = await fetch(`${host.url}/assistant/voice/messages`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				audioBase64: "UklGRg==",
				mimeType: "audio/wav",
				route: "local",
				repositoryId: "fake",
				runtimeId: "runtime-fake",
			}),
		});
		expect(message.status).toBe(202);
		expect(await message.json()).toMatchObject({
			transcript: "运行测试",
			voice: { providerId: "voice-local" },
			speech: { audioBase64: "UklGRg==" },
		});
		expect(transcribe).toHaveBeenCalledOnce();
		expect(synthesize).toHaveBeenCalledOnce();
	});

	const realVoiceIt =
		process.env.AGENTME_REAL_LOCAL_VOICE_SETTINGS === undefined ? it.skip : it;
	realVoiceIt(
		"runs installed wake, STT and TTS through the supervisor with outbound network blocked",
		async () => {
			const directory = await mkdtemp(join(tmpdir(), "agentme-real-voice-"));
			directories.push(directory);
			const provider = await realLocalProvider();
			await expect(
				provider.health(new AbortController().signal),
			).resolves.toEqual({ networkPolicy: "loopback-only" });
			const voice = new SpokenConversationRouter({ local: provider });
			const host = new AgentMeHost({
				databasePath: join(directory, "agentme.sqlite"),
				authToken: token,
				wake: provider,
				voice,
			});
			await host.start(0);
			hosts.push(host);

			const wakeAudio = await provider.synthesize(
				"小麦助手",
				new AbortController().signal,
			);
			const wake = await fetch(`${host.url}/assistant/voice/wake`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					audioBase64: wakeAudio.audioBase64,
					mimeType: "audio/wav",
				}),
			});
			expect(await wake.json()).toMatchObject({
				awake: true,
				phrase: "小麦助手",
			});

			const taskAudio = await provider.synthesize(
				"运行测试",
				new AbortController().signal,
			);
			const message = await fetch(`${host.url}/assistant/voice/messages`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					audioBase64: taskAudio.audioBase64,
					mimeType: "audio/wav",
					route: "local",
					repositoryId: "fake",
					runtimeId: "runtime-fake",
				}),
			});
			expect(message.status).toBe(202);
			const result = (await message.json()) as {
				readonly parentId: string;
				readonly transcript: string;
			};
			expect(result).toMatchObject({
				transcript: expect.any(String),
				voice: { providerId: "voice-local", fallbackUsed: false },
				speech: { mimeType: "audio/wav" },
			});
			expect(result.transcript.trim().length).toBeGreaterThan(0);
			const tree = await fetch(
				`${host.url}/assistant/parents/${result.parentId}`,
				{
					headers: { authorization: `Bearer ${token}` },
				},
			);
			expect(await tree.json()).toMatchObject({
				children: [{ request: { instruction: result.transcript } }],
			});
		},
		30_000,
	);

	realVoiceIt(
		"cancels an installed local sidecar before it can finish synthesis",
		async () => {
			const provider = await realLocalProvider();
			const operation = new AbortController();
			const pending = provider.synthesize(
				"任务正在执行".repeat(100),
				operation.signal,
			);
			operation.abort();
			await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
		},
		10_000,
	);
});
