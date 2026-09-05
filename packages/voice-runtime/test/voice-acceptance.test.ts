import { describe, expect, it } from "vitest";
import {
	benchmarkGeneratedWakeFixtures,
	defaultVoiceAcceptanceThresholds,
	evaluateWakeAcceptance,
	type WakeFixtureObservation,
} from "../src/index.js";

function observation(
	id: string,
	expectedWake: boolean,
	detectedWake: boolean,
	latencyMs = 200,
	cpuPercent = 2,
): WakeFixtureObservation {
	return {
		fixture: {
			id,
			expectedWake,
			sha256: id.length.toString(16).padStart(64, "0"),
			source: "generated",
			license: "CC0-1.0",
		},
		detectedWake,
		latencyMs,
		cpuPercent,
	};
}

describe("wake acceptance evidence", () => {
	it("computes explicit false-accept, false-reject, latency and CPU gates", () => {
		const observations = [
			...Array.from({ length: 10 }, (_, index) =>
				observation(`positive-${index}`, true, index !== 0),
			),
			...Array.from({ length: 20 }, (_, index) =>
				observation(`negative-${index}`, false, false),
			),
		];

		expect(evaluateWakeAcceptance(observations)).toEqual({
			thresholds: defaultVoiceAcceptanceThresholds,
			fixtureCount: 30,
			positiveCount: 10,
			negativeCount: 20,
			falseAcceptCount: 0,
			falseRejectCount: 1,
			falseAcceptRate: 0,
			falseRejectRate: 0.1,
			p95LatencyMs: 200,
			averageCpuPercent: 2,
			passed: true,
		});
	});

	it("rejects user recordings and fixtures without auditable provenance", () => {
		const valid = observation("valid", true, true);
		expect(() =>
			evaluateWakeAcceptance([
				{ ...valid, fixture: { ...valid.fixture, source: "user-recording" } },
			]),
		).toThrow("non-user");
		expect(() =>
			evaluateWakeAcceptance([
				{ ...valid, fixture: { ...valid.fixture, license: "" } },
			]),
		).toThrow("license");
	});

	it("benchmarks generated fixtures without persisting raw audio", async () => {
		const synthesized: string[] = [];
		const report = await benchmarkGeneratedWakeFixtures(
			[
				{ id: "positive", text: "你好小麦", speed: 1, expectedWake: true },
				{ id: "negative", text: "你好小爱", speed: 1, expectedWake: false },
			],
			{
				synthesize: async (text) => {
					synthesized.push(text);
					const audio = new Uint8Array(64);
					audio[0] = text === "你好小麦" ? 1 : 0;
					return audio;
				},
				detectWake: async (audio) => ({
					detectedWake: audio[0] === 1,
					latencyMs: 100,
					cpuPercent: 1,
				}),
			},
			new AbortController().signal,
		);

		expect(synthesized).toEqual(["你好小麦", "你好小爱"]);
		expect(report).toHaveLength(2);
		expect(report[0]?.fixture).toMatchObject({
			id: "positive",
			source: "generated",
			license: expect.stringContaining("DataBaker"),
		});
		expect(report[0]?.fixture.sha256).toMatch(/^[a-f0-9]{64}$/u);
	});
});
