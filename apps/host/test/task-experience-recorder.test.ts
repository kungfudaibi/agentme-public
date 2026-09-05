import { describe, expect, it } from "vitest";

import type { SupervisorChild } from "../../../packages/task-orchestrator/src/index.js";
import { buildTaskExperienceInput } from "../src/task-experience-recorder.js";

function completedChild(summary: string): SupervisorChild {
	return {
		childId: "child-1",
		parentId: "parent-1",
		ordinal: 0,
		request: {
			repositoryId: "agentme",
			runtimeId: "runtime-codex",
			instruction: "原始任务指令 sk-instruction-secret-123456",
			acceptanceCriteria: ["通过测试"],
		},
		state: "completed",
		report: { summary },
	};
}

describe("completed task experience", () => {
	it("uses a stable id and excludes raw instructions and common credentials", () => {
		const input = buildTaskExperienceInput("parent-1", [
			completedChild(
				"完成 原始任务指令 sk-instruction-secret-123456，Bearer abcdefghijklmnop，api_key=secret-value，另有 sk-report-secret-123456。",
			),
		]);

		expect(input).toMatchObject({
			id: "experience-f2a0ede82b5b172b5fe082f344cf232d",
			kind: "experience",
			source: "task:parent-1",
			confidence: 0.8,
			sensitivity: "private",
		});
		expect(input.content).toContain("已完成并通过核验");
		expect(input.content).not.toContain(
			"原始任务指令 sk-instruction-secret-123456",
		);
		expect(input.content).not.toContain("abcdefghijklmnop");
		expect(input.content).not.toContain("secret-value");
		expect(input.content).not.toContain("sk-report-secret");
		expect(
			buildTaskExperienceInput("parent-1", [completedChild("完成")]).id,
		).toBe(input.id);
	});

	it("bounds generated memory content", () => {
		const input = buildTaskExperienceInput("parent-2", [
			completedChild("x".repeat(64_000)),
		]);
		expect(input.content.length).toBeLessThanOrEqual(20_000);
	});
});
