import { execFile, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { promisify } from "node:util";

import {
	AgentMeError,
	type CodingEvent,
} from "../../../packages/contracts/src/index.js";
import { PiEventAdapter } from "./event-adapter.js";
import {
	isolatePiEnvironment,
	type PiInvocation,
	piAbortCommand,
} from "./invocation.js";
import { changedFilesSince, snapshotDirtyFiles } from "./worktree-state.js";

const execFileAsync = promisify(execFile);
const MAX_JSONL_CHARS = 1_048_576;

export async function terminatePiProcessTree(processId: number): Promise<void> {
	try {
		if (process.platform === "win32") {
			await execFileAsync("taskkill", ["/PID", String(processId), "/T", "/F"], {
				windowsHide: true,
			});
		} else process.kill(-processId, "SIGTERM");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}

export async function* runPiProcess(
	runId: string,
	sessionId: string,
	invocation: PiInvocation,
	signal: AbortSignal,
): AsyncIterable<CodingEvent> {
	if (signal.aborted) {
		yield { type: "run.cancelled", runId };
		return;
	}
	const gitEnvironment = isolatedGitEnvironment();
	const before = await snapshotDirtyFiles(invocation.cwd, gitEnvironment);
	if (signal.aborted) {
		yield { type: "run.cancelled", runId };
		return;
	}
	const child = spawn(invocation.executable, [...invocation.args], {
		cwd: invocation.cwd,
		detached: process.platform !== "win32",
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
		shell: false,
		env: invocation.env ?? {},
	});
	if (!(await spawnedSuccessfully(child)) || child.pid === undefined) {
		yield { type: "run.failed", runId, error: unavailable() };
		return;
	}
	const exit = new Promise<number | null>((resolveExit) => {
		child.once("error", () => resolveExit(null));
		child.once("close", resolveExit);
	});
	child.stderr.resume();
	child.stdin.on("error", () => undefined);
	child.stdin.write(invocation.stdin ?? "");
	let termination: Promise<void> | undefined;
	let stopTimer: ReturnType<typeof setTimeout> | undefined;
	const stop = () => {
		termination ??= terminatePiProcessTree(child.pid as number).catch(
			() => undefined,
		);
		return termination;
	};
	const scheduleStop = () => {
		stopTimer ??= setTimeout(() => void stop(), 500);
	};
	const onAbort = () => {
		if (!child.stdin.destroyed)
			child.stdin.write(piAbortCommand(`${sessionId}:abort`));
		scheduleStop();
	};
	signal.addEventListener("abort", onAbort, { once: true });
	if (signal.aborted) onAbort();
	let readCompleted = false;
	try {
		const adapter = new PiEventAdapter(runId, sessionId);
		let terminalEvent: CodingEvent | undefined;
		for await (const line of boundedLines(child.stdout)) {
			if (line.trim().length === 0) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch (cause) {
				throw invalidOutput(cause);
			}
			for (const event of adapter.adapt(parsed)) {
				if (isTerminal(event)) terminalEvent = event;
				else yield event;
			}
			if (terminalEvent !== undefined) {
				child.stdin.end();
				scheduleStop();
				break;
			}
		}
		await exit;
		readCompleted = true;
		const changed = await changedFilesSince(
			invocation.cwd,
			before,
			gitEnvironment,
		);
		if (changed.length > 0)
			yield { type: "file.changed", runId, paths: changed };
		if (signal.aborted) {
			yield { type: "run.cancelled", runId };
			return;
		}
		yield terminalEvent ?? {
			type: "run.failed",
			runId,
			error: unavailable(),
		};
	} finally {
		signal.removeEventListener("abort", onAbort);
		if (stopTimer !== undefined) clearTimeout(stopTimer);
		if (!readCompleted || child.exitCode === null) await stop();
		await termination;
		await exit;
	}
}

async function* boundedLines(stdout: Readable): AsyncIterable<string> {
	stdout.setEncoding("utf8");
	let buffered = "";
	for await (const chunk of stdout) {
		buffered += String(chunk);
		let newline = buffered.indexOf("\n");
		while (newline >= 0) {
			const line = buffered.slice(0, newline).replace(/\r$/, "");
			if (line.length > MAX_JSONL_CHARS) throw invalidOutput();
			yield line;
			buffered = buffered.slice(newline + 1);
			newline = buffered.indexOf("\n");
		}
		if (buffered.length > MAX_JSONL_CHARS) throw invalidOutput();
	}
	if (buffered.length > 0) yield buffered.replace(/\r$/, "");
}

function spawnedSuccessfully(
	child: ReturnType<typeof spawn>,
): Promise<boolean> {
	return new Promise((resolve) => {
		child.once("spawn", () => resolve(true));
		child.once("error", () => resolve(false));
	});
}

function isolatedGitEnvironment(): NodeJS.ProcessEnv {
	return {
		...isolatePiEnvironment(process.env),
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
		GIT_OPTIONAL_LOCKS: "0",
	};
}

function isTerminal(event: CodingEvent): boolean {
	return ["run.completed", "run.failed", "run.cancelled"].includes(event.type);
}

function invalidOutput(cause?: unknown): AgentMeError {
	return new AgentMeError({
		code: "INVALID_CONTRACT",
		message: "Invalid Pi RPC output",
		isRetryable: false,
		cause,
	});
}

function unavailable(): AgentMeError {
	return new AgentMeError({
		code: "PROVIDER_UNAVAILABLE",
		message: "Pi runtime is unavailable",
		isRetryable: false,
	});
}
