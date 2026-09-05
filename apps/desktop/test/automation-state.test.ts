import { describe, expect, it } from "vitest";

import {
	buildScheduledTaskInput,
	buildStandingIntentInput,
	parseScheduledTaskPage,
	parseStandingIntentPage,
} from "../ui/automation-state.js";

describe("desktop automation state", () => {
	it("parses dispatched scheduled tasks", () => {
		expect(
			parseScheduledTaskPage({
				data: [
					{
						id: "job-1",
						runAt: "2030-01-01T00:00:00.000Z",
						createdAt: "2029-01-01T00:00:00.000Z",
						state: "dispatched",
						instruction: "Run verified tests",
						repositoryId: "agentme",
						runtimeId: "runtime-codex",
						parentId: "automation-job-1",
					},
				],
			}),
		).toMatchObject({ data: [{ state: "dispatched" }] });
	});

	it("builds a canonical target-bound task and rejects invalid local time", () => {
		expect(
			buildScheduledTaskInput(
				"2030-01-01T08:00",
				"  Run verified tests  ",
				"agentme",
				"runtime-codex",
			),
		).toEqual({
			runAt: new Date("2030-01-01T08:00").toISOString(),
			instruction: "Run verified tests",
			repositoryId: "agentme",
			runtimeId: "runtime-codex",
		});
		expect(() =>
			buildScheduledTaskInput("", "x", "agentme", "runtime-codex"),
		).toThrow();
	});

	it("parses and builds bounded condition-triggered intents", () => {
		expect(
			parseStandingIntentPage({
				data: [
					{
						id: "intent-1",
						eventType: "task.failed",
						expiresAt: "2030-01-01T00:00:00.000Z",
						cooldownMinutes: 30,
						maxFires: 3,
						firedCount: 1,
						state: "active",
						instruction: "Review a failed task",
						repositoryId: "agentme",
						runtimeId: "runtime-codex",
						createdAt: "2029-01-01T00:00:00.000Z",
					},
				],
			}),
		).toMatchObject({ data: [{ eventType: "task.failed", firedCount: 1 }] });
		expect(
			buildStandingIntentInput(
				"task.completed",
				"2030-01-01T08:00",
				15,
				2,
				" Review completion evidence ",
				"agentme",
				"runtime-codex",
			),
		).toMatchObject({
			eventType: "task.completed",
			cooldownMinutes: 15,
			maxFires: 2,
			instruction: "Review completion evidence",
		});
	});
});
