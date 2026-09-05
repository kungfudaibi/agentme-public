import { describe, expect, it } from "vitest";
import { decideVoiceTask } from "../src/index.js";

describe("spoken task intake", () => {
	it("requires a unique repository and confirmation for destructive intent", () => {
		expect(decideVoiceTask("修复测试", ["agentme", "api"]).type).toBe(
			"clarification.required",
		);
		expect(decideVoiceTask("删除 agentme 全部文件", ["agentme"]).type).toBe(
			"clarification.required",
		);
		expect(decideVoiceTask("修复 agentme 的测试", ["agentme"])).toMatchObject({
			type: "task.confirmation",
			repositoryId: "agentme",
		});
	});
});
