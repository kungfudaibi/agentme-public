import type { AgentMeError } from "./errors.js";
import {
	isAgentMeErrorCode,
	AgentMeError as PublicAgentMeError,
} from "./errors.js";
import type { JsonValue, TaskReport } from "./events.js";

export interface CodingRunRequest {
	readonly runId: string;
	readonly taskId: string;
	readonly worktreePath: string;
	readonly instruction: string;
	readonly repositoryInstructions?: string;
}

export type CodingEvent =
	| {
			readonly type: "run.started";
			readonly runId: string;
			readonly threadId: string;
	  }
	| {
			readonly type: "run.progress";
			readonly runId: string;
			readonly message: string;
	  }
	| {
			readonly type: "message.delta";
			readonly runId: string;
			readonly text: string;
	  }
	| {
			readonly type: "tool.requested";
			readonly runId: string;
			readonly toolCallId: string;
			readonly tool: string;
			readonly input: JsonValue;
	  }
	| {
			readonly type: "approval.required";
			readonly runId: string;
			readonly approvalId: string;
			readonly reason: string;
	  }
	| {
			readonly type: "file.changed";
			readonly runId: string;
			readonly paths: readonly string[];
	  }
	| {
			readonly type: "test.result";
			readonly runId: string;
			readonly command: string;
			readonly exitCode: number;
	  }
	| {
			readonly type: "run.completed";
			readonly runId: string;
			readonly summary: string;
			readonly report?: TaskReport;
	  }
	| {
			readonly type: "run.failed";
			readonly runId: string;
			readonly error: AgentMeError;
	  }
	| { readonly type: "run.cancelled"; readonly runId: string };

export interface CodingRuntimeCapabilities {
	readonly canResume: boolean;
	readonly canRequestApproval: boolean;
	readonly canStreamFileChanges: boolean;
}

export interface CodingRuntime {
	start(
		request: CodingRunRequest,
		signal: AbortSignal,
	): AsyncIterable<CodingEvent>;
	resume(
		threadId: string,
		input: string,
		signal: AbortSignal,
	): AsyncIterable<CodingEvent>;
	cancel(runId: string): Promise<void>;
	capabilities(): Promise<CodingRuntimeCapabilities>;
}

function invalidCodingEvent(): never {
	throw new PublicAgentMeError({
		code: "INVALID_CONTRACT",
		message: "Invalid coding event",
		isRetryable: false,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
	return isRecord(value) && Object.values(value).every(isJsonValue);
}

export function parseCodingEvent(input: unknown): CodingEvent {
	if (
		!isRecord(input) ||
		!boundedString(input.type, 100) ||
		!boundedString(input.runId, 500)
	)
		return invalidCodingEvent();
	const runId = input.runId;
	switch (input.type) {
		case "run.started":
			if (!boundedString(input.threadId, 500)) return invalidCodingEvent();
			return { type: input.type, runId, threadId: input.threadId };
		case "run.progress":
			if (!boundedString(input.message, 16_000)) return invalidCodingEvent();
			return { type: input.type, runId, message: input.message };
		case "message.delta":
			if (!boundedString(input.text, 64_000)) return invalidCodingEvent();
			return { type: input.type, runId, text: input.text };
		case "tool.requested":
			if (
				!boundedString(input.toolCallId, 500) ||
				!boundedString(input.tool, 100) ||
				!isJsonValue(input.input) ||
				JSON.stringify(input.input).length > 64_000
			)
				return invalidCodingEvent();
			return {
				type: input.type,
				runId,
				toolCallId: input.toolCallId,
				tool: input.tool,
				input: input.input,
			};
		case "approval.required":
			if (
				!boundedString(input.approvalId, 500) ||
				!boundedString(input.reason, 4_000)
			)
				return invalidCodingEvent();
			return {
				type: input.type,
				runId,
				approvalId: input.approvalId,
				reason: input.reason,
			};
		case "file.changed":
			if (
				!Array.isArray(input.paths) ||
				input.paths.length > 1_000 ||
				input.paths.some((path) => !boundedString(path, 4_000))
			)
				return invalidCodingEvent();
			return { type: input.type, runId, paths: input.paths as string[] };
		case "test.result":
			if (
				!boundedString(input.command, 16_000) ||
				!Number.isSafeInteger(input.exitCode)
			)
				return invalidCodingEvent();
			return {
				type: input.type,
				runId,
				command: input.command,
				exitCode: input.exitCode as number,
			};
		case "run.completed":
			if (!boundedString(input.summary, 64_000)) return invalidCodingEvent();
			if (
				input.report !== undefined &&
				(!isRecord(input.report) ||
					!boundedString(input.report.summary, 64_000) ||
					(input.report.details !== undefined &&
						!isJsonValue(input.report.details)) ||
					JSON.stringify(input.report).length > 64_000)
			)
				return invalidCodingEvent();
			return {
				type: input.type,
				runId,
				summary: input.summary,
				...(input.report === undefined
					? {}
					: { report: input.report as unknown as TaskReport }),
			};
		case "run.failed":
			if (
				!isRecord(input.error) ||
				!isAgentMeErrorCode(input.error.code) ||
				!boundedString(input.error.message, 4_000) ||
				typeof input.error.isRetryable !== "boolean"
			)
				return invalidCodingEvent();
			return {
				type: input.type,
				runId,
				error: new PublicAgentMeError({
					code: input.error.code,
					message: input.error.message,
					isRetryable: input.error.isRetryable,
				}),
			};
		case "run.cancelled":
			return { type: input.type, runId };
		default:
			return invalidCodingEvent();
	}
}
