import { DatabaseSync } from "node:sqlite";

import {
	AgentMeError,
	parseTaskEvent,
	type TaskEvent,
} from "../../contracts/src/index.js";
import { migrate } from "./migrations.js";
import { canTransition, isTaskState, type TaskState } from "./state-machine.js";

export interface CreateTaskInput {
	readonly taskId: string;
	readonly actorId: string;
	readonly at: string;
}

export interface WriterLease {
	readonly taskId: string;
	readonly writerId: string;
	readonly version: number;
	readonly expiresAt: string;
}

export interface StoredTask {
	readonly taskId: string;
	readonly actorId: string;
	readonly state: TaskState;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface OutboxEvent {
	readonly id: number;
	readonly taskId: string;
	readonly event: TaskEvent;
	readonly createdAt: string;
}

interface TaskRow {
	id: string;
	actor_id: string;
	state: string;
	created_at: string;
	updated_at: string;
	lease_writer_id: string | null;
	lease_version: number;
	lease_expires_at: string | null;
}

interface OutboxRow {
	id: number;
	task_id: string;
	payload_json: string;
	created_at: string;
}

function taskNotFound(): AgentMeError {
	return new AgentMeError({
		code: "TASK_NOT_FOUND",
		message: "Task not found",
		isRetryable: false,
	});
}

function staleLease(): AgentMeError {
	return new AgentMeError({
		code: "STALE_WRITER_LEASE",
		message: "Task writer lease is stale",
		isRetryable: false,
	});
}

function invalidTransition(): AgentMeError {
	return new AgentMeError({
		code: "INVALID_TASK_TRANSITION",
		message: "Invalid task state transition",
		isRetryable: false,
	});
}

export class TaskStore {
	readonly #database: DatabaseSync;

	constructor(databasePath: string) {
		this.#database = new DatabaseSync(databasePath, {
			allowExtension: false,
			timeout: 5_000,
		});
		this.#database.exec(
			"PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;",
		);
		migrate(this.#database);
	}

	close(): void {
		if (this.#database.isOpen) this.#database.close();
	}

	createTask(input: CreateTaskInput): StoredTask {
		const event: TaskEvent = {
			type: "task.started",
			taskId: input.taskId,
			at: input.at,
		};
		return this.#transaction(() => {
			this.#database
				.prepare(
					"INSERT INTO tasks(id, actor_id, state, created_at, updated_at) VALUES (?, ?, 'received', ?, ?)",
				)
				.run(input.taskId, input.actorId, input.at, input.at);
			this.#insertOutbox(event, input.at);
			return this.getTask(input.taskId);
		});
	}

	getTask(taskId: string): StoredTask {
		const row = this.#database
			.prepare("SELECT * FROM tasks WHERE id = ?")
			.get(taskId) as TaskRow | undefined;
		if (row === undefined) throw taskNotFound();
		if (!isTaskState(row.state))
			throw new Error("Stored task has an invalid state");
		return {
			taskId: row.id,
			actorId: row.actor_id,
			state: row.state,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	acquireLease(
		taskId: string,
		writerId: string,
		now: string,
		ttlMs: number,
	): WriterLease {
		if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw staleLease();
		return this.#transaction(() => {
			const row = this.#taskRow(taskId);
			if (
				row.lease_writer_id !== null &&
				row.lease_writer_id !== writerId &&
				row.lease_expires_at !== null &&
				row.lease_expires_at > now
			) {
				throw staleLease();
			}
			const version = row.lease_version + 1;
			const expiresAt = new Date(Date.parse(now) + ttlMs).toISOString();
			this.#database
				.prepare(
					"UPDATE tasks SET lease_writer_id = ?, lease_version = ?, lease_expires_at = ? WHERE id = ?",
				)
				.run(writerId, version, expiresAt, taskId);
			return { taskId, writerId, version, expiresAt };
		});
	}

	releaseLease(taskId: string, lease: WriterLease, now: string): void {
		this.#transaction(() => {
			this.#assertLease(taskId, lease, now);
			const result = this.#database
				.prepare(
					"UPDATE tasks SET lease_writer_id = NULL, lease_expires_at = NULL WHERE id = ? AND lease_writer_id = ? AND lease_version = ?",
				)
				.run(taskId, lease.writerId, lease.version);
			if (result.changes !== 1) throw staleLease();
		});
	}

	transition(
		taskId: string,
		lease: WriterLease,
		to: TaskState,
		event: TaskEvent,
		now: string,
	): void {
		this.#transaction(() => {
			const row = this.#assertLease(taskId, lease, now);
			if (!isTaskState(row.state) || !canTransition(row.state, to))
				throw invalidTransition();
			this.#assertEvent(taskId, event);
			this.#assertTransitionEvent(to, event);
			this.#database
				.prepare("UPDATE tasks SET state = ?, updated_at = ? WHERE id = ?")
				.run(to, now, taskId);
			this.#insertOutbox(event, now);
		});
	}

	appendEvent(
		taskId: string,
		lease: WriterLease,
		event: TaskEvent,
		now: string,
	): void {
		this.#transaction(() => {
			this.#assertLease(taskId, lease, now);
			this.#assertEvent(taskId, event);
			this.#insertOutbox(event, now);
		});
	}

	listPendingEvents(limit = 100): OutboxEvent[] {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000)
			throw new RangeError("Invalid outbox limit");
		const rows = this.#database
			.prepare(
				"SELECT id, task_id, payload_json, created_at FROM task_outbox WHERE delivered_at IS NULL ORDER BY id LIMIT ?",
			)
			.all(limit) as unknown as OutboxRow[];
		return rows.map((row) => ({
			id: row.id,
			taskId: row.task_id,
			event: parseTaskEvent(JSON.parse(row.payload_json)),
			createdAt: row.created_at,
		}));
	}

	getTaskEvents(taskId: string, afterId = 0): OutboxEvent[] {
		this.#taskRow(taskId);
		const rows = this.#database
			.prepare(
				"SELECT id, task_id, payload_json, created_at FROM task_outbox WHERE task_id = ? AND id > ? ORDER BY id",
			)
			.all(taskId, afterId) as unknown as OutboxRow[];
		return rows.map((row) => ({
			id: row.id,
			taskId: row.task_id,
			event: parseTaskEvent(JSON.parse(row.payload_json)),
			createdAt: row.created_at,
		}));
	}

	markEventDelivered(eventId: number, deliveredAt: string): void {
		this.#database
			.prepare(
				"UPDATE task_outbox SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL",
			)
			.run(deliveredAt, eventId);
	}

	#taskRow(taskId: string): TaskRow {
		const row = this.#database
			.prepare("SELECT * FROM tasks WHERE id = ?")
			.get(taskId) as TaskRow | undefined;
		if (row === undefined) throw taskNotFound();
		return row;
	}

	#assertLease(taskId: string, lease: WriterLease, now: string): TaskRow {
		const row = this.#taskRow(taskId);
		if (
			lease.taskId !== taskId ||
			row.lease_writer_id !== lease.writerId ||
			row.lease_version !== lease.version ||
			row.lease_expires_at === null ||
			row.lease_expires_at <= now
		) {
			throw staleLease();
		}
		return row;
	}

	#assertEvent(taskId: string, event: TaskEvent): void {
		if (event.taskId !== taskId) throw invalidTransition();
	}

	#assertTransitionEvent(state: TaskState, event: TaskEvent): void {
		if (state === "completed" && event.type !== "task.completed")
			throw invalidTransition();
		if (state === "failed" && event.type !== "task.failed")
			throw invalidTransition();
		if (state !== "completed" && event.type === "task.completed")
			throw invalidTransition();
		if (state !== "failed" && event.type === "task.failed")
			throw invalidTransition();
	}

	#insertOutbox(event: TaskEvent, createdAt: string): void {
		this.#database
			.prepare(
				"INSERT INTO task_outbox(task_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)",
			)
			.run(event.taskId, event.type, JSON.stringify(event), createdAt);
	}

	#transaction<T>(operation: () => T): T {
		this.#database.exec("BEGIN IMMEDIATE");
		try {
			const result = operation();
			this.#database.exec("COMMIT");
			return result;
		} catch (error) {
			if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
			throw error;
		}
	}
}
