import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { CodingEvent } from "../../../packages/contracts/src/index.js";
import { ClaudeCliRuntime } from "../src/index.js";

const execFileAsync = promisify(execFile);
const enabled = process.env.AGENTME_CLAUDE_SMOKE === "1";

describe.skipIf(!enabled)("installed Claude CLI smoke", () => {
	it("changes and verifies only its disposable worktree", async () => {
		const root = await mkdtemp(join(tmpdir(), "agentme-claude-smoke-"));
		const repository = join(root, "repository");
		const worktree = join(root, "worktree");
		await execFileAsync("git", ["init", repository]);
		await writeFile(join(repository, "value.txt"), "before\n");
		await execFileAsync("git", ["-C", repository, "add", "value.txt"]);
		await execFileAsync("git", [
			"-C",
			repository,
			"-c",
			"user.name=AgentMe Smoke",
			"-c",
			"user.email=agentme@example.invalid",
			"commit",
			"-m",
			"fixture",
		]);
		await execFileAsync("git", [
			"-C",
			repository,
			"worktree",
			"add",
			"-b",
			"claude-smoke",
			worktree,
		]);
		try {
			const executable = process.env.AGENTME_CLAUDE_EXECUTABLE;
			if (executable === undefined) {
				throw new Error("AGENTME_CLAUDE_EXECUTABLE is required for smoke test");
			}
			const runtime = new ClaudeCliRuntime({
				executable,
				permissionMode: "bypassPermissions",
				maxBudgetUsd: 0.5,
			});
			const events: CodingEvent[] = [];
			for await (const event of runtime.start(
				{
					runId: "claude-installed-smoke",
					taskId: "claude-installed-smoke",
					worktreePath: worktree,
					instruction:
						"Modify only value.txt. Replace its entire content with exactly the word after followed by one newline. Read the file after editing to verify it. Do not commit.",
				},
				AbortSignal.timeout(120_000),
			)) {
				events.push(event);
			}
			expect(events.some((event) => event.type === "run.started")).toBe(true);
			expect(events).toContainEqual({
				type: "file.changed",
				runId: "claude-installed-smoke",
				paths: ["value.txt"],
			});
			expect(events.at(-1)?.type).toBe("run.completed");
			expect(await readFile(join(worktree, "value.txt"), "utf8")).toBe(
				"after\n",
			);
			expect(await readFile(join(repository, "value.txt"), "utf8")).toBe(
				"before\n",
			);
			const diff = await execFileAsync("git", [
				"-C",
				worktree,
				"diff",
				"--name-only",
			]);
			expect(diff.stdout.trim()).toBe("value.txt");
		} finally {
			await execFileAsync("git", [
				"-C",
				repository,
				"worktree",
				"remove",
				"--force",
				worktree,
			]);
			await rm(root, { recursive: true, force: true, maxRetries: 5 });
		}
	}, 150_000);
});
