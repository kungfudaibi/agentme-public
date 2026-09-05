import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

import {
	AgentMeError,
	type CodingEvent,
} from "../../../packages/contracts/src/index.js";
import { adaptCodexEvent } from "./event-adapter.js";
import type { CodexInvocation } from "./invocation.js";

const execFileAsync = promisify(execFile);
const MAX_STDERR_CHARS = 16_384;

export async function terminateProcessTree(processId: number): Promise<void> {
	try {
		if (process.platform === "win32") {
			await execFileAsync("taskkill", ["/PID", String(processId), "/T", "/F"], {
				windowsHide: true,
			});
		} else {
			process.kill(-processId, "SIGTERM");
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}

export async function* runCodexProcess(
	runId: string,
	invocation: CodexInvocation,
	signal: AbortSignal,
): AsyncIterable<CodingEvent> {
	const child = spawn(invocation.executable, [...invocation.args], {
		cwd: undefined,
		detached: true,
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
		shell: false,
		env: invocation.env ?? {},
	});
	if (child.pid === undefined) throw processFailure();
	const exit = new Promise<number | null>((resolveExit, reject) => {
		child.once("error", reject);
		child.once("close", resolveExit);
	});
	let stderr = "";
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => {
		stderr = `${stderr}${chunk}`.slice(-MAX_STDERR_CHARS);
	});
	child.stdin.end(invocation.stdin);
	const onAbort = () => void terminateProcessTree(child.pid as number);
	signal.addEventListener("abort", onAbort, { once: true });
	let hasTerminalEvent = false;
	try {
		const lines = createInterface({
			input: child.stdout,
			crlfDelay: Number.POSITIVE_INFINITY,
		});
		for await (const line of lines) {
			if (line.trim().length === 0) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch (cause) {
				throw new AgentMeError({
					code: "INVALID_CONTRACT",
					message: "Invalid Codex JSONL output",
					isRetryable: false,
					cause,
				});
			}
			const event = adaptCodexEvent(runId, parsed);
			if (event !== undefined) {
				hasTerminalEvent ||= [
					"run.completed",
					"run.failed",
					"run.cancelled",
				].includes(event.type);
				yield event;
			}
		}
		const exitCode = await exit;
		if (signal.aborted && !hasTerminalEvent) {
			yield { type: "run.cancelled", runId };
		} else if (exitCode !== 0 && !hasTerminalEvent) {
			yield { type: "run.failed", runId, error: processFailure(stderr) };
		}
	} finally {
		signal.removeEventListener("abort", onAbort);
		if (signal.aborted && child.exitCode === null)
			await terminateProcessTree(child.pid);
	}
}

function processFailure(cause?: unknown): AgentMeError {
	return new AgentMeError({
		code: "EXECUTION_FAILED",
		message: "Codex process failed",
		isRetryable: false,
		cause,
	});
}
