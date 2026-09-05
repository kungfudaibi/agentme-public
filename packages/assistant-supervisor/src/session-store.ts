import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
	AgentMeError,
	type AssistantMessage,
} from "../../contracts/src/index.js";

export interface StoredAssistantMessage extends AssistantMessage {
	readonly id: number;
	readonly sessionId: string;
	readonly at: string;
}

export interface AssistantSessionStoreOptions {
	readonly clock?: () => Date;
	readonly retentionDays?: number;
}

function invalidSession(): AgentMeError {
	return new AgentMeError({
		code: "INVALID_CONTRACT",
		message: "Invalid assistant session",
		isRetryable: false,
	});
}

export class AssistantSessionStore {
	readonly #database: DatabaseSync;
	readonly #clock: () => Date;

	constructor(
		databasePath: string,
		options: AssistantSessionStoreOptions = {},
	) {
		this.#clock = options.clock ?? (() => new Date());
		this.#database = new DatabaseSync(databasePath, {
			allowExtension: false,
			timeout: 5_000,
		});
		this.#database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS assistant_sessions (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS assistant_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES assistant_sessions(id),
        role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS assistant_messages_session_idx
        ON assistant_messages(session_id, id);
    `);
		this.purgeExpiredSessions(this.#clock(), options.retentionDays ?? 7);
	}

	close(): void {
		if (this.#database.isOpen) this.#database.close();
	}

	appendUserMessage(content: string, sessionId?: string): string {
		const message = content.trim();
		if (message.length < 1 || message.length > 4_000) throw invalidSession();
		const id = sessionId ?? randomUUID();
		const at = this.#clock().toISOString();
		this.#database.exec("BEGIN IMMEDIATE");
		try {
			if (sessionId === undefined) {
				this.#database
					.prepare(
						"INSERT INTO assistant_sessions(id, created_at, updated_at) VALUES (?, ?, ?)",
					)
					.run(id, at, at);
			} else if (
				this.#database
					.prepare("SELECT 1 FROM assistant_sessions WHERE id = ?")
					.get(id) === undefined
			) {
				throw invalidSession();
			}
			this.#database
				.prepare(
					"INSERT INTO assistant_messages(session_id, role, content, created_at) VALUES (?, 'user', ?, ?)",
				)
				.run(id, message, at);
			this.#database
				.prepare("UPDATE assistant_sessions SET updated_at = ? WHERE id = ?")
				.run(at, id);
			this.#database.exec("COMMIT");
			return id;
		} catch (error) {
			if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
			throw error;
		}
	}

	appendAssistantMessage(sessionId: string, content: string): void {
		const message = content.trim();
		if (message.length < 1 || message.length > 4_000) throw invalidSession();
		const at = this.#clock().toISOString();
		this.#database.exec("BEGIN IMMEDIATE");
		try {
			if (
				this.#database
					.prepare("SELECT 1 FROM assistant_sessions WHERE id = ?")
					.get(sessionId) === undefined
			)
				throw invalidSession();
			this.#database
				.prepare(
					"INSERT INTO assistant_messages(session_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)",
				)
				.run(sessionId, message, at);
			this.#database
				.prepare("UPDATE assistant_sessions SET updated_at = ? WHERE id = ?")
				.run(at, sessionId);
			this.#database.exec("COMMIT");
		} catch (error) {
			if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
			throw error;
		}
	}

	listMessages(sessionId: string): StoredAssistantMessage[] {
		if (
			this.#database
				.prepare("SELECT 1 FROM assistant_sessions WHERE id = ?")
				.get(sessionId) === undefined
		)
			throw invalidSession();
		return this.#database
			.prepare(
				"SELECT id, session_id, role, content, created_at FROM assistant_messages WHERE session_id = ? ORDER BY id",
			)
			.all(sessionId)
			.map((row) => {
				const value = row as {
					id: number;
					session_id: string;
					role: "system" | "user" | "assistant";
					content: string;
					created_at: string;
				};
				return {
					id: value.id,
					sessionId: value.session_id,
					role: value.role,
					content: value.content,
					at: value.created_at,
				};
			});
	}

	deleteSession(sessionId: string): boolean {
		this.#database.exec("BEGIN IMMEDIATE");
		try {
			this.#database
				.prepare("DELETE FROM assistant_messages WHERE session_id = ?")
				.run(sessionId);
			const result = this.#database
				.prepare("DELETE FROM assistant_sessions WHERE id = ?")
				.run(sessionId);
			this.#database.exec("COMMIT");
			return result.changes === 1;
		} catch (error) {
			if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
			throw error;
		}
	}

	purgeExpiredSessions(at: Date, retentionDays = 7): number {
		if (
			Number.isNaN(at.getTime()) ||
			!Number.isInteger(retentionDays) ||
			retentionDays < 1 ||
			retentionDays > 365
		)
			throw invalidSession();
		const cutoff = new Date(
			at.getTime() - retentionDays * 86_400_000,
		).toISOString();
		this.#database.exec("BEGIN IMMEDIATE");
		try {
			this.#database
				.prepare(
					"DELETE FROM assistant_messages WHERE session_id IN (SELECT id FROM assistant_sessions WHERE updated_at < ?)",
				)
				.run(cutoff);
			const result = this.#database
				.prepare("DELETE FROM assistant_sessions WHERE updated_at < ?")
				.run(cutoff);
			this.#database.exec("COMMIT");
			return Number(result.changes);
		} catch (error) {
			if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
			throw error;
		}
	}
}
