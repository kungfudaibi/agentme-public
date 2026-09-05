import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CodingEvent } from "../../../packages/contracts/src/index.js";
import { TaskStore } from "../../../packages/task-orchestrator/src/index.js";
import type { RegisteredRepository } from "../../../packages/workspace-manager/src/index.js";
import { TaskWorkerSessionService } from "../src/task-worker-session.js";

function completeTaskWithThread(store: TaskStore, taskId: string): void {
	const startedAt = "2026-08-24T01:00:00.000Z";
	store.createTask({ taskId, actorId: "owner", at: startedAt });
	const lease = store.acquireLease(taskId, "initial-worker", startedAt, 60_000);
	for (const [state, at] of [
		["planned", "2026-08-24T01:00:01.000Z"],
		["queued", "2026-08-24T01:00:02.000Z"],
		["preparing_workspace", "2026-08-24T01:00:03.000Z"],
		["running", "2026-08-24T01:00:04.000Z"],
	] as const)
		store.transition(
			taskId,
			lease,
			state,
			{ type: "task.progress", taskId, message: state, at },
			at,
		);
	store.appendEvent(
		taskId,
		lease,
		{
			type: "task.worker.event",
			taskId,
			runtimeId: "runtime-codex",
			event: { type: "run.started", runId: taskId, threadId: "thread-one" },
			at: "2026-08-24T01:00:05.000Z",
		},
		"2026-08-24T01:00:05.000Z",
	);
	store.transition(
		taskId,
		lease,
		"verifying",
		{
			type: "task.progress",
			taskId,
			message: "verifying",
			at: "2026-08-24T01:00:06.000Z",
		},
		"2026-08-24T01:00:06.000Z",
	);
	store.transition(
		taskId,
		lease,
		"completed",
		{
			type: "task.completed",
			taskId,
			report: { summary: "done" },
			at: "2026-08-24T01:00:07.000Z",
		},
		"2026-08-24T01:00:07.000Z",
	);
	store.releaseLease(taskId, lease, "2026-08-24T01:00:08.000Z");
}

describe("task worker session service", () => {
	it("resumes the persisted worker thread and records the verified turn", async () => {
		const root = await mkdtemp(join(tmpdir(), "agentme-worker-session-"));
		const taskId = "task-worker-one";
		const worktreePath = join(root, taskId);
		await mkdir(worktreePath);
		const canonicalWorktreePath = await realpath(worktreePath);
		const store = new TaskStore(join(root, "agentme.sqlite"));
		completeTaskWithThread(store, taskId);
		const historyLease = store.acquireLease(
			taskId,
			"history-writer",
			"2026-08-24T01:00:09.000Z",
			60_000,
		);
		for (let index = 0; index < 1_005; index += 1)
			store.appendEvent(
				taskId,
				historyLease,
				{
					type: "task.worker.event",
					taskId,
					runtimeId: "runtime-codex",
					event: {
						type: "run.progress",
						runId: taskId,
						message: `step ${index}`,
					},
					at: "2026-08-24T01:00:10.000Z",
				},
				"2026-08-24T01:00:10.000Z",
			);
		store.releaseLease(taskId, historyLease, "2026-08-24T01:00:11.000Z");
		const resumed: Array<{
			threadId: string;
			worktreePath: string;
			input: string;
		}> = [];
		const service = new TaskWorkerSessionService({
			store,
			graph: {
				listChildren: () => [
					{
						childId: "child-one",
						parentId: "parent-one",
						ordinal: 0,
						request: {
							repositoryId: "agentme",
							runtimeId: "runtime-codex",
							instruction: "inspect",
							acceptanceCriteria: ["reported"],
						},
						state: "completed",
						workerTaskId: taskId,
						worktreeId: taskId,
					},
				],
			},
			repositories: {
				resolve: () =>
					({
						id: "agentme",
						canonicalPath: root,
						executionTarget: "windows",
						verificationCommands: [],
						permissionProfile: { canWrite: true, canUseNetwork: false },
						git: { branch: "main", head: "a".repeat(40), isDirty: false },
					}) satisfies RegisteredRepository,
			},
			taskRoot: root,
			runtime: {
				id: "runtime-codex",
				resume: async function* (input): AsyncIterable<CodingEvent> {
					resumed.push(input);
					yield { type: "message.delta", runId: input.runId, text: "继续完成" };
					yield {
						type: "run.completed",
						runId: input.runId,
						summary: "continued",
					};
				},
			},
			createTurnId: () => "turn-two",
			now: () => "2026-08-24T01:01:00.000Z",
		});

		const activity = service.activity("parent-one", "child-one", 0);
		expect(activity).toMatchObject({
			canContinue: true,
			runtime: { id: "runtime-codex", sessionId: "thread-one" },
		});
		expect(activity.events).toHaveLength(1_000);
		const result = await service.continue(
			"parent-one",
			"child-one",
			"继续完成剩余工作",
			new AbortController().signal,
		);

		expect(result).toEqual({
			turnId: "turn-two",
			message: "继续完成",
			verification: "passed",
		});
		expect(resumed).toEqual([
			{
				threadId: "thread-one",
				worktreePath: canonicalWorktreePath,
				input: "继续完成剩余工作",
				runId: "turn-two",
			},
		]);
		expect(
			store
				.getTaskEvents(taskId)
				.map(({ event }) => event.type)
				.slice(-4),
		).toEqual([
			"task.worker.input",
			"task.worker.event",
			"task.worker.event",
			"task.worker.turn.completed",
		]);
		store.close();
	}, 10_000);
});
