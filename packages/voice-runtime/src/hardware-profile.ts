import { cpus, freemem, totalmem } from "node:os";

export interface RedactedHardwareProfile {
	readonly platform: NodeJS.Platform;
	readonly architecture: string;
	readonly cpuModel: string;
	readonly logicalCores: number;
	readonly totalMemoryMiB: number;
	readonly freeMemoryMiB: number;
}

export function readHardwareProfile(): RedactedHardwareProfile {
	const processors = cpus();
	return {
		platform: process.platform,
		architecture: process.arch,
		cpuModel: processors[0]?.model ?? "unknown",
		logicalCores: processors.length,
		totalMemoryMiB: Math.round(totalmem() / 1024 / 1024),
		freeMemoryMiB: Math.round(freemem() / 1024 / 1024),
	};
}

export interface VoiceCandidateReadiness {
	readonly candidate: "sherpa-onnx" | "SenseVoiceSmall" | "Piper" | "CosyVoice";
	readonly configured: boolean;
	readonly route: "local" | "optional";
}
export function voiceCandidateReadiness(
	environment: NodeJS.ProcessEnv = process.env,
): readonly VoiceCandidateReadiness[] {
	return [
		{
			candidate: "sherpa-onnx",
			configured: Boolean(environment.AGENTME_SHERPA_COMMAND),
			route: "local",
		},
		{
			candidate: "SenseVoiceSmall",
			configured: Boolean(environment.AGENTME_SENSEVOICE_COMMAND),
			route: "local",
		},
		{
			candidate: "Piper",
			configured: Boolean(environment.AGENTME_PIPER_COMMAND),
			route: "local",
		},
		{
			candidate: "CosyVoice",
			configured: Boolean(environment.AGENTME_COSYVOICE_COMMAND),
			route: "optional",
		},
	];
}
