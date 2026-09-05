import { type CodingEvent, parseCodingEvent } from "./coding.js";
import { AgentMeError, isAgentMeErrorCode } from "./errors.js";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
	| JsonPrimitive
	| { readonly [key: string]: JsonValue }
	| readonly JsonValue[];

export interface TaskReport {
	readonly summary: string;
	readonly details?: JsonValue;
}

export type TaskEvent =
	| {
			readonly type: "task.started";
			readonly taskId: string;
			readonly at: string;
	  }
	| {
			readonly type: "task.progress";
			readonly taskId: string;
			readonly message: string;
			readonly at: string;
	  }
	| {
			readonly type: "task.completed";
			readonly taskId: string;
			readonly report: TaskReport;
			readonly at: string;
	  }
	| {
			readonly type: "task.failed";
			readonly taskId: string;
			readonly error: AgentMeError;
			readonly at: string;
	  }
	| {
			readonly type: "task.worker.input";
			readonly taskId: string;
			readonly turnId: string;
			readonly message: string;
			readonly at: string;
	  }
	| {
			readonly type: "task.worker.event";
			readonly taskId: string;
			readonly runtimeId: string;
			readonly event: CodingEvent;
			readonly at: string;
	  }
	| {
			readonly type: "task.worker.turn.completed";
			readonly taskId: string;
			readonly turnId: string;
			readonly message: string;
			readonly verification: "passed" | "failed" | "cancelled";
			readonly at: string;
	  }
	| {
			readonly type: "task.worker.turn.failed";
			readonly taskId: string;
			readonly turnId: string;
			readonly error: AgentMeError;
			readonly at: string;
	  };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(value: UnknownRecord, key: string): boolean {
	return typeof value[key] === "string";
}

function boundedString(value: unknown, maximum: number): value is string {
	return (
		typeof value === "string" && value.length > 0 && value.length <= maximum
	);
}

function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	if (!isRecord(value)) return false;
	return Object.values(value).every(isJsonValue);
}

function invalidTaskEvent(): never {
	throw new AgentMeError({
		code: "INVALID_CONTRACT",
		message: "Invalid task event",
		isRetryable: false,
	});
}

/** Validates an event received from a plugin, worker, channel, or persisted JSON record. */
export function parseTaskEvent(input: unknown): TaskEvent {
	if (
		!isRecord(input) ||
		!hasString(input, "type") ||
		!hasString(input, "taskId") ||
		!hasString(input, "at")
	) {
		return invalidTaskEvent();
	}

	const base = { taskId: input.taskId as string, at: input.at as string };
	switch (input.type) {
		case "task.started":
			return { type: input.type, ...base };
		case "task.progress":
			if (!hasString(input, "message")) return invalidTaskEvent();
			return { type: input.type, ...base, message: input.message as string };
		case "task.completed": {
			if (!isRecord(input.report) || !hasString(input.report, "summary"))
				return invalidTaskEvent();
			if (
				input.report.details !== undefined &&
				!isJsonValue(input.report.details)
			) {
				return invalidTaskEvent();
			}
			const report: TaskReport =
				input.report.details === undefined
					? { summary: input.report.summary as string }
					: {
							summary: input.report.summary as string,
							details: input.report.details as JsonValue,
						};
			return { type: input.type, ...base, report };
		}
		case "task.failed": {
			if (
				!isRecord(input.error) ||
				!isAgentMeErrorCode(input.error.code) ||
				!hasString(input.error, "message") ||
				typeof input.error.isRetryable !== "boolean"
			) {
				return invalidTaskEvent();
			}
			return {
				type: input.type,
				...base,
				error: new AgentMeError({
					code: input.error.code,
					message: input.error.message as string,
					isRetryable: input.error.isRetryable,
				}),
			};
		}
		case "task.worker.input":
			if (
				!boundedString(input.turnId, 500) ||
				!boundedString(input.message, 4_000)
			)
				return invalidTaskEvent();
			return {
				type: input.type,
				...base,
				turnId: input.turnId,
				message: input.message,
			};
		case "task.worker.event":
			if (!boundedString(input.runtimeId, 200)) return invalidTaskEvent();
			return {
				type: input.type,
				...base,
				runtimeId: input.runtimeId,
				event: parseCodingEvent(input.event),
			};
		case "task.worker.turn.completed":
			if (
				!boundedString(input.turnId, 500) ||
				!boundedString(input.message, 64_000) ||
				!(["passed", "failed", "cancelled"] as const).includes(
					input.verification as "passed",
				)
			)
				return invalidTaskEvent();
			return {
				type: input.type,
				...base,
				turnId: input.turnId,
				message: input.message,
				verification: input.verification as "passed" | "failed" | "cancelled",
			};
		case "task.worker.turn.failed":
			if (
				!boundedString(input.turnId, 500) ||
				!isRecord(input.error) ||
				!isAgentMeErrorCode(input.error.code) ||
				!boundedString(input.error.message, 4_000) ||
				typeof input.error.isRetryable !== "boolean"
			)
				return invalidTaskEvent();
			return {
				type: input.type,
				...base,
				turnId: input.turnId,
				error: new AgentMeError({
					code: input.error.code,
					message: input.error.message,
					isRetryable: input.error.isRetryable,
				}),
			};
		default:
			return invalidTaskEvent();
	}
}
