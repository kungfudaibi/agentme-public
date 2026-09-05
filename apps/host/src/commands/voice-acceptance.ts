import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { SpawnNativeCommandRunner } from "../../../../packages/platform-runtime/src/index.js";
import {
	benchmarkGeneratedWakeFixtures,
	evaluateWakeAcceptance,
	type GeneratedWakeFixture,
	generatedWakeFixtureLicense,
} from "../../../../packages/voice-runtime/src/index.js";

interface SidecarConfiguration {
	readonly executable: string;
	readonly args: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readSidecarConfiguration(
	path: string,
): Promise<SidecarConfiguration> {
	const value: unknown = JSON.parse(await readFile(path, "utf8"));
	if (!isRecord(value) || !isRecord(value.voice))
		throw new TypeError("Local voice settings are not configured");
	const { localExecutable, localArgs } = value.voice;
	if (
		typeof localExecutable !== "string" ||
		localExecutable.length < 1 ||
		!Array.isArray(localArgs) ||
		localArgs.length > 32 ||
		localArgs.some(
			(item) =>
				typeof item !== "string" ||
				item.length < 1 ||
				item.length > 2_048 ||
				/[\r\n\0]/u.test(item),
		)
	)
		throw new TypeError("Local voice settings are invalid");
	return { executable: localExecutable, args: localArgs as string[] };
}

function parseObject(value: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(value);
	if (!isRecord(parsed)) throw new TypeError("Local voice output is invalid");
	return parsed;
}

function finiteMetric(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
		throw new TypeError(`Local voice ${name} is invalid`);
	return value;
}

const captureWindowMs = 2_500;
const interWindowDelayMs = 500;

function generatedFixturePlan(): readonly GeneratedWakeFixture[] {
	const positiveSpeeds = [
		0.82, 0.86, 0.9, 0.94, 0.98, 1.02, 1.06, 1.1, 1.14, 1.18,
	];
	const negativePhrases = [
		"小麦帮手",
		"小爱助手",
		"小梅助手",
		"小麦助理",
		"小白助手",
		"开始工作",
		"停止任务",
		"运行测试",
		"打开微信",
		"今天天气不错",
		"记录一笔支出",
		"检查代码仓库",
		"你好小麦",
		"你好助手",
		"您好助手",
		"小麦开始",
		"任务已经完成",
		"切换模型",
		"查看任务状态",
		"保持安静",
	];
	return [
		...positiveSpeeds.map((speed, index) => ({
			id: `wake-positive-${String(index + 1).padStart(2, "0")}`,
			text: "小麦助手",
			speed,
			expectedWake: true,
		})),
		...negativePhrases.map((text, index) => ({
			id: `wake-negative-${String(index + 1).padStart(2, "0")}`,
			text,
			speed: 0.82 + (index % 10) * 0.04,
			expectedWake: false,
		})),
	];
}

export async function runLocalVoiceAcceptance(
	settingsPath = resolve(
		process.env.AGENTME_SETTINGS_PATH ?? ".agentme/settings.json",
	),
): Promise<unknown> {
	const config = await readSidecarConfiguration(settingsPath);
	const command = new SpawnNativeCommandRunner();
	const controller = new AbortController();
	const invoke = async (
		operation: "health" | "synthesize" | "wake",
		input: unknown,
	) => {
		const started = performance.now();
		const result = await command.run({
			executable: config.executable,
			args: [...config.args, operation],
			stdin: JSON.stringify(input),
			signal: controller.signal,
			maxOutputBytes: 14 * 1024 * 1024,
			script: `voice-acceptance ${operation}`,
		});
		if (result.exitCode !== 0) throw new Error("Local voice sidecar failed");
		return {
			value: parseObject(result.stdout),
			elapsedMs: performance.now() - started,
		};
	};
	const health = (await invoke("health", {})).value;
	if (health.networkPolicy !== "loopback-only")
		throw new Error("Local voice outbound network is not disabled");
	const observations = await benchmarkGeneratedWakeFixtures(
		generatedFixturePlan(),
		{
			synthesize: async (text, speed) => {
				const { value } = await invoke("synthesize", { text, speed });
				if (
					value.mimeType !== "audio/wav" ||
					typeof value.audioBase64 !== "string" ||
					value.audioBase64.length > 13_981_016 ||
					!/^[A-Za-z0-9+/]+={0,2}$/u.test(value.audioBase64)
				)
					throw new TypeError("Local voice synthesis output is invalid");
				return Buffer.from(value.audioBase64, "base64");
			},
			detectWake: async (audio) => {
				const { value, elapsedMs } = await invoke("wake", {
					audioBase64: Buffer.from(audio).toString("base64"),
					mimeType: "audio/wav",
				});
				if (typeof value.awake !== "boolean" || !isRecord(value.metrics))
					throw new TypeError("Local wake output is invalid");
				const processCpuMs = finiteMetric(
					value.metrics.processCpuMs,
					"CPU time",
				);
				const logicalCores = finiteMetric(
					value.metrics.logicalCores,
					"logical core count",
				);
				return {
					detectedWake: value.awake,
					latencyMs: elapsedMs,
					cpuPercent:
						(processCpuMs /
							(elapsedMs + captureWindowMs + interWindowDelayMs) /
							logicalCores) *
						100,
				};
			},
		},
		controller.signal,
	);
	const report = evaluateWakeAcceptance(observations);
	return {
		generatedAt: new Date().toISOString(),
		model: "sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20 chunk-8 INT8",
		fixturePolicy: {
			source: "Piper-generated in memory; raw audio retention disabled",
			license: generatedWakeFixtureLicense,
		},
		networkPolicy: health.networkPolicy,
		cpuMethod: {
			metric: "KWS process CPU time normalized across logical cores",
			captureWindowMs,
			interWindowDelayMs,
		},
		report,
		fixtures: observations.map((observation) => ({
			id: observation.fixture.id,
			sha256: observation.fixture.sha256,
			expectedWake: observation.fixture.expectedWake,
			detectedWake: observation.detectedWake,
		})),
	};
}

if (process.argv[1]?.endsWith("voice-acceptance.js")) {
	const evidence = await runLocalVoiceAcceptance();
	process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
	if (
		isRecord(evidence) &&
		isRecord(evidence.report) &&
		evidence.report.passed !== true
	)
		process.exitCode = 1;
}
