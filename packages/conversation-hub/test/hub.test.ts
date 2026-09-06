import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ConversationHub } from "../src/hub.js";

function location() {
	return join(mkdtempSync(join(tmpdir(), "hub-")), "hub.json");
}

it("assigns a specialist using a validated intent proposal", async () => {
	const hub = new ConversationHub(location(), {
		model: async () =>
			JSON.stringify({
				action: "office",
				agentId: "research",
				message: "整理资料",
			}),
		execute: async () => ({ state: "completed", result: "done", evidence: [] }),
	});
	const c = hub.createConversation();
	await hub.send({ conversationId: c.id, message: "整理这份选型材料" });
	expect(hub.snapshot(c.id).tasks[0]?.agentId).toBe("research");
});

it("consumes pending changes once when retrying a failed run", async () => {
	let rejectFirst: ((error: Error) => void) | undefined;
	let calls = 0;
	const hub = new ConversationHub(location(), {
		execute: async () => {
			calls++;
			if (calls === 1)
				return new Promise((_, reject) => {
					rejectFirst = reject;
				});
			return { state: "completed", result: "done", evidence: [] };
		},
	});
	const c = hub.createConversation();
	await hub.send({
		conversationId: c.id,
		message: "prepare report",
		mode: "office",
	});
	const task = hub.snapshot(c.id).tasks[0];
	await hub.send({
		conversationId: c.id,
		message: "add sources",
		mode: "update",
		taskId: task?.id,
	});
	rejectFirst?.(new Error("test failure"));
	await vi.waitFor(() =>
		expect(hub.snapshot(c.id).tasks[0]?.state).toBe("failed"),
	);
	await hub.send({
		conversationId: c.id,
		message: "retry now",
		mode: "continue",
		taskId: task?.id,
	});
	await vi.waitFor(() =>
		expect(hub.snapshot(c.id).tasks[0]?.state).toBe("completed"),
	);
	expect(calls).toBe(2);
	expect(hub.snapshot(c.id).tasks[0]?.pending).toEqual([]);
});
const ready = {
	state: "completed" as const,
	result: "已验证",
	evidence: ["test passed"],
};

it("uses explicit task references for adjustments instead of creating another task", async () => {
	const hub = new ConversationHub(location(), {
		execute: async () => ready,
		model: async () =>
			JSON.stringify({ action: "office", message: "调整任务" }),
	});
	const c = hub.createConversation();
	await hub.send({ conversationId: c.id, message: "整理资料", mode: "office" });
	await vi.waitFor(() =>
		expect(hub.snapshot(c.id).tasks[0]?.state).toBe("completed"),
	);
	const task = hub.snapshot(c.id).tasks[0];
	await hub.send({
		conversationId: c.id,
		message: "增加出处",
		taskId: task?.id,
		constraints: ["只用官方资料"],
	});
	expect(hub.snapshot(c.id).tasks).toHaveLength(1);
	expect(hub.snapshot(c.id).tasks[0]?.constraints).toContain("只用官方资料");
});

it("validates a coding goal against the backend input budget before starting execution", async () => {
	const execute = vi.fn(async () => ready);
	const hub = new ConversationHub(location(), { execute });
	const c = hub.createConversation();
	await hub.send({
		conversationId: c.id,
		message: "长".repeat(5000),
		mode: "coding",
		repositoryId: "repo",
		runtimeId: "runtime-pi",
	});
	expect(execute).not.toHaveBeenCalled();
	expect(hub.snapshot(c.id).tasks).toHaveLength(0);
});
it("keeps authoritative task facts and returns results to the original conversation across unrelated chat", async () => {
	let finish: ((result: typeof ready) => void) | undefined;
	const path = location();
	const hub = new ConversationHub(path, {
		model: async () => "今天晴朗",
		execute: async () =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	});
	const session = hub.createConversation();
	await hub.send({
		conversationId: session.id,
		message: "修复登录",
		mode: "coding",
		repositoryId: "repo",
		runtimeId: "runtime-claude",
		constraints: ["保留接口"],
	});
	const task = hub.snapshot(session.id).tasks[0];
	expect(task?.state).toBe("running");
	await hub.send({
		conversationId: session.id,
		message: "聊聊午餐",
		mode: "chat",
	});
	expect(
		hub.snapshot(session.id).messages.find((m) => m.content === "聊聊午餐")
			?.taskId,
	).toBeUndefined();
	expect(hub.snapshot(session.id).tasks[0]?.goal).toBe("修复登录");
	finish?.(ready);
	await vi.waitFor(() =>
		expect(hub.snapshot(session.id).tasks[0]?.state).toBe("completed"),
	);
	const restored = new ConversationHub(path, {}).snapshot(session.id);
	expect(restored.tasks[0]).toMatchObject({
		repositoryId: "repo",
		runtimeId: "runtime-claude",
		constraints: ["保留接口"],
		evidence: ["test passed"],
	});
	expect(
		restored.messages.filter(
			(message) => message.taskId === task?.id && message.kind === "result",
		),
	).toHaveLength(1);
});
it("rejects coerced action types and empty references", async () => {
	const hub = new ConversationHub(location(), {});
	const c = hub.createConversation();
	await expect(
		hub.send({ conversationId: c.id, message: "hi", mode: ["office"] }),
	).rejects.toThrow();
	await expect(
		hub.send({ conversationId: c.id, message: "hi", taskId: "" }),
	).rejects.toThrow();
});
it("returns an idle conversation after a completed model turn", async () => {
	const hub = new ConversationHub(location(), { model: async () => "你好" });
	const c = hub.createConversation();
	expect(
		(await hub.send({ conversationId: c.id, message: "hi", mode: "chat" }))
			.busy,
	).toBe(false);
});
it("aborts an outstanding model turn on shutdown without persisting a late reply", async () => {
	let resolve: ((value: string) => void) | undefined;
	let signal: AbortSignal | undefined;
	const hub = new ConversationHub(location(), {
		model: async (_, s) => {
			signal = s;
			return new Promise((r) => {
				resolve = r;
			});
		},
	});
	const c = hub.createConversation();
	const pending = hub.send({
		conversationId: c.id,
		message: "hi",
		mode: "chat",
	});
	hub.shutdown();
	expect(signal?.aborted).toBe(true);
	resolve?.("late");
	await pending.catch(() => undefined);
	expect(hub.snapshot(c.id).messages.some((m) => m.content === "late")).toBe(
		false,
	);
});
it("does not route broad coding keywords into execution and downgrades a chat-only model", async () => {
	const execute = vi.fn(async () => ready);
	const hub = new ConversationHub(location(), {
		model: async () =>
			JSON.stringify({ action: "create-coding", goal: "delete files" }),
		execute,
		modelPolicy: { actions: "chat-only", contextCharacters: 4000 },
	});
	const session = hub.createConversation();
	await hub.send({
		conversationId: session.id,
		message: "检查一下我的旅行项目安排",
		mode: "auto",
	});
	expect(execute).not.toHaveBeenCalled();
	expect(hub.snapshot(session.id).tasks).toHaveLength(0);
});
it("bounds context without extra summarization and repairs malformed structured output only once", async () => {
	const requests: string[] = [];
	const hub = new ConversationHub(location(), {
		model: async (request) => {
			requests.push(JSON.stringify(request));
			return "not json";
		},
		modelPolicy: { actions: "structured", contextCharacters: 4000 },
	});
	const session = hub.createConversation();
	await hub.send({
		conversationId: session.id,
		message: "帮我规划旅行".repeat(80),
		mode: "auto",
	});
	expect(requests).toHaveLength(2);
	expect(requests.every((request) => request.length < 5500)).toBe(true);
	expect(hub.snapshot(session.id).messages.at(-1)?.content).toContain("明确");
	expect(hub.snapshot(session.id).tasks).toHaveLength(0);
});
it("asks to disambiguate multiple tasks and records updates against an explicit task", async () => {
	const hub = new ConversationHub(location(), {
		execute: async () => ready,
		model: async () => "你好",
	});
	const session = hub.createConversation();
	for (const goal of ["方案一", "方案二"])
		await hub.send({
			conversationId: session.id,
			message: goal,
			mode: "office",
		});
	await vi.waitFor(() =>
		expect(
			hub.snapshot(session.id).tasks.every((t) => t.state === "completed"),
		).toBe(true),
	);
	await hub.send({
		conversationId: session.id,
		message: "继续修改",
		mode: "continue",
	});
	expect(hub.snapshot(session.id).messages.at(-1)?.content).toContain("哪一项");
	const task = hub.snapshot(session.id).tasks[0];
	await hub.send({
		conversationId: session.id,
		message: "控制在一页",
		mode: "update",
		taskId: task?.id,
	});
	expect(hub.snapshot(session.id).tasks[0]?.decisions).toContain("控制在一页");
});
