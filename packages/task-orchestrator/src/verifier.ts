import { spawn } from "node:child_process";

import type { VerificationCommand } from "../../workspace-manager/src/index.js";

export interface VerificationResult {
	readonly executable: string;
	readonly args: readonly string[];
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

export interface VerificationSummary {
	readonly status: "passed" | "failed" | "cancelled";
	readonly results: readonly VerificationResult[];
}

export async function verifyWorkspace(
	worktreePath: string,
	commands: readonly VerificationCommand[],
	signal: AbortSignal,
): Promise<VerificationSummary> {
	const results: VerificationResult[] = [];
	for (const command of commands) {
		if (signal.aborted) return { status: "cancelled", results };
		const result = await runVerificationCommand(worktreePath, command, signal);
		results.push(result);
		if (result.exitCode !== 0) return { status: "failed", results };
	}
	return { status: signal.aborted ? "cancelled" : "passed", results };
}

async function runVerificationCommand(
	cwd: string,
	command: VerificationCommand,
	signal: AbortSignal,
): Promise<VerificationResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command.executable, [...command.args], {
			cwd,
			shell: false,
			windowsHide: true,
			signal,
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			stdout = bounded(stdout + chunk);
		});
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
			stderr = bounded(stderr + chunk);
		});
		child.once("error", (error) => {
			if (signal.aborted) {
				resolve({ ...command, exitCode: -1, stdout, stderr: "Cancelled" });
				return;
			}
			reject(error);
		});
		child.once("close", (code) =>
			resolve({ ...command, exitCode: code ?? -1, stdout, stderr }),
		);
	});
}

function bounded(value: string): string {
	return value.slice(-64 * 1024);
}
