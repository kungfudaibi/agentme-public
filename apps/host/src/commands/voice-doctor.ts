import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	readHardwareProfile,
	voiceCandidateReadiness,
} from "../../../../packages/voice-runtime/src/index.js";
import { SidecarSpeechProvider } from "../../../../plugins/voice-sherpa/src/index.js";

interface LocalVoiceSettings {
	readonly executable: string;
	readonly args: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadLocalVoiceSettings(
	path: string,
): Promise<LocalVoiceSettings | undefined> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	if (!isRecord(parsed) || !isRecord(parsed.voice)) return undefined;
	const { localExecutable, localArgs } = parsed.voice;
	if (
		typeof localExecutable !== "string" ||
		localExecutable.length < 1 ||
		localExecutable.length > 2_048 ||
		/[\r\n\0]/u.test(localExecutable) ||
		!Array.isArray(localArgs) ||
		localArgs.length > 32 ||
		localArgs.some(
			(value) =>
				typeof value !== "string" ||
				value.length < 1 ||
				value.length > 2_048 ||
				/[\r\n\0]/u.test(value),
		)
	)
		return undefined;
	return { executable: localExecutable, args: localArgs as string[] };
}

function argumentAfter(
	args: readonly string[],
	name: string,
): string | undefined {
	const index = args.indexOf(name);
	return index < 0 ? undefined : args[index + 1];
}

async function available(path: string | undefined): Promise<boolean> {
	if (path === undefined) return false;
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function createVoiceDoctorReport(
	settingsPath = resolve(
		process.env.AGENTME_SETTINGS_PATH ?? ".agentme/settings.json",
	),
) {
	const settings = await loadLocalVoiceSettings(settingsPath);
	let candidates = voiceCandidateReadiness();
	let networkPolicy: "loopback-only" | "not-configured" | "unavailable" =
		"not-configured";
	if (settings !== undefined) {
		const serviceReady =
			(await available(settings.executable)) &&
			(await available(settings.args[0]));
		const kwsReady =
			serviceReady &&
			(await available(argumentAfter(settings.args, "--kws-model-dir"))) &&
			(await available(argumentAfter(settings.args, "--wake-keywords-file")));
		const asrReady =
			serviceReady &&
			(await available(argumentAfter(settings.args, "--asr-model-dir")));
		const ttsReady =
			serviceReady &&
			(await available(argumentAfter(settings.args, "--tts-model-dir")));
		candidates = candidates.map((candidate) => ({
			...candidate,
			configured:
				candidate.candidate === "sherpa-onnx"
					? kwsReady
					: candidate.candidate === "SenseVoiceSmall"
						? asrReady
						: candidate.candidate === "Piper"
							? ttsReady
							: candidate.configured,
		}));
		if (kwsReady && asrReady && ttsReady) {
			try {
				const health = await new SidecarSpeechProvider({
					executable: settings.executable,
					args: settings.args,
				}).health(new AbortController().signal);
				networkPolicy = health.networkPolicy;
			} catch {
				networkPolicy = "unavailable";
			}
		}
	}
	return {
		generatedAt: new Date().toISOString(),
		hardware: readHardwareProfile(),
		candidates,
		networkPolicy,
		defaultRoute: {
			wake: "sherpa-onnx KWS chunk-8 INT8",
			wakePhrase: "小麦助手",
			stt: "SenseVoiceSmall",
			tts: "Piper",
			rationale: "local-first privacy and offline availability",
		},
	};
}

if (process.argv[1]?.endsWith("voice-doctor.js"))
	process.stdout.write(
		`${JSON.stringify(await createVoiceDoctorReport(), null, 2)}\n`,
	);
