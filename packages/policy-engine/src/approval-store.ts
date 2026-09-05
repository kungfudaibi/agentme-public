import { DatabaseSync } from "node:sqlite";

import type { ApprovalAction, ApprovalRecord } from "./policy.js";

const approvalActions = new Set<ApprovalAction>([
	"read_repository",
	"write_worktree",
	"run_configured_command",
	"install_dependencies",
	"access_network",
	"read_outside_roots",
	"modify_source_checkout",
	"git_commit",
	"git_push",
	"create_pr",
	"deploy",
	"delete_persistent",
	"send_message",
	"activate_full_access",
]);

function isCanonicalTimestamp(value: string): boolean {
	const milliseconds = Date.parse(value);
	return (
		!Number.isNaN(milliseconds) &&
		new Date(milliseconds).toISOString() === value
	);
}

export interface ApprovalQuery {
	readonly taskId: string;
	readonly action: ApprovalAction;
	readonly target: string;
}

interface ApprovalRow {
	id: string;
	task_id: string;
	action: ApprovalAction;
	target: string;
	decision: "approved" | "denied";
	expires_at: string;
}

export class ApprovalStore {
	readonly #database: DatabaseSync;

	constructor(databasePath: string) {
		this.#database = new DatabaseSync(databasePath, {
			allowExtension: false,
			timeout: 5_000,
		});
		this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        decision TEXT NOT NULL CHECK(decision IN ('approved', 'denied')),
        expires_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS approvals_binding_idx
        ON approvals(task_id, action, target, expires_at);
    `);
	}

	record(record: ApprovalRecord): void {
		if (
			record.id.length === 0 ||
			record.taskId.length === 0 ||
			record.target.length === 0 ||
			!approvalActions.has(record.action) ||
			!(["approved", "denied"] as const).includes(record.decision) ||
			!isCanonicalTimestamp(record.expiresAt)
		) {
			throw new TypeError("Invalid approval record");
		}
		this.#database
			.prepare(
				"INSERT INTO approvals(id, task_id, action, target, decision, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run(
				record.id,
				record.taskId,
				record.action,
				record.target,
				record.decision,
				record.expiresAt,
			);
	}

	findValid(query: ApprovalQuery, now: string): ApprovalRecord | undefined {
		if (!isCanonicalTimestamp(now))
			throw new TypeError("Invalid approval query time");
		const row = this.#database
			.prepare(
				"SELECT id, task_id, action, target, decision, expires_at FROM approvals WHERE task_id = ? AND action = ? AND target = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1",
			)
			.get(query.taskId, query.action, query.target, now) as
			| ApprovalRow
			| undefined;
		return row === undefined
			? undefined
			: {
					id: row.id,
					taskId: row.task_id,
					action: row.action,
					target: row.target,
					decision: row.decision,
					expiresAt: row.expires_at,
				};
	}

	close(): void {
		if (this.#database.isOpen) this.#database.close();
	}
}
