import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
	AgentMeError,
	type DelegatedTaskInput,
	parseSupervisorAction,
	parseTaskEvent,
	type TaskReport,
} from "../../contracts/src/index.js";

export type SupervisorChildState =
	| "pending"
	| "dispatched"
	| "completed"
	| "failed"
	| "cancelled";

export interface SupervisorParent {
	readonly parentId: string;
	readonly actorId: string;
	readonly state: "active" | "completed";
}

export interface SupervisorChild {
	readonly childId: string;
	readonly parentId: string;
	readonly ordinal: number;
	readonly request: DelegatedTaskInput;
	readonly state: SupervisorChildState;
	readonly workerTaskId?: string;
	readonly worktreeId?: string;
	readonly report?: TaskReport;
}

export type SupervisorGraphEvent =
	| { readonly type: "supervisor.parent.created"; readonly parentId: string }
	| {
			readonly type: "supervisor.child.created";
			readonly parentId: string;
			readonly childId: string;
	  }
	| {
			readonly type: "supervisor.child.dispatched";
			readonly parentId: string;
			readonly childId: string;
			readonly workerTaskId: string;
	  }
	| {
			readonly type:
				| "supervisor.child.completed"
				| "supervisor.child.failed"
				| "supervisor.child.cancelled";
			readonly parentId: string;
			readonly childId: string;
	  }
	| { readonly type: "supervisor.parent.completed"; readonly parentId: string };

export interface StoredSupervisorGraphEvent {
	readonly id: number;
	readonly parentId: string;
	readonly event: SupervisorGraphEvent;
	readonly createdAt: string;
}

interface ParentRow {
	id: string;
	actor_id: string;
	state: string;
}

interface RecentParentRow extends ParentRow {
	created_at: string;
	updated_at: string;
}

export interface RecentSupervisorParent extends SupervisorParent {
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface SupervisorParentPage {
	readonly parents: readonly RecentSupervisorParent[];
	readonly nextCursor?: string;
}

interface ChildRow {
	id: string;
	parent_id: string;
	ordinal: number;
	repository_id: string;
	runtime_id: string;
	instruction: string;
	criteria_json: string;
	state: string;
	worker_task_id: string | null;
	worktree_id: string | null;
	report_json: string | null;
}

interface EventRow {
	id: number;
	parent_id: string;
	payload_json: string;
	created_at: string;
}

function transitionError(cause?: unknown): AgentMeError {
	return new AgentMeError({
		code: "INVALID_TASK_TRANSITION",
		message: "Supervisor task graph transition is invalid",
		isRetryable: false,
		cause,
	});
}

function normalizedRequest(request: DelegatedTaskInput): DelegatedTaskInput {
	const action = parseSupervisorAction({ type: "delegate.task", request });
	if (action.type !== "delegate.task") throw transitionError();
	return action.request;
}

function normalizedReport(report: TaskReport, at: string): TaskReport {
	const event = parseTaskEvent({
		type: "task.completed",
		taskId: "supervisor-report-validation",
		report,
		at,
	});
	if (event.type !== "task.completed") throw transitionError();
	return event.report;
}

export class SupervisorGraphStore {
	readonly databasePath: string;
	readonly #database: DatabaseSync;

	constructor(databasePath: string) {
		this.databasePath = databasePath;
		this.#database = new DatabaseSync(databasePath, {
			allowExtension: false,
			timeout: 5_000,
		});
		this.#database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS supervisor_parents (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('active', 'completed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS supervisor_children (
        id TEXT PRIMARY KEY,
        parent_id TEXT NOT NULL REFERENCES supervisor_parents(id),
        ordinal INTEGER NOT NULL,
        repository_id TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        instruction TEXT NOT NULL,
        criteria_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('pending', 'dispatched', 'completed', 'failed', 'cancelled')),
        worker_task_id TEXT UNIQUE,
        worktree_id TEXT,
        report_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(parent_id, ordinal)
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS supervisor_active_worktree_idx
        ON supervisor_children(worktree_id) WHERE state = 'dispatched';
      CREATE TABLE IF NOT EXISTS supervisor_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id TEXT NOT NULL REFERENCES supervisor_parents(id),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS supervisor_events_parent_idx
        ON supervisor_events(parent_id, id);
    `);
	}

	close(): void {
		if (this.#database.isOpen) this.#database.close();
	}

	createPlan(
		parentId: string,
		actorId: string,
		tasks: readonly DelegatedTaskInput[],
		at: string,
	): void {
		const normalized = tasks.map(normalizedRequest);
		this.#transaction(() => {
			this.#database
				.prepare(
					"INSERT INTO supervisor_parents(id, actor_id, state, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
				)
				.run(parentId, actorId, at, at);
			this.#insertEvent(
				parentId,
				{ type: "supervisor.parent.created", parentId },
				at,
			);
			const insert = this.#database.prepare(
				"INSERT INTO supervisor_children(id, parent_id, ordinal, repository_id, runtime_id, instruction, criteria_json, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
			);
			for (const [ordinal, request] of normalized.entries()) {
				const childId = randomUUID();
				insert.run(
					childId,
					parentId,
					ordinal,
					request.repositoryId,
					request.runtimeId,
					request.instruction,
					JSON.stringify(request.acceptanceCriteria),
					at,
					at,
				);
				this.#insertEvent(
					parentId,
					{ type: "supervisor.child.created", parentId, childId },
					at,
				);
			}
		});
	}

	getParent(parentId: string): SupervisorParent {
		const row = this.#database
			.prepare(
				"SELECT id, actor_id, state FROM supervisor_parents WHERE id = ?",
			)
			.get(parentId) as ParentRow | undefined;
		if (
			row === undefined ||
			(row.state !== "active" && row.state !== "completed")
		)
			throw transitionError();
		return { parentId: row.id, actorId: row.actor_id, state: row.state };
	}

	listRecentParents(actorId: string, limit = 5): RecentSupervisorParent[] {
		return [...this.listParentPage(actorId, { limit }).parents];
	}

	listParentPage(
		actorId: string,
		options: { readonly limit?: number; readonly cursor?: string },
	): SupervisorParentPage {
		const limit = options.limit ?? 20;
		if (
			actorId.length < 1 ||
			actorId.length > 200 ||
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > 50 ||
			(options.cursor !== undefined &&
				(options.cursor.length < 1 || options.cursor.length > 500))
		)
			throw transitionError();
		let rows: RecentParentRow[];
		if (options.cursor === undefined) {
			rows = this.#database
				.prepare(
					"SELECT id, actor_id, state, created_at, updated_at FROM supervisor_parents WHERE actor_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
				)
				.all(actorId, limit + 1) as unknown as RecentParentRow[];
		} else {
			const cursor = this.#database
				.prepare(
					"SELECT id, actor_id, state, created_at, updated_at FROM supervisor_parents WHERE id = ? AND actor_id = ?",
				)
				.get(options.cursor, actorId) as RecentParentRow | undefined;
			if (cursor === undefined) throw transitionError();
			rows = this.#database
				.prepare(
					"SELECT id, actor_id, state, created_at, updated_at FROM supervisor_parents WHERE actor_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?",
				)
				.all(
					actorId,
					cursor.created_at,
					cursor.created_at,
					cursor.id,
					limit + 1,
				) as unknown as RecentParentRow[];
		}
		const hasMore = rows.length > limit;
		const parents = rows.slice(0, limit).map((row): RecentSupervisorParent => {
			const state = row.state;
			if (state !== "active" && state !== "completed") throw transitionError();
			return {
				parentId: row.id,
				actorId: row.actor_id,
				state,
				createdAt: row.created_at,
				updatedAt: row.updated_at,
			};
		});
		const nextCursor = hasMore ? parents.at(-1)?.parentId : undefined;
		return {
			parents,
			...(nextCursor === undefined ? {} : { nextCursor }),
		};
	}

	listChildren(parentId: string): SupervisorChild[] {
		this.getParent(parentId);
		return (
			this.#database
				.prepare(
					"SELECT * FROM supervisor_children WHERE parent_id = ? ORDER BY ordinal",
				)
				.all(parentId) as unknown as ChildRow[]
		).map((row) => this.#child(row));
	}

	countActiveChildren(): number {
		const row = this.#database
			.prepare(
				"SELECT COUNT(*) AS count FROM supervisor_children WHERE state = 'dispatched'",
			)
			.get() as { count: number };
		return row.count;
	}

	listEvents(parentId: string, afterId = 0): StoredSupervisorGraphEvent[] {
		this.getParent(parentId);
		if (!Number.isSafeInteger(afterId) || afterId < 0) throw transitionError();
		const rows = this.#database
			.prepare(
				"SELECT id, parent_id, payload_json, created_at FROM supervisor_events WHERE parent_id = ? AND id > ? ORDER BY id",
			)
			.all(parentId, afterId) as unknown as EventRow[];
		return rows.map((row) => ({
			id: row.id,
			parentId: row.parent_id,
			event: JSON.parse(row.payload_json) as SupervisorGraphEvent,
			createdAt: row.created_at,
		}));
	}

	markDispatched(
		childId: string,
		workerTaskId: string,
		worktreeId: string,
		at: string,
	): void {
		try {
			this.#transaction(() => {
				const child = this.#childRow(childId);
				const result = this.#database
					.prepare(
						"UPDATE supervisor_children SET state = 'dispatched', worker_task_id = ?, worktree_id = ?, updated_at = ? WHERE id = ? AND state = 'pending'",
					)
					.run(workerTaskId, worktreeId, at, childId);
				if (result.changes !== 1) throw transitionError();
				this.#insertEvent(
					child.parent_id,
					{
						type: "supervisor.child.dispatched",
						parentId: child.parent_id,
						childId,
						workerTaskId,
					},
					at,
				);
			});
		} catch (error) {
			if (error instanceof AgentMeError) throw error;
			throw transitionError(error);
		}
	}

	markTerminal(
		childId: string,
		state: "completed" | "failed" | "cancelled",
		report: TaskReport | undefined,
		at: string,
	): void {
		if ((state === "completed") !== (report !== undefined))
			throw transitionError();
		const safeReport =
			report === undefined ? undefined : normalizedReport(report, at);
		this.#transaction(() => {
			const child = this.#childRow(childId);
			const result = this.#database
				.prepare(
					"UPDATE supervisor_children SET state = ?, report_json = ?, updated_at = ? WHERE id = ? AND state = 'dispatched'",
				)
				.run(
					state,
					safeReport === undefined ? null : JSON.stringify(safeReport),
					at,
					childId,
				);
			if (result.changes !== 1) throw transitionError();
			this.#insertEvent(
				child.parent_id,
				{
					type: `supervisor.child.${state}` as
						| "supervisor.child.completed"
						| "supervisor.child.failed"
						| "supervisor.child.cancelled",
					parentId: child.parent_id,
					childId,
				},
				at,
			);
		});
	}

	completeParent(parentId: string, at: string): readonly SupervisorChild[] {
		return this.#transaction(() => {
			const children = this.listChildren(parentId);
			if (
				children.length < 1 ||
				children.some(
					(child) => child.state !== "completed" || child.report === undefined,
				)
			)
				throw transitionError();
			const result = this.#database
				.prepare(
					"UPDATE supervisor_parents SET state = 'completed', updated_at = ? WHERE id = ? AND state = 'active'",
				)
				.run(at, parentId);
			if (result.changes !== 1) throw transitionError();
			this.#insertEvent(
				parentId,
				{ type: "supervisor.parent.completed", parentId },
				at,
			);
			return children;
		});
	}

	#child(row: ChildRow): SupervisorChild {
		if (
			!(
				["pending", "dispatched", "completed", "failed", "cancelled"] as const
			).includes(row.state as SupervisorChildState)
		)
			throw transitionError();
		const request = normalizedRequest({
			repositoryId: row.repository_id,
			runtimeId: row.runtime_id,
			instruction: row.instruction,
			acceptanceCriteria: JSON.parse(row.criteria_json),
		});
		const report =
			row.report_json === null
				? undefined
				: normalizedReport(JSON.parse(row.report_json), "stored-report");
		return {
			childId: row.id,
			parentId: row.parent_id,
			ordinal: row.ordinal,
			request,
			state: row.state as SupervisorChildState,
			...(row.worker_task_id === null
				? {}
				: { workerTaskId: row.worker_task_id }),
			...(row.worktree_id === null ? {} : { worktreeId: row.worktree_id }),
			...(report === undefined ? {} : { report }),
		};
	}

	#childRow(childId: string): ChildRow {
		const row = this.#database
			.prepare("SELECT * FROM supervisor_children WHERE id = ?")
			.get(childId) as ChildRow | undefined;
		if (row === undefined) throw transitionError();
		return row;
	}

	#insertEvent(
		parentId: string,
		event: SupervisorGraphEvent,
		at: string,
	): void {
		this.#database
			.prepare(
				"INSERT INTO supervisor_events(parent_id, payload_json, created_at) VALUES (?, ?, ?)",
			)
			.run(parentId, JSON.stringify(event), at);
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
