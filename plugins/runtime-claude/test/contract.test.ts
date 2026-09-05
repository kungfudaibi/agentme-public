import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
	adaptClaudeEvent,
	buildClaudeInvocation,
	buildClaudeResumeInvocation,
	ClaudeCliRuntime,
	probeClaudeHealth,
	runClaudeProcess,
} from "../src/index.js";

const execFileAsync = promisify(execFile);

describe("Claude stream event adapter", () => {
	it("normalizes start, progress, messages, tools, completion and failure", () => {
		expect(
			adaptClaudeEvent("run-1", {
				type: "system",
				subtype: "init",
				session_id: "session-1",
			}),
		).toEqual([{ type: "run.started", runId: "run-1", threadId: "session-1" }]);
		expect(
			adaptClaudeEvent("run-1", {
				type: "system",
				subtype: "status",
				status: "compacting",
			}),
		).toEqual([
			{ type: "run.progress", runId: "run-1", message: "Claude status" },
		]);
		expect(
			adaptClaudeEvent("run-1", {
				type: "assistant",
				message: {
					content: [
						{ type: "text", text: "Working" },
						{
							type: "tool_use",
							id: "tool-1",
							name: "Edit",
							input: { file_path: "src/a.ts" },
						},
					],
				},
			}),
		).toEqual([
			{ type: "message.delta", runId: "run-1", text: "Working" },
			{
				type: "tool.requested",
				runId: "run-1",
				toolCallId: "tool-1",
				tool: "Edit",
				input: { file_path: "src/a.ts" },
			},
		]);
		expect(
			adaptClaudeEvent("run-1", {
				type: "stream_event",
				event: {
					type: "content_block_delta",
					delta: { type: "text_delta", text: "still working" },
				},
			}),
		).toEqual([
			{ type: "message.delta", runId: "run-1", text: "still working" },
		]);
		expect(
			adaptClaudeEvent("run-1", {
				type: "result",
				subtype: "success",
				is_error: false,
				result: "Done",
			}),
		).toEqual([{ type: "run.completed", runId: "run-1", summary: "Done" }]);
		expect(
			adaptClaudeEvent("run-1", {
				type: "result",
				subtype: "error_during_execution",
				is_error: true,
				result: "Authentication required",
			}),
		).toMatchObject([
			{
				type: "run.failed",
				error: { code: "EXECUTION_FAILED", message: "Claude run failed" },
			},
		]);
	});

	it("rejects malformed events", () => {
		expect(() => adaptClaudeEvent("run-1", { type: "system" })).toThrowError(
			expect.objectContaining({ code: "INVALID_CONTRACT" }),
		);
		expect(() =>
			adaptClaudeEvent("run-1", {
				type: "assistant",
				message: { content: [{ type: "tool_use", id: "x", name: "Edit" }] },
			}),
		).toThrowError(expect.objectContaining({ code: "INVALID_CONTRACT" }));
		expect(() =>
			adaptClaudeEvent("run-1", {
				type: "assistant",
				message: { content: [{ type: "text", text: "x".repeat(64_001) }] },
			}),
		).toThrowError(expect.objectContaining({ code: "INVALID_CONTRACT" }));
	});
});

describe("Claude invocation", () => {
	it("isolates the environment, worktree and configured permission profile", () => {
		const invocation = buildClaudeInvocation({
			executable: "claude",
			worktreePath: "D:\\tasks\\task-1",
			prompt: "Fix it",
			permissionMode: "bypassPermissions",
			model: "sonnet",
			maxBudgetUsd: 0.5,
			hostEnvironment: {
				APPDATA: "D:\\profile\\appdata",
				PATH: "safe-path",
				ANTHROPIC_API_KEY: "provider-secret",
				AGENTME_AUTH_TOKEN: "host-secret",
				NODE_OPTIONS: "--require malicious-module",
			},
		});
		expect(invocation).toEqual({
			executable: "claude",
			args: [
				"-p",
				"--output-format",
				"stream-json",
				"--verbose",
				"--include-partial-messages",
				"--safe-mode",
				"--permission-mode",
				"bypassPermissions",
				"--model",
				"sonnet",
				"--max-budget-usd",
				"0.5",
			],
			stdin: "Fix it",
			cwd: "D:\\tasks\\task-1",
			env: { APPDATA: "D:\\profile\\appdata", PATH: "safe-path" },
		});
	});

	it("resumes the named Claude session in the same worktree", () => {
		const invocation = buildClaudeResumeInvocation({
			executable: "claude",
			worktreePath: "D:\\tasks\\task-1",
			prompt: "Continue",
			threadId: "session-1",
		});
		expect(invocation.args).toContain("--resume");
		expect(invocation.args).toContain("session-1");
		expect(invocation.cwd).toBe("D:\\tasks\\task-1");
	});
});

describe("Claude process controller", () => {
	it("streams normalized JSONL and reports changed files", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agentme-claude-process-"));
		try {
			await writeFile(join(cwd, "tracked.txt"), "before\n");
			await execFileAsync("git", ["init"], { cwd });
			await execFileAsync("git", ["add", "tracked.txt"], { cwd });
			await execFileAsync(
				"git",
				[
					"-c",
					"user.name=AgentMe Test",
					"-c",
					"user.email=agentme@example.invalid",
					"commit",
					"-m",
					"fixture",
				],
				{ cwd },
			);
			const script = [
				`const fs=require("node:fs");`,
				`console.log(JSON.stringify({type:"system",subtype:"init",session_id:"session-1"}));`,
				`fs.writeFileSync("tracked.txt","after\\n");`,
				`console.log(JSON.stringify({type:"result",subtype:"success",is_error:false,result:"Done"}));`,
			].join("");
			const events = [];
			for await (const event of runClaudeProcess(
				"run-1",
				{
					executable: process.execPath,
					args: ["-e", script],
					stdin: "",
					cwd,
					env: { PATH: process.env.PATH },
				},
				new AbortController().signal,
			)) {
				events.push(event);
			}
			expect(events.map((event) => event.type)).toEqual([
				"run.started",
				"file.changed",
				"run.completed",
			]);
			expect(events[1]).toEqual({
				type: "file.changed",
				runId: "run-1",
				paths: ["tracked.txt"],
			});
		} finally {
			await removeTemp(cwd);
		}
	});

	it("terminates the worker after malformed JSONL", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agentme-claude-malformed-"));
		try {
			const events: unknown[] = [];
			await expect(async () => {
				for await (const event of runClaudeProcess(
					"run-bad",
					{
						executable: process.execPath,
						args: ["-e", "console.log('not-json');setInterval(() => {}, 1000)"],
						stdin: "",
						cwd,
					},
					new AbortController().signal,
				)) {
					events.push(event);
				}
			}).rejects.toMatchObject({ code: "INVALID_CONTRACT" });
			expect(events).toEqual([]);
		} finally {
			await removeTemp(cwd);
		}
	}, 2_000);

	it("maps a missing executable to a stable failure event", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agentme-claude-missing-"));
		try {
			const events = [];
			for await (const event of runClaudeProcess(
				"run-missing",
				{
					executable: join(cwd, "missing-claude"),
					args: [],
					stdin: "",
					cwd,
				},
				new AbortController().signal,
			)) {
				events.push(event);
			}
			expect(events).toMatchObject([
				{
					type: "run.failed",
					runId: "run-missing",
					error: { code: "EXECUTION_FAILED" },
				},
			]);
		} finally {
			await removeTemp(cwd);
		}
	});

	it("terminates an active process and emits cancellation", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agentme-claude-cancel-"));
		try {
			const controller = new AbortController();
			setTimeout(() => controller.abort(), 50);
			const events = [];
			for await (const event of runClaudeProcess(
				"run-cancel",
				{
					executable: process.execPath,
					args: ["-e", "setInterval(() => {}, 1000)"],
					stdin: "",
					cwd,
				},
				controller.signal,
			)) {
				events.push(event);
			}
			expect(events).toEqual([{ type: "run.cancelled", runId: "run-cancel" }]);
		} finally {
			await removeTemp(cwd);
		}
	});
});

describe("Claude runtime", () => {
	it("tracks the session worktree for resumable conversations", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agentme-claude-runtime-"));
		try {
			await mkdir(join(cwd, "bin"));
			const executable = join(cwd, "bin", "claude-stub.js");
			await writeFile(
				executable,
				`#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"system",subtype:"init",session_id:"session-1"}));console.log(JSON.stringify({type:"result",subtype:"success",is_error:false,result:"Done"}));\n`,
			);
			const runtime = new ClaudeCliRuntime({
				executable: process.execPath,
				extraArgs: [executable],
				hostEnvironment: { PATH: process.env.PATH },
			});
			const startEvents = [];
			for await (const event of runtime.start(
				{
					runId: "run-start",
					taskId: "task-1",
					worktreePath: cwd,
					instruction: "Fix it",
				},
				new AbortController().signal,
			))
				startEvents.push(event);
			const resumeEvents = [];
			for await (const event of runtime.resume(
				"session-1",
				"Continue",
				new AbortController().signal,
			))
				resumeEvents.push(event);
			expect(startEvents.at(-1)?.type).toBe("run.completed");
			expect(resumeEvents.at(-1)?.type).toBe("run.completed");
			expect(await runtime.capabilities()).toEqual({
				canResume: true,
				canRequestApproval: false,
				canStreamFileChanges: true,
			});
		} finally {
			await removeTemp(cwd);
		}
	});

	it("cancels a run by its public run id", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agentme-claude-runtime-cancel-"));
		try {
			const executable = join(cwd, "claude-stub.js");
			await writeFile(
				executable,
				`console.log(JSON.stringify({type:"system",subtype:"init",session_id:"session-cancel"}));setInterval(() => {}, 1000);\n`,
			);
			const runtime = new ClaudeCliRuntime({
				executable: process.execPath,
				extraArgs: [executable],
				hostEnvironment: { PATH: process.env.PATH },
			});
			const events = [];
			for await (const event of runtime.start(
				{
					runId: "run-public-cancel",
					taskId: "task-cancel",
					worktreePath: cwd,
					instruction: "Wait",
				},
				new AbortController().signal,
			)) {
				events.push(event);
				if (event.type === "run.started")
					await runtime.cancel("run-public-cancel");
			}
			expect(events.at(-1)).toEqual({
				type: "run.cancelled",
				runId: "run-public-cancel",
			});
		} finally {
			await removeTemp(cwd);
		}
	});
});

describe("Claude health probe", () => {
	it("reports missing authentication without exposing CLI output", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agentme-claude-health-"));
		try {
			const executable = join(cwd, "health.js");
			await writeFile(executable, "process.exit(1);\n");
			expect(
				await probeClaudeHealth(process.execPath, {
					extraArgs: [executable],
					environment: { PATH: process.env.PATH },
				}),
			).toEqual({ status: "unhealthy", reason: "authentication-required" });
		} finally {
			await removeTemp(cwd);
		}
	});
});

async function removeTemp(path: string): Promise<void> {
	await rm(path, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	});
}
