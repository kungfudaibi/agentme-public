import { describe, expect, it } from "vitest";

import {
	buildSkillProposalInput,
	parseSkillProposalPage,
} from "../ui/skill-workshop-state.js";

describe("desktop skill workshop state", () => {
	it("parses a provenance-bearing evaluated proposal", () => {
		expect(
			parseSkillProposalPage({
				data: [
					{
						id: "proposal-1",
						skillId: "verified-reviewer",
						content: "Review bounded evidence.",
						contentHash: "a".repeat(64),
						source: "owner:local",
						createdAt: "2026-08-29T00:00:00.000Z",
						status: "evaluated",
						scanFindings: [],
						evaluation: {
							passed: true,
							evaluatorId: "agentme-node-isolate-v1",
							evidence: ["proposed-content-not-executed"],
						},
					},
				],
				pagination: { limit: 50, offset: 0, totalItems: 1 },
			}),
		).toMatchObject({ data: [{ status: "evaluated" }] });
	});

	it("rejects malformed output and proposal input", () => {
		expect(() =>
			parseSkillProposalPage({ data: [], pagination: {} }),
		).toThrow();
		expect(() => buildSkillProposalInput("../core", "x")).toThrow();
		expect(buildSkillProposalInput("safe-reviewer", "  evidence  ")).toEqual({
			skillId: "safe-reviewer",
			content: "evidence",
		});
	});
});
