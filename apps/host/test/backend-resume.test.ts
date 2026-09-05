import { expect, it, vi } from "vitest";
import { ClaudeCliRuntime } from "../../../plugins/runtime-claude/src/runtime.js";
import { PiRpcRuntime } from "../../../plugins/runtime-pi/src/runtime.js";

const calls = vi.hoisted(() => [] as unknown[][]);
vi.mock("../../../plugins/runtime-claude/src/process-controller.js", () => ({
	runClaudeProcess: async function* (...args: unknown[]) {
		calls.push(args);
		yield { type: "run.completed", runId: args[0], summary: "done" };
	},
}));
vi.mock("../../../plugins/runtime-pi/src/process-controller.js", () => ({
	runPiProcess: async function* (...args: unknown[]) {
		calls.push(args);
		yield { type: "run.completed", runId: args[0], summary: "done" };
	},
}));
it("restores Claude and Pi sessions into the persisted worktree on a fresh runtime", async () => {
	calls.length = 0;
	const signal = new AbortController().signal;
	const claude = new ClaudeCliRuntime({ executable: "claude" });
	const pi = new PiRpcRuntime({
		executable: "pi",
		sessionDirectory: "sessions",
		policyExtensionPath: "policy.mjs",
	});
	for await (const _event of claude.resumeInWorktree(
		"thread-one",
		"worktree",
		"continue",
		"turn-one",
		signal,
	)) {
	}
	for await (const _event of pi.resumeInWorktree(
		"thread-two",
		"worktree",
		"continue",
		"turn-two",
		signal,
	)) {
	}
	expect(calls[0]?.[0]).toBe("turn-one");
	expect(calls[0]?.[1]).toMatchObject({
		cwd: "worktree",
		args: expect.arrayContaining(["--resume", "thread-one"]),
	});
	expect(calls[1]?.slice(0, 2)).toEqual(["turn-two", "thread-two"]);
	expect(calls[1]?.[2]).toMatchObject({
		cwd: "worktree",
		args: expect.arrayContaining(["--session-id", "thread-two"]),
	});
});
