import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
	isolatePiEnvironment,
	isolatePiProviderEnvironment,
} from "./invocation.js";

const execFileAsync = promisify(execFile);

export type PiHealth =
	| { readonly status: "healthy"; readonly provider: string }
	| {
			readonly status: "unhealthy";
			readonly reason: "authentication-required" | "cli-unavailable";
	  };

export interface PiHealthOptions {
	readonly executableArgs?: readonly string[];
	readonly environment?: NodeJS.ProcessEnv;
	readonly providerEnvironment?: NodeJS.ProcessEnv;
	readonly signal?: AbortSignal;
}

export async function probePiHealth(
	executable: string,
	provider: string,
	options: PiHealthOptions = {},
): Promise<PiHealth> {
	const timeout = AbortSignal.timeout(10_000);
	const signal = options.signal
		? AbortSignal.any([options.signal, timeout])
		: timeout;
	try {
		const result = await execFileAsync(
			executable,
			[
				...(options.executableArgs ?? []),
				"auth",
				"check",
				"--provider",
				provider,
				"--json",
				"--no-refresh",
			],
			{
				env: {
					...isolatePiEnvironment(options.environment ?? process.env),
					...isolatePiProviderEnvironment(options.providerEnvironment ?? {}),
				},
				windowsHide: true,
				signal,
				maxBuffer: 64 * 1024,
			},
		);
		const parsed: unknown = JSON.parse(result.stdout);
		if (!isRecord(parsed) || parsed.status !== "ready")
			return { status: "unhealthy", reason: "authentication-required" };
		return { status: "healthy", provider };
	} catch (error) {
		return {
			status: "unhealthy",
			reason:
				(error as NodeJS.ErrnoException).code === "ENOENT"
					? "cli-unavailable"
					: "authentication-required",
		};
	}
}

export function piHealth(
	environment: NodeJS.ProcessEnv = process.env,
): "healthy" | "unhealthy" {
	return environment.ANTHROPIC_API_KEY ||
		environment.OPENAI_API_KEY ||
		environment.PI_AUTH_CONFIGURED
		? "healthy"
		: "unhealthy";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
