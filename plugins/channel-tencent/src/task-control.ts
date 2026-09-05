import { DatabaseSync } from "node:sqlite";

import type { RemoteTaskControlPort, RemoteTaskState } from "./controller.js";

interface StoredTaskLike {
	readonly taskId: string;
	readonly state: string;
}

interface StoredTaskEventLike {
	readonly event: unknown;
}

export interface TaskSubmissionPort {
	submit(input: {
		readonly instruction: string;
		readonly actorId: string;
		readonly repositoryId?: string;
	}): string;
	cancel(taskId: string): void;
}

export interface TaskEvidencePort {
	getTask(taskId: string): StoredTaskLike;
	getTaskEvents(taskId: string): readonly StoredTaskEventLike[];
}

function boundedIdentifier(value: string, maximum = 256): string {
	if (
		value.length < 1 ||
		value.length > maximum ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
	)
		throw new TypeError("Tencent task identifier is invalid");
	return value;
}

function uuid(value: string): string {
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
			value,
		)
	)
		throw new TypeError("Tencent task id is invalid");
	return value;
}

function state(value: string): RemoteTaskState {
	if (value === "completed" || value === "cancelled" || value === "failed")
		return value;
	if (value === "rejected" || value === "timed_out") return "failed";
	if (value === "received" || value === "clarifying" || value === "planned")
		return "queued";
	if (
		value === "queued" ||
		value === "preparing_workspace" ||
		value === "running" ||
		value === "verifying" ||
		value === "awaiting_approval"
	)
		return value === "queued" ? "queued" : "running";
	throw new TypeError("Stored task state is invalid");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function evidence(events: readonly StoredTaskEventLike[]): string | undefined {
	for (const item of [...events].reverse()) {
		if (!isRecord(item.event)) continue;
		if (item.event.type === "task.completed" && isRecord(item.event.report)) {
			const summary = item.event.report.summary;
			if (typeof summary === "string" && summary.length > 0) return summary;
		}
		if (item.event.type === "task.failed" && isRecord(item.event.error)) {
			const message = item.event.error.message;
			if (typeof message === "string" && message.length > 0) return message;
		}
		if (item.event.type === "task.progress") {
			const message = item.event.message;
			if (typeof message === "string" && message.length > 0) return message;
		}
	}
	return undefined;
}

export class TencentTaskRequestStore {
	readonly #db: DatabaseSync;

	constructor(path: string) {
		this.#db = new DatabaseSync(path, {
			allowExtension: false,
			timeout: 5_000,
		});
		this.#db.exec(
			"PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS tencent_task_request(request_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, created_at TEXT NOT NULL) STRICT",
		);
	}

	get(requestId: string): string | undefined {
		const row = this.#db
			.prepare("SELECT task_id FROM tencent_task_request WHERE request_id=?")
			.get(boundedIdentifier(requestId)) as { task_id: string } | undefined;
		return row === undefined ? undefined : uuid(row.task_id);
	}

	remember(
		requestId: string,
		taskId: string,
		at = new Date().toISOString(),
	): void {
		this.#db
			.prepare(
				"INSERT OR IGNORE INTO tencent_task_request(request_id, task_id, created_at) VALUES(?, ?, ?)",
			)
			.run(boundedIdentifier(requestId), uuid(taskId), at);
	}

	close(): void {
		this.#db.close();
	}
}

export class OrchestratorTaskControl implements RemoteTaskControlPort {
	readonly #tasks: TaskSubmissionPort;
	readonly #evidence: TaskEvidencePort;
	readonly #requests: TencentTaskRequestStore;

	constructor(
		tasks: TaskSubmissionPort,
		evidencePort: TaskEvidencePort,
		requests: TencentTaskRequestStore,
	) {
		this.#tasks = tasks;
		this.#evidence = evidencePort;
		this.#requests = requests;
	}

	async create(
		input: {
			readonly requestId: string;
			readonly actorId: string;
			readonly repositoryId: string;
			readonly instruction: string;
		},
		signal: AbortSignal,
	): Promise<{ readonly taskId: string }> {
		signal.throwIfAborted();
		const existing = this.#requests.get(input.requestId);
		if (existing !== undefined) return { taskId: existing };
		boundedIdentifier(input.actorId);
		boundedIdentifier(input.repositoryId, 128);
		if (input.instruction.trim().length < 1 || input.instruction.length > 4_000)
			throw new TypeError("Tencent task instruction is invalid");
		const taskId = uuid(
			this.#tasks.submit({
				actorId: input.actorId,
				repositoryId: input.repositoryId,
				instruction: input.instruction.trim(),
			}),
		);
		this.#requests.remember(input.requestId, taskId);
		return { taskId };
	}

	async status(
		taskId: string,
		signal: AbortSignal,
	): Promise<{
		readonly taskId: string;
		readonly state: RemoteTaskState;
		readonly evidence?: string;
	}> {
		signal.throwIfAborted();
		const id = uuid(taskId);
		const task = this.#evidence.getTask(id);
		if (uuid(task.taskId) !== id)
			throw new TypeError("Stored task id mismatch");
		const summary = evidence(this.#evidence.getTaskEvents(id));
		return {
			taskId: id,
			state: state(task.state),
			...(summary === undefined ? {} : { evidence: summary }),
		};
	}

	async cancel(
		taskId: string,
		signal: AbortSignal,
	): Promise<{ readonly taskId: string; readonly state: RemoteTaskState }> {
		signal.throwIfAborted();
		const id = uuid(taskId);
		this.#tasks.cancel(id);
		const result = await this.status(id, signal);
		return { taskId: result.taskId, state: result.state };
	}
}
