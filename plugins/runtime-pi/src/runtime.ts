import { randomUUID } from "node:crypto";

import {
	AgentMeError,
	type CodingEvent,
	type CodingRunRequest,
	type CodingRuntime,
	type CodingRuntimeCapabilities,
} from "../../../packages/contracts/src/index.js";
import { type PiHealth, probePiHealth } from "./health.js";
import {
	buildPiInvocation,
	type PiInvocation,
	type PiPermissionProfile,
} from "./invocation.js";
import { runPiProcess } from "./process-controller.js";

export interface PiRuntimeConfig {
	readonly executable: string;
	readonly sessionDirectory: string;
	readonly provider?: string;
	readonly model?: string;
	readonly permissionProfile?: PiPermissionProfile;
	readonly hostEnvironment?: NodeJS.ProcessEnv;
	readonly executableArgs?: readonly string[];
	readonly policyExtensionPath?: string;
	readonly credentialResolver?: PiCredentialResolver;
}

export type PiCredentialResolver = (
	signal: AbortSignal,
) => Promise<NodeJS.ProcessEnv>;

export class PiRpcRuntime implements CodingRuntime {
	readonly #config: PiRuntimeConfig;
	readonly #active = new Map<string, AbortController>();
	readonly #threadWorktrees = new Map<string, string>();

	constructor(config: PiRuntimeConfig) {
		this.#config = config;
	}

	async *start(
		request: CodingRunRequest,
		signal: AbortSignal,
	): AsyncIterable<CodingEvent> {
		const sessionId = randomUUID();
		const prompt = [
			`Task: ${request.instruction}`,
			request.repositoryInstructions === undefined
				? "Follow the repository instructions supplied by AgentMe."
				: `Repository instructions:\n${request.repositoryInstructions}`,
		].join("\n\n");
		this.#threadWorktrees.set(sessionId, request.worktreePath);
		yield* this.#run(
			request.runId,
			sessionId,
			await this.#invocation(sessionId, request.worktreePath, prompt, signal),
			signal,
		);
	}

	async *resume(
		threadId: string,
		input: string,
		signal: AbortSignal,
	): AsyncIterable<CodingEvent> {
		const worktreePath = this.#threadWorktrees.get(threadId);
		if (worktreePath === undefined) throw unavailable();
		yield* this.resumeInWorktree(
			threadId,
			worktreePath,
			input,
			randomUUID(),
			signal,
		);
	}

	async *resumeInWorktree(
		threadId: string,
		worktreePath: string,
		input: string,
		runId: string,
		signal: AbortSignal,
	): AsyncIterable<CodingEvent> {
		this.#threadWorktrees.set(threadId, worktreePath);
		yield* this.#run(
			runId,
			threadId,
			await this.#invocation(threadId, worktreePath, input, signal),
			signal,
		);
	}

	async cancel(runId: string): Promise<void> {
		this.#active.get(runId)?.abort();
	}

	async capabilities(): Promise<CodingRuntimeCapabilities> {
		return {
			canResume: true,
			canRequestApproval: false,
			canStreamFileChanges: true,
		};
	}

	async health(signal?: AbortSignal): Promise<PiHealth> {
		const providerEnvironment = await this.#config.credentialResolver?.(
			signal ?? new AbortController().signal,
		);
		return probePiHealth(
			this.#config.executable,
			this.#config.provider ?? "google",
			{
				...(this.#config.executableArgs === undefined
					? {}
					: { executableArgs: this.#config.executableArgs }),
				...(this.#config.hostEnvironment === undefined
					? {}
					: { environment: this.#config.hostEnvironment }),
				...(signal === undefined ? {} : { signal }),
				...(providerEnvironment === undefined ? {} : { providerEnvironment }),
			},
		);
	}

	async #invocation(
		sessionId: string,
		worktreePath: string,
		prompt: string,
		signal: AbortSignal,
	): Promise<PiInvocation> {
		const providerEnvironment = await this.#config.credentialResolver?.(signal);
		return buildPiInvocation({
			executable: this.#config.executable,
			worktreePath,
			sessionDirectory: this.#config.sessionDirectory,
			sessionId,
			prompt,
			...(this.#config.policyExtensionPath === undefined
				? {}
				: { policyExtensionPath: this.#config.policyExtensionPath }),
			...(this.#config.provider === undefined
				? {}
				: { provider: this.#config.provider }),
			...(this.#config.model === undefined
				? {}
				: { model: this.#config.model }),
			...(this.#config.permissionProfile === undefined
				? {}
				: { permissionProfile: this.#config.permissionProfile }),
			...(this.#config.hostEnvironment === undefined
				? {}
				: { hostEnvironment: this.#config.hostEnvironment }),
			...(this.#config.executableArgs === undefined
				? {}
				: { executableArgs: this.#config.executableArgs }),
			...(providerEnvironment === undefined ? {} : { providerEnvironment }),
		});
	}

	async *#run(
		runId: string,
		sessionId: string,
		invocation: PiInvocation,
		externalSignal: AbortSignal,
	): AsyncIterable<CodingEvent> {
		if (this.#active.has(runId)) throw unavailable();
		const controller = new AbortController();
		this.#active.set(runId, controller);
		try {
			yield* runPiProcess(
				runId,
				sessionId,
				invocation,
				AbortSignal.any([externalSignal, controller.signal]),
			);
		} finally {
			this.#active.delete(runId);
		}
	}
}

function unavailable(): AgentMeError {
	return new AgentMeError({
		code: "PROVIDER_UNAVAILABLE",
		message: "Pi runtime is unavailable",
		isRetryable: false,
	});
}
