import {
	AgentMeError,
	type CodingEvent,
	type JsonValue,
} from "../../../packages/contracts/src/index.js";

type RecordValue = Record<string, unknown>;
const MAX_TYPE = 100;
const MAX_ID = 500;
const MAX_TEXT = 64_000;

export class PiEventAdapter {
	readonly #runId: string;
	readonly #sessionId: string;
	#summary = "";

	constructor(runId: string, sessionId: string) {
		this.#runId = runId;
		this.#sessionId = sessionId;
	}

	adapt(input: unknown): readonly CodingEvent[] {
		if (!isRecord(input) || !boundedString(input.type, MAX_TYPE))
			return invalidEvent();
		switch (input.type) {
			case "response":
				return this.#response(input);
			case "agent_start":
				return [
					{
						type: "run.started",
						runId: this.#runId,
						threadId: this.#sessionId,
					},
					{
						type: "run.progress",
						runId: this.#runId,
						message: "Pi agent started",
					},
				];
			case "message_update":
				return this.#messageUpdate(input);
			case "message_end":
				return this.#messageEnd(input);
			case "tool_execution_start":
				return this.#toolStart(input);
			case "tool_execution_end":
				return this.#toolEnd(input);
			case "agent_settled":
				return [
					{
						type: "run.completed",
						runId: this.#runId,
						summary:
							this.#summary.length === 0 ? "Pi run completed" : this.#summary,
					},
				];
			case "extension_error":
				if (input.message !== undefined && typeof input.message !== "string")
					return invalidEvent();
				return [failure(this.#runId, "EXECUTION_FAILED")];
			case "compaction_start":
			case "auto_retry_start":
			case "turn_start":
				return [
					{
						type: "run.progress",
						runId: this.#runId,
						message: `Pi ${input.type.replaceAll("_", " ")}`,
					},
				];
			default:
				return [];
		}
	}

	#response(input: RecordValue): readonly CodingEvent[] {
		if (
			!boundedString(input.command, MAX_TYPE) ||
			typeof input.success !== "boolean"
		)
			return invalidEvent();
		if (input.command !== "prompt") return [];
		return input.success
			? [
					{
						type: "run.progress",
						runId: this.#runId,
						message: "Pi prompt accepted",
					},
				]
			: [failure(this.#runId, "PROVIDER_UNAVAILABLE")];
	}

	#messageUpdate(input: RecordValue): readonly CodingEvent[] {
		if (
			!isRecord(input.assistantMessageEvent) ||
			!boundedString(input.assistantMessageEvent.type, MAX_TYPE)
		)
			return invalidEvent();
		if (input.assistantMessageEvent.type !== "text_delta") return [];
		const delta = input.assistantMessageEvent.delta;
		if (typeof delta !== "string" || delta.length > MAX_TEXT)
			return invalidEvent();
		this.#summary = `${this.#summary}${delta}`.slice(-MAX_TEXT);
		return delta.length === 0
			? []
			: [{ type: "message.delta", runId: this.#runId, text: delta }];
	}

	#messageEnd(input: RecordValue): readonly CodingEvent[] {
		if (
			!isRecord(input.message) ||
			!boundedString(input.message.role, MAX_TYPE)
		)
			return invalidEvent();
		if (input.message.role !== "assistant") return [];
		if (!boundedString(input.message.stopReason, MAX_TYPE))
			return invalidEvent();
		return ["error", "aborted"].includes(input.message.stopReason)
			? [failure(this.#runId, "EXECUTION_FAILED")]
			: [];
	}

	#toolStart(input: RecordValue): readonly CodingEvent[] {
		if (
			!boundedString(input.toolCallId, MAX_ID) ||
			!boundedString(input.toolName, MAX_TYPE) ||
			!isJsonValue(input.args) ||
			JSON.stringify(input.args).length > MAX_TEXT
		)
			return invalidEvent();
		return [
			{
				type: "tool.requested",
				runId: this.#runId,
				toolCallId: input.toolCallId,
				tool: input.toolName,
				input: input.args,
			},
		];
	}

	#toolEnd(input: RecordValue): readonly CodingEvent[] {
		if (
			!boundedString(input.toolCallId, MAX_ID) ||
			!boundedString(input.toolName, MAX_TYPE) ||
			typeof input.isError !== "boolean" ||
			!isRecord(input.result)
		)
			return invalidEvent();
		if (!["bash", "powershell"].includes(input.toolName)) return [];
		if (!isRecord(input.result.details)) return [];
		const command = input.result.details.command;
		const exitCode = input.result.details.exitCode;
		if (typeof command !== "string" || !Number.isSafeInteger(exitCode))
			return [];
		return [
			{
				type: "test.result",
				runId: this.#runId,
				command,
				exitCode: exitCode as number,
			},
		];
	}
}

function failure(
	runId: string,
	code: "EXECUTION_FAILED" | "PROVIDER_UNAVAILABLE",
): CodingEvent {
	return {
		type: "run.failed",
		runId,
		error: new AgentMeError({
			code,
			message:
				code === "PROVIDER_UNAVAILABLE"
					? "Pi provider unavailable"
					: "Pi run failed",
			isRetryable: false,
		}),
	};
}

function invalidEvent(): never {
	throw new AgentMeError({
		code: "INVALID_CONTRACT",
		message: "Invalid Pi RPC event",
		isRetryable: false,
	});
}

function boundedString(value: unknown, maximum: number): value is string {
	return (
		typeof value === "string" && value.length > 0 && value.length <= maximum
	);
}

function isRecord(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(
	value: unknown,
	seen: ReadonlySet<object> = new Set(),
	depth = 0,
): value is JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (depth >= 50 || typeof value !== "object" || seen.has(value)) return false;
	const nextSeen = new Set(seen).add(value);
	if (Array.isArray(value))
		return value.every((entry) => isJsonValue(entry, nextSeen, depth + 1));
	return (
		isRecord(value) &&
		Object.values(value).every((entry) =>
			isJsonValue(entry, nextSeen, depth + 1),
		)
	);
}
