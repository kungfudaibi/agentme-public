import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { OrchestratorWorkerDispatcher } from "../../../packages/assistant-supervisor/src/orchestrator-dispatcher.js";
import {
	TaskOrchestrator,
	TaskStore,
} from "../../../packages/task-orchestrator/src/index.js";
import { CodingBackendRouter } from "../src/coding-backend-router.js";

it("routes the delegated backend and cancellation through the real orchestrator", async () => {
	const store = new TaskStore(
		join(mkdtempSync(join(tmpdir(), "backend-route-")), "db.sqlite"),
	);
	const seen: string[] = [];
	let aborted = false;
	const router = new CodingBackendRouter(
		new Map([
			[
				"runtime-codex",
				{
					execute: async () => {
						seen.push("codex");
						return { summary: "done" };
					},
				},
			],
			[
				"runtime-pi",
				{
					execute: async (_text: string, signal: AbortSignal) => {
						seen.push("pi");
						await new Promise<void>((resolve) =>
							signal.addEventListener(
								"abort",
								() => {
									aborted = true;
									resolve();
								},
								{ once: true },
							),
						);
						return { summary: "cancelled" };
					},
				},
			],
		]),
	);
	const orchestrator = new TaskOrchestrator(store, router);
	const dispatcher = new OrchestratorWorkerDispatcher(orchestrator, store);
	const controller = new AbortController();
	const task = await dispatcher.dispatch(
		{
			repositoryId: "fixture",
			runtimeId: "runtime-pi",
			instruction: "inspect",
			acceptanceCriteria: ["done"],
		},
		controller.signal,
		"owner",
	);
	await vi.waitFor(() => expect(seen).toEqual(["pi"]));
	controller.abort();
	await vi.waitFor(() => expect(aborted).toBe(true));
	expect(store.getTask(task.taskId).state).toBe("cancelled");
	orchestrator.stop();
	store.close();
});

it("rejects an unknown backend without falling back to Codex", async () => {
	const run = vi.fn(async () => ({ summary: "done" }));
	const router = new CodingBackendRouter(
		new Map([["runtime-codex", { execute: run }]]),
	);
	await expect(
		router.execute("inspect", new AbortController().signal, {
			taskId: "x",
			runtimeId: "runtime-missing",
		}),
	).rejects.toThrow();
	expect(run).not.toHaveBeenCalled();
});
