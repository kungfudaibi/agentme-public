import { execFile, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { promisify } from "node:util";

import {
	AgentMeError,
	type CodingEvent,
} from "../../../packages/contracts/src/index.js";
import { adaptClaudeEvent } from "./event-adapter.js";
import {
	type ClaudeInvocation,
	isolateClaudeEnvironment,
} from "./invocation.js";
import { changedFilesSince, snapshotDirtyFiles } from "./worktree-state.js";

const execFileAsync = promisify(execFile);
const MAX_JSONL_CHARS = 1_048_576;

export async function terminateClaudeProcessTree(
	processId: number,
): Promise<void> {
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

export async function* runClaudeProcess(
	runId: string,
	invocation: ClaudeInvocation,
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
	if (!(await spawnedSuccessfully(child))) {
		yield { type: "run.failed", runId, error: processFailure() };
		return;
	}
	if (child.pid === undefined) {
		yield { type: "run.failed", runId, error: processFailure() };
		return;
	}
	const exit = new Promise<number | null>((resolveExit, rejectExit) => {
		child.once("error", rejectExit);
		child.once("close", resolveExit);
	});
	child.stderr.resume();
	child.stdin.on("error", () => undefined);
	child.stdin.end(invocation.stdin);
	let termination: Promise<void> | undefined;
	const stop = () => {
		termination ??= terminateClaudeProcessTree(child.pid as number).catch(
			() => undefined,
		);
		return termination;
	};
	const onAbort = () => void stop();
	signal.addEventListener("abort", onAbort, { once: true });
	if (signal.aborted) onAbort();
	let readCompleted = false;
	try {
		const terminalEvent = yield* readClaudeEvents(runId, child.stdout);
		const exitCode = await exit.catch(() => null);
		readCompleted = true;
		if (signal.aborted) {
			yield { type: "run.cancelled", runId };
			return;
		}
		const changedPaths = await changedFilesSince(
			invocation.cwd,
			before,
			gitEnvironment,
		);
		if (changedPaths.length > 0)
			yield { type: "file.changed", runId, paths: changedPaths };
		if (exitCode !== 0) {
			yield terminalEvent?.type === "run.failed"
				? terminalEvent
				: { type: "run.failed", runId, error: processFailure() };
			return;
		}
		yield terminalEvent ?? {
			type: "run.failed",
			runId,
			error: invalidOutput(),
		};
	} finally {
		signal.removeEventListener("abort", onAbort);
		if (!readCompleted || signal.aborted) await stop();
		await termination;
		await exit.catch(() => null);
	}
}

async function* readClaudeEvents(
	runId: string,
	stdout: Readable,
): AsyncGenerator<CodingEvent, CodingEvent | undefined> {
	let terminalEvent: CodingEvent | undefined;
	let sawTextDelta = false;
	for await (const line of boundedLines(stdout)) {
		if (line.trim().length === 0) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (cause) {
			throw invalidOutput(cause);
		}
		const fromFinalAssistant =
			isRecord(parsed) && parsed.type === "assistant" && sawTextDelta;
		if (isTextDelta(parsed)) sawTextDelta = true;
		for (const event of adaptClaudeEvent(runId, parsed)) {
			if (fromFinalAssistant && event.type === "message.delta") continue;
			if (isTerminal(event)) {
				if (terminalEvent !== undefined) throw invalidOutput();
				terminalEvent = event;
			} else yield event;
		}
	}
	return terminalEvent;
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
		...isolateClaudeEnvironment(process.env),
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
		GIT_OPTIONAL_LOCKS: "0",
	};
}

function isTerminal(event: CodingEvent): boolean {
	return ["run.completed", "run.failed", "run.cancelled"].includes(event.type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextDelta(value: unknown): boolean {
	return (
		isRecord(value) &&
		value.type === "stream_event" &&
		isRecord(value.event) &&
		value.event.type === "content_block_delta" &&
		isRecord(value.event.delta) &&
		value.event.delta.type === "text_delta"
	);
}

function invalidOutput(cause?: unknown): AgentMeError {
	return new AgentMeError({
		code: "INVALID_CONTRACT",
		message: "Invalid Claude JSONL output",
		isRetryable: false,
		cause,
	});
}

function processFailure(): AgentMeError {
	return new AgentMeError({
		code: "EXECUTION_FAILED",
		message: "Claude process failed",
		isRetryable: false,
	});
}
