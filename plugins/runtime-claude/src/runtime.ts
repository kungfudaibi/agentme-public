import { randomUUID } from "node:crypto";

import {
	AgentMeError,
	type CodingEvent,
	type CodingRunRequest,
	type CodingRuntime,
	type CodingRuntimeCapabilities,
} from "../../../packages/contracts/src/index.js";
import { type ClaudeHealth, probeClaudeHealth } from "./health.js";
import {
	buildClaudeInvocation,
	buildClaudeResumeInvocation,
	type ClaudeInvocation,
	type ClaudeInvocationInput,
	type ClaudePermissionMode,
} from "./invocation.js";
import { runClaudeProcess } from "./process-controller.js";

export interface ClaudeRuntimeConfig {
	readonly executable: string;
	readonly model?: string;
	readonly permissionMode?: ClaudePermissionMode;
	readonly maxBudgetUsd?: number;
	readonly hostEnvironment?: NodeJS.ProcessEnv;
	readonly extraArgs?: readonly string[];
}

export class ClaudeCliRuntime implements CodingRuntime {
	readonly #config: ClaudeRuntimeConfig;
	readonly #active = new Map<string, AbortController>();
	readonly #threadWorktrees = new Map<string, string>();

	constructor(config: ClaudeRuntimeConfig) {
		this.#config = config;
	}

	async *start(
		request: CodingRunRequest,
		signal: AbortSignal,
	): AsyncIterable<CodingEvent> {
		const prompt = [
			`Task: ${request.instruction}`,
			request.repositoryInstructions === undefined
				? "Follow the repository instructions in the assigned worktree."
				: `Repository instructions:\n${request.repositoryInstructions}`,
		].join("\n\n");
		const invocation = buildClaudeInvocation({
			executable: this.#config.executable,
			worktreePath: request.worktreePath,
			prompt,
			...this.#invocationOptions(),
		});
		yield* this.#run(request.runId, request.worktreePath, invocation, signal);
	}

	async *resume(
		threadId: string,
		input: string,
		signal: AbortSignal,
	): AsyncIterable<CodingEvent> {
		const worktreePath = this.#threadWorktrees.get(threadId);
		if (worktreePath === undefined) throw runtimeUnavailable();
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
		const invocation = buildClaudeResumeInvocation({
			executable: this.#config.executable,
			worktreePath,
			prompt: input,
			threadId,
			...this.#invocationOptions(),
		});
		yield* this.#run(runId, worktreePath, invocation, signal);
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

	async health(signal?: AbortSignal): Promise<ClaudeHealth> {
		return probeClaudeHealth(this.#config.executable, {
			...(this.#config.extraArgs === undefined
				? {}
				: { extraArgs: this.#config.extraArgs }),
			...(this.#config.hostEnvironment === undefined
				? {}
				: { environment: this.#config.hostEnvironment }),
			...(signal === undefined ? {} : { signal }),
		});
	}

	#invocationOptions(): Omit<
		ClaudeInvocationInput,
		"executable" | "worktreePath" | "prompt"
	> {
		return {
			...(this.#config.model === undefined
				? {}
				: { model: this.#config.model }),
			...(this.#config.permissionMode === undefined
				? {}
				: { permissionMode: this.#config.permissionMode }),
			...(this.#config.maxBudgetUsd === undefined
				? {}
				: { maxBudgetUsd: this.#config.maxBudgetUsd }),
			...(this.#config.hostEnvironment === undefined
				? {}
				: { hostEnvironment: this.#config.hostEnvironment }),
			...(this.#config.extraArgs === undefined
				? {}
				: { extraArgs: this.#config.extraArgs }),
		};
	}

	async *#run(
		runId: string,
		worktreePath: string,
		invocation: ClaudeInvocation,
		externalSignal: AbortSignal,
	): AsyncIterable<CodingEvent> {
		if (this.#active.has(runId)) throw runtimeUnavailable();
		const controller = new AbortController();
		this.#active.set(runId, controller);
		const signal = AbortSignal.any([externalSignal, controller.signal]);
		try {
			for await (const event of runClaudeProcess(runId, invocation, signal)) {
				if (event.type === "run.started")
					this.#threadWorktrees.set(event.threadId, worktreePath);
				yield event;
			}
		} finally {
			this.#active.delete(runId);
		}
	}
}

function runtimeUnavailable(): AgentMeError {
	return new AgentMeError({
		code: "PROVIDER_UNAVAILABLE",
		message: "Claude runtime is unavailable",
		isRetryable: false,
	});
}
