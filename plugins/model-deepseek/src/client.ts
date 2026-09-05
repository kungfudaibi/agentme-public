import { randomUUID } from "node:crypto";

import {
	AgentMeError,
	type AssistantEvent,
	type AssistantModel,
	type AssistantRequest,
	type AssistantUsage,
	type SecretReference,
} from "../../../packages/contracts/src/index.js";
import type { SecretStore } from "../../../packages/platform-runtime/src/index.js";

export interface DeepSeekConfig {
	readonly endpoint: string;
	readonly model: string;
	readonly secret: SecretReference;
	readonly timeoutMs: number;
}

export interface DeepSeekDependencies {
	readonly secretStore: SecretStore;
	readonly fetcher?: Fetcher;
	readonly createRunId?: () => string;
	readonly now?: () => string;
	readonly lifecycleSignal?: AbortSignal;
}

interface ParsedChunk {
	readonly content?: string;
	readonly usage?: AssistantUsage;
}

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

const MAX_DELTA_CHARACTERS = 16_000;
const MAX_MESSAGE_CHARACTERS = 64_000;
const MAX_SSE_BUFFER_CHARACTERS = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeFailure(
	message: string,
	isRetryable: boolean,
	cause?: unknown,
): AgentMeError {
	return new AgentMeError({
		code: "PROVIDER_UNAVAILABLE",
		message,
		isRetryable,
		cause,
	});
}

function parseUsage(value: unknown): AssistantUsage | undefined {
	if (value === undefined || value === null) return undefined;
	if (
		!isRecord(value) ||
		!Number.isSafeInteger(value.prompt_tokens) ||
		!Number.isSafeInteger(value.completion_tokens) ||
		(value.prompt_tokens as number) < 0 ||
		(value.completion_tokens as number) < 0
	) {
		throw safeFailure("DeepSeek returned an invalid usage record", true);
	}
	return {
		inputTokens: value.prompt_tokens as number,
		outputTokens: value.completion_tokens as number,
	};
}

function parseChunk(value: unknown): ParsedChunk {
	if (!isRecord(value) || !Array.isArray(value.choices))
		throw safeFailure("DeepSeek returned an invalid stream event", true);
	const usage = parseUsage(value.usage);
	if (value.choices.length === 0) {
		if (usage === undefined)
			throw safeFailure("DeepSeek returned an invalid stream event", true);
		return { usage };
	}
	const choice = value.choices[0];
	if (!isRecord(choice) || !isRecord(choice.delta))
		throw safeFailure("DeepSeek returned an invalid stream event", true);
	const content = choice.delta.content;
	if (content !== undefined && content !== null && typeof content !== "string")
		throw safeFailure("DeepSeek returned an invalid stream event", true);
	if (typeof content === "string" && content.length > MAX_DELTA_CHARACTERS)
		throw safeFailure("DeepSeek returned an oversized stream event", true);
	const finishReason = choice.finish_reason;
	if (
		finishReason !== undefined &&
		finishReason !== null &&
		![
			"stop",
			"length",
			"content_filter",
			"tool_calls",
			"insufficient_system_resource",
		].includes(finishReason as string)
	)
		throw safeFailure("DeepSeek returned an invalid stream event", true);
	return {
		...(typeof content === "string" && content.length > 0 ? { content } : {}),
		...(usage === undefined ? {} : { usage }),
	};
}

async function* readSse(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let dataLines: string[] = [];
	try {
		while (true) {
			const result = await reader.read();
			buffer += decoder.decode(result.value, { stream: !result.done });
			if (buffer.length > MAX_SSE_BUFFER_CHARACTERS)
				throw safeFailure("DeepSeek returned an oversized stream event", true);
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const rawLine = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
				if (line.length === 0) {
					if (dataLines.length > 0) yield dataLines.join("\n");
					dataLines = [];
				} else if (line.startsWith("data:")) {
					const data = line.slice(5);
					dataLines.push(data.startsWith(" ") ? data.slice(1) : data);
				}
				newline = buffer.indexOf("\n");
			}
			if (result.done) break;
		}
		if (buffer.length > 0) {
			const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
			if (line.startsWith("data:")) {
				const data = line.slice(5);
				dataLines.push(data.startsWith(" ") ? data.slice(1) : data);
			}
		}
		if (dataLines.length > 0) yield dataLines.join("\n");
	} finally {
		reader.releaseLock();
	}
}

function normalizeFailure(
	error: unknown,
	callerSignal: AbortSignal,
	lifecycleSignal?: AbortSignal,
): AgentMeError {
	if (callerSignal.aborted || lifecycleSignal?.aborted) {
		return new AgentMeError({
			code: "CANCELLED",
			message: "Assistant request was cancelled",
			isRetryable: false,
			cause: error,
		});
	}
	if (error instanceof AgentMeError) return error;
	return safeFailure("DeepSeek is temporarily unavailable", true, error);
}

export class DeepSeekAssistantModel implements AssistantModel {
	readonly #config: DeepSeekConfig;
	readonly #secrets: SecretStore;
	readonly #fetch: Fetcher;
	readonly #createRunId: () => string;
	readonly #now: () => string;
	readonly #lifecycleSignal: AbortSignal | undefined;

	constructor(config: DeepSeekConfig, dependencies: DeepSeekDependencies) {
		this.#config = config;
		this.#secrets = dependencies.secretStore;
		this.#fetch = dependencies.fetcher ?? fetch;
		this.#createRunId = dependencies.createRunId ?? randomUUID;
		this.#now = dependencies.now ?? (() => new Date().toISOString());
		this.#lifecycleSignal = dependencies.lifecycleSignal;
	}

	async *converse(
		request: AssistantRequest,
		callerSignal: AbortSignal,
	): AsyncIterable<AssistantEvent> {
		const runId = this.#createRunId();
		const base = { sessionId: request.sessionId, runId };
		yield {
			type: "assistant.response.started",
			...base,
			at: this.#now(),
		};
		const timeout = new AbortController();
		const timeoutHandle = setTimeout(
			() => timeout.abort(),
			this.#config.timeoutMs,
		);
		timeoutHandle.unref();
		const signals = [callerSignal, timeout.signal];
		if (this.#lifecycleSignal !== undefined)
			signals.push(this.#lifecycleSignal);
		const signal = AbortSignal.any(signals);
		try {
			const key = await this.#secrets.get(this.#config.secret, signal);
			const response = await this.#fetch(this.#config.endpoint, {
				method: "POST",
				headers: {
					authorization: `Bearer ${key}`,
					"content-type": "application/json",
					accept: "text/event-stream",
				},
				body: JSON.stringify({
					model: this.#config.model,
					messages: request.messages,
					stream: true,
					stream_options: { include_usage: true },
				}),
				signal,
			});
			if (!response.ok)
				throw safeFailure(
					`DeepSeek request failed with HTTP ${response.status}`,
					response.status === 429 || response.status >= 500,
				);
			if (!response.headers.get("content-type")?.includes("text/event-stream"))
				throw safeFailure(
					"DeepSeek returned an unexpected response type",
					true,
				);
			if (response.body === null)
				throw safeFailure("DeepSeek returned no response stream", true);

			let message = "";
			let usage: AssistantUsage | undefined;
			let completed = false;
			for await (const data of readSse(response.body)) {
				if (data === "[DONE]") {
					completed = true;
					break;
				}
				let input: unknown;
				try {
					input = JSON.parse(data);
				} catch (error) {
					throw safeFailure("DeepSeek returned invalid JSON", true, error);
				}
				const chunk = parseChunk(input);
				if (chunk.content !== undefined) {
					message += chunk.content;
					if (message.length > MAX_MESSAGE_CHARACTERS)
						throw safeFailure("DeepSeek returned an oversized message", true);
					yield {
						type: "assistant.message.delta",
						...base,
						delta: chunk.content,
						at: this.#now(),
					};
				}
				if (chunk.usage !== undefined) usage = chunk.usage;
			}
			if (!completed || message.length < 1)
				throw safeFailure("DeepSeek response ended before completion", true);
			yield {
				type: "assistant.response.completed",
				...base,
				message,
				...(usage === undefined ? {} : { usage }),
				at: this.#now(),
			};
		} catch (error) {
			yield {
				type: "assistant.response.failed",
				...base,
				error: normalizeFailure(error, callerSignal, this.#lifecycleSignal),
				at: this.#now(),
			};
		} finally {
			clearTimeout(timeoutHandle);
		}
	}
}
