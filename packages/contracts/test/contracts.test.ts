import { describe, expect, expectTypeOf, it } from "vitest";

import {
	AgentMeError,
	type CapabilityProvider,
	capabilityKinds,
	type PersonalDashboardDocument,
	type ProviderContext,
	parsePersonalDashboardDocument,
	parseTaskEvent,
	type TaskEvent,
} from "../src/index.js";

describe("capability contracts", () => {
	it("exposes the stable, vendor-neutral capability kinds", () => {
		expect(capabilityKinds).toEqual([
			"assistant.model",
			"voice.wake",
			"voice.stt",
			"voice.tts",
			"voice.realtime",
			"channel",
			"coding.runtime",
			"memory.engine",
			"execution.target",
		]);
	});

	it("describes an idempotent provider lifecycle without starting it", () => {
		const provider = {
			id: "fake-runtime",
			kind: "coding.runtime",
			version: "1.0.0",
			validate: (config: unknown) => ({ value: String(config) }),
			start: async (_context: ProviderContext, config: { value: string }) =>
				config,
			stop: async () => undefined,
			health: async () => ({ status: "healthy" as const }),
		} satisfies CapabilityProvider<{ value: string }, { value: string }>;

		expect(provider.kind).toBe("coding.runtime");
		expectTypeOf(provider.start).toBeFunction();
	});
});

describe("task event serialization", () => {
	const fixtures: TaskEvent[] = [
		{ type: "task.started", taskId: "task-1", at: "2026-08-20T08:00:00.000Z" },
		{
			type: "task.progress",
			taskId: "task-1",
			message: "Running tests",
			at: "2026-08-20T08:00:01.000Z",
		},
		{
			type: "task.completed",
			taskId: "task-1",
			report: { summary: "All tests passed" },
			at: "2026-08-20T08:00:02.000Z",
		},
		{
			type: "task.failed",
			taskId: "task-2",
			error: new AgentMeError({
				code: "PROVIDER_UNAVAILABLE",
				message: "The coding provider is unavailable",
				isRetryable: true,
			}),
			at: "2026-08-20T08:00:03.000Z",
		},
		{
			type: "task.worker.input",
			taskId: "task-1",
			turnId: "turn-2",
			message: "继续检查失败的测试",
			at: "2026-08-20T08:00:04.000Z",
		},
		{
			type: "task.worker.event",
			taskId: "task-1",
			runtimeId: "runtime-codex",
			event: {
				type: "run.started",
				runId: "turn-2",
				threadId: "thread-1",
			},
			at: "2026-08-20T08:00:05.000Z",
		},
		{
			type: "task.worker.turn.completed",
			taskId: "task-1",
			turnId: "turn-2",
			message: "检查完成",
			verification: "passed",
			at: "2026-08-20T08:00:06.000Z",
		},
	];

	it.each(fixtures)("round-trips $type through JSON", (fixture) => {
		const decoded = parseTaskEvent(JSON.parse(JSON.stringify(fixture)));

		expect(decoded).toEqual(fixture);
	});

	it("rejects malformed input at the process boundary", () => {
		expect(() =>
			parseTaskEvent({
				type: "task.progress",
				taskId: "task-1",
				message: 42,
				at: "now",
			}),
		).toThrowError(
			expect.objectContaining({
				code: "INVALID_CONTRACT",
				message: "Invalid task event",
				isRetryable: false,
			}),
		);
	});

	it("rejects report details that cannot be represented as JSON", () => {
		expect(() =>
			parseTaskEvent({
				type: "task.completed",
				taskId: "task-1",
				report: { summary: "Done", details: { callback: () => undefined } },
				at: "2026-08-20T08:00:02.000Z",
			}),
		).toThrowError(expect.objectContaining({ code: "INVALID_CONTRACT" }));
	});

	it("rejects unbounded worker activity", () => {
		expect(() =>
			parseTaskEvent({
				type: "task.worker.input",
				taskId: "task-1",
				turnId: "turn-2",
				message: "x".repeat(4_001),
				at: "2026-08-20T08:00:04.000Z",
			}),
		).toThrowError(expect.objectContaining({ code: "INVALID_CONTRACT" }));
	});

	it("rejects a completed coding event with a non-report payload", () => {
		expect(() =>
			parseTaskEvent({
				type: "task.worker.event",
				taskId: "task-1",
				runtimeId: "runtime-codex",
				event: {
					type: "run.completed",
					runId: "run-1",
					summary: "done",
					report: 7,
				},
				at: "2026-08-24T00:00:00.000Z",
			}),
		).toThrowError(expect.objectContaining({ code: "INVALID_CONTRACT" }));
	});
});

describe("public errors", () => {
	it("serializes only stable and safe public fields", () => {
		const error = new AgentMeError({
			code: "EXECUTION_FAILED",
			message: "The task could not be completed",
			isRetryable: false,
			cause: new Error("secret internal path"),
		});

		expect(JSON.parse(JSON.stringify(error))).toEqual({
			code: "EXECUTION_FAILED",
			message: "The task could not be completed",
			isRetryable: false,
		});
	});
});

describe("personal dashboard contracts", () => {
	const document: PersonalDashboardDocument = {
		schemaVersion: 1,
		purpose: "owner-personal-dashboard",
		retention: "until-owner-deletes",
		updatedAt: "2026-08-25T06:00:00.000Z",
		entries: [
			{
				type: "balance",
				id: "balance-1",
				account: "储蓄账户",
				amountMinor: 123_456,
				currency: "CNY",
				recordedAt: "2026-08-25T06:00:00.000Z",
				createdAt: "2026-08-25T06:00:00.000Z",
				updatedAt: "2026-08-25T06:00:00.000Z",
			},
			{
				type: "income",
				id: "income-1",
				category: "工资",
				amountMinor: 100_000,
				currency: "CNY",
				occurredAt: "2026-08-01T00:00:00.000Z",
				createdAt: "2026-08-25T06:00:00.000Z",
				updatedAt: "2026-08-25T06:00:00.000Z",
			},
			{
				type: "expense",
				id: "expense-1",
				category: "设备",
				amountMinor: 20_000,
				currency: "CNY",
				occurredAt: "2026-08-02T00:00:00.000Z",
				note: "开发设备",
				createdAt: "2026-08-25T06:00:00.000Z",
				updatedAt: "2026-08-25T06:00:00.000Z",
			},
			{
				type: "investment",
				id: "investment-1",
				company: "示例公司",
				amountMinor: 500_000,
				currency: "CNY",
				investedAt: "2026-01-02T00:00:00.000Z",
				status: "active",
				createdAt: "2026-08-25T06:00:00.000Z",
				updatedAt: "2026-08-25T06:00:00.000Z",
			},
			{
				type: "competition",
				id: "competition-1",
				name: "示例比赛",
				role: "队长",
				result: "一等奖",
				occurredAt: "2026-05-01T00:00:00.000Z",
				createdAt: "2026-08-25T06:00:00.000Z",
				updatedAt: "2026-08-25T06:00:00.000Z",
			},
			{
				type: "skill",
				id: "skill-1",
				name: "TypeScript",
				category: "编程",
				level: 5,
				assessedAt: "2026-08-25T00:00:00.000Z",
				evidence: "完成 AgentMe",
				createdAt: "2026-08-25T06:00:00.000Z",
				updatedAt: "2026-08-25T06:00:00.000Z",
			},
		],
	};

	it("round-trips versioned dashboard entries", () => {
		expect(
			parsePersonalDashboardDocument(JSON.parse(JSON.stringify(document))),
		).toEqual(document);
	});

	it("rejects unknown fields and invalid financial values", () => {
		expect(() =>
			parsePersonalDashboardDocument({
				...document,
				entries: [
					{
						...document.entries[1],
						amountMinor: -1,
						apiKey: "must-not-be-accepted",
					},
				],
			}),
		).toThrowError(expect.objectContaining({ code: "INVALID_CONTRACT" }));
	});
});
