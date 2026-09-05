import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { AgentMeError } from "../../contracts/src/index.js";

const execFileAsync = promisify(execFile);

export function invalidWorktree(cause?: unknown): AgentMeError {
	return new AgentMeError({
		code: "INVALID_WORKTREE",
		message: "Task worktree could not be created",
		isRetryable: false,
		cause,
	});
}

export async function addWorktree(
	repositoryPath: string,
	worktreePath: string,
	branch: string,
	baseRevision: string,
): Promise<void> {
	try {
		await execFileAsync(
			"git",
			[
				"worktree",
				"add",
				"--no-track",
				"-b",
				branch,
				worktreePath,
				baseRevision,
			],
			{ cwd: repositoryPath, windowsHide: true },
		);
	} catch (error) {
		throw invalidWorktree(error);
	}
}
