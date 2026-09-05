import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import {
	AgentMeError,
	type CodingEvent,
} from "../../../packages/contracts/src/index.js";
import type {
	SupervisorChild,
	SupervisorGraphStore,
	TaskStore,
} from "../../../packages/task-orchestrator/src/index.js";
import { verifyWorkspace } from "../../../packages/task-orchestrator/src/index.js";
import {
	assertPathInApprovedRoots,
	type RepositoryRegistry,
} from "../../../packages/workspace-manager/src/index.js";

export interface WorkerConversationRuntime {
	readonly id: string;
	resume(
		input: {
			readonly threadId: string;
			readonly worktreePath: string;
			readonly input: string;
			readonly runId: string;
		},
		signal: AbortSignal,
	): AsyncIterable<CodingEvent>;
}

export interface TaskWorkerActivity {
	readonly child: SupervisorChild;
	readonly task: ReturnType<TaskStore["getTask"]>;
	readonly runtime?: { readonly id: string; readonly sessionId: string };
	readonly canContinue: boolean;
	readonly events: ReturnType<TaskStore["getTaskEvents"]>;
}

export interface TaskWorkerTurnResult {
	readonly turnId: string;
	readonly message: string;
	readonly verification: "passed" | "failed" | "cancelled";
}

export interface TaskWorkerSessionDependencies {
	readonly store: TaskStore;
	readonly graph: Pick<SupervisorGraphStore, "listChildren">;
	readonly repositories?: Pick<RepositoryRegistry, "resolve">;
	readonly taskRoot?: string;
	readonly runtime?: WorkerConversationRuntime;
	readonly runtimes?: readonly WorkerConversationRuntime[];
	readonly createTurnId?: () => string;
	readonly now?: () => string;
}

function unavailable(message: string): AgentMeError {
	return new AgentMeError({
		code: "INVALID_TASK_TRANSITION",
		message,
		isRetryable: false,
	});
}

function normalizedFailure(error: unknown, signal: AbortSignal): AgentMeError {
	if (signal.aborted)
		return new AgentMeError({
			code: "CANCELLED",
			message: "Worker turn was cancelled",
			isRetryable: false,
			cause: error,
		});
	if (error instanceof AgentMeError) return error;
	return new AgentMeError({
		code: "EXECUTION_FAILED",
		message: "Worker turn could not be completed",
		isRetryable: false,
		cause: error,
	});
}

export class TaskWorkerSessionService {
	readonly #store: TaskStore;
	readonly #graph: TaskWorkerSessionDependencies["graph"];
	readonly #repositories: TaskWorkerSessionDependencies["repositories"];
	readonly #taskRoot: string | undefined;
	readonly #runtimes: ReadonlyMap<string, WorkerConversationRuntime>;
	readonly #createTurnId: () => string;
	readonly #now: () => string;
	readonly #activeChildren = new Set<string>();

	constructor(dependencies: TaskWorkerSessionDependencies) {
		this.#store = dependencies.store;
		this.#graph = dependencies.graph;
		this.#repositories = dependencies.repositories;
		this.#taskRoot =
			dependencies.taskRoot === undefined
				? undefined
				: resolve(dependencies.taskRoot);
		this.#runtimes = new Map(
			(
				dependencies.runtimes ??
				(dependencies.runtime ? [dependencies.runtime] : [])
			).map((runtime) => [runtime.id, runtime]),
		);
		this.#createTurnId = dependencies.createTurnId ?? randomUUID;
		this.#now = dependencies.now ?? (() => new Date().toISOString());
	}

	activity(parentId: string, childId: string, afterId = 0): TaskWorkerActivity {
		if (!Number.isSafeInteger(afterId) || afterId < 0)
			throw unavailable("Worker event cursor is invalid");
		const child = this.#child(parentId, childId);
		if (child.workerTaskId === undefined)
			throw unavailable("Worker task has not started");
		const task = this.#store.getTask(child.workerTaskId);
		const allEvents = this.#store.getTaskEvents(child.workerTaskId);
		const connection = allEvents.findLast(
			({ event }) =>
				event.type === "task.worker.event" &&
				event.event.type === "run.started",
		);
		const runtime =
			connection?.event.type === "task.worker.event" &&
			connection.event.event.type === "run.started"
				? {
						id: connection.event.runtimeId,
						sessionId: connection.event.event.threadId,
					}
				: undefined;
		const canContinue =
			child.state === "completed" &&
			task.state === "completed" &&
			child.worktreeId !== undefined &&
			this.#repositories !== undefined &&
			this.#taskRoot !== undefined &&
			runtime !== undefined &&
			this.#runtimes.has(runtime.id) &&
			runtime.id === child.request.runtimeId &&
			!this.#activeChildren.has(child.childId);
		return {
			child,
			task,
			...(runtime === undefined ? {} : { runtime }),
			canContinue,
			events:
				afterId === 0
					? allEvents.slice(-1_000)
					: allEvents.filter(({ id }) => id > afterId).slice(0, 1_000),
		};
	}

	async continue(
		parentId: string,
		childId: string,
		message: string,
		signal: AbortSignal,
	): Promise<TaskWorkerTurnResult> {
		const input = message.trim();
		if (input.length < 1 || message.length > 4_000)
			throw unavailable("Worker message is invalid");
		const activity = this.activity(parentId, childId);
		if (
			!activity.canContinue ||
			activity.runtime === undefined ||
			activity.child.workerTaskId === undefined ||
			activity.child.worktreeId === undefined
		)
			throw unavailable("Worker session cannot be continued");
		const runtime = this.#runtimes.get(activity.runtime.id);
		const repositories = this.#repositories;
		const taskRootValue = this.#taskRoot;
		if (
			runtime === undefined ||
			repositories === undefined ||
			taskRootValue === undefined
		)
			throw unavailable("Worker session cannot be continued");
		if (this.#activeChildren.has(childId))
			throw unavailable("Worker session already has an active turn");
		this.#activeChildren.add(childId);
		const taskId = activity.child.workerTaskId;
		const turnId = this.#createTurnId();
		const at = this.#now();
		let lease: ReturnType<TaskStore["acquireLease"]> | undefined;
		try {
			lease = this.#store.acquireLease(
				taskId,
				`worker-turn-${turnId}`,
				at,
				10 * 60_000,
			);
			const taskRoot = await realpath(taskRootValue);
			const worktreePath = await assertPathInApprovedRoots(
				resolve(taskRoot, activity.child.worktreeId),
				[taskRoot],
			);
			this.#append(taskId, lease, {
				type: "task.worker.input",
				taskId,
				turnId,
				message: input,
				at: this.#now(),
			});
			let response = "";
			let completed = false;
			for await (const event of runtime.resume(
				{
					threadId: activity.runtime.sessionId,
					worktreePath,
					input,
					runId: turnId,
				},
				signal,
			)) {
				this.#append(taskId, lease, {
					type: "task.worker.event",
					taskId,
					runtimeId: runtime.id,
					event,
					at: this.#now(),
				});
				if (event.type === "message.delta") response += event.text;
				if (event.type === "run.failed") throw event.error;
				if (event.type === "run.cancelled")
					throw unavailable("Worker turn cancelled");
				if (event.type === "run.completed") completed = true;
			}
			if (!completed) throw unavailable("Worker turn ended before completion");
			const repository = repositories.resolve(
				activity.child.request.repositoryId,
			);
			const verification = await verifyWorkspace(
				worktreePath,
				repository.verificationCommands,
				signal,
			);
			for (const result of verification.results)
				this.#append(taskId, lease, {
					type: "task.worker.event",
					taskId,
					runtimeId: runtime.id,
					event: {
						type: "test.result",
						runId: turnId,
						command: [result.executable, ...result.args].join(" "),
						exitCode: result.exitCode,
					},
					at: this.#now(),
				});
			const finalMessage =
				response.length === 0
					? "Worker turn completed"
					: response.slice(0, 64_000);
			this.#append(taskId, lease, {
				type: "task.worker.turn.completed",
				taskId,
				turnId,
				message: finalMessage,
				verification: verification.status,
				at: this.#now(),
			});
			return {
				turnId,
				message: finalMessage,
				verification: verification.status,
			};
		} catch (error) {
			const failure = normalizedFailure(error, signal);
			if (lease !== undefined)
				this.#append(taskId, lease, {
					type: "task.worker.turn.failed",
					taskId,
					turnId,
					error: failure,
					at: this.#now(),
				});
			throw failure;
		} finally {
			if (lease !== undefined)
				try {
					this.#store.releaseLease(taskId, lease, this.#now());
				} catch {
					// The lease may have expired while an external process was running.
				}
			this.#activeChildren.delete(childId);
		}
	}

	#child(parentId: string, childId: string): SupervisorChild {
		const child = this.#graph
			.listChildren(parentId)
			.find((candidate) => candidate.childId === childId);
		if (child === undefined) throw unavailable("Worker task was not found");
		return child;
	}

	#append(
		taskId: string,
		lease: Parameters<TaskStore["appendEvent"]>[1],
		event: Parameters<TaskStore["appendEvent"]>[2],
	): void {
		this.#store.appendEvent(taskId, lease, event, event.at);
	}
}
