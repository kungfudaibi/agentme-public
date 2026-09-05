import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import type {
	AssistantEvent,
	AssistantRequest,
	SecretReference,
} from "../../../packages/contracts/src/index.js";
import type { SecretStore } from "../../../packages/platform-runtime/src/index.js";
import { DeepSeekAssistantModel, DeepSeekModelProvider } from "../src/index.js";

const request: AssistantRequest = {
	sessionId: "session-1",
	messages: [{ role: "user", content: "你好" }],
	allowedRepositoryIds: ["agentme"],
	allowedRuntimeIds: ["runtime-codex"],
};

function sseResponse(events: readonly string[]): Response {
	const encoder = new TextEncoder();
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const event of events) controller.enqueue(encoder.encode(event));
				controller.close();
			},
		}),
		{
			status: 200,
			headers: { "content-type": "text/event-stream" },
		},
	);
}

async function collect(source: AsyncIterable<AssistantEvent>) {
	const events: AssistantEvent[] = [];
	for await (const event of source) events.push(event);
	return events;
}

function secretStore(value = "deepseek-secret"): SecretStore {
	return {
		set: vi.fn(),
		get: vi.fn(async (_reference: SecretReference) => value),
		delete: vi.fn(),
	};
}

describe("DeepSeek assistant model", () => {
	it("resolves the API key only when a request starts and normalizes SSE", async () => {
		const secrets = secretStore();
		const fetcher = vi.fn(async (_url: string | URL, init?: RequestInit) => {
			expect(new Headers(init?.headers).get("authorization")).toBe(
				"Bearer deepseek-secret",
			);
			expect(String(init?.body)).not.toContain("deepseek-secret");
			return sseResponse([
				": keep-alive\n\n",
				'data: {"choices":[{"delta":{"content":"你"},"finish_reason":null}]}\n\n',
				'data: {"choices":[{"delta":{"content":"好"},"finish_reason":null}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
				"data: [DONE]\n\n",
			]);
		});
		const model = new DeepSeekAssistantModel(
			{
				endpoint: "https://api.deepseek.com/chat/completions",
				model: "deepseek-v4-flash",
				secret: { type: "secret-reference", id: "deepseek-api-key" },
				timeoutMs: 30_000,
			},
			{
				secretStore: secrets,
				fetcher,
				createRunId: () => "run-1",
				now: () => "2026-08-22T10:00:00.000Z",
			},
		);

		const stream = model.converse(request, new AbortController().signal);
		expect(secrets.get).not.toHaveBeenCalled();
		await expect(collect(stream)).resolves.toEqual([
			{
				type: "assistant.response.started",
				sessionId: "session-1",
				runId: "run-1",
				at: "2026-08-22T10:00:00.000Z",
			},
			{
				type: "assistant.message.delta",
				sessionId: "session-1",
				runId: "run-1",
				delta: "你",
				at: "2026-08-22T10:00:00.000Z",
			},
			{
				type: "assistant.message.delta",
				sessionId: "session-1",
				runId: "run-1",
				delta: "好",
				at: "2026-08-22T10:00:00.000Z",
			},
			{
				type: "assistant.response.completed",
				sessionId: "session-1",
				runId: "run-1",
				message: "你好",
				usage: { inputTokens: 3, outputTokens: 2 },
				at: "2026-08-22T10:00:00.000Z",
			},
		]);
		expect(secrets.get).toHaveBeenCalledOnce();
	});

	it("accepts an OpenAI-compatible terminal usage chunk", async () => {
		const fetcher = vi.fn(async (_url: string | URL, init?: RequestInit) => {
			expect(JSON.parse(String(init?.body))).toMatchObject({
				stream: true,
				stream_options: { include_usage: true },
			});
			return sseResponse([
				'data: {"choices":[{"delta":{"content":"兼容"},"finish_reason":"stop"}],"usage":null}\n\n',
				'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n',
				"data: [DONE]\n\n",
			]);
		});
		const model = new DeepSeekAssistantModel(
			{
				endpoint: "https://api.deepseek.com/chat/completions",
				model: "deepseek-v4-flash",
				secret: { type: "secret-reference", id: "deepseek-api-key" },
				timeoutMs: 30_000,
			},
			{ secretStore: secretStore(), fetcher },
		);

		const events = await collect(
			model.converse(request, new AbortController().signal),
		);

		expect(events.at(-1)).toMatchObject({
			type: "assistant.response.completed",
			message: "兼容",
			usage: { inputTokens: 4, outputTokens: 2 },
		});
	});

	it("turns malformed provider data into a safe failed event", async () => {
		const model = new DeepSeekAssistantModel(
			{
				endpoint: "https://api.deepseek.com/chat/completions",
				model: "deepseek-v4-flash",
				secret: { type: "secret-reference", id: "deepseek-api-key" },
				timeoutMs: 30_000,
			},
			{
				secretStore: secretStore("never-leak-this"),
				fetcher: vi.fn(async () =>
					sseResponse(['data: {"provider_payload":"never-leak-this"}\n\n']),
				),
				createRunId: () => "run-2",
				now: () => "2026-08-22T10:00:01.000Z",
			},
		);

		const events = await collect(
			model.converse(request, new AbortController().signal),
		);
		expect(events.at(-1)).toMatchObject({
			type: "assistant.response.failed",
			error: {
				code: "PROVIDER_UNAVAILABLE",
				isRetryable: true,
			},
		});
		expect(JSON.stringify(events)).not.toContain("never-leak-this");
	});

	it("preserves safe retry guidance without exposing an HTTP error body", async () => {
		const model = new DeepSeekAssistantModel(
			{
				endpoint: "https://api.deepseek.com/chat/completions",
				model: "deepseek-v4-flash",
				secret: { type: "secret-reference", id: "deepseek-api-key" },
				timeoutMs: 30_000,
			},
			{
				secretStore: secretStore(),
				fetcher: vi.fn(
					async () => new Response("sensitive-provider-body", { status: 401 }),
				),
			},
		);

		const events = await collect(
			model.converse(request, new AbortController().signal),
		);
		expect(events.at(-1)).toMatchObject({
			type: "assistant.response.failed",
			error: { code: "PROVIDER_UNAVAILABLE", isRetryable: false },
		});
		expect(JSON.stringify(events)).not.toContain("sensitive-provider-body");
	});

	it("rejects provider chunks that exceed the public event bounds", async () => {
		const oversized = "x".repeat(16_001);
		const model = new DeepSeekAssistantModel(
			{
				endpoint: "https://api.deepseek.com/chat/completions",
				model: "deepseek-v4-flash",
				secret: { type: "secret-reference", id: "deepseek-api-key" },
				timeoutMs: 30_000,
			},
			{
				secretStore: secretStore(),
				fetcher: vi.fn(async () =>
					sseResponse([
						`data: ${JSON.stringify({ choices: [{ delta: { content: oversized } }] })}\n\n`,
						"data: [DONE]\n\n",
					]),
				),
			},
		);

		expect(
			(await collect(model.converse(request, new AbortController().signal))).at(
				-1,
			),
		).toMatchObject({
			type: "assistant.response.failed",
			error: { code: "PROVIDER_UNAVAILABLE" },
		});
	});

	it("propagates caller cancellation to the HTTP request", async () => {
		const controller = new AbortController();
		const fetcher = vi.fn(
			async (_url: string | URL, init?: RequestInit): Promise<Response> =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				}),
		);
		const model = new DeepSeekAssistantModel(
			{
				endpoint: "https://api.deepseek.com/chat/completions",
				model: "deepseek-v4-flash",
				secret: { type: "secret-reference", id: "deepseek-api-key" },
				timeoutMs: 30_000,
			},
			{ secretStore: secretStore(), fetcher },
		);

		const collecting = collect(model.converse(request, controller.signal));
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
		controller.abort();

		expect((await collecting).at(-1)).toMatchObject({
			type: "assistant.response.failed",
			error: { code: "CANCELLED", isRetryable: false },
		});
	});

	it("aborts a request at the configured timeout", async () => {
		const fetcher = vi.fn(
			async (_url: string | URL, init?: RequestInit): Promise<Response> =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				}),
		);
		const model = new DeepSeekAssistantModel(
			{
				endpoint: "https://api.deepseek.com/chat/completions",
				model: "deepseek-v4-flash",
				secret: { type: "secret-reference", id: "deepseek-api-key" },
				timeoutMs: 20,
			},
			{ secretStore: secretStore(), fetcher },
		);

		expect(
			(await collect(model.converse(request, new AbortController().signal))).at(
				-1,
			),
		).toMatchObject({
			type: "assistant.response.failed",
			error: { code: "PROVIDER_UNAVAILABLE", isRetryable: true },
		});
	});

	it("validates configuration and declares only the assistant capability", async () => {
		const provider = new DeepSeekModelProvider({ secretStore: secretStore() });
		expect(provider.validate({})).toEqual({
			endpoint: "https://api.deepseek.com/chat/completions",
			model: "deepseek-v4-flash",
			secret: { type: "secret-reference", id: "deepseek-api-key" },
			timeoutMs: 120_000,
		});
		expect(() =>
			provider.validate({ apiKey: "must-not-be-accepted" }),
		).toThrow();
		expect(() =>
			provider.validate({
				endpoint: "https://credential-collector.example/chat/completions",
			}),
		).toThrow();
		expect(() => provider.validate({ secretId: "aliyun-api-key" })).toThrow();

		const manifest = JSON.parse(
			await readFile(
				new URL("../agentme.plugin.json", import.meta.url),
				"utf8",
			),
		) as { capabilities: string[]; permissions: string[] };
		expect(manifest.capabilities).toEqual(["assistant.model"]);
		expect(manifest.permissions).toContain("secret:deepseek-api-key");
	});
});
