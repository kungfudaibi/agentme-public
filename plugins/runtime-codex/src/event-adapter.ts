import {
	AgentMeError,
	type CodingEvent,
} from "../../../packages/contracts/src/index.js";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidEvent(cause?: unknown): never {
	throw new AgentMeError({
		code: "INVALID_CONTRACT",
		message: "Invalid Codex event",
		isRetryable: false,
		cause,
	});
}

export function adaptCodexEvent(
	runId: string,
	input: unknown,
): CodingEvent | undefined {
	if (!isRecord(input) || typeof input.type !== "string") return invalidEvent();
	switch (input.type) {
		case "thread.started":
			if (typeof input.thread_id !== "string") return invalidEvent();
			return { type: "run.started", runId, threadId: input.thread_id };
		case "turn.started":
			return { type: "run.progress", runId, message: "Codex turn started" };
		case "turn.completed":
			return { type: "run.completed", runId, summary: "Codex run completed" };
		case "turn.failed":
		case "error":
			return {
				type: "run.failed",
				runId,
				error: new AgentMeError({
					code: "EXECUTION_FAILED",
					message: "Codex run failed",
					isRetryable: false,
				}),
			};
		case "item.started":
		case "item.completed":
			return adaptItem(runId, input.item, input.type);
		default:
			return undefined;
	}
}

function adaptItem(
	runId: string,
	value: unknown,
	phase: "item.started" | "item.completed",
): CodingEvent | undefined {
	if (
		!isRecord(value) ||
		typeof value.type !== "string" ||
		typeof value.id !== "string"
	) {
		return invalidEvent();
	}
	switch (value.type) {
		case "agent_message":
			if (phase !== "item.completed") return undefined;
			if (typeof value.text !== "string") return invalidEvent();
			return { type: "message.delta", runId, text: value.text };
		case "command_execution":
			if (typeof value.command !== "string") return invalidEvent();
			if (phase === "item.completed") {
				if (typeof value.exit_code !== "number") return invalidEvent();
				return {
					type: "test.result",
					runId,
					command: value.command,
					exitCode: value.exit_code,
				};
			}
			return {
				type: "tool.requested",
				runId,
				toolCallId: value.id,
				tool: "shell",
				input: { command: value.command },
			};
		case "approval_request":
			if (phase !== "item.started") return undefined;
			if (typeof value.reason !== "string") return invalidEvent();
			return {
				type: "approval.required",
				runId,
				approvalId: value.id,
				reason: value.reason,
			};
		case "file_change": {
			if (phase !== "item.completed" || value.status !== "completed")
				return undefined;
			if (!Array.isArray(value.changes)) return invalidEvent();
			const paths = value.changes.map((change) =>
				isRecord(change) && typeof change.path === "string"
					? change.path
					: invalidEvent(),
			);
			return { type: "file.changed", runId, paths };
		}
		default:
			return undefined;
	}
}
