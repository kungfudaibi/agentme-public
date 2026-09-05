export type InspectableMemoryKind =
	| "profile"
	| "project"
	| "decision"
	| "experience"
	| "daily";
export type InspectableMemorySensitivity = "private" | "sensitive";

export interface InspectableMemoryInput {
	readonly id: string;
	readonly kind: InspectableMemoryKind;
	readonly content: string;
	readonly source: string;
	readonly createdAt?: string;
	readonly verifiedAt?: string;
	readonly confidence?: number;
	readonly sensitivity?: InspectableMemorySensitivity;
}

export interface InspectableMemoryUpdate {
	readonly content?: string;
	readonly verifiedAt?: string;
	readonly confidence?: number;
	readonly sensitivity?: InspectableMemorySensitivity;
}

export interface InspectableMemoryRecord {
	readonly id: string;
	readonly kind: InspectableMemoryKind;
	readonly content: string;
	readonly source: string;
	readonly createdAt: string;
	readonly verifiedAt?: string;
	readonly confidence: number;
	readonly sensitivity: InspectableMemorySensitivity;
}

export interface InspectableMemoryPage {
	readonly data: readonly InspectableMemoryRecord[];
	readonly pagination: {
		readonly limit: number;
		readonly offset: number;
		readonly totalItems: number;
	};
}

export type InspectableMemoryAuditEvent = {
	readonly type: "memory.mutated";
	readonly operation: "created" | "updated" | "deleted";
	readonly memoryId: string;
	readonly kind?: InspectableMemoryKind;
	readonly at: string;
};

type MaybePromise<T> = T | Promise<T>;

export interface InspectableMemoryPort {
	put(
		input: InspectableMemoryInput,
		signal?: AbortSignal,
	): MaybePromise<InspectableMemoryRecord>;
	get(
		id: string,
		signal?: AbortSignal,
	): MaybePromise<InspectableMemoryRecord | undefined>;
	list(
		options: {
			readonly kind?: InspectableMemoryKind;
			readonly limit?: number;
			readonly offset?: number;
		},
		signal?: AbortSignal,
	): MaybePromise<InspectableMemoryPage>;
	update(
		id: string,
		input: InspectableMemoryUpdate,
		signal?: AbortSignal,
	): MaybePromise<InspectableMemoryRecord>;
	search(
		query: string,
		signal?: AbortSignal,
	): MaybePromise<readonly InspectableMemoryRecord[]>;
	forget(id: string, signal?: AbortSignal): MaybePromise<boolean>;
	export(signal?: AbortSignal): MaybePromise<string>;
	close?(): MaybePromise<void>;
}
