import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type {
	SkillEvaluationRequest,
	SkillEvaluationResult,
	SkillEvaluator,
} from "./evaluator.js";

export interface ProcessSkillEvaluatorOptions {
	readonly isolationRoot: string;
	readonly executable?: string;
	readonly timeoutMs?: number;
}

const evaluatorSource = String.raw`
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (input.length > 70000) process.exit(2);
});
process.stdin.on("end", () => {
  try {
    const request = JSON.parse(input);
    const content = request.content;
    if (typeof content !== "string") process.exit(3);
    const lines = content.split(/\r?\n/u);
    const passed = content.trim().length > 0 && content.length <= 64000 &&
      lines.length <= 2000 && lines.every((line) => line.length <= 4000);
    process.stdout.write(JSON.stringify({
      passed,
      evaluatorId: "agentme-node-isolate-v1",
      evidence: [
        "separate-node-process",
        "empty-inherited-environment",
        "proposed-content-not-executed",
        passed ? "bounded-structure-passed" : "bounded-structure-failed"
      ]
    }));
  } catch {
    process.exit(4);
  }
});
`;

export class ProcessSkillEvaluator implements SkillEvaluator {
	readonly #root: string;
	readonly #executable: string;
	readonly #timeoutMs: number;

	constructor(options: ProcessSkillEvaluatorOptions) {
		this.#root = resolve(options.isolationRoot);
		this.#executable = options.executable ?? process.execPath;
		this.#timeoutMs = options.timeoutMs ?? 5_000;
		if (
			!Number.isSafeInteger(this.#timeoutMs) ||
			this.#timeoutMs < 100 ||
			this.#timeoutMs > 60_000
		)
			throw new RangeError("Invalid skill evaluator timeout");
		mkdirSync(this.#root, { recursive: true });
	}

	async evaluate(
		request: SkillEvaluationRequest,
		signal?: AbortSignal,
	): Promise<SkillEvaluationResult> {
		if (signal?.aborted) throw signal.reason;
		const controller = new AbortController();
		const abort = () => controller.abort(signal?.reason);
		signal?.addEventListener("abort", abort, { once: true });
		const timer = setTimeout(
			() => controller.abort(new Error("Skill evaluation timed out")),
			this.#timeoutMs,
		);
		try {
			return await new Promise<SkillEvaluationResult>(
				(resolveResult, reject) => {
					const child = spawn(
						this.#executable,
						["--input-type=module", "--eval", evaluatorSource],
						{
							cwd: this.#root,
							env: {},
							stdio: ["pipe", "pipe", "pipe"],
							windowsHide: true,
							signal: controller.signal,
						},
					);
					let stdout = "";
					let stderr = "";
					let outputError: Error | undefined;
					child.stdout.setEncoding("utf8");
					child.stderr.setEncoding("utf8");
					child.stdout.on("data", (chunk: string) => {
						const result = boundedOutput(stdout, chunk);
						if (result instanceof Error) {
							outputError = result;
							child.kill();
						} else stdout = result;
					});
					child.stderr.on("data", (chunk: string) => {
						const result = boundedOutput(stderr, chunk);
						if (result instanceof Error) {
							outputError = result;
							child.kill();
						} else stderr = result;
					});
					child.once("error", reject);
					child.once("close", (code) => {
						if (outputError !== undefined) {
							reject(outputError);
							return;
						}
						if (code !== 0) {
							reject(
								new Error(
									stderr.length > 0
										? "Isolated skill evaluation failed"
										: `Isolated skill evaluation exited ${String(code)}`,
								),
							);
							return;
						}
						try {
							resolveResult(parseResult(JSON.parse(stdout)));
						} catch (error) {
							reject(error);
						}
					});
					child.stdin.end(JSON.stringify(request));
				},
			);
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
		}
	}
}

function boundedOutput(current: string, chunk: string): string | Error {
	const combined = current + chunk;
	if (combined.length > 64_000)
		return new Error("Skill evaluator output is too large");
	return combined;
}

function parseResult(value: unknown): SkillEvaluationResult {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		typeof (value as Record<string, unknown>).passed !== "boolean" ||
		(value as Record<string, unknown>).evaluatorId !==
			"agentme-node-isolate-v1" ||
		!Array.isArray((value as Record<string, unknown>).evidence) ||
		!((value as Record<string, unknown>).evidence as unknown[]).every(
			(item) => typeof item === "string" && item.length <= 500,
		)
	)
		throw new TypeError("Invalid isolated skill evaluation result");
	return value as unknown as SkillEvaluationResult;
}
