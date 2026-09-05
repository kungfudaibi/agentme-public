import { describe, expect, expectTypeOf, it } from "vitest";

import {
	type AssistantEvent,
	type AssistantModel,
	type AssistantRequest,
	capabilityKinds,
	parseAssistantEvent,
	parseDesktopStatus,
	parseSecretReference,
	parseSupervisorAction,
} from "../src/index.js";

describe("assistant model contracts", () => {
	it("adds an assistant model without changing existing capability ids", () => {
		expect(capabilityKinds).toContain("assistant.model");
		expect(capabilityKinds).toContain("coding.runtime");
	});

	it("describes a cancellable vendor-neutral assistant stream", () => {
		const model: AssistantModel = {
			converse: async function* () {
				yield {
					type: "assistant.message.delta" as const,
					sessionId: "session-1",
					runId: "run-1",
					delta: "正在规划",
					at: "2026-08-22T10:00:00.000Z",
				};
			},
		};
		const request: AssistantRequest = {
			sessionId: "session-1",
			messages: [
				{ role: "user", content: "修复测试并说明结果" },
				{ role: "assistant", content: "我会委派给 coding worker。" },
			],
			allowedRepositoryIds: ["agentme"],
			allowedRuntimeIds: ["runtime-codex"],
		};

		expectTypeOf(model.converse).toBeFunction();
		expect(model.converse(request, new AbortController().signal)).toBeDefined();
	});

	it("round-trips a bounded delegation action without executable fields", () => {
		const action = parseSupervisorAction(
			JSON.parse(
				JSON.stringify({
					type: "delegate.task",
					request: {
						repositoryId: "agentme",
						runtimeId: "runtime-codex",
						instruction: "修复登录回归",
						acceptanceCriteria: ["相关测试通过", "不修改源 checkout"],
					},
				}),
			),
		);

		expect(action).toEqual({
			type: "delegate.task",
			request: {
				repositoryId: "agentme",
				runtimeId: "runtime-codex",
				instruction: "修复登录回归",
				acceptanceCriteria: ["相关测试通过", "不修改源 checkout"],
			},
		});
	});

	it("rejects model output that smuggles a shell command", () => {
		expect(() =>
			parseSupervisorAction({
				type: "delegate.task",
				request: {
					repositoryId: "agentme",
					runtimeId: "runtime-codex",
					instruction: "修复测试",
					acceptanceCriteria: ["测试通过"],
					command: "dangerous-command",
				},
			}),
		).toThrowError(expect.objectContaining({ code: "INVALID_CONTRACT" }));
	});

	it("rejects unbounded or empty delegation criteria", () => {
		expect(() =>
			parseSupervisorAction({
				type: "delegate.task",
				request: {
					repositoryId: "agentme",
					runtimeId: "runtime-codex",
					instruction: "修复测试",
					acceptanceCriteria: [],
				},
			}),
		).toThrowError(expect.objectContaining({ code: "INVALID_CONTRACT" }));
	});

	it("round-trips assistant stream events through JSON", () => {
		const fixture: AssistantEvent = {
			type: "assistant.action",
			sessionId: "session-1",
			runId: "run-1",
			action: {
				type: "clarification.request",
				question: "要修改哪个仓库？",
			},
			at: "2026-08-22T10:00:01.000Z",
		};

		expect(parseAssistantEvent(JSON.parse(JSON.stringify(fixture)))).toEqual(
			fixture,
		);
	});

	it("preserves whitespace in streamed message deltas", () => {
		expect(
			parseAssistantEvent({
				type: "assistant.message.delta",
				sessionId: "session-1",
				runId: "run-1",
				delta: " 继续",
				at: "2026-08-22T10:00:02.000Z",
			}),
		).toMatchObject({ delta: " 继续" });
	});

	it("rejects unknown fields nested in provider errors", () => {
		expect(() =>
			parseAssistantEvent({
				type: "assistant.response.failed",
				sessionId: "session-1",
				runId: "run-1",
				error: {
					code: "PROVIDER_UNAVAILABLE",
					message: "Unavailable",
					isRetryable: true,
					providerPayload: "must-not-cross-the-contract",
				},
				at: "2026-08-22T10:00:03.000Z",
			}),
		).toThrowError(expect.objectContaining({ code: "INVALID_CONTRACT" }));
	});
});

describe("portable platform contracts", () => {
	it("round-trips desktop state without operating-system types", () => {
		expect(
			parseDesktopStatus({
				type: "thinking",
				taskId: "task-1",
			}),
		).toEqual({ type: "thinking", taskId: "task-1" });
	});

	it("accepts an opaque secret reference and rejects embedded material", () => {
		expect(
			parseSecretReference({
				type: "secret-reference",
				id: "deepseek-api-key",
			}),
		).toEqual({ type: "secret-reference", id: "deepseek-api-key" });
		expect(() =>
			parseSecretReference({
				type: "secret-reference",
				id: "deepseek-api-key",
				value: "must-not-cross-the-contract",
			}),
		).toThrowError(expect.objectContaining({ code: "INVALID_CONTRACT" }));
	});
});
