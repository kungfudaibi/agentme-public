import { describe, expect, it } from "vitest";
import { readHardwareProfile, voiceCandidateReadiness } from "../src/index.js";

describe("voice doctor", () => {
	it("returns useful hardware facts without identity or paths", () => {
		const serialized = JSON.stringify(readHardwareProfile());
		expect(serialized).not.toContain(process.env.USERNAME ?? "__missing__");
		expect(serialized).not.toContain("apiKey");
		expect(JSON.parse(serialized)).toMatchObject({
			platform: process.platform,
			architecture: process.arch,
		});
	});
	it("reports candidates independently", () => {
		const readiness = voiceCandidateReadiness({
			AGENTME_PIPER_COMMAND: "piper",
		});
		expect(
			readiness.find((item) => item.candidate === "Piper")?.configured,
		).toBe(true);
		expect(
			readiness.find((item) => item.candidate === "SenseVoiceSmall")
				?.configured,
		).toBe(false);
	});
});
