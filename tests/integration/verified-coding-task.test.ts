import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
	CodingEvent,
	CodingRuntime,
} from "../../packages/contracts/src/index.js";
import { VerifiedCodingTaskRunner } from "../../packages/task-orchestrator/src/index.js";
import {
	RepositoryRegistry,
	WorktreeManager,
} from "../../packages/workspace-manager/src/index.js";

class FixtureRuntime implements CodingRuntime {
	async *start(
		request: Parameters<CodingRuntime["start"]>[0],
	): AsyncIterable<CodingEvent> {
		writeFileSync(join(request.worktreePath, "result.txt"), "verified");
		yield { type: "run.started", runId: request.runId, threadId: "fixture" };
		yield {
			type: "run.completed",
			runId: request.runId,
			summary: "fixture completed",
		};
	}
	async *resume(): AsyncIterable<CodingEvent> {
		yield* [];
	}
	async cancel(): Promise<void> {}
	async capabilities() {
		return {
			canResume: false,
			canRequestApproval: false,
			canStreamFileChanges: false,
		};
	}
}

describe("verified coding task", () => {
	it("isolates a change, verifies it and reports evidence", async () => {
		const root = mkdtempSync(join(tmpdir(), "agentme-verified-"));
		const source = join(root, "source");
		execFileSync("git", ["init", "-q", source]);
		execFileSync("git", ["config", "user.email", "fixture@example.invalid"], {
			cwd: source,
		});
		execFileSync("git", ["config", "user.name", "Fixture"], { cwd: source });
		writeFileSync(join(source, "README.md"), "source");
		execFileSync("git", ["add", "."], { cwd: source });
		execFileSync("git", ["commit", "-qm", "initial"], { cwd: source });
		const registry = await RepositoryRegistry.create([source]);
		await registry.register({
			id: "fixture",
			path: source,
			executionTarget: "windows",
			verificationCommands: [
				{
					executable: "node",
					args: ["-e", "require('fs').accessSync('result.txt')"],
				},
			],
			permissionProfile: { canWrite: true, canUseNetwork: false },
		});
		const worktrees = await WorktreeManager.create(join(root, "tasks"), [
			source,
		]);
		const runner = new VerifiedCodingTaskRunner(
			registry,
			worktrees,
			new FixtureRuntime(),
			"runtime-fixture",
		);
		const workerEvents: Array<{
			readonly runtimeId: string;
			readonly event: CodingEvent;
		}> = [];
		const report = await runner.execute(
			"create result",
			new AbortController().signal,
			{
				taskId: "task-verified",
				repositoryId: "fixture",
				recordWorkerEvent: (runtimeId, event) =>
					workerEvents.push({ runtimeId, event }),
			},
		);
		expect(report).toMatchObject({
			summary: "Task changes verified",
			details: { status: "passed", changedFiles: ["result.txt"] },
		});
		expect(() =>
			execFileSync("git", ["status", "--porcelain"], {
				cwd: source,
			}).toString(),
		).not.toThrow();
		expect(
			execFileSync("git", ["status", "--porcelain"], {
				cwd: source,
			}).toString(),
		).toBe("");
		expect(workerEvents).toEqual([
			{
				runtimeId: "runtime-fixture",
				event: {
					type: "run.started",
					runId: "task-verified",
					threadId: "fixture",
				},
			},
			{
				runtimeId: "runtime-fixture",
				event: {
					type: "run.completed",
					runId: "task-verified",
					summary: "fixture completed",
				},
			},
		]);
	});
});
