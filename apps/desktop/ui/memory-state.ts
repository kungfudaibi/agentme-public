export type DesktopMemoryKind =
	| "profile"
	| "project"
	| "decision"
	| "experience"
	| "daily";
export type DesktopMemorySensitivity = "private" | "sensitive";

export interface DesktopMemoryRecord {
	readonly id: string;
	readonly kind: DesktopMemoryKind;
	readonly content: string;
	readonly source: string;
	readonly createdAt: string;
	readonly verifiedAt?: string;
	readonly confidence: number;
	readonly sensitivity: DesktopMemorySensitivity;
}

export interface DesktopMemoryPage {
	readonly data: readonly DesktopMemoryRecord[];
	readonly pagination: {
		readonly limit: number;
		readonly offset: number;
		readonly totalItems: number;
	};
}

export interface MemoryFormValues {
	readonly content: string;
	readonly verifiedAt: string;
	readonly confidence: string;
	readonly sensitivity: string;
}

const kinds = new Set<DesktopMemoryKind>([
	"profile",
	"project",
	"decision",
	"experience",
	"daily",
]);
const sensitivities = new Set<DesktopMemorySensitivity>([
	"private",
	"sensitive",
]);
const idPattern = /^[a-z0-9][a-z0-9._-]{0,100}$/;

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

function invalid(): never {
	throw new TypeError("Invalid memory input");
}

function parseRecord(value: unknown): DesktopMemoryRecord {
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
		!kinds.has(value.kind as DesktopMemoryKind) ||
		typeof value.content !== "string" ||
		value.content.length < 1 ||
		value.content.length > 20_000 ||
		typeof value.source !== "string" ||
		value.source.length < 1 ||
		value.source.length > 500 ||
		!isTimestamp(value.createdAt) ||
		(value.verifiedAt !== undefined && !isTimestamp(value.verifiedAt)) ||
		typeof value.confidence !== "number" ||
		!Number.isFinite(value.confidence) ||
		value.confidence < 0 ||
		value.confidence > 1 ||
		typeof value.sensitivity !== "string" ||
		!sensitivities.has(value.sensitivity as DesktopMemorySensitivity)
	)
		throw new TypeError("Invalid memory page");
	return {
		id: value.id,
		kind: value.kind as DesktopMemoryKind,
		content: value.content,
		source: value.source,
		createdAt: value.createdAt,
		...(value.verifiedAt === undefined
			? {}
			: { verifiedAt: value.verifiedAt as string }),
		confidence: value.confidence,
		sensitivity: value.sensitivity as DesktopMemorySensitivity,
	};
}

export function parseMemoryPage(value: unknown): DesktopMemoryPage {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["data", "pagination"]) ||
		!Array.isArray(value.data) ||
		!isRecord(value.pagination) ||
		!hasOnlyKeys(value.pagination, ["limit", "offset", "totalItems"]) ||
		!Number.isSafeInteger(value.pagination.limit) ||
		(value.pagination.limit as number) < 1 ||
		(value.pagination.limit as number) > 100 ||
		!Number.isSafeInteger(value.pagination.offset) ||
		(value.pagination.offset as number) < 0 ||
		!Number.isSafeInteger(value.pagination.totalItems) ||
		(value.pagination.totalItems as number) < value.data.length ||
		value.data.length > (value.pagination.limit as number)
	)
		throw new TypeError("Invalid memory page");
	return {
		data: value.data.map(parseRecord),
		pagination: {
			limit: value.pagination.limit as number,
			offset: value.pagination.offset as number,
			totalItems: value.pagination.totalItems as number,
		},
	};
}

export function parseMemoryExport(value: unknown): {
	readonly schemaVersion: 1;
	readonly purpose: "owner-inspectable-memory";
	readonly entries: readonly DesktopMemoryRecord[];
} {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["schemaVersion", "purpose", "entries"]) ||
		value.schemaVersion !== 1 ||
		value.purpose !== "owner-inspectable-memory" ||
		!Array.isArray(value.entries) ||
		value.entries.length > 50_000
	)
		throw new TypeError("Invalid memory export");
	return {
		schemaVersion: 1,
		purpose: "owner-inspectable-memory",
		entries: value.entries.map(parseRecord),
	};
}

function parseForm(values: MemoryFormValues): {
	readonly content: string;
	readonly verifiedAt?: string;
	readonly confidence: number;
	readonly sensitivity: DesktopMemorySensitivity;
} {
	const content = values.content.trim();
	const confidence = Number(values.confidence);
	if (
		content.length < 1 ||
		content.length > 20_000 ||
		(values.verifiedAt.length > 0 && !isTimestamp(values.verifiedAt)) ||
		!Number.isFinite(confidence) ||
		confidence < 0 ||
		confidence > 1 ||
		!sensitivities.has(values.sensitivity as DesktopMemorySensitivity)
	)
		return invalid();
	return {
		content,
		...(values.verifiedAt.length === 0
			? {}
			: { verifiedAt: values.verifiedAt }),
		confidence,
		sensitivity: values.sensitivity as DesktopMemorySensitivity,
	};
}

export function buildMemoryCreateInput(
	values: MemoryFormValues & {
		readonly id: string;
		readonly kind: string;
	},
): {
	readonly id: string;
	readonly kind: DesktopMemoryKind;
	readonly content: string;
	readonly verifiedAt?: string;
	readonly confidence: number;
	readonly sensitivity: DesktopMemorySensitivity;
} {
	const id = values.id.trim();
	if (!idPattern.test(id) || !kinds.has(values.kind as DesktopMemoryKind))
		return invalid();
	return { id, kind: values.kind as DesktopMemoryKind, ...parseForm(values) };
}

export function buildMemoryUpdateInput(values: MemoryFormValues): {
	readonly content: string;
	readonly verifiedAt?: string;
	readonly confidence: number;
	readonly sensitivity: DesktopMemorySensitivity;
} {
	return parseForm(values);
}
