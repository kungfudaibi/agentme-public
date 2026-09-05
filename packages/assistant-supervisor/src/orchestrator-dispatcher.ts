import type { DelegatedTaskInput } from "../../contracts/src/index.js";
import type {
	TaskOrchestrator,
	TaskStore,
} from "../../task-orchestrator/src/index.js";
import type {
	WorkerDispatcher,
	WorkerHandle,
	WorkerSnapshot,
} from "./supervisor.js";

export class OrchestratorWorkerDispatcher implements WorkerDispatcher {
	readonly #orchestrator: TaskOrchestrator;
	readonly #store: TaskStore;

	constructor(orchestrator: TaskOrchestrator, store: TaskStore) {
		this.#orchestrator = orchestrator;
		this.#store = store;
	}

	async dispatch(
		request: DelegatedTaskInput,
		signal: AbortSignal,
		actorId: string,
	): Promise<WorkerHandle> {
		if (signal.aborted) throw signal.reason;
		const taskId = this.#orchestrator.submit({
			instruction: request.instruction,
			actorId,
			repositoryId: request.repositoryId,
			runtimeId: request.runtimeId,
		});
		signal.addEventListener("abort", () => this.#orchestrator.cancel(taskId), {
			once: true,
		});
		return { taskId, worktreeId: taskId };
	}

	async observe(taskId: string): Promise<WorkerSnapshot> {
		const task = this.#store.getTask(taskId);
		switch (task.state) {
			case "completed": {
				const completed = this.#store
					.getTaskEvents(taskId)
					.map(({ event }) => event)
					.findLast((event) => event.type === "task.completed");
				if (completed?.type !== "task.completed") return { state: "failed" };
				return { state: "completed", report: completed.report };
			}
			case "failed":
			case "rejected":
			case "timed_out":
				return { state: "failed" };
			case "cancelled":
				return { state: "cancelled" };
			default:
				return { state: "running" };
		}
	}

	async cancel(taskId: string): Promise<void> {
		this.#orchestrator.cancel(taskId);
	}
}
