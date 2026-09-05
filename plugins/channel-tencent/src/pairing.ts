import { DatabaseSync } from "node:sqlite";

export interface TencentPairingPort {
	isPaired(senderId: string): boolean;
}

function senderId(value: string): string {
	if (
		value.length < 1 ||
		value.length > 256 ||
		!/^[A-Za-z0-9._:-]+$/u.test(value)
	)
		throw new TypeError("Tencent sender id is invalid");
	return value;
}

export class TencentPairingStore implements TencentPairingPort {
	readonly #db: DatabaseSync;

	constructor(path: string) {
		this.#db = new DatabaseSync(path, { allowExtension: false });
		this.#db.exec(
			"PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS tencent_owner_pairing(sender_id TEXT PRIMARY KEY, paired_at TEXT NOT NULL) STRICT",
		);
	}

	pair(id: string, at = new Date().toISOString()): void {
		this.#db
			.prepare(
				"INSERT INTO tencent_owner_pairing(sender_id, paired_at) VALUES(?, ?) ON CONFLICT(sender_id) DO UPDATE SET paired_at=excluded.paired_at",
			)
			.run(senderId(id), at);
	}

	isPaired(id: string): boolean {
		return (
			this.#db
				.prepare("SELECT 1 FROM tencent_owner_pairing WHERE sender_id=?")
				.get(senderId(id)) !== undefined
		);
	}

	unpair(id: string): boolean {
		return (
			this.#db
				.prepare("DELETE FROM tencent_owner_pairing WHERE sender_id=?")
				.run(senderId(id)).changes > 0
		);
	}

	close(): void {
		this.#db.close();
	}
}
