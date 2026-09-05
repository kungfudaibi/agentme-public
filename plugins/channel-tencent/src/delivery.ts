import { DatabaseSync } from "node:sqlite";

export interface PendingDelivery {
	readonly id: number;
	readonly recipientId: string;
	readonly payload: string;
}
export class ChannelDeliveryStore {
	readonly #db: DatabaseSync;
	constructor(path: string) {
		this.#db = new DatabaseSync(path, { allowExtension: false });
		this.#db.exec(
			"PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS channel_delivery(id INTEGER PRIMARY KEY AUTOINCREMENT, recipient_id TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, delivered_at TEXT) STRICT",
		);
	}
	enqueue(recipientId: string, dedupeKey: string, payload: string): void {
		this.#db
			.prepare(
				"INSERT OR IGNORE INTO channel_delivery(recipient_id,dedupe_key,payload) VALUES(?,?,?)",
			)
			.run(recipientId, dedupeKey, payload);
	}
	pending(): readonly PendingDelivery[] {
		return this.#db
			.prepare(
				"SELECT id, recipient_id, payload FROM channel_delivery WHERE delivered_at IS NULL ORDER BY id",
			)
			.all()
			.map((row) => ({
				id: Number(row.id),
				recipientId: String(row.recipient_id),
				payload: String(row.payload),
			}));
	}
	markDelivered(id: number, at = new Date().toISOString()): void {
		this.#db
			.prepare(
				"UPDATE channel_delivery SET delivered_at=? WHERE id=? AND delivered_at IS NULL",
			)
			.run(at, id);
	}
	close(): void {
		this.#db.close();
	}
}
