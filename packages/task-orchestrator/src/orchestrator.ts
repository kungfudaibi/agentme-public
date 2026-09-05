import { randomUUID } from "node:crypto";

import {
	AgentMeError,
	type CodingEvent,
	type TaskEvent,
	type TaskReport,
} from "../../contracts/src/index.js";
import type { TaskStore, WriterLease } from "./task-store.js";

export interface TaskRunnerContext {
	readonly runtimeId?: string;
	readonly taskId: string;
	readonly repositoryId?: string;
	readonly recordWorkerEvent?: (runtimeId: string, event: CodingEvent) => void;
}

export interface TaskRunner {
	execute(
		instruction: string,
		signal: AbortSignal,
		context?: TaskRunnerContext,
	): Promise<TaskReport>;
}

export interface SubmitTaskInput {
	readonly runtimeId?: string;
	readonly instruction: string;
	readonly actorId: string;
	readonly repositoryId?: string;
}

type EventListener = () => void;
type GlobalEventListener = (event: TaskEvent) => void;

interface ActiveTask {
	readonly controller: AbortController;
	readonly lease: WriterLease;
}

export class TaskOrchestrator {
	readonly #store: TaskStore;
	readonly #runner: TaskRunner;
	readonly #active = new Map<string, ActiveTask>();
	readonly #listeners = new Map<string, Set<EventListener>>();
	readonly #globalListeners = new Set<GlobalEventListener>();

	constructor(store: TaskStore, runner: TaskRunner) {
		this.#store = store;
		this.#runner = runner;
	}

	submit(input: SubmitTaskInput): string {
		const taskId = randomUUID();
		const now = new Date().toISOString();
		this.#store.createTask({ taskId, actorId: input.actorId, at: now });
		this.#notify(taskId, { type: "task.started", taskId, at: now });
		const active = {
			controller: new AbortController(),
			lease: this.#store.acquireLease(
				taskId,
				`host-${taskId}`,
				now,
				10 * 60_000,
			),
		};
		this.#active.set(taskId, active);
		queueMicrotask(
			() =>
				void this.#run(
					taskId,
					input.instruction,
					active,
					input.repositoryId,
					input.runtimeId,
				),
		);
		return taskId;
	}

	cancel(taskId: string): void {
		const active = this.#active.get(taskId);
		if (active === undefined) return;
		active.controller.abort();
		const task = this.#store.getTask(taskId);
		if (
			["completed", "cancelled", "failed", "rejected", "timed_out"].includes(
				task.state,
			)
		)
			return;
		const at = new Date().toISOString();
		const event: TaskEvent = {
			type: "task.progress",
			taskId,
			message: "Task cancelled",
			at,
		};
		this.#store.transition(taskId, active.lease, "cancelled", event, at);
		this.#notify(taskId, event);
	}

	subscribe(taskId: string, listener: EventListener): () => void {
		const listeners = this.#listeners.get(taskId) ?? new Set<EventListener>();
		listeners.add(listener);
		this.#listeners.set(taskId, listeners);
		return () => {
			listeners.delete(listener);
			if (listeners.size === 0) this.#listeners.delete(taskId);
		};
	}

	subscribeAll(listener: GlobalEventListener): () => void {
		this.#globalListeners.add(listener);
		return () => this.#globalListeners.delete(listener);
	}

	get events(): TaskStore {
		return this.#store;
	}

	stop(): void {
		for (const taskId of [...this.#active.keys()]) this.cancel(taskId);
	}

	async #run(
		taskId: string,
		instruction: string,
		active: ActiveTask,
		repositoryId: string | undefined,
		runtimeId: string | undefined,
	): Promise<void> {
		try {
			for (const [state, message] of [
				["planned", "Task planned"],
				["queued", "Task queued"],
				["preparing_workspace", "Preparing workspace"],
				["running", "Worker started"],
			] as const) {
				this.#progress(taskId, active.lease, state, message);
			}
			const report = await this.#runner.execute(
				instruction,
				active.controller.signal,
				{
					taskId,
					...(runtimeId === undefined ? {} : { runtimeId }),
					...(repositoryId === undefined ? {} : { repositoryId }),
					recordWorkerEvent: (runtimeId, event) => {
						const at = new Date().toISOString();
						const taskEvent: TaskEvent = {
							type: "task.worker.event",
							taskId,
							runtimeId,
							event,
							at,
						};
						this.#store.appendEvent(taskId, active.lease, taskEvent, at);
						this.#notify(taskId, taskEvent);
					},
				},
			);
			if (active.controller.signal.aborted) return;
			this.#progress(
				taskId,
				active.lease,
				"verifying",
				"Verifying worker result",
			);
			const at = new Date().toISOString();
			const event: TaskEvent = {
				type: "task.completed",
				taskId,
				report,
				at,
			};
			this.#store.transition(taskId, active.lease, "completed", event, at);
			this.#notify(taskId, event);
		} catch {
			if (active.controller.signal.aborted) return;
			const at = new Date().toISOString();
			const event: TaskEvent = {
				type: "task.failed",
				taskId,
				error: new AgentMeError({
					code: "EXECUTION_FAILED",
					message: "The task could not be completed",
					isRetryable: false,
				}),
				at,
			};
			this.#store.transition(taskId, active.lease, "failed", event, at);
			this.#notify(taskId, event);
		} finally {
			try {
				this.#store.releaseLease(
					taskId,
					active.lease,
					new Date().toISOString(),
				);
			} catch {
				// A replacement writer or an expired lease already owns recovery.
			}
			this.#active.delete(taskId);
		}
	}

	#progress(
		taskId: string,
		lease: WriterLease,
		state:
			| "planned"
			| "queued"
			| "preparing_workspace"
			| "running"
			| "verifying",
		message: string,
	): void {
		const at = new Date().toISOString();
		const event: TaskEvent = {
			type: "task.progress",
			taskId,
			message,
			at,
		};
		this.#store.transition(taskId, lease, state, event, at);
		this.#notify(taskId, event);
	}

	#notify(taskId: string, event: TaskEvent): void {
		for (const listener of this.#listeners.get(taskId) ?? []) listener();
		for (const listener of this.#globalListeners) {
			try {
				listener(event);
			} catch {
				// Observers cannot alter committed task execution.
			}
		}
	}
}
