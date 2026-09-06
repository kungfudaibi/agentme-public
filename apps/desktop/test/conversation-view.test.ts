import { expect, it } from "vitest";
import type { HubTask } from "../../../packages/conversation-hub/src/types.js";
import { renderConversationTask } from "../ui/conversation-view.js";

it("expands durable facts and evidence inline without linking to a separate coding workbench", () => {
	const task: HubTask = {
		id: "test",
		conversationId: "chat",
		kind: "coding",
		goal: "<img src=x onerror=evil()>",
		constraints: ["保留接口"],
		decisions: ["仅修复登录"],
		progress: "测试通过",
		state: "completed",
		createdAt: "2026-09-06",
		updatedAt: "2026-09-06",
		revision: 1,
		evidence: ["test passed"],
		repositoryId: "repo",
		runtimeId: "runtime-pi",
		agentId: "coding",
		pending: [],
	};
	const html = renderConversationTask(task);
	expect(html).toContain("<details");
	expect(html).toContain("保留接口");
	expect(html).toContain("test passed");
	expect(html).toContain("runtime-pi");
	expect(html).toContain('data-task="test"');
	expect(html).not.toContain("<img");
	expect(html).not.toContain("data-legacy");
});
