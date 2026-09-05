import { randomUUID } from "node:crypto";

import {
	AgentMeError,
	type CodingEvent,
	type CodingRunRequest,
	type CodingRuntime,
	type CodingRuntimeCapabilities,
} from "../../../packages/contracts/src/index.js";
import {
	buildCodexInvocation,
	buildCodexResumeInvocation,
	type CodexExecutionPolicy,
	type CodexInvocation,
	safeUnattendedCodexPolicy,
} from "./invocation.js";
import { runCodexProcess } from "./process-controller.js";

export interface CodexRuntimeConfig {
	readonly executable: string;
	readonly model?: string;
	readonly windowsSandbox?: "elevated" | "unelevated";
	readonly resourceDirectory?: string;
	readonly executionPolicy?: CodexExecutionPolicy;
}

export class CodexCliRuntime implements CodingRuntime {
	readonly #config: CodexRuntimeConfig;
	readonly #active = new Map<string, AbortController>();
	readonly #threadWorktrees = new Map<string, string>();
	#executionPolicy: CodexExecutionPolicy;

	constructor(config: CodexRuntimeConfig) {
		this.#config = config;
		this.#executionPolicy = config.executionPolicy ?? safeUnattendedCodexPolicy;
	}

	setExecutionPolicy(policy: CodexExecutionPolicy): void {
		if (this.#active.size > 0)
			throw new AgentMeError({
				code: "INVALID_TASK_TRANSITION",
				message: "Coding permissions cannot change while Codex is running",
				isRetryable: true,
			});
		this.#executionPolicy = { ...policy };
	}

	getExecutionPolicy(): CodexExecutionPolicy {
		return { ...this.#executionPolicy };
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
		const invocation = buildCodexInvocation({
			executable: this.#config.executable,
			worktreePath: request.worktreePath,
			prompt,
			executionPolicy: this.#executionPolicy,
			...(this.#config.model === undefined
				? {}
				: { model: this.#config.model }),
			...(this.#config.windowsSandbox === undefined
				? {}
				: { windowsSandbox: this.#config.windowsSandbox }),
			...(this.#config.resourceDirectory === undefined
				? {}
				: { resourceDirectory: this.#config.resourceDirectory }),
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
		const invocation = buildCodexResumeInvocation({
			executable: this.#config.executable,
			worktreePath,
			prompt: input,
			threadId,
			executionPolicy: this.#executionPolicy,
			...(this.#config.model === undefined
				? {}
				: { model: this.#config.model }),
			...(this.#config.windowsSandbox === undefined
				? {}
				: { windowsSandbox: this.#config.windowsSandbox }),
			...(this.#config.resourceDirectory === undefined
				? {}
				: { resourceDirectory: this.#config.resourceDirectory }),
		});
		yield* this.#run(runId, worktreePath, invocation, signal);
	}

	async cancel(runId: string): Promise<void> {
		this.#active.get(runId)?.abort();
	}

	async capabilities(): Promise<CodingRuntimeCapabilities> {
		return {
			canResume: true,
			canRequestApproval: this.#executionPolicy.approvalPolicy !== "never",
			canStreamFileChanges: true,
		};
	}

	async *#run(
		runId: string,
		worktreePath: string,
		invocation: CodexInvocation,
		externalSignal: AbortSignal,
	): AsyncIterable<CodingEvent> {
		if (this.#active.has(runId)) throw runtimeUnavailable();
		const controller = new AbortController();
		this.#active.set(runId, controller);
		const signal = AbortSignal.any([externalSignal, controller.signal]);
		try {
			for await (const event of runCodexProcess(runId, invocation, signal)) {
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
		message: "Codex runtime is unavailable",
		isRetryable: false,
	});
}
