export interface VoiceAcceptanceThresholds {
	readonly maxFalseAcceptRate: number;
	readonly maxFalseRejectRate: number;
	readonly maxP95LatencyMs: number;
	readonly maxAverageCpuPercent: number;
	readonly minPositiveFixtures: number;
	readonly minNegativeFixtures: number;
}

export const defaultVoiceAcceptanceThresholds: VoiceAcceptanceThresholds = {
	maxFalseAcceptRate: 0.01,
	maxFalseRejectRate: 0.2,
	maxP95LatencyMs: 1_500,
	maxAverageCpuPercent: 5,
	minPositiveFixtures: 10,
	minNegativeFixtures: 20,
};

export interface WakeFixtureEvidence {
	readonly id: string;
	readonly expectedWake: boolean;
	readonly sha256: string;
	readonly source: "generated" | "upstream-fixture" | "user-recording";
	readonly license: string;
}

export interface WakeFixtureObservation {
	readonly fixture: WakeFixtureEvidence;
	readonly detectedWake: boolean;
	readonly latencyMs: number;
	readonly cpuPercent: number;
}

export interface WakeAcceptanceReport {
	readonly thresholds: VoiceAcceptanceThresholds;
	readonly fixtureCount: number;
	readonly positiveCount: number;
	readonly negativeCount: number;
	readonly falseAcceptCount: number;
	readonly falseRejectCount: number;
	readonly falseAcceptRate: number;
	readonly falseRejectRate: number;
	readonly p95LatencyMs: number;
	readonly averageCpuPercent: number;
	readonly passed: boolean;
}

export interface GeneratedWakeFixture {
	readonly id: string;
	readonly text: string;
	readonly speed: number;
	readonly expectedWake: boolean;
}

export interface GeneratedWakeFixtureRunner {
	synthesize(
		text: string,
		speed: number,
		signal: AbortSignal,
	): Promise<Uint8Array>;
	detectWake(
		audio: Uint8Array,
		signal: AbortSignal,
	): Promise<{
		readonly detectedWake: boolean;
		readonly latencyMs: number;
		readonly cpuPercent: number;
	}>;
}

export const generatedWakeFixtureLicense =
	"DataBaker non-commercial dataset terms via Piper xiao_ya MODEL_CARD";

export async function benchmarkGeneratedWakeFixtures(
	fixtures: readonly GeneratedWakeFixture[],
	runner: GeneratedWakeFixtureRunner,
	signal: AbortSignal,
): Promise<readonly WakeFixtureObservation[]> {
	const ids = new Set<string>();
	const observations: WakeFixtureObservation[] = [];
	for (const fixture of fixtures) {
		signal.throwIfAborted();
		if (
			fixture.id.length < 1 ||
			fixture.id.length > 200 ||
			ids.has(fixture.id) ||
			fixture.text.trim().length < 1 ||
			fixture.text.length > 100 ||
			!Number.isFinite(fixture.speed) ||
			fixture.speed < 0.8 ||
			fixture.speed > 1.2
		)
			throw new TypeError("Generated wake fixture is invalid");
		ids.add(fixture.id);
		const audio = await runner.synthesize(fixture.text, fixture.speed, signal);
		if (audio.byteLength < 44 || audio.byteLength > 10 * 1024 * 1024)
			throw new TypeError("Generated wake fixture audio is invalid");
		const result = await runner.detectWake(audio, signal);
		observations.push({
			fixture: {
				id: fixture.id,
				expectedWake: fixture.expectedWake,
				sha256: createHash("sha256").update(audio).digest("hex"),
				source: "generated",
				license: generatedWakeFixtureLicense,
			},
			detectedWake: result.detectedWake,
			latencyMs: result.latencyMs,
			cpuPercent: result.cpuPercent,
		});
	}
	return observations;
}

function assertRate(value: number, name: string): void {
	if (!Number.isFinite(value) || value < 0 || value > 1)
		throw new TypeError(`${name} must be between zero and one`);
}

function validateThresholds(value: VoiceAcceptanceThresholds): void {
	assertRate(value.maxFalseAcceptRate, "maxFalseAcceptRate");
	assertRate(value.maxFalseRejectRate, "maxFalseRejectRate");
	if (
		!Number.isFinite(value.maxP95LatencyMs) ||
		value.maxP95LatencyMs <= 0 ||
		!Number.isFinite(value.maxAverageCpuPercent) ||
		value.maxAverageCpuPercent <= 0 ||
		!Number.isSafeInteger(value.minPositiveFixtures) ||
		value.minPositiveFixtures < 1 ||
		!Number.isSafeInteger(value.minNegativeFixtures) ||
		value.minNegativeFixtures < 1
	)
		throw new TypeError("Voice acceptance thresholds are invalid");
}

function validateObservation(value: WakeFixtureObservation): void {
	if (value.fixture.source === "user-recording")
		throw new TypeError("Wake acceptance requires non-user recordings");
	if (value.fixture.license.trim().length < 1)
		throw new TypeError("Wake fixture license is required");
	if (!/^[a-f0-9]{64}$/iu.test(value.fixture.sha256))
		throw new TypeError("Wake fixture SHA-256 is invalid");
	if (
		value.fixture.id.length < 1 ||
		value.fixture.id.length > 200 ||
		!Number.isFinite(value.latencyMs) ||
		value.latencyMs < 0 ||
		!Number.isFinite(value.cpuPercent) ||
		value.cpuPercent < 0 ||
		value.cpuPercent > 100
	)
		throw new TypeError("Wake fixture observation is invalid");
}

function percentile95(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

export function evaluateWakeAcceptance(
	observations: readonly WakeFixtureObservation[],
	thresholds: VoiceAcceptanceThresholds = defaultVoiceAcceptanceThresholds,
): WakeAcceptanceReport {
	validateThresholds(thresholds);
	for (const observation of observations) validateObservation(observation);
	const positives = observations.filter((value) => value.fixture.expectedWake);
	const negatives = observations.filter((value) => !value.fixture.expectedWake);
	const falseAcceptCount = negatives.filter(
		(value) => value.detectedWake,
	).length;
	const falseRejectCount = positives.filter(
		(value) => !value.detectedWake,
	).length;
	const falseAcceptRate =
		negatives.length === 0 ? 1 : falseAcceptCount / negatives.length;
	const falseRejectRate =
		positives.length === 0 ? 1 : falseRejectCount / positives.length;
	const p95LatencyMs = percentile95(
		observations.map((value) => value.latencyMs),
	);
	const averageCpuPercent =
		observations.length === 0
			? 100
			: observations.reduce((sum, value) => sum + value.cpuPercent, 0) /
				observations.length;
	const passed =
		positives.length >= thresholds.minPositiveFixtures &&
		negatives.length >= thresholds.minNegativeFixtures &&
		falseAcceptRate <= thresholds.maxFalseAcceptRate &&
		falseRejectRate <= thresholds.maxFalseRejectRate &&
		p95LatencyMs <= thresholds.maxP95LatencyMs &&
		averageCpuPercent <= thresholds.maxAverageCpuPercent;
	return {
		thresholds,
		fixtureCount: observations.length,
		positiveCount: positives.length,
		negativeCount: negatives.length,
		falseAcceptCount,
		falseRejectCount,
		falseAcceptRate,
		falseRejectRate,
		p95LatencyMs,
		averageCpuPercent,
		passed,
	};
}

import { createHash } from "node:crypto";
