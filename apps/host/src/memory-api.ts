import type {
	InspectableMemoryAuditEvent,
	InspectableMemoryInput,
	InspectableMemoryKind,
	InspectableMemoryPort,
	InspectableMemoryRecord,
	InspectableMemorySensitivity,
	InspectableMemoryUpdate,
} from "../../../packages/assistant-supervisor/src/index.js";
import { AgentMeError } from "../../../packages/contracts/src/index.js";

export type MemoryRoute =
	| { readonly type: "memory.list" }
	| { readonly type: "memory.export" }
	| { readonly type: "memory.create" }
	| { readonly type: "memory.update"; readonly id: string }
	| { readonly type: "memory.forget" };

export type MemoryRouteResult =
	| {
			readonly data: readonly InspectableMemoryRecord[];
			readonly pagination: {
				readonly limit: number;
				readonly offset: number;
				readonly totalItems: number;
			};
	  }
	| { readonly entry: InspectableMemoryRecord }
	| { readonly deleted: boolean }
	| {
			readonly schemaVersion: number;
			readonly purpose: string;
			readonly entries: readonly InspectableMemoryRecord[];
	  };

const memoryKinds = new Set<InspectableMemoryKind>([
	"profile",
	"project",
	"decision",
	"experience",
	"daily",
]);
const sensitivities = new Set<InspectableMemorySensitivity>([
	"private",
	"sensitive",
]);
const idPattern = /^[a-z0-9][a-z0-9._-]{0,100}$/;

function invalidRequest(): AgentMeError {
	return new AgentMeError({
		code: "INVALID_CONTRACT",
		message: "Invalid memory request",
		isRetryable: false,
	});
}

function conflict(): AgentMeError {
	return new AgentMeError({
		code: "INVALID_TASK_TRANSITION",
		message: "Memory id already exists with different content",
		isRetryable: false,
	});
}

function invalidProviderResponse(): AgentMeError {
	return new AgentMeError({
		code: "INVALID_CONTRACT",
		message: "Invalid memory provider response",
		isRetryable: false,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
): boolean {
	return Object.keys(value).every((key) => allowed.includes(key));
}

function isTimestamp(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isConfidence(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= 0 &&
		value <= 1
	);
}

function parseMemoryRecord(value: unknown): InspectableMemoryRecord {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, [
			"id",
			"kind",
			"content",
			"source",
			"createdAt",
			"verifiedAt",
			"confidence",
			"sensitivity",
		]) ||
		typeof value.id !== "string" ||
		!idPattern.test(value.id) ||
		typeof value.kind !== "string" ||
		!memoryKinds.has(value.kind as InspectableMemoryKind) ||
		typeof value.content !== "string" ||
		value.content.length < 1 ||
		value.content.length > 20_000 ||
		typeof value.source !== "string" ||
		value.source.length < 1 ||
		value.source.length > 500 ||
		!isTimestamp(value.createdAt) ||
		(value.verifiedAt !== undefined && !isTimestamp(value.verifiedAt)) ||
		!isConfidence(value.confidence) ||
		typeof value.sensitivity !== "string" ||
		!sensitivities.has(value.sensitivity as InspectableMemorySensitivity)
	)
		throw invalidProviderResponse();
	return {
		id: value.id,
		kind: value.kind as InspectableMemoryKind,
		content: value.content,
		source: value.source,
		createdAt: value.createdAt,
		...(value.verifiedAt === undefined
			? {}
			: { verifiedAt: value.verifiedAt as string }),
		confidence: value.confidence,
		sensitivity: value.sensitivity as InspectableMemorySensitivity,
	};
}

function parseMemoryRecords(
	value: unknown,
	maximum: number,
): readonly InspectableMemoryRecord[] {
	if (!Array.isArray(value) || value.length > maximum)
		throw invalidProviderResponse();
	return value.map(parseMemoryRecord);
}

function parseMemoryExport(value: string): MemoryRouteResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw invalidProviderResponse();
	}
	if (
		!isRecord(parsed) ||
		!hasOnlyKeys(parsed, ["schemaVersion", "purpose", "entries"]) ||
		parsed.schemaVersion !== 1 ||
		parsed.purpose !== "owner-inspectable-memory"
	)
		throw invalidProviderResponse();
	return {
		schemaVersion: 1,
		purpose: "owner-inspectable-memory",
		entries: parseMemoryRecords(parsed.entries, 50_000),
	};
}

function parseCreate(value: unknown): InspectableMemoryInput {
	if (!isRecord(value)) throw invalidRequest();
	if (
		!hasOnlyKeys(value, [
			"id",
			"kind",
			"content",
			"verifiedAt",
			"confidence",
			"sensitivity",
		]) ||
		typeof value.id !== "string" ||
		!idPattern.test(value.id) ||
		typeof value.kind !== "string" ||
		!memoryKinds.has(value.kind as InspectableMemoryKind) ||
		typeof value.content !== "string" ||
		value.content.trim().length < 1 ||
		value.content.trim().length > 20_000 ||
		(value.verifiedAt !== undefined && !isTimestamp(value.verifiedAt)) ||
		(value.confidence !== undefined && !isConfidence(value.confidence)) ||
		(value.sensitivity !== undefined &&
			(typeof value.sensitivity !== "string" ||
				!sensitivities.has(value.sensitivity as InspectableMemorySensitivity)))
	)
		throw invalidRequest();
	return {
		id: value.id,
		kind: value.kind as InspectableMemoryKind,
		content: value.content.trim(),
		source: "user:local-owner",
		...(value.verifiedAt === undefined
			? {}
			: { verifiedAt: value.verifiedAt as string }),
		...(value.confidence === undefined
			? {}
			: { confidence: value.confidence as number }),
		...(value.sensitivity === undefined
			? {}
			: {
					sensitivity: value.sensitivity as InspectableMemorySensitivity,
				}),
	};
}

function parseUpdate(value: unknown): InspectableMemoryUpdate {
	if (
		!isRecord(value) ||
		Object.keys(value).length < 1 ||
		!hasOnlyKeys(value, [
			"content",
			"verifiedAt",
			"confidence",
			"sensitivity",
		]) ||
		(value.content !== undefined &&
			(typeof value.content !== "string" ||
				value.content.trim().length < 1 ||
				value.content.trim().length > 20_000)) ||
		(value.verifiedAt !== undefined && !isTimestamp(value.verifiedAt)) ||
		(value.confidence !== undefined && !isConfidence(value.confidence)) ||
		(value.sensitivity !== undefined &&
			(typeof value.sensitivity !== "string" ||
				!sensitivities.has(value.sensitivity as InspectableMemorySensitivity)))
	)
		throw invalidRequest();
	return {
		...(typeof value.content === "string"
			? { content: value.content.trim() }
			: {}),
		...(typeof value.verifiedAt === "string"
			? { verifiedAt: value.verifiedAt }
			: {}),
		...(typeof value.confidence === "number"
			? { confidence: value.confidence }
			: {}),
		...(typeof value.sensitivity === "string"
			? { sensitivity: value.sensitivity as InspectableMemorySensitivity }
			: {}),
	};
}

function parseRemoval(value: unknown): string {
	if (
		!isRecord(value) ||
		Object.keys(value).length !== 1 ||
		typeof value.id !== "string" ||
		!idPattern.test(value.id)
	)
		throw invalidRequest();
	return value.id;
}

function assertJson(contentType: string | undefined): void {
	if (!contentType?.toLowerCase().startsWith("application/json"))
		throw invalidRequest();
}

function sameCreate(
	existing: InspectableMemoryRecord,
	input: InspectableMemoryInput,
): boolean {
	return (
		existing.kind === input.kind &&
		existing.content === input.content &&
		existing.source === input.source &&
		existing.verifiedAt === input.verifiedAt &&
		existing.confidence === (input.confidence ?? 1) &&
		existing.sensitivity === (input.sensitivity ?? "private")
	);
}

export function matchMemoryRoute(
	method: string | undefined,
	pathname: string,
): MemoryRoute | undefined {
	if (method === "GET" && pathname === "/memories")
		return { type: "memory.list" };
	if (method === "GET" && pathname === "/memories/export")
		return { type: "memory.export" };
	if (method !== "POST") return undefined;
	if (pathname === "/memories") return { type: "memory.create" };
	if (pathname === "/memories/removals") return { type: "memory.forget" };
	const match = /^\/memories\/([a-z0-9][a-z0-9._-]{0,100})$/i.exec(pathname);
	return match === null
		? undefined
		: { type: "memory.update", id: match[1] ?? "" };
}

export async function executeMemoryRoute(
	memory: InspectableMemoryPort,
	route: MemoryRoute,
	input: {
		readonly query: URLSearchParams;
		readonly contentType?: string;
		readonly body?: unknown;
		readonly audit?: (
			event: InspectableMemoryAuditEvent,
		) => void | Promise<void>;
	},
	signal: AbortSignal,
): Promise<MemoryRouteResult> {
	if (signal.aborted) throw signal.reason;
	if (route.type === "memory.list") {
		if (
			[...input.query.keys()].some(
				(key) => !["kind", "query", "limit", "offset"].includes(key),
			)
		)
			throw invalidRequest();
		const kindValue = input.query.get("kind");
		const query = input.query.get("query");
		const limit = Number(input.query.get("limit") ?? "50");
		const offset = Number(input.query.get("offset") ?? "0");
		if (
			(kindValue !== null &&
				!memoryKinds.has(kindValue as InspectableMemoryKind)) ||
			(query !== null && (query.trim().length < 1 || query.length > 500)) ||
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > 100 ||
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			offset > 10_000
		)
			throw invalidRequest();
		if (query === null) {
			const page = await memory.list(
				{
					...(kindValue === null
						? {}
						: { kind: kindValue as InspectableMemoryKind }),
					limit,
					offset,
				},
				signal,
			);
			if (
				!isRecord(page) ||
				!hasOnlyKeys(page, ["data", "pagination"]) ||
				!isRecord(page.pagination) ||
				!hasOnlyKeys(page.pagination, ["limit", "offset", "totalItems"]) ||
				page.pagination.limit !== limit ||
				page.pagination.offset !== offset ||
				!Number.isSafeInteger(page.pagination.totalItems) ||
				(page.pagination.totalItems as number) < 0
			)
				throw invalidProviderResponse();
			return {
				data: parseMemoryRecords(page.data, limit),
				pagination: {
					limit,
					offset,
					totalItems: page.pagination.totalItems as number,
				},
			};
		}
		const found = parseMemoryRecords(
			await memory.search(query.trim(), signal),
			100,
		).filter((record) => kindValue === null || record.kind === kindValue);
		return {
			data: found.slice(offset, offset + limit),
			pagination: { limit, offset, totalItems: found.length },
		};
	}
	if (route.type === "memory.export") {
		if ([...input.query.keys()].length > 0) throw invalidRequest();
		return parseMemoryExport(await memory.export(signal));
	}
	assertJson(input.contentType);
	if (route.type === "memory.create") {
		const create = parseCreate(input.body);
		const existingValue = await memory.get(create.id, signal);
		const existing =
			existingValue === undefined
				? undefined
				: parseMemoryRecord(existingValue);
		if (existing !== undefined) {
			if (!sameCreate(existing, create)) throw conflict();
			return { entry: existing };
		}
		const entry = parseMemoryRecord(await memory.put(create, signal));
		await input.audit?.({
			type: "memory.mutated",
			operation: "created",
			memoryId: entry.id,
			kind: entry.kind,
			at: new Date().toISOString(),
		});
		return { entry };
	}
	if (route.type === "memory.update") {
		if ((await memory.get(route.id, signal)) === undefined)
			throw invalidRequest();
		const entry = parseMemoryRecord(
			await memory.update(route.id, parseUpdate(input.body), signal),
		);
		await input.audit?.({
			type: "memory.mutated",
			operation: "updated",
			memoryId: entry.id,
			kind: entry.kind,
			at: new Date().toISOString(),
		});
		return { entry };
	}
	const id = parseRemoval(input.body);
	const deleted = await memory.forget(id, signal);
	if (typeof deleted !== "boolean") throw invalidProviderResponse();
	if (deleted)
		await input.audit?.({
			type: "memory.mutated",
			operation: "deleted",
			memoryId: id,
			at: new Date().toISOString(),
		});
	return { deleted };
}
