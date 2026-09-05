import { AgentMeError, isAgentMeErrorCode } from "./errors.js";

export interface DelegatedTaskInput {
	readonly repositoryId: string;
	readonly runtimeId: string;
	readonly instruction: string;
	readonly acceptanceCriteria: readonly string[];
}

export type SupervisorAction =
	| { readonly type: "delegate.task"; readonly request: DelegatedTaskInput }
	| { readonly type: "task.cancel"; readonly taskId: string }
	| { readonly type: "clarification.request"; readonly question: string }
	| { readonly type: "user.reply"; readonly message: string };

export interface AssistantMessage {
	readonly role: "system" | "user" | "assistant";
	readonly content: string;
}

export interface AssistantRequest {
	readonly sessionId: string;
	readonly messages: readonly AssistantMessage[];
	readonly allowedRepositoryIds: readonly string[];
	readonly allowedRuntimeIds: readonly string[];
}

export interface AssistantUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
}

interface AssistantEventBase {
	readonly sessionId: string;
	readonly runId: string;
	readonly at: string;
}

export type AssistantEvent =
	| (AssistantEventBase & { readonly type: "assistant.response.started" })
	| (AssistantEventBase & {
			readonly type: "assistant.message.delta";
			readonly delta: string;
	  })
	| (AssistantEventBase & {
			readonly type: "assistant.action";
			readonly action: SupervisorAction;
	  })
	| (AssistantEventBase & {
			readonly type: "assistant.response.completed";
			readonly message: string;
			readonly usage?: AssistantUsage;
	  })
	| (AssistantEventBase & {
			readonly type: "assistant.response.failed";
			readonly error: AgentMeError;
	  });

export interface AssistantModel {
	converse(
		request: AssistantRequest,
		signal: AbortSignal,
	): AsyncIterable<AssistantEvent>;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
	const allowed = new Set(keys);
	return Object.keys(value).every((key) => allowed.has(key));
}

function boundedText(value: unknown, maximum: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = value.trim();
	return text.length > 0 && text.length <= maximum ? text : undefined;
}

function boundedDelta(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 && value.length <= 16_000
		? value
		: undefined;
}

function identifier(value: unknown): string | undefined {
	const text = boundedText(value, 128);
	return text && /^[a-z0-9][a-z0-9._-]*$/i.test(text) ? text : undefined;
}

function invalidContract(message: string): never {
	throw new AgentMeError({
		code: "INVALID_CONTRACT",
		message,
		isRetryable: false,
	});
}

export function parseSupervisorAction(input: unknown): SupervisorAction {
	if (!isRecord(input) || typeof input.type !== "string")
		return invalidContract("Invalid supervisor action");
	switch (input.type) {
		case "delegate.task": {
			if (
				!hasOnlyKeys(input, ["type", "request"]) ||
				!isRecord(input.request) ||
				!hasOnlyKeys(input.request, [
					"repositoryId",
					"runtimeId",
					"instruction",
					"acceptanceCriteria",
				])
			)
				return invalidContract("Invalid delegation request");
			const repositoryId = identifier(input.request.repositoryId);
			const runtimeId = identifier(input.request.runtimeId);
			const instruction = boundedText(input.request.instruction, 4_000);
			const criteria = input.request.acceptanceCriteria;
			if (
				!repositoryId ||
				!runtimeId ||
				!instruction ||
				!Array.isArray(criteria) ||
				criteria.length < 1 ||
				criteria.length > 16
			)
				return invalidContract("Invalid delegation request");
			const acceptanceCriteria = criteria.map((criterion) =>
				boundedText(criterion, 500),
			);
			if (acceptanceCriteria.some((criterion) => criterion === undefined))
				return invalidContract("Invalid delegation request");
			return {
				type: input.type,
				request: {
					repositoryId,
					runtimeId,
					instruction,
					acceptanceCriteria: acceptanceCriteria as string[],
				},
			};
		}
		case "task.cancel": {
			const taskId = identifier(input.taskId);
			if (!hasOnlyKeys(input, ["type", "taskId"]) || !taskId)
				return invalidContract("Invalid cancellation action");
			return { type: input.type, taskId };
		}
		case "clarification.request": {
			const question = boundedText(input.question, 1_000);
			if (!hasOnlyKeys(input, ["type", "question"]) || !question)
				return invalidContract("Invalid clarification action");
			return { type: input.type, question };
		}
		case "user.reply": {
			const message = boundedText(input.message, 4_000);
			if (!hasOnlyKeys(input, ["type", "message"]) || !message)
				return invalidContract("Invalid reply action");
			return { type: input.type, message };
		}
		default:
			return invalidContract("Invalid supervisor action");
	}
}

export function parseAssistantEvent(input: unknown): AssistantEvent {
	if (!isRecord(input) || typeof input.type !== "string")
		return invalidContract("Invalid assistant event");
	const sessionId = identifier(input.sessionId);
	const runId = identifier(input.runId);
	const at = boundedText(input.at, 64);
	if (!sessionId || !runId || !at)
		return invalidContract("Invalid assistant event");
	const base = { sessionId, runId, at };
	switch (input.type) {
		case "assistant.response.started":
			if (!hasOnlyKeys(input, ["type", "sessionId", "runId", "at"]))
				return invalidContract("Invalid assistant event");
			return { type: input.type, ...base };
		case "assistant.message.delta": {
			const delta = boundedDelta(input.delta);
			if (
				!hasOnlyKeys(input, ["type", "sessionId", "runId", "delta", "at"]) ||
				!delta
			)
				return invalidContract("Invalid assistant event");
			return { type: input.type, ...base, delta };
		}
		case "assistant.action":
			if (!hasOnlyKeys(input, ["type", "sessionId", "runId", "action", "at"]))
				return invalidContract("Invalid assistant event");
			return {
				type: input.type,
				...base,
				action: parseSupervisorAction(input.action),
			};
		case "assistant.response.completed": {
			const message = boundedText(input.message, 64_000);
			if (
				!hasOnlyKeys(input, [
					"type",
					"sessionId",
					"runId",
					"message",
					"usage",
					"at",
				]) ||
				!message
			)
				return invalidContract("Invalid assistant event");
			if (input.usage === undefined)
				return { type: input.type, ...base, message };
			if (
				!isRecord(input.usage) ||
				!hasOnlyKeys(input.usage, ["inputTokens", "outputTokens"]) ||
				!Number.isSafeInteger(input.usage.inputTokens) ||
				!Number.isSafeInteger(input.usage.outputTokens) ||
				(input.usage.inputTokens as number) < 0 ||
				(input.usage.outputTokens as number) < 0
			)
				return invalidContract("Invalid assistant usage");
			return {
				type: input.type,
				...base,
				message,
				usage: {
					inputTokens: input.usage.inputTokens as number,
					outputTokens: input.usage.outputTokens as number,
				},
			};
		}
		case "assistant.response.failed":
			if (
				!hasOnlyKeys(input, ["type", "sessionId", "runId", "error", "at"]) ||
				!isRecord(input.error) ||
				!hasOnlyKeys(input.error, ["code", "message", "isRetryable"]) ||
				!isAgentMeErrorCode(input.error.code) ||
				typeof input.error.message !== "string" ||
				typeof input.error.isRetryable !== "boolean"
			)
				return invalidContract("Invalid assistant event");
			return {
				type: input.type,
				...base,
				error: new AgentMeError({
					code: input.error.code,
					message: input.error.message,
					isRetryable: input.error.isRetryable,
				}),
			};
		default:
			return invalidContract("Invalid assistant event");
	}
}
