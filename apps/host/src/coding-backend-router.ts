import { AgentMeError } from "../../../packages/contracts/src/index.js";
import type {
	TaskRunner,
	TaskRunnerContext,
} from "../../../packages/task-orchestrator/src/orchestrator.js";

export class CodingBackendRouter implements TaskRunner {
	constructor(readonly runners: ReadonlyMap<string, TaskRunner>) {}
	async execute(
		instruction: string,
		signal: AbortSignal,
		context?: TaskRunnerContext,
	) {
		const id = context?.runtimeId ?? "runtime-codex";
		const runner = this.runners.get(id);
		if (!runner)
			throw new AgentMeError({
				code: "PROVIDER_UNAVAILABLE",
				message: `编码后端未配置：${id}`,
				isRetryable: false,
			});
		return runner.execute(instruction, signal, context);
	}
}
