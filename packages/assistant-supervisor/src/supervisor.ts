import {
	AgentMeError,
	type DelegatedTaskInput,
	type TaskReport,
} from "../../contracts/src/index.js";
import type { SupervisorGraphStore } from "../../task-orchestrator/src/index.js";

export interface WorkerHandle {
	readonly taskId: string;
	readonly worktreeId: string;
}

export type WorkerSnapshot =
	| { readonly state: "running" }
	| { readonly state: "completed"; readonly report: TaskReport }
	| { readonly state: "failed" | "cancelled" };

export interface WorkerDispatcher {
	dispatch(
		request: DelegatedTaskInput,
		signal: AbortSignal,
		actorId: string,
	): Promise<WorkerHandle>;
	observe(taskId: string): Promise<WorkerSnapshot>;
	cancel(taskId: string): Promise<void>;
}

export interface SupervisorScope {
	hasRepository(repositoryId: string): boolean;
	hasRuntime(runtimeId: string): boolean;
}

export interface AssistantSupervisorDependencies {
	readonly store: SupervisorGraphStore;
	readonly dispatcher: WorkerDispatcher;
	readonly scope: SupervisorScope;
	readonly maxConcurrency: number;
	readonly supervisorId?: string;
}

export interface CreatePlanInput {
	readonly parentId: string;
	readonly actorId: string;
	readonly tasks: readonly DelegatedTaskInput[];
}

function permissionDenied(): AgentMeError {
	return new AgentMeError({
		code: "PERMISSION_DENIED",
		message: "Delegated task is outside the configured scope",
		isRetryable: false,
	});
}

export class AssistantSupervisor {
	readonly #store: SupervisorGraphStore;
	readonly #dispatcher: WorkerDispatcher;
	readonly #scope: SupervisorScope;
	readonly #maxConcurrency: number;

	constructor(dependencies: AssistantSupervisorDependencies) {
		if (
			!Number.isSafeInteger(dependencies.maxConcurrency) ||
			dependencies.maxConcurrency < 1 ||
			dependencies.maxConcurrency > 16
		)
			throw new RangeError("Invalid supervisor concurrency");
		this.#store = dependencies.store;
		this.#dispatcher = dependencies.dispatcher;
		this.#scope = dependencies.scope;
		this.#maxConcurrency = dependencies.maxConcurrency;
	}

	async createPlan(input: CreatePlanInput): Promise<void> {
		if (input.tasks.length < 1 || input.tasks.length > 16)
			throw new RangeError("Invalid supervisor plan size");
		for (const task of input.tasks) {
			if (
				!this.#scope.hasRepository(task.repositoryId) ||
				!this.#scope.hasRuntime(task.runtimeId)
			)
				throw permissionDenied();
		}
		this.#store.createPlan(
			input.parentId,
			input.actorId,
			input.tasks,
			new Date().toISOString(),
		);
		await this.#pump(input.parentId);
	}

	async resume(parentId: string): Promise<void> {
		await this.refresh(parentId);
	}

	async refresh(parentId: string): Promise<void> {
		for (const child of this.#store.listChildren(parentId)) {
			if (child.state !== "dispatched" || child.workerTaskId === undefined)
				continue;
			const snapshot = await this.#dispatcher.observe(child.workerTaskId);
			if (snapshot.state === "running") continue;
			this.#store.markTerminal(
				child.childId,
				snapshot.state,
				snapshot.state === "completed" ? snapshot.report : undefined,
				new Date().toISOString(),
			);
		}
		await this.#pump(parentId);
	}

	async cancelChild(parentId: string, childId: string): Promise<void> {
		const child = this.#store
			.listChildren(parentId)
			.find((candidate) => candidate.childId === childId);
		if (child?.state !== "dispatched" || child.workerTaskId === undefined)
			throw new AgentMeError({
				code: "INVALID_TASK_TRANSITION",
				message: "Child task cannot be cancelled",
				isRetryable: false,
			});
		await this.#dispatcher.cancel(child.workerTaskId);
		this.#store.markTerminal(
			child.childId,
			"cancelled",
			undefined,
			new Date().toISOString(),
		);
		await this.#pump(parentId);
	}

	async synthesize(parentId: string): Promise<{
		readonly parentId: string;
		readonly reports: readonly {
			readonly childId: string;
			readonly report: TaskReport;
		}[];
	}> {
		const children = this.#store.completeParent(
			parentId,
			new Date().toISOString(),
		);
		return {
			parentId,
			reports: children.map((child) => ({
				childId: child.childId,
				report: child.report as TaskReport,
			})),
		};
	}

	async #pump(parentId: string): Promise<void> {
		const actorId = this.#store.getParent(parentId).actorId;
		let available = this.#maxConcurrency - this.#store.countActiveChildren();
		if (available <= 0) return;
		for (const child of this.#store.listChildren(parentId)) {
			if (available <= 0) break;
			if (child.state !== "pending") continue;
			const controller = new AbortController();
			const handle = await this.#dispatcher.dispatch(
				child.request,
				controller.signal,
				actorId,
			);
			try {
				this.#store.markDispatched(
					child.childId,
					handle.taskId,
					handle.worktreeId,
					new Date().toISOString(),
				);
			} catch (error) {
				controller.abort();
				await this.#dispatcher.cancel(handle.taskId);
				throw error;
			}
			available -= 1;
		}
	}
}
