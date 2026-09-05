import type { DatabaseSync } from "node:sqlite";

const migrationOne = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  lease_writer_id TEXT,
  lease_version INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS task_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS task_outbox_pending_idx
  ON task_outbox(delivered_at, id);
`;

export function migrate(database: DatabaseSync): void {
	database.exec("BEGIN IMMEDIATE");
	try {
		database.exec(
			"CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT",
		);
		if (
			database
				.prepare("SELECT 1 FROM schema_migrations WHERE version = 1")
				.get() === undefined
		) {
			database.exec(migrationOne);
			database
				.prepare(
					"INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)",
				)
				.run(new Date().toISOString());
		}
		database.exec("COMMIT");
	} catch (error) {
		if (database.isTransaction) database.exec("ROLLBACK");
		throw error;
	}
}
