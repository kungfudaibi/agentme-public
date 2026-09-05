import { DatabaseSync } from "node:sqlite";

import { canFireIntent, type StandingIntent } from "./intent-matcher.js";

export type StandingIntentState =
	| "active"
	| "exhausted"
	| "expired"
	| "cancelled";

export interface CreateStandingIntent {
	readonly id: string;
	readonly ownerId: string;
	readonly eventType: string;
	readonly expiresAt: string;
	readonly cooldownMs: number;
	readonly maxFires: number;
	readonly allowedTools: readonly string[];
	readonly payload: string;
	readonly createdAt: string;
}

export interface StandingIntentRecord
	extends CreateStandingIntent,
		StandingIntent {
	readonly firedCount: number;
	readonly lastFiredAt?: string;
	readonly state: StandingIntentState;
	readonly cancelledAt?: string;
	readonly lastParentId?: string;
	readonly lastFailureMessage?: string;
}

interface StandingIntentRow {
	id: string;
	owner_id: string;
	event_type: string;
	expires_at: string;
	cooldown_ms: number;
	max_fires: number;
	allowed_tools_json: string;
	payload: string;
	created_at: string;
	fired_count: number;
	last_fired_at: string | null;
	cancelled_at: string | null;
	last_parent_id: string | null;
	last_failure_message: string | null;
}

const idPattern = /^[a-z0-9][a-z0-9-]{0,99}$/u;
const eventPattern = /^[a-z][a-z0-9.-]{1,99}$/u;
const toolPattern = /^[a-z][a-z0-9.-]{1,99}$/u;

function isCanonicalTimestamp(value: string): boolean {
	const milliseconds = Date.parse(value);
	return (
		!Number.isNaN(milliseconds) &&
		new Date(milliseconds).toISOString() === value
	);
}

function validate(input: CreateStandingIntent): void {
	if (
		!idPattern.test(input.id) ||
		input.ownerId.length < 1 ||
		input.ownerId.length > 128 ||
		!eventPattern.test(input.eventType) ||
		!isCanonicalTimestamp(input.expiresAt) ||
		!isCanonicalTimestamp(input.createdAt) ||
		Date.parse(input.expiresAt) <= Date.parse(input.createdAt) ||
		!Number.isSafeInteger(input.cooldownMs) ||
		input.cooldownMs < 0 ||
		input.cooldownMs > 365 * 86_400_000 ||
		!Number.isSafeInteger(input.maxFires) ||
		input.maxFires < 1 ||
		input.maxFires > 100 ||
		input.allowedTools.length < 1 ||
		input.allowedTools.length > 10 ||
		new Set(input.allowedTools).size !== input.allowedTools.length ||
		input.allowedTools.some((tool) => !toolPattern.test(tool)) ||
		input.payload.length < 1 ||
		Buffer.byteLength(input.payload, "utf8") > 64 * 1024
	)
		throw new TypeError("Invalid standing intent");
}

function tools(value: string): readonly string[] {
	const parsed: unknown = JSON.parse(value);
	if (
		!Array.isArray(parsed) ||
		parsed.length < 1 ||
		parsed.length > 10 ||
		parsed.some((item) => typeof item !== "string" || !toolPattern.test(item))
	)
		throw new Error("Stored standing intent tools are invalid");
	return parsed as string[];
}

function record(
	row: StandingIntentRow,
	now = new Date().toISOString(),
): StandingIntentRecord {
	const allowedTools = tools(row.allowed_tools_json);
	const state: StandingIntentState =
		row.cancelled_at !== null
			? "cancelled"
			: row.fired_count >= row.max_fires
				? "exhausted"
				: Date.parse(now) >= Date.parse(row.expires_at)
					? "expired"
					: "active";
	return {
		id: row.id,
		ownerId: row.owner_id,
		eventType: row.event_type,
		expiresAt: row.expires_at,
		cooldownMs: row.cooldown_ms,
		maxFires: row.max_fires,
		allowedTools,
		payload: row.payload,
		createdAt: row.created_at,
		firedCount: row.fired_count,
		...(row.last_fired_at === null ? {} : { lastFiredAt: row.last_fired_at }),
		...(row.cancelled_at === null ? {} : { cancelledAt: row.cancelled_at }),
		...(row.last_parent_id === null
			? {}
			: { lastParentId: row.last_parent_id }),
		...(row.last_failure_message === null
			? {}
			: { lastFailureMessage: row.last_failure_message }),
		state,
	};
}

export class StandingIntentStore {
	readonly #db: DatabaseSync;

	constructor(path: string) {
		this.#db = new DatabaseSync(path, {
			allowExtension: false,
			timeout: 5_000,
		});
		this.#db.exec(`
			PRAGMA journal_mode = WAL;
			PRAGMA synchronous = FULL;
			CREATE TABLE IF NOT EXISTS standing_intents(
				id TEXT PRIMARY KEY,
				owner_id TEXT NOT NULL,
				event_type TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				cooldown_ms INTEGER NOT NULL,
				max_fires INTEGER NOT NULL,
				allowed_tools_json TEXT NOT NULL,
				payload TEXT NOT NULL,
				created_at TEXT NOT NULL,
				fired_count INTEGER NOT NULL DEFAULT 0,
				last_fired_at TEXT,
				cancelled_at TEXT,
				last_parent_id TEXT,
				last_failure_message TEXT
			) STRICT;
			CREATE INDEX IF NOT EXISTS standing_intents_match_idx
				ON standing_intents(owner_id,event_type,cancelled_at,expires_at);
		`);
	}

	create(input: CreateStandingIntent): StandingIntentRecord {
		validate(input);
		this.#db
			.prepare(
				"INSERT INTO standing_intents(id,owner_id,event_type,expires_at,cooldown_ms,max_fires,allowed_tools_json,payload,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
			)
			.run(
				input.id,
				input.ownerId,
				input.eventType,
				input.expiresAt,
				input.cooldownMs,
				input.maxFires,
				JSON.stringify(input.allowedTools),
				input.payload,
				input.createdAt,
			);
		return this.get(input.id, input.createdAt);
	}

	matchAndClaim(
		event: {
			readonly type: string;
			readonly actorId: string;
			readonly authenticated: boolean;
		},
		now: string,
		requestedTools: readonly string[],
	): readonly StandingIntentRecord[] {
		if (
			!eventPattern.test(event.type) ||
			event.actorId.length < 1 ||
			event.actorId.length > 128 ||
			!isCanonicalTimestamp(now) ||
			requestedTools.length < 1 ||
			requestedTools.some((tool) => !toolPattern.test(tool))
		)
			throw new TypeError("Invalid standing intent event");
		this.#db.exec("BEGIN IMMEDIATE");
		try {
			const rows = this.#db
				.prepare(
					"SELECT * FROM standing_intents WHERE owner_id=? AND event_type=? AND cancelled_at IS NULL ORDER BY created_at,id",
				)
				.all(event.actorId, event.type) as unknown as StandingIntentRow[];
			const claimed: StandingIntentRecord[] = [];
			for (const row of rows) {
				const current = record(row, now);
				if (!canFireIntent(current, event, now, requestedTools)) continue;
				this.#db
					.prepare(
						"UPDATE standing_intents SET fired_count=fired_count+1,last_fired_at=?,last_parent_id=NULL,last_failure_message=NULL WHERE id=?",
					)
					.run(now, row.id);
				claimed.push(this.get(row.id, now));
			}
			this.#db.exec("COMMIT");
			return claimed;
		} catch (error) {
			this.#db.exec("ROLLBACK");
			throw error;
		}
	}

	recordDispatch(id: string, parentId: string): StandingIntentRecord {
		if (!idPattern.test(id) || parentId.length < 1 || parentId.length > 200)
			throw new TypeError("Invalid standing intent dispatch");
		const result = this.#db
			.prepare(
				"UPDATE standing_intents SET last_parent_id=?,last_failure_message=NULL WHERE id=? AND fired_count>0 AND cancelled_at IS NULL",
			)
			.run(parentId, id);
		if (result.changes !== 1)
			throw new Error("Standing intent was not claimed");
		return this.get(id);
	}

	recordFailure(id: string, message: string): StandingIntentRecord {
		if (!idPattern.test(id) || message.length < 1 || message.length > 1_000)
			throw new TypeError("Invalid standing intent failure");
		const result = this.#db
			.prepare(
				"UPDATE standing_intents SET last_failure_message=?,last_parent_id=NULL WHERE id=? AND fired_count>0 AND cancelled_at IS NULL",
			)
			.run(message, id);
		if (result.changes !== 1)
			throw new Error("Standing intent was not claimed");
		return this.get(id);
	}

	cancel(id: string, ownerId: string, at: string): boolean {
		if (
			!idPattern.test(id) ||
			ownerId.length < 1 ||
			ownerId.length > 128 ||
			!isCanonicalTimestamp(at)
		)
			throw new TypeError("Invalid standing intent cancellation");
		return (
			this.#db
				.prepare(
					"UPDATE standing_intents SET cancelled_at=? WHERE id=? AND owner_id=? AND cancelled_at IS NULL AND fired_count<max_fires AND expires_at>?",
				)
				.run(at, id, ownerId, at).changes === 1
		);
	}

	get(id: string, now = new Date().toISOString()): StandingIntentRecord {
		if (!idPattern.test(id) || !isCanonicalTimestamp(now))
			throw new TypeError("Invalid standing intent id");
		const row = this.#db
			.prepare("SELECT * FROM standing_intents WHERE id=?")
			.get(id) as StandingIntentRow | undefined;
		if (row === undefined) throw new Error("Standing intent was not found");
		return record(row, now);
	}

	list(
		ownerId: string,
		limit = 100,
		now = new Date().toISOString(),
	): readonly StandingIntentRecord[] {
		if (
			ownerId.length < 1 ||
			ownerId.length > 128 ||
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > 100 ||
			!isCanonicalTimestamp(now)
		)
			throw new TypeError("Invalid standing intent list");
		return (
			this.#db
				.prepare(
					"SELECT * FROM standing_intents WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT ?",
				)
				.all(ownerId, limit) as unknown as StandingIntentRow[]
		).map((row) => record(row, now));
	}

	close(): void {
		if (this.#db.isOpen) this.#db.close();
	}
}
