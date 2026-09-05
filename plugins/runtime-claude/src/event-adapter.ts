import {
	AgentMeError,
	type CodingEvent,
	type JsonValue,
} from "../../../packages/contracts/src/index.js";

type RecordValue = Record<string, unknown>;
const MAX_EVENT_TYPE_CHARS = 100;
const MAX_ID_CHARS = 500;
const MAX_TEXT_CHARS = 64_000;
const MAX_TOOL_INPUT_CHARS = 64_000;
const MAX_CONTENT_BLOCKS = 1_000;

export function adaptClaudeEvent(
	runId: string,
	input: unknown,
): readonly CodingEvent[] {
	if (!isRecord(input) || !boundedString(input.type, MAX_EVENT_TYPE_CHARS))
		return invalidEvent();
	switch (input.type) {
		case "system":
			return adaptSystem(runId, input);
		case "assistant":
			return adaptAssistant(runId, input);
		case "stream_event":
			return adaptStreamEvent(runId, input);
		case "result":
			return adaptResult(runId, input);
		case "user":
			return [];
		default:
			return [];
	}
}

function adaptSystem(
	runId: string,
	input: RecordValue,
): readonly CodingEvent[] {
	if (input.subtype === "init") {
		if (!boundedString(input.session_id, MAX_ID_CHARS)) return invalidEvent();
		return [{ type: "run.started", runId, threadId: input.session_id }];
	}
	if (!boundedString(input.subtype, MAX_EVENT_TYPE_CHARS))
		return invalidEvent();
	return [
		{
			type: "run.progress",
			runId,
			message: `Claude ${input.subtype.replaceAll("_", " ")}`,
		},
	];
}

function adaptAssistant(
	runId: string,
	input: RecordValue,
): readonly CodingEvent[] {
	if (
		!isRecord(input.message) ||
		!Array.isArray(input.message.content) ||
		input.message.content.length > MAX_CONTENT_BLOCKS
	)
		return invalidEvent();
	const events: CodingEvent[] = [];
	for (const content of input.message.content) {
		if (
			!isRecord(content) ||
			!boundedString(content.type, MAX_EVENT_TYPE_CHARS)
		)
			return invalidEvent();
		if (content.type === "text") {
			if (
				typeof content.text !== "string" ||
				content.text.length > MAX_TEXT_CHARS
			)
				return invalidEvent();
			if (content.text.length > 0)
				events.push({ type: "message.delta", runId, text: content.text });
		} else if (content.type === "tool_use") {
			if (
				!boundedString(content.id, MAX_ID_CHARS) ||
				!boundedString(content.name, MAX_EVENT_TYPE_CHARS) ||
				!isJsonValue(content.input) ||
				JSON.stringify(content.input).length > MAX_TOOL_INPUT_CHARS
			)
				return invalidEvent();
			events.push({
				type: "tool.requested",
				runId,
				toolCallId: content.id,
				tool: content.name,
				input: content.input,
			});
		}
	}
	return events;
}

function adaptStreamEvent(
	runId: string,
	input: RecordValue,
): readonly CodingEvent[] {
	if (
		!isRecord(input.event) ||
		!boundedString(input.event.type, MAX_EVENT_TYPE_CHARS)
	)
		return invalidEvent();
	if (input.event.type !== "content_block_delta") return [];
	if (
		!isRecord(input.event.delta) ||
		!boundedString(input.event.delta.type, MAX_EVENT_TYPE_CHARS)
	)
		return invalidEvent();
	if (input.event.delta.type !== "text_delta") return [];
	if (
		typeof input.event.delta.text !== "string" ||
		input.event.delta.text.length > MAX_TEXT_CHARS
	)
		return invalidEvent();
	return input.event.delta.text.length === 0
		? []
		: [{ type: "message.delta", runId, text: input.event.delta.text }];
}

function adaptResult(
	runId: string,
	input: RecordValue,
): readonly CodingEvent[] {
	if (
		!boundedString(input.subtype, MAX_EVENT_TYPE_CHARS) ||
		typeof input.is_error !== "boolean" ||
		typeof input.result !== "string" ||
		input.result.length > MAX_TEXT_CHARS
	)
		return invalidEvent();
	if (!input.is_error && input.subtype === "success") {
		return [
			{
				type: "run.completed",
				runId,
				summary:
					input.result.length === 0 ? "Claude run completed" : input.result,
			},
		];
	}
	return [
		{
			type: "run.failed",
			runId,
			error: executionFailure(),
		},
	];
}

function executionFailure(): AgentMeError {
	return new AgentMeError({
		code: "EXECUTION_FAILED",
		message: "Claude run failed",
		isRetryable: false,
	});
}

function invalidEvent(cause?: unknown): never {
	throw new AgentMeError({
		code: "INVALID_CONTRACT",
		message: "Invalid Claude event",
		isRetryable: false,
		cause,
	});
}

function isRecord(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): value is string {
	return (
		typeof value === "string" && value.length > 0 && value.length <= maximum
	);
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
