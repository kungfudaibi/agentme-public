import { describe, expect, it } from "vitest";

import {
	isTaskStatusQuestion,
	summarizeRecentTasks,
} from "../src/task-status.js";

describe("assistant task status", () => {
	it("recognizes natural questions about recent task progress", () => {
		for (const message of [
			"刚才的任务怎么样了",
			"之前任务的状态",
			"最近的任务完成了吗？",
			"任务进度",
		])
			expect(isTaskStatusQuestion(message)).toBe(true);
	});

	it("does not reinterpret a coding request as a status question", () => {
		for (const message of [
			"修复任务状态显示",
			"新增一个任务进度组件",
			"运行测试",
		])
			expect(isTaskStatusQuestion(message)).toBe(false);
	});

	it("summarizes durable child outcomes with their original instruction", () => {
		expect(
			summarizeRecentTasks([
				{
					parent: {
						parentId: "parent-one",
						actorId: "local-owner",
						state: "completed",
					},
					children: [
						{
							state: "completed",
							instruction: "运行测试并修复失败",
						},
					],
				},
			]),
		).toBe("最近任务「运行测试并修复失败」已完成。");
	});
});
