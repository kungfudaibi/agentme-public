import { spawn } from "node:child_process";

import { AgentMeError } from "../../contracts/src/index.js";

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 14 * 1024 * 1024;

export interface NativeCommand {
	readonly executable: string;
	readonly args: readonly string[];
	readonly stdin?: string;
	readonly signal?: AbortSignal;
	readonly maxOutputBytes?: number;
	/** Fixed implementation text, exposed separately so command arguments stay auditable. */
	readonly script: string;
}

export interface NativeCommandResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

export interface NativeCommandRunner {
	run(command: NativeCommand): Promise<NativeCommandResult>;
}

function commandFailed(message: string, cause?: unknown): AgentMeError {
	return new AgentMeError({
		code: "PROVIDER_UNAVAILABLE",
		message,
		isRetryable: true,
		cause,
	});
}

export class SpawnNativeCommandRunner implements NativeCommandRunner {
	run(command: NativeCommand): Promise<NativeCommandResult> {
		return new Promise((resolve, reject) => {
			const maxOutputBytes = command.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
			if (
				!Number.isSafeInteger(maxOutputBytes) ||
				maxOutputBytes < 1 ||
				maxOutputBytes > MAX_OUTPUT_BYTES
			) {
				reject(commandFailed("Credential helper output limit is invalid"));
				return;
			}
			if (command.signal?.aborted) {
				reject(
					new AgentMeError({
						code: "CANCELLED",
						message: "Credential operation was cancelled",
						isRetryable: false,
					}),
				);
				return;
			}
			let stdout = "";
			let stderr = "";
			let outputBytes = 0;
			const child = spawn(command.executable, command.args, {
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
				signal: command.signal,
			});
			const collect = (target: "stdout" | "stderr", chunk: Buffer) => {
				outputBytes += chunk.byteLength;
				if (outputBytes > maxOutputBytes) {
					child.kill();
					return;
				}
				if (target === "stdout") stdout += chunk.toString("utf8");
				else stderr += chunk.toString("utf8");
			};
			child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
			child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
			child.on("error", (error) => {
				if (command.signal?.aborted) {
					reject(
						new AgentMeError({
							code: "CANCELLED",
							message: "Credential operation was cancelled",
							isRetryable: false,
							cause: error,
						}),
					);
					return;
				}
				reject(commandFailed("Credential helper could not be started", error));
			});
			child.on("close", (exitCode) => {
				if (outputBytes > maxOutputBytes) {
					reject(commandFailed("Credential helper returned too much data"));
					return;
				}
				resolve({ stdout, stderr, exitCode: exitCode ?? -1 });
			});
			child.stdin.end(command.stdin ?? "");
		});
	}
}
