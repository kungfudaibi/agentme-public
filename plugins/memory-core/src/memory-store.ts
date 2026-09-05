import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type MemoryKind =
	| "profile"
	| "project"
	| "decision"
	| "experience"
	| "daily";
export type MemorySensitivity = "private" | "sensitive";

export interface MemoryInput {
	readonly id: string;
	readonly kind: MemoryKind;
	readonly content: string;
	readonly source: string;
	readonly createdAt?: string;
	readonly verifiedAt?: string;
	readonly confidence?: number;
	readonly sensitivity?: MemorySensitivity;
}

export interface MemoryUpdateInput {
	readonly content?: string;
	readonly verifiedAt?: string;
	readonly confidence?: number;
	readonly sensitivity?: MemorySensitivity;
}

export interface MemoryRecord {
	readonly id: string;
	readonly kind: MemoryKind;
	readonly content: string;
	readonly source: string;
	readonly createdAt: string;
	readonly verifiedAt?: string;
	readonly confidence: number;
	readonly sensitivity: MemorySensitivity;
}

export type MemorySearchResult = MemoryRecord;

export interface MemoryPage {
	readonly data: readonly MemoryRecord[];
	readonly pagination: {
		readonly limit: number;
		readonly offset: number;
		readonly totalItems: number;
	};
}

export interface MemoryStoreOptions {
	readonly clock?: () => Date;
}

const idPattern = /^[a-z0-9][a-z0-9._-]{0,100}$/;
const memoryKinds = new Set<MemoryKind>([
	"profile",
	"project",
	"decision",
	"experience",
	"daily",
]);
const sensitivities = new Set<MemorySensitivity>(["private", "sensitive"]);

function validTimestamp(value: string): boolean {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function metadataField(metadata: string, name: string): unknown {
	const raw = metadata.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1];
	if (raw === undefined) throw new TypeError("Invalid memory document");
	return JSON.parse(raw) as unknown;
}

export class MemoryStore {
	readonly #root: string;
	readonly #db: DatabaseSync;
	readonly #clock: () => Date;

	constructor(
		root: string,
		databasePath: string,
		options: MemoryStoreOptions = {},
	) {
		this.#root = resolve(root);
		this.#clock = options.clock ?? (() => new Date());
		mkdirSync(this.#root, { recursive: true });
		this.#db = new DatabaseSync(databasePath, { allowExtension: false });
		this.#db.exec(
			"CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(id UNINDEXED, kind UNINDEXED, content)",
		);
	}

	put(input: MemoryInput): MemoryRecord {
		const record = this.#normalize(input);
		this.#write(record);
		this.#index(record);
		return record;
	}

	get(id: string): MemoryRecord | undefined {
		const path = this.#path(id);
		if (!existsSync(path)) return undefined;
		return this.#parse(readFileSync(path, "utf8"));
	}

	list(options: {
		readonly kind?: MemoryKind;
		readonly limit?: number;
		readonly offset?: number;
	}): MemoryPage {
		const limit = options.limit ?? 50;
		const offset = options.offset ?? 0;
		if (
			(options.kind !== undefined && !memoryKinds.has(options.kind)) ||
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > 100 ||
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			offset > 10_000
		)
			throw new TypeError("Invalid memory page");
		const records = this.#records()
			.filter(
				(record) => options.kind === undefined || record.kind === options.kind,
			)
			.sort(
				(left, right) =>
					right.createdAt.localeCompare(left.createdAt) ||
					left.id.localeCompare(right.id),
			);
		return {
			data: records.slice(offset, offset + limit),
			pagination: { limit, offset, totalItems: records.length },
		};
	}

	update(id: string, input: MemoryUpdateInput): MemoryRecord {
		if (
			Object.keys(input).length < 1 ||
			Object.keys(input).some(
				(key) =>
					!["content", "verifiedAt", "confidence", "sensitivity"].includes(key),
			)
		)
			throw new TypeError("Invalid memory update");
		const current = this.get(id);
		if (current === undefined) throw new TypeError("Memory not found");
		const record = this.#normalize({
			id: current.id,
			kind: current.kind,
			content: input.content ?? current.content,
			source: current.source,
			createdAt: current.createdAt,
			...(input.verifiedAt === undefined
				? current.verifiedAt === undefined
					? {}
					: { verifiedAt: current.verifiedAt }
				: { verifiedAt: input.verifiedAt }),
			confidence: input.confidence ?? current.confidence,
			sensitivity: input.sensitivity ?? current.sensitivity,
		});
		this.#write(record);
		this.#index(record);
		return record;
	}

	search(query: string): readonly MemorySearchResult[] {
		const normalized = query.trim();
		if (normalized.length === 0) return [];
		if (
			normalized.length > 500 ||
			[...normalized].some((character) => {
				const code = character.charCodeAt(0);
				return code <= 31 || code === 127;
			})
		)
			throw new TypeError("Invalid memory query");
		const terms = normalized
			.split(/\s+/u)
			.slice(0, 16)
			.map(
				(term) =>
					`%${term
						.toLocaleLowerCase()
						.replaceAll("\\", "\\\\")
						.replaceAll("%", "\\%")
						.replaceAll("_", "\\_")}%`,
			);
		const clause =
			"(lower(id) LIKE ? ESCAPE '\\' OR lower(kind) LIKE ? ESCAPE '\\' OR lower(content) LIKE ? ESCAPE '\\')";
		const parameters = terms.flatMap((term) => [term, term, term]);
		const ids = this.#db
			.prepare(
				`SELECT id FROM memory_search WHERE ${terms.map(() => clause).join(" AND ")} ORDER BY rowid DESC LIMIT 20`,
			)
			.all(...parameters)
			.map((row) => String(row.id));
		return ids.flatMap((id) => {
			const record = this.get(id);
			return record === undefined ? [] : [record];
		});
	}

	forget(id: string): boolean {
		const path = this.#path(id);
		const existed = existsSync(path);
		rmSync(path, { force: true });
		this.#db.prepare("DELETE FROM memory_search WHERE id=?").run(id);
		return existed;
	}

	export(): string {
		return JSON.stringify({
			schemaVersion: 1,
			purpose: "owner-inspectable-memory",
			entries: this.#records(),
		});
	}

	reindex(): void {
		this.#db.exec("DELETE FROM memory_search");
		for (const record of this.#records()) this.#index(record);
	}

	close(): void {
		if (this.#db.isOpen) this.#db.close();
	}

	#normalize(input: MemoryInput): MemoryRecord {
		const content = input.content.trim();
		const source = input.source.trim();
		const createdAt = input.createdAt ?? this.#clock().toISOString();
		const confidence = input.confidence ?? 1;
		const sensitivity = input.sensitivity ?? "private";
		if (
			!idPattern.test(input.id) ||
			basename(input.id) !== input.id ||
			!memoryKinds.has(input.kind) ||
			content.length < 1 ||
			content.length > 20_000 ||
			source.length < 1 ||
			source.length > 500 ||
			!validTimestamp(createdAt) ||
			(input.verifiedAt !== undefined && !validTimestamp(input.verifiedAt)) ||
			!Number.isFinite(confidence) ||
			confidence < 0 ||
			confidence > 1 ||
			!sensitivities.has(sensitivity)
		)
			throw new TypeError("Invalid memory");
		return {
			id: input.id,
			kind: input.kind,
			content,
			source,
			createdAt,
			...(input.verifiedAt === undefined
				? {}
				: { verifiedAt: input.verifiedAt }),
			confidence,
			sensitivity,
		};
	}

	#write(record: MemoryRecord): void {
		const path = this.#path(record.id);
		const temporary = `${path}.tmp`;
		const frontmatter = [
			"---",
			`id: ${JSON.stringify(record.id)}`,
			`kind: ${JSON.stringify(record.kind)}`,
			`source: ${JSON.stringify(record.source)}`,
			`createdAt: ${JSON.stringify(record.createdAt)}`,
			`verifiedAt: ${JSON.stringify(record.verifiedAt ?? null)}`,
			`confidence: ${JSON.stringify(record.confidence)}`,
			`sensitivity: ${JSON.stringify(record.sensitivity)}`,
			"---",
			"",
			record.content,
			"",
		].join("\n");
		writeFileSync(temporary, frontmatter, { encoding: "utf8", mode: 0o600 });
		renameSync(temporary, path);
	}

	#parse(text: string): MemoryRecord {
		const parts = text.split("---");
		const metadata = parts[1] ?? "";
		const verifiedAt = metadataField(metadata, "verifiedAt");
		return this.#normalize({
			id: metadataField(metadata, "id") as string,
			kind: metadataField(metadata, "kind") as MemoryKind,
			source: metadataField(metadata, "source") as string,
			createdAt: metadataField(metadata, "createdAt") as string,
			...(verifiedAt === null ? {} : { verifiedAt: verifiedAt as string }),
			confidence: metadataField(metadata, "confidence") as number,
			sensitivity: metadataField(metadata, "sensitivity") as MemorySensitivity,
			content: parts.slice(2).join("---").trim(),
		});
	}

	#records(): MemoryRecord[] {
		return readdirSync(this.#root)
			.filter((name) => name.endsWith(".md"))
			.map((name) => this.#parse(readFileSync(join(this.#root, name), "utf8")));
	}

	#path(id: string): string {
		if (!idPattern.test(id) || basename(id) !== id)
			throw new TypeError("Invalid memory id");
		return join(this.#root, `${id}.md`);
	}

	#index(record: MemoryRecord): void {
		this.#db.prepare("DELETE FROM memory_search WHERE id=?").run(record.id);
		this.#db
			.prepare("INSERT INTO memory_search(id,kind,content) VALUES(?,?,?)")
			.run(record.id, record.kind, record.content);
	}
}
