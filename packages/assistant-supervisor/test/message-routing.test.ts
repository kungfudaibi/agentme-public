import { describe, expect, it } from "vitest";

import { isCodingTaskRequest } from "../src/message-routing.js";

describe("assistant message routing", () => {
	it("delegates repository-changing and verification goals to coding workers", () => {
		for (const message of [
			"修复失败的测试",
			"在当前仓库实现登录功能",
			"审查最近的代码变化",
			"run the test suite and fix it",
		])
			expect(isCodingTaskRequest(message)).toBe(true);
	});

	it("keeps ordinary conversation with the supervisor model", () => {
		for (const message of ["你好，你是谁", "解释一下这个概念", "给我一些建议"])
			expect(isCodingTaskRequest(message)).toBe(false);
	});
});
