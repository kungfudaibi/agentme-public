export const taskStates = [
	"received",
	"clarifying",
	"planned",
	"queued",
	"preparing_workspace",
	"running",
	"verifying",
	"awaiting_approval",
	"completed",
	"rejected",
	"cancelled",
	"failed",
	"timed_out",
] as const;

export type TaskState = (typeof taskStates)[number];

const transitions: Readonly<Record<TaskState, readonly TaskState[]>> = {
	received: ["clarifying", "planned", "rejected", "cancelled"],
	clarifying: ["planned", "rejected", "cancelled"],
	planned: ["queued", "cancelled"],
	queued: ["preparing_workspace", "cancelled"],
	preparing_workspace: ["running", "cancelled", "failed"],
	running: [
		"verifying",
		"awaiting_approval",
		"cancelled",
		"failed",
		"timed_out",
	],
	verifying: ["awaiting_approval", "completed", "failed", "timed_out"],
	awaiting_approval: [
		"running",
		"completed",
		"rejected",
		"cancelled",
		"failed",
	],
	completed: [],
	rejected: [],
	cancelled: [],
	failed: [],
	timed_out: [],
};

export function isTaskState(value: unknown): value is TaskState {
	return (
		typeof value === "string" &&
		(taskStates as readonly string[]).includes(value)
	);
}

export function canTransition(from: TaskState, to: TaskState): boolean {
	return transitions[from].includes(to);
}
