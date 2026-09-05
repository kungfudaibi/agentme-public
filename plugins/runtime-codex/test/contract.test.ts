import { describe, expect, it } from "vitest";

import {
	adaptCodexEvent,
	buildCodexInvocation,
	buildCodexResumeInvocation,
	runCodexProcess,
} from "../src/index.js";

describe("Codex JSONL event adapter", () => {
	it.each([
		[
			{ type: "thread.started", thread_id: "thread-1" },
			{ type: "run.started", runId: "run-1", threadId: "thread-1" },
		],
		[
			{ type: "turn.started" },
			{ type: "run.progress", runId: "run-1", message: "Codex turn started" },
		],
		[
			{
				type: "item.completed",
				item: { id: "item-1", type: "agent_message", text: "Done" },
			},
			{ type: "message.delta", runId: "run-1", text: "Done" },
		],
		[
			{
				type: "item.started",
				item: { id: "item-2", type: "command_execution", command: "pnpm test" },
			},
			{
				type: "tool.requested",
				runId: "run-1",
				toolCallId: "item-2",
				tool: "shell",
				input: { command: "pnpm test" },
			},
		],
		[
			{
				type: "item.completed",
				item: {
					id: "item-3",
					type: "file_change",
					status: "completed",
					changes: [{ path: "src/a.ts" }],
				},
			},
			{ type: "file.changed", runId: "run-1", paths: ["src/a.ts"] },
		],
		[
			{ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } },
			{ type: "run.completed", runId: "run-1", summary: "Codex run completed" },
		],
	] as const)("normalizes %#", (input, expected) => {
		expect(adaptCodexEvent("run-1", input)).toEqual(expected);
	});

	it("maps approval, failure and malformed JSON to stable events", () => {
		expect(
			adaptCodexEvent("run-1", {
				type: "item.started",
				item: {
					id: "approval-1",
					type: "approval_request",
					reason: "Network access",
				},
			}),
		).toMatchObject({ type: "approval.required", reason: "Network access" });
		expect(
			adaptCodexEvent("run-1", {
				type: "turn.failed",
				error: { message: "failed" },
			}),
		).toMatchObject({
			type: "run.failed",
			error: { code: "EXECUTION_FAILED", message: "Codex run failed" },
		});
		expect(() => adaptCodexEvent("run-1", "not an event")).toThrowError(
			expect.objectContaining({ code: "INVALID_CONTRACT" }),
		);
	});

	it("does not report failed file changes as changed files", () => {
		expect(
			adaptCodexEvent("run-1", {
				type: "item.completed",
				item: {
					id: "item-1",
					type: "file_change",
					status: "failed",
					changes: [{ path: "src/a.ts" }],
				},
			}),
		).toBeUndefined();
	});
});

describe("Codex process controller", () => {
	it("streams JSONL and emits a single completion event", async () => {
		const script = `console.log(JSON.stringify({type:"thread.started",thread_id:"thread-1"}));console.log(JSON.stringify({type:"turn.completed"}))`;
		const events = [];
		for await (const event of runCodexProcess(
			"run-1",
			{ executable: process.execPath, args: ["-e", script], stdin: "" },
			new AbortController().signal,
		)) {
			events.push(event);
		}
		expect(events.map((event) => event.type)).toEqual([
			"run.started",
			"run.completed",
		]);
	});

	it("does not inherit host secrets when an invocation omits its environment", async () => {
		const environmentVariable = "AGENTME_CODEX_LEAK_TEST";
		const previousValue = process.env[environmentVariable];
		process.env[environmentVariable] = "must-not-reach-worker";
		try {
			const script = `console.log(JSON.stringify({type:"item.completed",item:{id:"item-1",type:"agent_message",text:process.env.${environmentVariable} ?? "missing"}}));console.log(JSON.stringify({type:"turn.completed"}))`;
			const events = [];
			for await (const event of runCodexProcess(
				"run-isolated",
				{ executable: process.execPath, args: ["-e", script], stdin: "" },
				new AbortController().signal,
			)) {
				events.push(event);
			}
			expect(events).toContainEqual({
				type: "message.delta",
				runId: "run-isolated",
				text: "missing",
			});
		} finally {
			if (previousValue === undefined) delete process.env[environmentVariable];
			else process.env[environmentVariable] = previousValue;
		}
	});

	it("terminates an active process and emits cancellation", async () => {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 50);
		const events = [];
		for await (const event of runCodexProcess(
			"run-cancel",
			{
				executable: process.execPath,
				args: ["-e", "setInterval(() => {}, 1000)"],
				stdin: "",
			},
			controller.signal,
		)) {
			events.push(event);
		}
		expect(events).toEqual([{ type: "run.cancelled", runId: "run-cancel" }]);
	});
});

describe("Codex invocation", () => {
	it("scopes the run to a worktree and sends the prompt over stdin", () => {
		const input = {
			executable: "codex",
			worktreePath: "D:\\tasks\\task-1",
			prompt: "Follow AGENTS.md and fix the test",
			hostEnvironment: {
				HOME: "/users/agentme",
				PATH: "safe-path",
				AGENTME_AUTH_TOKEN: "host-secret",
				OPENAI_API_KEY: "provider-secret",
				NODE_OPTIONS: "--require malicious-module",
			},
		};
		expect(buildCodexInvocation(input)).toEqual({
			executable: "codex",
			args: [
				"--ask-for-approval",
				"never",
				"--sandbox",
				"workspace-write",
				"--cd",
				"D:\\tasks\\task-1",
				"exec",
				"--json",
				"--color",
				"never",
				"-",
			],
			stdin: "Follow AGENTS.md and fix the test",
			env: {
				HOME: "/users/agentme",
				PATH: "safe-path",
			},
		});
	});

	it("applies Windows sandbox resources to resumed runs", () => {
		const invocation = buildCodexResumeInvocation({
			executable: "codex",
			worktreePath: "D:\\tasks\\task-1",
			prompt: "Continue",
			threadId: "thread-1",
			model: "gpt-5",
			windowsSandbox: "unelevated",
			resourceDirectory: "D:\\codex-resources",
			hostEnvironment: { PATH: "safe-path" },
			platform: "win32",
		});
		expect(invocation.args).toEqual([
			"--ask-for-approval",
			"never",
			"--cd",
			"D:\\tasks\\task-1",
			"--sandbox",
			"workspace-write",
			"exec",
			"resume",
			"--json",
			"--model",
			"gpt-5",
			"--config",
			'windows.sandbox="unelevated"',
			"thread-1",
			"-",
		]);
		expect(invocation.env?.PATH).toBe("D:\\codex-resources;safe-path");
	});

	it("applies an explicitly selected full-access unattended policy", () => {
		expect(
			buildCodexInvocation({
				executable: "codex",
				worktreePath: "D:\\tasks\\task-1",
				prompt: "Run",
				executionPolicy: {
					sandboxMode: "danger-full-access",
					approvalPolicy: "never",
				},
			}).args.slice(0, 6),
		).toEqual([
			"--ask-for-approval",
			"never",
			"--sandbox",
			"danger-full-access",
			"--cd",
			"D:\\tasks\\task-1",
		]);
	});
});
