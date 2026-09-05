export type ChildState =
	| "pending"
	| "dispatched"
	| "completed"
	| "failed"
	| "cancelled";

export interface AssistantChild {
	readonly childId: string;
	readonly parentId: string;
	readonly ordinal: number;
	readonly request: {
		readonly repositoryId: string;
		readonly runtimeId: string;
		readonly instruction: string;
		readonly acceptanceCriteria: readonly string[];
	};
	readonly state: ChildState;
	readonly workerTaskId?: string;
	readonly worktreeId?: string;
	readonly report?: {
		readonly verification?: { readonly status?: string };
		readonly [key: string]: unknown;
	};
}

export interface AssistantTree {
	readonly parent: {
		readonly parentId: string;
		readonly actorId: string;
		readonly state: "active" | "completed";
	};
	readonly children: readonly AssistantChild[];
}

export interface AssistantTreePage {
	readonly items: readonly AssistantTree[];
	readonly nextCursor?: string;
}

export interface TaskWorkerActivity {
	readonly child: AssistantChild;
	readonly task: {
		readonly taskId: string;
		readonly actorId: string;
		readonly state: string;
		readonly createdAt: string;
		readonly updatedAt: string;
	};
	readonly runtime?: { readonly id: string; readonly sessionId: string };
	readonly canContinue: boolean;
	readonly events: readonly {
		readonly id: number;
		readonly taskId: string;
		readonly event: Record<string, unknown>;
		readonly createdAt: string;
	}[];
}

export interface WorkspaceIdentity {
	readonly sessionId?: string;
	readonly parentIds: readonly string[];
}

export interface AssistantRequest {
	readonly message: string;
	readonly repositoryId: string;
	readonly runtimeId: string;
	readonly sessionId?: string;
}

export interface VoiceRequest {
	readonly audioBase64: string;
	readonly mimeType: "audio/wav" | "audio/webm" | "audio/ogg" | "audio/mp3";
	readonly route: "local" | "aliyun" | "auto";
	readonly repositoryId: string;
	readonly runtimeId: string;
	readonly sessionId?: string;
}

export interface DesktopActionSubmission {
	readonly type: "desktop-action.completed";
	readonly sessionId: string;
	readonly actionId: "open.wechat";
	readonly acknowledgement: string;
}

export interface DelegatedSubmission {
	readonly type: "supervisor.delegated";
	readonly sessionId: string;
	readonly parentId: string;
}

export type DirectAssistantResponse =
	| {
			readonly type: "assistant.responded";
			readonly responseKind: "task-status";
			readonly sessionId: string;
			readonly message: string;
	  }
	| {
			readonly type: "assistant.responded";
			readonly responseKind: "conversation";
			readonly sessionId: string;
			readonly message: string;
			readonly provider: {
				readonly id: "deepseek" | "aliyun";
				readonly model: string;
			};
	  }
	| {
			readonly type: "assistant.responded";
			readonly responseKind: "personal-dashboard";
			readonly sessionId: string;
			readonly message: string;
			readonly entries?: readonly PersonalDashboardEntry[];
	  };

export type AssistantSubmission =
	| DesktopActionSubmission
	| DelegatedSubmission
	| DirectAssistantResponse;

export type SpokenAssistantResult = AssistantSubmission & {
	readonly transcript: string;
	readonly acknowledgement: string;
	readonly voice: {
		readonly providerId: string;
		readonly fallbackUsed: boolean;
	};
	readonly speech?: {
		readonly mimeType: string;
		readonly audioBase64?: string;
	};
};

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): value is string {
	return (
		typeof value === "string" && value.length > 0 && value.length <= maximum
	);
}

function parseAssistantChild(value: unknown): AssistantChild {
	if (!isRecord(value) || !isRecord(value.request))
		throw new TypeError("Invalid assistant child");
	const request = value.request;
	if (
		!boundedString(value.childId, 200) ||
		!boundedString(value.parentId, 200) ||
		!Number.isSafeInteger(value.ordinal) ||
		(value.ordinal as number) < 0 ||
		!boundedString(request.repositoryId, 200) ||
		!boundedString(request.runtimeId, 200) ||
		!boundedString(request.instruction, 4_000) ||
		!Array.isArray(request.acceptanceCriteria) ||
		!request.acceptanceCriteria.every((item) => boundedString(item, 1_000)) ||
		!["pending", "dispatched", "completed", "failed", "cancelled"].includes(
			String(value.state),
		)
	)
		throw new TypeError("Invalid assistant child");
	return value as unknown as AssistantChild;
}

function parseAssistantTree(value: unknown): AssistantTree {
	if (
		!isRecord(value) ||
		!isRecord(value.parent) ||
		!Array.isArray(value.children)
	)
		throw new TypeError("Invalid assistant tree");
	const parent = value.parent;
	if (
		!boundedString(parent.parentId, 200) ||
		!boundedString(parent.actorId, 200) ||
		(parent.state !== "active" && parent.state !== "completed")
	)
		throw new TypeError("Invalid assistant tree");
	return {
		parent: {
			parentId: parent.parentId,
			actorId: parent.actorId,
			state: parent.state,
		},
		children: value.children.map(parseAssistantChild),
	};
}

export function parseAssistantTreePage(value: unknown): AssistantTreePage {
	if (
		!isRecord(value) ||
		!Array.isArray(value.items) ||
		value.items.length > 50 ||
		(value.nextCursor !== undefined && !boundedString(value.nextCursor, 500))
	)
		throw new TypeError("Invalid assistant task page");
	return {
		items: value.items.map(parseAssistantTree),
		...(typeof value.nextCursor === "string"
			? { nextCursor: value.nextCursor }
			: {}),
	};
}

export function parseTaskWorkerActivity(value: unknown): TaskWorkerActivity {
	if (
		!isRecord(value) ||
		!isRecord(value.task) ||
		typeof value.canContinue !== "boolean" ||
		!Array.isArray(value.events) ||
		value.events.length > 10_000
	)
		throw new TypeError("Invalid worker activity");
	const task = value.task;
	if (
		![
			task.taskId,
			task.actorId,
			task.state,
			task.createdAt,
			task.updatedAt,
		].every((item) => boundedString(item, 500)) ||
		(value.runtime !== undefined &&
			(!isRecord(value.runtime) ||
				!boundedString(value.runtime.id, 200) ||
				!boundedString(value.runtime.sessionId, 500)))
	)
		throw new TypeError("Invalid worker activity");
	const events = value.events.map((item) => {
		if (
			!isRecord(item) ||
			!Number.isSafeInteger(item.id) ||
			(item.id as number) < 1 ||
			!boundedString(item.taskId, 500) ||
			!isRecord(item.event) ||
			!boundedString(item.createdAt, 100)
		)
			throw new TypeError("Invalid worker activity");
		return item as unknown as TaskWorkerActivity["events"][number];
	});
	return {
		child: parseAssistantChild(value.child),
		task: task as unknown as TaskWorkerActivity["task"],
		...(value.runtime === undefined
			? {}
			: {
					runtime: value.runtime as unknown as NonNullable<
						TaskWorkerActivity["runtime"]
					>,
				}),
		canContinue: value.canContinue,
		events,
	};
}

export function parseAssistantSubmission(value: unknown): AssistantSubmission {
	if (
		!isRecord(value) ||
		typeof value.sessionId !== "string" ||
		!uuidPattern.test(value.sessionId)
	)
		throw new TypeError("Invalid assistant submission");
	if (
		value.type === "desktop-action.completed" &&
		value.actionId === "open.wechat" &&
		boundedString(value.acknowledgement, 500)
	)
		return {
			type: value.type,
			sessionId: value.sessionId,
			actionId: value.actionId,
			acknowledgement: value.acknowledgement,
		};
	if (
		value.type === "supervisor.delegated" &&
		typeof value.parentId === "string" &&
		uuidPattern.test(value.parentId)
	)
		return {
			type: value.type,
			sessionId: value.sessionId,
			parentId: value.parentId,
		};
	if (
		value.type === "assistant.responded" &&
		value.responseKind === "task-status" &&
		boundedString(value.message, 4_000)
	)
		return {
			type: value.type,
			responseKind: value.responseKind,
			sessionId: value.sessionId,
			message: value.message,
		};
	if (
		value.type === "assistant.responded" &&
		value.responseKind === "conversation" &&
		boundedString(value.message, 4_000) &&
		isRecord(value.provider) &&
		(value.provider.id === "deepseek" || value.provider.id === "aliyun") &&
		boundedString(value.provider.model, 128)
	)
		return {
			type: value.type,
			responseKind: value.responseKind,
			sessionId: value.sessionId,
			message: value.message,
			provider: { id: value.provider.id, model: value.provider.model },
		};
	if (
		value.type === "assistant.responded" &&
		value.responseKind === "personal-dashboard" &&
		boundedString(value.message, 4_000) &&
		(value.entries === undefined ||
			(Array.isArray(value.entries) && value.entries.length <= 512))
	) {
		try {
			return {
				type: value.type,
				responseKind: value.responseKind,
				sessionId: value.sessionId,
				message: value.message,
				...(Array.isArray(value.entries)
					? { entries: value.entries.map(parsePersonalDashboardEntry) }
					: {}),
			};
		} catch {
			throw new TypeError("Invalid assistant submission");
		}
	}
	throw new TypeError("Invalid assistant submission");
}

export function parseSpokenAssistantResult(
	value: unknown,
): SpokenAssistantResult {
	const submission = parseAssistantSubmission(value);
	if (
		!isRecord(value) ||
		!boundedString(value.transcript, 4_000) ||
		!boundedString(value.acknowledgement, 500)
	)
		throw new TypeError("Invalid spoken assistant result");
	const voice = value.voice;
	if (
		!isRecord(voice) ||
		!boundedString(voice.providerId, 100) ||
		typeof voice.fallbackUsed !== "boolean"
	)
		throw new TypeError("Invalid spoken assistant result");
	const speech = value.speech;
	if (
		speech !== undefined &&
		(!isRecord(speech) ||
			!boundedString(speech.mimeType, 100) ||
			(speech.audioBase64 !== undefined &&
				(typeof speech.audioBase64 !== "string" ||
					speech.audioBase64.length > 14 * 1024 * 1024)))
	)
		throw new TypeError("Invalid spoken assistant result");
	return {
		...submission,
		transcript: value.transcript,
		acknowledgement: value.acknowledgement,
		voice: {
			providerId: voice.providerId,
			fallbackUsed: voice.fallbackUsed,
		},
		...(speech === undefined
			? {}
			: {
					speech: {
						mimeType: speech.mimeType as string,
						...(typeof speech.audioBase64 === "string"
							? { audioBase64: speech.audioBase64 }
							: {}),
					},
				}),
	};
}

export function parseWorkspaceIdentity(raw: string | null): WorkspaceIdentity {
	if (raw === null || raw.length > 8_192) return { parentIds: [] };
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
			return { parentIds: [] };
		const value = parsed as Record<string, unknown>;
		const parentIds = Array.isArray(value.parentIds)
			? value.parentIds
					.filter(
						(item): item is string =>
							typeof item === "string" && uuidPattern.test(item),
					)
					.slice(-20)
			: [];
		return typeof value.sessionId === "string" &&
			uuidPattern.test(value.sessionId)
			? { sessionId: value.sessionId, parentIds }
			: { parentIds };
	} catch {
		return { parentIds: [] };
	}
}

export function buildAssistantRequest(
	input: AssistantRequest,
): AssistantRequest {
	const request = {
		message: input.message,
		repositoryId: input.repositoryId,
		runtimeId: input.runtimeId,
	};
	return input.sessionId === undefined
		? request
		: { ...request, sessionId: input.sessionId };
}

export function buildVoiceRequest(input: VoiceRequest): VoiceRequest {
	const request = {
		audioBase64: input.audioBase64,
		mimeType: input.mimeType,
		route: input.route,
		repositoryId: input.repositoryId,
		runtimeId: input.runtimeId,
	};
	return input.sessionId === undefined
		? request
		: { ...request, sessionId: input.sessionId };
}

export function encodePcm16Wav(
	chunks: readonly Float32Array[],
	sampleRate: number,
): Uint8Array<ArrayBuffer> {
	if (
		!Number.isInteger(sampleRate) ||
		sampleRate < 8_000 ||
		sampleRate > 192_000
	)
		throw new RangeError("Unsupported audio sample rate");
	const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
	if (sampleCount < 1 || sampleCount > sampleRate * 60)
		throw new RangeError("Unsupported audio duration");
	const bytes = new Uint8Array(44 + sampleCount * 2);
	const view = new DataView(bytes.buffer);
	const label = (offset: number, value: string): void => {
		for (let index = 0; index < value.length; index += 1)
			view.setUint8(offset + index, value.charCodeAt(index));
	};
	label(0, "RIFF");
	view.setUint32(4, bytes.length - 8, true);
	label(8, "WAVE");
	label(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	label(36, "data");
	view.setUint32(40, sampleCount * 2, true);
	let offset = 44;
	for (const chunk of chunks) {
		for (const raw of chunk) {
			const sample = Math.max(-1, Math.min(1, raw));
			view.setInt16(
				offset,
				sample < 0 ? sample * 32_768 : sample * 32_767,
				true,
			);
			offset += 2;
		}
	}
	return bytes;
}

export function summarizeTree(tree: AssistantTree): {
	readonly active: number;
	readonly completed: number;
	readonly failed: number;
	readonly total: number;
} {
	return tree.children.reduce(
		(summary, child) => {
			if (child.state === "pending" || child.state === "dispatched")
				summary.active += 1;
			if (child.state === "completed") summary.completed += 1;
			if (child.state === "failed" || child.state === "cancelled")
				summary.failed += 1;
			return summary;
		},
		{ active: 0, completed: 0, failed: 0, total: tree.children.length },
	);
}

export function taskPhase(
	child: Pick<AssistantChild, "state" | "worktreeId" | "report">,
): string {
	switch (child.state) {
		case "pending":
			return "等待调度";
		case "dispatched":
			return child.worktreeId === undefined ? "正在执行" : "正在工作树中执行";
		case "completed":
			return child.report?.verification?.status === "passed"
				? "验证通过"
				: "工作已完成";
		case "failed":
			return "执行失败";
		case "cancelled":
			return "已取消";
	}
}

import {
	type PersonalDashboardEntry,
	parsePersonalDashboardEntry,
} from "../../../packages/contracts/src/index.js";
