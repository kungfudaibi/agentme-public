export interface TaskWorkspace {
	readonly taskId: string;
	readonly repositoryId: string;
	readonly canonicalPath: string;
	readonly branch: string;
	readonly baseRevision: string;
}

export interface RetainedWorkspaceReport {
	readonly taskId: string;
	readonly disposition: "retained";
	readonly reason: "cancelled" | "failed" | "review";
	readonly path: string;
	readonly branch: string;
}
