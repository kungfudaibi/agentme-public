import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { TaskOrchestrator, TaskStore } from "../src/index.js";

it("releases the writer lease when a task finishes", async () => {
	const directory = await mkdtemp(
		join(tmpdir(), "agentme-orchestrator-lease-"),
	);
	const store = new TaskStore(join(directory, "agentme.sqlite"));
	const orchestrator = new TaskOrchestrator(store, {
		execute: async () => ({ summary: "done" }),
	});
	const observed: string[] = [];
	const unsubscribeAll = orchestrator.subscribeAll((event) => {
		observed.push(event.type);
	});
	const taskId = orchestrator.submit({
		instruction: "inspect",
		actorId: "owner",
	});
	await new Promise<void>((resolve) => {
		const unsubscribe = orchestrator.subscribe(taskId, () => {
			if (store.getTask(taskId).state === "completed") {
				unsubscribe();
				queueMicrotask(resolve);
			}
		});
	});

	expect(() =>
		store.acquireLease(taskId, "follow-up", new Date().toISOString(), 60_000),
	).not.toThrow();
	expect(observed).toContain("task.completed");
	unsubscribeAll();
	store.close();
});
