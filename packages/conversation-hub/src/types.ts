export type TaskState =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "interrupted";
export interface Conversation {
	id: string;
	title: string;
	createdAt: string;
}
export interface HubMessage {
	id: string;
	conversationId: string;
	role: "user" | "assistant";
	kind: "chat" | "task" | "result" | "notice";
	content: string;
	createdAt: string;
	taskId?: string;
}
export interface HubTask {
	id: string;
	conversationId: string;
	kind: "office" | "coding";
	goal: string;
	sources?: string[];
	constraints: string[];
	decisions: string[];
	progress: string;
	state: TaskState;
	createdAt: string;
	updatedAt: string;
	revision: number;
	result?: string;
	evidence: string[];
	executionId?: string;
	repositoryId?: string;
	runtimeId?: string;
	agentId: string;
	pending: string[];
}
export interface HubData {
	version: 1;
	conversations: Conversation[];
	messages: HubMessage[];
	tasks: HubTask[];
}
export interface ModelPolicy {
	actions: "chat-only" | "structured";
	contextCharacters: number;
}
export interface ExecutionResult {
	state: "completed" | "failed" | "cancelled";
	result: string;
	evidence: string[];
}
export interface HubDependencies {
	model?: (
		messages: readonly {
			role: "system" | "user" | "assistant";
			content: string;
		}[],
		signal: AbortSignal,
	) => Promise<string>;
	modelPolicy?: ModelPolicy;
	getModelPolicy?: () => ModelPolicy;
	execute?: (
		task: HubTask,
		signal: AbortSignal,
		link: (id: string) => void,
	) => Promise<ExecutionResult>;
	continue?: (
		task: HubTask,
		input: string,
		signal: AbortSignal,
	) => Promise<ExecutionResult>;
	validateTarget?: (repositoryId: string, runtimeId: string) => boolean;
}
export type SendMode =
	| "auto"
	| "chat"
	| "office"
	| "coding"
	| "continue"
	| "update"
	| "status"
	| "cancel";
export interface HubSend {
	conversationId: string;
	message: string;
	mode?: SendMode;
	taskId?: string;
	repositoryId?: string;
	runtimeId?: string;
	agentId?: string;
	constraints?: string[];
	sources?: string[];
}
