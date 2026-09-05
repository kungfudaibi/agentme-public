import { describe, expect, it } from "vitest";

import {
	buildAssistantRequest,
	buildVoiceRequest,
	encodePcm16Wav,
	parseAssistantSubmission,
	parseAssistantTreePage,
	parseSpokenAssistantResult,
	parseTaskWorkerActivity,
	parseWorkspaceIdentity,
	summarizeTree,
	taskPhase,
} from "../ui/assistant-state.js";

describe("assistant workspace state", () => {
	it("parses a completed desktop action without requiring a parent task", () => {
		expect(
			parseAssistantSubmission({
				type: "desktop-action.completed",
				sessionId: "1ec2d6b5-985d-4b51-a5c9-cbe414df7467",
				actionId: "open.wechat",
				acknowledgement: "已打开微信。",
			}),
		).toEqual({
			type: "desktop-action.completed",
			sessionId: "1ec2d6b5-985d-4b51-a5c9-cbe414df7467",
			actionId: "open.wechat",
			acknowledgement: "已打开微信。",
		});
	});

	it("rejects malformed assistant submissions at the desktop boundary", () => {
		expect(() =>
			parseAssistantSubmission({
				type: "supervisor.delegated",
				sessionId: "not-a-session",
				parentId: "not-a-task",
			}),
		).toThrow("Invalid assistant submission");
	});

	it("parses a direct task-status answer without a parent task", () => {
		expect(
			parseAssistantSubmission({
				type: "assistant.responded",
				responseKind: "task-status",
				sessionId: "1ec2d6b5-985d-4b51-a5c9-cbe414df7467",
				message: "最近任务已完成。",
			}),
		).toEqual({
			type: "assistant.responded",
			responseKind: "task-status",
			sessionId: "1ec2d6b5-985d-4b51-a5c9-cbe414df7467",
			message: "最近任务已完成。",
		});
	});

	it("parses a provider-backed conversation answer without exposing a key", () => {
		expect(
			parseAssistantSubmission({
				type: "assistant.responded",
				responseKind: "conversation",
				sessionId: "1ec2d6b5-985d-4b51-a5c9-cbe414df7467",
				message: "我是 AgentMe。",
				provider: { id: "aliyun", model: "qwen3.7-flash" },
			}),
		).toMatchObject({
			responseKind: "conversation",
			provider: { id: "aliyun", model: "qwen3.7-flash" },
		});
	});

	it("parses an explicit personal dashboard response without provider metadata", () => {
		expect(
			parseAssistantSubmission({
				type: "assistant.responded",
				responseKind: "personal-dashboard",
				sessionId: "1ec2d6b5-985d-4b51-a5c9-cbe414df7467",
				message: "这是你明确请求的个人看板记录。",
				entries: [],
			}),
		).toMatchObject({
			responseKind: "personal-dashboard",
			entries: [],
		});
	});

	it("parses spoken desktop actions with their voice acknowledgement", () => {
		expect(
			parseSpokenAssistantResult({
				type: "desktop-action.completed",
				sessionId: "1ec2d6b5-985d-4b51-a5c9-cbe414df7467",
				actionId: "open.wechat",
				acknowledgement: "已打开微信。",
				transcript: "帮我打开微信",
				voice: { providerId: "voice-local", fallbackUsed: false },
				speech: { mimeType: "audio/wav", audioBase64: "UklGRg==" },
			}),
		).toMatchObject({
			type: "desktop-action.completed",
			transcript: "帮我打开微信",
			voice: { providerId: "voice-local", fallbackUsed: false },
		});
	});

	it("summarizes active workers and terminal outcomes", () => {
		const summary = summarizeTree({
			parent: { parentId: "parent", actorId: "owner", state: "active" },
			children: [
				{
					childId: "one",
					parentId: "parent",
					ordinal: 0,
					request: {
						repositoryId: "agentme",
						runtimeId: "runtime-codex",
						instruction: "修复测试",
						acceptanceCriteria: ["tests pass"],
					},
					state: "dispatched",
					workerTaskId: "worker-one",
				},
				{
					childId: "two",
					parentId: "parent",
					ordinal: 1,
					request: {
						repositoryId: "agentme",
						runtimeId: "runtime-codex",
						instruction: "检查文档",
						acceptanceCriteria: ["report exists"],
					},
					state: "completed",
					report: { verification: { status: "passed" } },
				},
			],
		});

		expect(summary).toEqual({ active: 1, completed: 1, failed: 0, total: 2 });
	});

	it("derives a visible phase from normalized child state", () => {
		expect(taskPhase({ state: "pending" })).toBe("等待调度");
		expect(taskPhase({ state: "dispatched", worktreeId: "wt-1" })).toBe(
			"正在工作树中执行",
		);
		expect(
			taskPhase({
				state: "completed",
				report: { verification: { status: "passed" } },
			}),
		).toBe("验证通过");
	});

	it("restores only bounded UUID task identities", () => {
		expect(
			parseWorkspaceIdentity(
				JSON.stringify({
					sessionId: "1ec2d6b5-985d-4b51-a5c9-cbe414df7467",
					parentIds: ["a2bfa966-e95a-4f43-a841-e6e208117a24", "not-a-task"],
					authToken: "must-not-survive",
				}),
			),
		).toEqual({
			sessionId: "1ec2d6b5-985d-4b51-a5c9-cbe414df7467",
			parentIds: ["a2bfa966-e95a-4f43-a841-e6e208117a24"],
		});
	});

	it("builds only the host assistant API fields", () => {
		expect(
			buildAssistantRequest({
				message: "修复失败测试",
				repositoryId: "agentme",
				runtimeId: "runtime-codex",
				sessionId: "1ec2d6b5-985d-4b51-a5c9-cbe414df7467",
			}),
		).toEqual({
			message: "修复失败测试",
			repositoryId: "agentme",
			runtimeId: "runtime-codex",
			sessionId: "1ec2d6b5-985d-4b51-a5c9-cbe414df7467",
		});
	});

	it("builds a bounded spoken request with the same task context", () => {
		expect(
			buildVoiceRequest({
				audioBase64: "UklGRg==",
				mimeType: "audio/webm",
				route: "auto",
				repositoryId: "agentme",
				runtimeId: "runtime-codex",
			}),
		).toEqual({
			audioBase64: "UklGRg==",
			mimeType: "audio/webm",
			route: "auto",
			repositoryId: "agentme",
			runtimeId: "runtime-codex",
		});
	});

	it("encodes captured mono samples as a portable PCM WAV", () => {
		const wav = encodePcm16Wav([new Float32Array([-1, 0, 0.5, 1])], 16_000);

		expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
		expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe("WAVE");
		const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
		expect(view.getUint16(22, true)).toBe(1);
		expect(view.getUint32(24, true)).toBe(16_000);
		expect(view.getUint16(34, true)).toBe(16);
		expect(view.getInt16(44, true)).toBe(-32_768);
		expect(view.getInt16(46, true)).toBe(0);
		expect(view.getInt16(48, true)).toBe(16_383);
		expect(view.getInt16(50, true)).toBe(32_767);
	});

	it("parses durable parent pages and normalized worker activity", () => {
		const child = {
			childId: "a2bfa966-e95a-4f43-a841-e6e208117a24",
			parentId: "1ec2d6b5-985d-4b51-a5c9-cbe414df7467",
			ordinal: 0,
			request: {
				repositoryId: "agentme",
				runtimeId: "runtime-codex",
				instruction: "修复测试",
				acceptanceCriteria: ["tests pass"],
			},
			state: "completed",
			workerTaskId: "worker-one",
			worktreeId: "worker-one",
		};
		const tree = {
			parent: {
				parentId: child.parentId,
				actorId: "local-owner",
				state: "completed",
			},
			children: [child],
		};

		expect(parseAssistantTreePage({ items: [tree] })).toEqual({
			items: [tree],
		});
		expect(
			parseTaskWorkerActivity({
				child,
				task: {
					taskId: "worker-one",
					actorId: "local-owner",
					state: "completed",
					createdAt: "2026-08-24T00:00:00.000Z",
					updatedAt: "2026-08-24T00:01:00.000Z",
				},
				runtime: { id: "runtime-codex", sessionId: "thread-one" },
				canContinue: true,
				events: [
					{
						id: 1,
						taskId: "worker-one",
						event: { type: "task.started", taskId: "worker-one" },
						createdAt: "2026-08-24T00:00:00.000Z",
					},
				],
			}),
		).toMatchObject({
			canContinue: true,
			runtime: { sessionId: "thread-one" },
		});
	});
});
