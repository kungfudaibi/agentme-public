import {
	isCodingTaskRequest,
	isTaskStatusQuestion,
	summarizeRecentTasks,
} from "../../../packages/assistant-supervisor/src/index.js";
import type { AssistantMessage } from "../../../packages/contracts/src/index.js";
import type {
	SupervisorChild,
	SupervisorParent,
} from "../../../packages/task-orchestrator/src/index.js";
import type {
	AssistantProviderProfileId,
	AssistantProviderService,
} from "./assistant-provider-manager.js";

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
				readonly id: AssistantProviderProfileId;
				readonly model: string;
			};
	  };

export interface AssistantMessageResponseInput {
	readonly sessionId: string;
	readonly message: string;
	readonly messages: readonly AssistantMessage[];
	readonly allowedRepositoryIds: readonly string[];
	readonly allowedRuntimeIds: readonly string[];
}

export interface AssistantMessageResponseDependencies {
	readonly providers?: AssistantProviderService;
	readonly recentParentIds: () => readonly string[];
	readonly refreshTask: (parentId: string) => Promise<{
		readonly parent: SupervisorParent;
		readonly children: readonly SupervisorChild[];
	}>;
}

export async function tryRespondToAssistantMessage(
	input: AssistantMessageResponseInput,
	dependencies: AssistantMessageResponseDependencies,
	signal: AbortSignal,
): Promise<DirectAssistantResponse | undefined> {
	if (isTaskStatusQuestion(input.message)) {
		const trees = [];
		for (const parentId of dependencies.recentParentIds()) {
			if (signal.aborted) throw signal.reason;
			const refreshed = await dependencies.refreshTask(parentId);
			trees.push({
				parent: refreshed.parent,
				children: refreshed.children.map((child) => ({
					state: child.state,
					instruction: child.request.instruction,
				})),
			});
		}
		return {
			type: "assistant.responded",
			responseKind: "task-status",
			sessionId: input.sessionId,
			message: summarizeRecentTasks(trees),
		};
	}
	if (
		dependencies.providers === undefined ||
		isCodingTaskRequest(input.message)
	)
		return undefined;
	const response = await dependencies.providers.respond(
		{
			sessionId: input.sessionId,
			messages: [
				{
					role: "system",
					content:
						"你是 AgentMe 主调度助手。简洁、诚实地回答；不要声称执行了尚未由工具或任务记录证实的操作。",
				},
				...input.messages,
			],
			allowedRepositoryIds: input.allowedRepositoryIds,
			allowedRuntimeIds: input.allowedRuntimeIds,
		},
		signal,
	);
	return {
		type: "assistant.responded",
		responseKind: "conversation",
		sessionId: input.sessionId,
		message: response.message,
		provider: response.provider,
	};
}
