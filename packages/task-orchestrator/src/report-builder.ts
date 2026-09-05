import { spawn } from "node:child_process";

import type { TaskReport } from "../../contracts/src/index.js";
import type { TaskWorkspace } from "../../workspace-manager/src/index.js";
import type { VerificationSummary } from "./verifier.js";

export interface BuildReportInput {
	readonly workspace: TaskWorkspace;
	readonly verification: VerificationSummary;
	readonly runtimeSummary: string;
	readonly unresolvedRisks?: readonly string[];
}

export async function buildTaskReport(
	input: BuildReportInput,
): Promise<TaskReport> {
	const changedFiles = await gitChangedFiles(input.workspace.canonicalPath);
	const passed = input.verification.status === "passed";
	return {
		summary: passed ? "Task changes verified" : "Task verification failed",
		details: {
			status: input.verification.status,
			runtimeSummary: input.runtimeSummary,
			worktree: input.workspace.canonicalPath,
			branch: input.workspace.branch,
			baseRevision: input.workspace.baseRevision,
			changedFiles,
			commands: input.verification.results.map((result) => ({
				executable: result.executable,
				args: result.args,
				exitCode: result.exitCode,
			})),
			unresolvedRisks: input.unresolvedRisks ?? [],
		},
	};
}

async function gitChangedFiles(cwd: string): Promise<readonly string[]> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", ["status", "--porcelain=v1", "-z"], {
			cwd,
			shell: false,
			windowsHide: true,
		});
		let output = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			output += chunk;
		});
		child.once("error", reject);
		child.once("close", (code) => {
			if (code !== 0) return reject(new Error("Unable to inspect Git changes"));
			resolve(
				output
					.split("\0")
					.filter(Boolean)
					.map((entry) => entry.slice(3)),
			);
		});
	});
}
