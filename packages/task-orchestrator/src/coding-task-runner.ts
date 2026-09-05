import {
	AgentMeError,
	type CodingRuntime,
	type TaskReport,
} from "../../contracts/src/index.js";
import type {
	RepositoryRegistry,
	WorktreeManager,
} from "../../workspace-manager/src/index.js";
import type { TaskRunner, TaskRunnerContext } from "./orchestrator.js";
import { buildTaskReport } from "./report-builder.js";
import { verifyWorkspace } from "./verifier.js";

export class VerifiedCodingTaskRunner implements TaskRunner {
	readonly #repositories: RepositoryRegistry;
	readonly #worktrees: WorktreeManager;
	readonly #runtime: CodingRuntime;
	readonly #runtimeId: string;
	constructor(
		repositories: RepositoryRegistry,
		worktrees: WorktreeManager,
		runtime: CodingRuntime,
		runtimeId: string,
	) {
		this.#repositories = repositories;
		this.#worktrees = worktrees;
		this.#runtime = runtime;
		this.#runtimeId = runtimeId;
	}
	async execute(
		instruction: string,
		signal: AbortSignal,
		context?: TaskRunnerContext,
	): Promise<TaskReport> {
		if (!context?.repositoryId)
			throw failure("A registered repository is required");
		const repository = this.#repositories.resolve(context.repositoryId);
		const workspace = await this.#worktrees.create(context.taskId, repository);
		let summary = "";
		let completed = false;
		for await (const event of this.#runtime.start(
			{
				runId: context.taskId,
				taskId: context.taskId,
				worktreePath: workspace.canonicalPath,
				instruction,
				repositoryInstructions:
					"Follow AGENTS.md and repository-local instructions. Modify only this assigned worktree.",
			},
			signal,
		)) {
			context.recordWorkerEvent?.(this.#runtimeId, event);
			if (event.type === "message.delta") summary += event.text;
			if (event.type === "run.failed") throw event.error;
			if (event.type === "run.cancelled") throw failure("Coding run cancelled");
			if (event.type === "run.completed") completed = true;
		}
		if (!completed) throw failure("Coding runtime ended without completion");
		const verification = await verifyWorkspace(
			workspace.canonicalPath,
			repository.verificationCommands,
			signal,
		);
		const report = await buildTaskReport({
			workspace,
			verification,
			runtimeSummary: summary || "Coding runtime completed",
			unresolvedRisks:
				verification.status === "passed"
					? []
					: ["One or more registered verification commands failed"],
		});
		if (verification.status !== "passed") throw failure(report.summary);
		return report;
	}
}
function failure(message: string): AgentMeError {
	return new AgentMeError({
		code: "EXECUTION_FAILED",
		message,
		isRetryable: false,
	});
}
