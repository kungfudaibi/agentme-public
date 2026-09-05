import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { DelegatedTaskInput } from "../../contracts/src/index.js";
import { SupervisorGraphStore } from "../../task-orchestrator/src/index.js";
import {
	AssistantSupervisor,
	type AssistantSupervisorDependencies,
	type WorkerDispatcher,
	type WorkerSnapshot,
} from "../src/index.js";

const directories: string[] = [];
const task = (
	repositoryId: string,
	instruction: string,
): DelegatedTaskInput => ({
	repositoryId,
	runtimeId: "runtime-codex",
	instruction,
	acceptanceCriteria: ["tests pass"],
});

class FakeDispatcher implements WorkerDispatcher {
	readonly dispatch = vi.fn(async (input: DelegatedTaskInput) => ({
		taskId: `worker-${input.instruction}`,
		worktreeId: `worktree-${input.instruction}`,
	}));
	readonly cancel = vi.fn(async () => undefined);
	readonly snapshots = new Map<string, WorkerSnapshot>();
	async observe(taskId: string): Promise<WorkerSnapshot> {
		return this.snapshots.get(taskId) ?? { state: "running" as const };
	}
}

async function fixture(maxConcurrency = 2) {
	const directory = await mkdtemp(join(tmpdir(), "agentme-supervisor-"));
	directories.push(directory);
	const store = new SupervisorGraphStore(join(directory, "agentme.sqlite"));
	const dispatcher = new FakeDispatcher();
	const supervisor = new AssistantSupervisor({
		store,
		dispatcher,
		scope: {
			hasRepository: (id) => id === "agentme",
			hasRuntime: (id) => id === "runtime-codex",
		},
		maxConcurrency,
	});
	return { store, dispatcher, supervisor };
}

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("assistant supervisor", () => {
	it("injects only graph, dispatcher and scope ports", () => {
		expectTypeOf<keyof AssistantSupervisorDependencies>().toEqualTypeOf<
			"store" | "dispatcher" | "scope" | "maxConcurrency" | "supervisorId"
		>();
	});

	it("rejects repositories and runtimes outside the registered scope", async () => {
		const { store, dispatcher, supervisor } = await fixture();
		await expect(
			supervisor.createPlan({
				parentId: "parent-1",
				actorId: "owner",
				tasks: [task("other-repository", "one")],
			}),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		expect(dispatcher.dispatch).not.toHaveBeenCalled();
		store.close();
	});

	it("dispatches only the configured number of children", async () => {
		const { store, dispatcher, supervisor } = await fixture(2);
		await supervisor.createPlan({
			parentId: "parent-1",
			actorId: "owner",
			tasks: [
				task("agentme", "one"),
				task("agentme", "two"),
				task("agentme", "three"),
			],
		});

		expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
		expect(dispatcher.dispatch).toHaveBeenCalledWith(
			expect.any(Object),
			expect.any(AbortSignal),
			"owner",
		);
		expect(store.listChildren("parent-1").map(({ state }) => state)).toEqual([
			"dispatched",
			"dispatched",
			"pending",
		]);
		store.close();
	});

	it("restores dispatched children without starting duplicate workers", async () => {
		const { store, dispatcher, supervisor } = await fixture(1);
		await supervisor.createPlan({
			parentId: "parent-1",
			actorId: "owner",
			tasks: [task("agentme", "one"), task("agentme", "two")],
		});
		const databasePath = store.databasePath;
		store.close();

		const restartedStore = new SupervisorGraphStore(databasePath);
		const restarted = new AssistantSupervisor({
			store: restartedStore,
			dispatcher,
			scope: { hasRepository: () => true, hasRuntime: () => true },
			maxConcurrency: 1,
		});
		await restarted.resume("parent-1");

		expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
		expect(restartedStore.listChildren("parent-1")).toHaveLength(2);
		restartedStore.close();
	});

	it("cancels a duplicate writer when a dispatcher reuses a worktree", async () => {
		const { store, dispatcher, supervisor } = await fixture(2);
		dispatcher.dispatch
			.mockResolvedValueOnce({ taskId: "worker-one", worktreeId: "shared" })
			.mockResolvedValueOnce({ taskId: "worker-two", worktreeId: "shared" });

		await expect(
			supervisor.createPlan({
				parentId: "parent-1",
				actorId: "owner",
				tasks: [task("agentme", "one"), task("agentme", "two")],
			}),
		).rejects.toMatchObject({ code: "INVALID_TASK_TRANSITION" });
		expect(dispatcher.cancel).toHaveBeenCalledWith("worker-two");
		expect(store.listChildren("parent-1").map(({ state }) => state)).toEqual([
			"dispatched",
			"pending",
		]);
		store.close();
	});

	it("cancels one child and dispatches the next queued child", async () => {
		const { store, dispatcher, supervisor } = await fixture(1);
		await supervisor.createPlan({
			parentId: "parent-1",
			actorId: "owner",
			tasks: [task("agentme", "one"), task("agentme", "two")],
		});
		const first = store.listChildren("parent-1")[0];
		if (first === undefined) throw new Error("Expected first child");

		await supervisor.cancelChild("parent-1", first.childId);

		expect(dispatcher.cancel).toHaveBeenCalledWith("worker-one");
		expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
		expect(store.listChildren("parent-1").map(({ state }) => state)).toEqual([
			"cancelled",
			"dispatched",
		]);
		store.close();
	});

	it("requires terminal reports before synthesizing the parent", async () => {
		const { store, dispatcher, supervisor } = await fixture(1);
		await supervisor.createPlan({
			parentId: "parent-1",
			actorId: "owner",
			tasks: [task("agentme", "one")],
		});
		await expect(supervisor.synthesize("parent-1")).rejects.toMatchObject({
			code: "INVALID_TASK_TRANSITION",
		});
		dispatcher.snapshots.set("worker-one", {
			state: "completed",
			report: { summary: "tests passed" },
		});
		await supervisor.refresh("parent-1");

		expect(await supervisor.synthesize("parent-1")).toEqual({
			parentId: "parent-1",
			reports: [
				{ childId: expect.any(String), report: { summary: "tests passed" } },
			],
		});
		expect(store.getParent("parent-1").state).toBe("completed");
		store.close();
	});

	it("rejects an untrusted worker report before persisting it", async () => {
		const { store, dispatcher, supervisor } = await fixture(1);
		await supervisor.createPlan({
			parentId: "parent-1",
			actorId: "owner",
			tasks: [task("agentme", "one")],
		});
		dispatcher.snapshots.set("worker-one", {
			state: "completed",
			report: {
				summary: "invalid",
				details: (() => undefined) as never,
			},
		});

		await expect(supervisor.refresh("parent-1")).rejects.toMatchObject({
			code: "INVALID_CONTRACT",
		});
		expect(store.listChildren("parent-1")[0]?.state).toBe("dispatched");
		store.close();
	});
});
