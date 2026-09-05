import { DatabaseSync } from "node:sqlite";

export interface ScheduledJob {
	readonly id: string;
	readonly ownerId: string;
	readonly runAt: string;
	readonly payload: string;
}

export type ScheduledJobState =
	| "scheduled"
	| "claimed"
	| "dispatched"
	| "cancelled"
	| "failed";

export interface ScheduledJobRecord extends ScheduledJob {
	readonly state: ScheduledJobState;
	readonly createdAt: string;
	readonly firedAt?: string;
	readonly cancelledAt?: string;
	readonly parentId?: string;
	readonly failureMessage?: string;
}

interface ScheduledJobRow {
	id: string;
	owner_id: string;
	run_at: string;
	payload: string;
	created_at: string | null;
	fired_at: string | null;
	cancelled_at: string | null;
	parent_id: string | null;
	failure_message: string | null;
}

const idPattern = /^[a-z0-9][a-z0-9-]{0,99}$/u;

function isCanonicalTimestamp(value: string): boolean {
	const milliseconds = Date.parse(value);
	return (
		!Number.isNaN(milliseconds) &&
		new Date(milliseconds).toISOString() === value
	);
}

function validateJob(job: ScheduledJob): void {
	if (
		!idPattern.test(job.id) ||
		job.ownerId.length < 1 ||
		job.ownerId.length > 128 ||
		!isCanonicalTimestamp(job.runAt) ||
		job.payload.length < 1 ||
		Buffer.byteLength(job.payload, "utf8") > 64 * 1024
	)
		throw new TypeError("Invalid scheduled job");
}

function state(row: ScheduledJobRow): ScheduledJobState {
	if (row.cancelled_at !== null) return "cancelled";
	if (row.failure_message !== null) return "failed";
	if (row.parent_id !== null) return "dispatched";
	if (row.fired_at !== null) return "claimed";
	return "scheduled";
}

function record(row: ScheduledJobRow): ScheduledJobRecord {
	return {
		id: row.id,
		ownerId: row.owner_id,
		runAt: row.run_at,
		payload: row.payload,
		createdAt: row.created_at ?? row.run_at,
		state: state(row),
		...(row.fired_at === null ? {} : { firedAt: row.fired_at }),
		...(row.cancelled_at === null ? {} : { cancelledAt: row.cancelled_at }),
		...(row.parent_id === null ? {} : { parentId: row.parent_id }),
		...(row.failure_message === null
			? {}
			: { failureMessage: row.failure_message }),
	};
}

export class DurableScheduler {
	readonly #db: DatabaseSync;

	constructor(path: string) {
		this.#db = new DatabaseSync(path, {
			allowExtension: false,
			timeout: 5_000,
		});
		this.#db.exec(`
			PRAGMA journal_mode = WAL;
			PRAGMA synchronous = FULL;
			CREATE TABLE IF NOT EXISTS scheduled_jobs(
				id TEXT PRIMARY KEY,
				owner_id TEXT NOT NULL,
				run_at TEXT NOT NULL,
				payload TEXT NOT NULL,
				fired_at TEXT
			) STRICT;
		`);
		this.#addColumn("created_at", "TEXT");
		this.#addColumn("cancelled_at", "TEXT");
		this.#addColumn("parent_id", "TEXT");
		this.#addColumn("failure_message", "TEXT");
		this.#db.exec(
			"CREATE INDEX IF NOT EXISTS scheduled_jobs_due_idx ON scheduled_jobs(fired_at, cancelled_at, run_at, id)",
		);
	}

	schedule(job: ScheduledJob): ScheduledJobRecord {
		validateJob(job);
		const createdAt = new Date().toISOString();
		this.#db
			.prepare(
				"INSERT INTO scheduled_jobs(id,owner_id,run_at,payload,created_at) VALUES(?,?,?,?,?)",
			)
			.run(job.id, job.ownerId, job.runAt, job.payload, createdAt);
		return this.get(job.id);
	}

	due(now: string): readonly ScheduledJob[] {
		if (!isCanonicalTimestamp(now))
			throw new TypeError("Invalid schedule time");
		return this.#db
			.prepare(
				"SELECT id,owner_id,run_at,payload FROM scheduled_jobs WHERE fired_at IS NULL AND cancelled_at IS NULL AND run_at<=? ORDER BY run_at,id",
			)
			.all(now)
			.map((row) => ({
				id: String(row.id),
				ownerId: String(row.owner_id),
				runAt: String(row.run_at),
				payload: String(row.payload),
			}));
	}

	claim(id: string, at: string): boolean {
		if (!idPattern.test(id) || !isCanonicalTimestamp(at))
			throw new TypeError("Invalid schedule claim");
		return (
			this.#db
				.prepare(
					"UPDATE scheduled_jobs SET fired_at=? WHERE id=? AND fired_at IS NULL AND cancelled_at IS NULL",
				)
				.run(at, id).changes === 1
		);
	}

	recordDispatch(id: string, parentId: string): ScheduledJobRecord {
		if (!idPattern.test(id) || parentId.length < 1 || parentId.length > 200)
			throw new TypeError("Invalid schedule dispatch");
		const result = this.#db
			.prepare(
				"UPDATE scheduled_jobs SET parent_id=? WHERE id=? AND fired_at IS NOT NULL AND parent_id IS NULL AND failure_message IS NULL AND cancelled_at IS NULL",
			)
			.run(parentId, id);
		if (result.changes !== 1) throw new Error("Scheduled job is not claimable");
		return this.get(id);
	}

	recordFailure(id: string, message: string): ScheduledJobRecord {
		if (!idPattern.test(id) || message.length < 1 || message.length > 1_000)
			throw new TypeError("Invalid schedule failure");
		const result = this.#db
			.prepare(
				"UPDATE scheduled_jobs SET failure_message=? WHERE id=? AND fired_at IS NOT NULL AND parent_id IS NULL AND failure_message IS NULL AND cancelled_at IS NULL",
			)
			.run(message, id);
		if (result.changes !== 1) throw new Error("Scheduled job cannot fail");
		return this.get(id);
	}

	cancel(id: string, ownerId: string, at: string): boolean {
		if (
			!idPattern.test(id) ||
			ownerId.length < 1 ||
			ownerId.length > 128 ||
			!isCanonicalTimestamp(at)
		)
			throw new TypeError("Invalid schedule cancellation");
		return (
			this.#db
				.prepare(
					"UPDATE scheduled_jobs SET cancelled_at=? WHERE id=? AND owner_id=? AND fired_at IS NULL AND cancelled_at IS NULL",
				)
				.run(at, id, ownerId).changes === 1
		);
	}

	get(id: string): ScheduledJobRecord {
		if (!idPattern.test(id)) throw new TypeError("Invalid scheduled job id");
		const row = this.#db
			.prepare(
				"SELECT id,owner_id,run_at,payload,created_at,fired_at,cancelled_at,parent_id,failure_message FROM scheduled_jobs WHERE id=?",
			)
			.get(id) as ScheduledJobRow | undefined;
		if (row === undefined) throw new Error("Scheduled job was not found");
		return record(row);
	}

	list(ownerId?: string, limit = 100): readonly ScheduledJobRecord[] {
		if (
			(ownerId !== undefined && (ownerId.length < 1 || ownerId.length > 128)) ||
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > 100
		)
			throw new TypeError("Invalid schedule list");
		const rows =
			ownerId === undefined
				? this.#db
						.prepare(
							"SELECT id,owner_id,run_at,payload,created_at,fired_at,cancelled_at,parent_id,failure_message FROM scheduled_jobs ORDER BY run_at DESC,id DESC LIMIT ?",
						)
						.all(limit)
				: this.#db
						.prepare(
							"SELECT id,owner_id,run_at,payload,created_at,fired_at,cancelled_at,parent_id,failure_message FROM scheduled_jobs WHERE owner_id=? ORDER BY run_at DESC,id DESC LIMIT ?",
						)
						.all(ownerId, limit);
		return rows.map((row) => record(row as unknown as ScheduledJobRow));
	}

	close(): void {
		if (this.#db.isOpen) this.#db.close();
	}

	#addColumn(name: string, type: "TEXT"): void {
		const exists = this.#db
			.prepare("SELECT 1 FROM pragma_table_info('scheduled_jobs') WHERE name=?")
			.get(name);
		if (exists === undefined)
			this.#db.exec(`ALTER TABLE scheduled_jobs ADD COLUMN ${name} ${type}`);
	}
}
