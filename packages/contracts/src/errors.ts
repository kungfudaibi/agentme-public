export const agentMeErrorCodes = [
	"INVALID_CONTRACT",
	"INVALID_PROVIDER_CONFIG",
	"INVALID_PLUGIN_MANIFEST",
	"INCOMPATIBLE_PLUGIN",
	"PLUGIN_LOAD_FAILED",
	"TASK_NOT_FOUND",
	"INVALID_TASK_TRANSITION",
	"STALE_WRITER_LEASE",
	"INVALID_REPOSITORY",
	"REPOSITORY_NOT_FOUND",
	"INVALID_WORKTREE",
	"PROVIDER_UNAVAILABLE",
	"PROVIDER_START_FAILED",
	"EXECUTION_FAILED",
	"PERMISSION_DENIED",
	"CANCELLED",
] as const;

export type AgentMeErrorCode = (typeof agentMeErrorCodes)[number];

export interface AgentMeErrorData {
	readonly code: AgentMeErrorCode;
	readonly message: string;
	readonly isRetryable: boolean;
}

export interface AgentMeErrorOptions extends AgentMeErrorData {
	readonly cause?: unknown;
}

/** An operational error whose serialized form is safe to show outside the host. */
export class AgentMeError extends Error {
	readonly code: AgentMeErrorCode;
	readonly isRetryable: boolean;

	constructor(options: AgentMeErrorOptions) {
		super(options.message, { cause: options.cause });
		this.name = "AgentMeError";
		this.code = options.code;
		this.isRetryable = options.isRetryable;
	}

	toJSON(): AgentMeErrorData {
		return {
			code: this.code,
			message: this.message,
			isRetryable: this.isRetryable,
		};
	}
}

export function isAgentMeErrorCode(value: unknown): value is AgentMeErrorCode {
	return (
		typeof value === "string" &&
		(agentMeErrorCodes as readonly string[]).includes(value)
	);
}
