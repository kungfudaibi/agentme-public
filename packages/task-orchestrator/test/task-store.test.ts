import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TaskStore } from "../src/index.js";

async function createStore(): Promise<TaskStore> {
	const directory = await mkdtemp(join(tmpdir(), "agentme-task-store-"));
	return new TaskStore(join(directory, "agentme.sqlite"));
}

describe("task state transitions", () => {
	it("commits only legal state transitions", async () => {
		const store = await createStore();
		store.createTask({
			taskId: "task-1",
			actorId: "owner",
			at: "2026-08-20T08:00:00.000Z",
		});
		const lease = store.acquireLease(
			"task-1",
			"worker-1",
			"2026-08-20T08:00:00.000Z",
			60_000,
		);

		expect(() =>
			store.transition(
				"task-1",
				lease,
				"completed",
				{
					type: "task.completed",
					taskId: "task-1",
					report: { summary: "Skipped required states" },
					at: "2026-08-20T08:00:01.000Z",
				},
				"2026-08-20T08:00:01.000Z",
			),
		).toThrowError(
			expect.objectContaining({ code: "INVALID_TASK_TRANSITION" }),
		);
		expect(store.getTask("task-1").state).toBe("received");
		expect(store.listPendingEvents()).toHaveLength(1);
		store.close();
	});

	it("rejects writes from a stale writer lease", async () => {
		const store = await createStore();
		store.createTask({
			taskId: "task-2",
			actorId: "owner",
			at: "2026-08-20T08:00:00.000Z",
		});
		const staleLease = store.acquireLease(
			"task-2",
			"worker-1",
			"2026-08-20T08:00:00.000Z",
			1_000,
		);
		const currentLease = store.acquireLease(
			"task-2",
			"worker-2",
			"2026-08-20T08:00:02.000Z",
			60_000,
		);

		expect(() =>
			store.appendEvent(
				"task-2",
				staleLease,
				{
					type: "task.progress",
					taskId: "task-2",
					message: "Late result",
					at: "2026-08-20T08:00:03.000Z",
				},
				"2026-08-20T08:00:03.000Z",
			),
		).toThrowError(expect.objectContaining({ code: "STALE_WRITER_LEASE" }));
		expect(() =>
			store.transition(
				"task-2",
				staleLease,
				"clarifying",
				{
					type: "task.progress",
					taskId: "task-2",
					message: "Stale transition",
					at: "2026-08-20T08:00:03.000Z",
				},
				"2026-08-20T08:00:03.000Z",
			),
		).toThrowError(expect.objectContaining({ code: "STALE_WRITER_LEASE" }));

		store.transition(
			"task-2",
			currentLease,
			"clarifying",
			{
				type: "task.progress",
				taskId: "task-2",
				message: "Clarifying request",
				at: "2026-08-20T08:00:03.000Z",
			},
			"2026-08-20T08:00:03.000Z",
		);
		expect(store.getTask("task-2").state).toBe("clarifying");
		expect(store.listPendingEvents()).toHaveLength(2);
		store.close();
	});

	it("releases a continuation lease without changing terminal task state", async () => {
		const store = await createStore();
		store.createTask({
			taskId: "task-terminal",
			actorId: "owner",
			at: "2026-08-20T08:00:00.000Z",
		});
		const first = store.acquireLease(
			"task-terminal",
			"turn-one",
			"2026-08-20T08:00:00.000Z",
			60_000,
		);

		store.releaseLease("task-terminal", first, "2026-08-20T08:00:01.000Z");
		const second = store.acquireLease(
			"task-terminal",
			"turn-two",
			"2026-08-20T08:00:01.000Z",
			60_000,
		);

		expect(second.version).toBeGreaterThan(first.version);
		expect(store.getTask("task-terminal").state).toBe("received");
		store.close();
	});
});
