import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { isolateClaudeEnvironment } from "./invocation.js";

const execFileAsync = promisify(execFile);

export type ClaudeHealth =
	| { readonly status: "healthy"; readonly authentication: string }
	| {
			readonly status: "unhealthy";
			readonly reason: "authentication-required" | "cli-unavailable";
	  };

export interface ClaudeHealthOptions {
	readonly extraArgs?: readonly string[];
	readonly environment?: NodeJS.ProcessEnv;
	readonly signal?: AbortSignal;
}

export async function probeClaudeHealth(
	executable: string,
	options: ClaudeHealthOptions = {},
): Promise<ClaudeHealth> {
	const timeout = AbortSignal.timeout(10_000);
	const signal = options.signal
		? AbortSignal.any([options.signal, timeout])
		: timeout;
	try {
		const result = await execFileAsync(
			executable,
			[...(options.extraArgs ?? []), "auth", "status", "--json"],
			{
				env: isolateClaudeEnvironment(options.environment ?? process.env),
				windowsHide: true,
				signal,
				maxBuffer: 64 * 1024,
			},
		);
		const parsed: unknown = JSON.parse(result.stdout);
		if (!isRecord(parsed) || parsed.loggedIn !== true) {
			return { status: "unhealthy", reason: "authentication-required" };
		}
		return {
			status: "healthy",
			authentication:
				typeof parsed.authMethod === "string"
					? parsed.authMethod
					: "configured",
		};
	} catch (error) {
		return {
			status: "unhealthy",
			reason: isMissingExecutable(error)
				? "cli-unavailable"
				: "authentication-required",
		};
	}
}

export function claudeHealth(
	environment: NodeJS.ProcessEnv = process.env,
): "healthy" | "unhealthy" {
	return environment.ANTHROPIC_API_KEY || environment.CLAUDE_CODE_OAUTH_TOKEN
		? "healthy"
		: "unhealthy";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingExecutable(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}
