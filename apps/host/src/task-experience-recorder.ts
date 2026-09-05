import { createHash } from "node:crypto";

import type {
	InspectableMemoryInput,
	InspectableMemoryPort,
	InspectableMemoryRecord,
} from "../../../packages/assistant-supervisor/src/index.js";
import type { SupervisorChild } from "../../../packages/task-orchestrator/src/index.js";

export interface TaskExperienceRecordResult {
	readonly created: boolean;
	readonly record: InspectableMemoryRecord;
}

function memoryId(parentId: string): string {
	const digest = createHash("sha256")
		.update(parentId)
		.digest("hex")
		.slice(0, 32);
	return `experience-${digest}`;
}

function redactSummary(summary: string, instruction: string): string {
	let redacted = summary;
	if (instruction.length > 0)
		redacted = redacted.replaceAll(instruction, "[任务指令已隐藏]");
	redacted = redacted
		.replaceAll(/\b(?:sk|ak)-[a-z0-9._-]{8,}/giu, "[敏感凭据已隐藏]")
		.replaceAll(/\bbearer\s+[a-z0-9._~+/=-]{8,}/giu, "Bearer [敏感凭据已隐藏]")
		.replaceAll(
			/\b(api[ _-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/giu,
			"$1=[敏感凭据已隐藏]",
		)
		.trim();
	return (redacted || "[报告内容已隐藏]").slice(0, 1_000);
}

export function buildTaskExperienceInput(
	parentId: string,
	children: readonly SupervisorChild[],
): InspectableMemoryInput {
	if (
		parentId.length < 1 ||
		parentId.length > 200 ||
		children.length < 1 ||
		children.length > 16 ||
		children.some(
			(child) => child.state !== "completed" || child.report === undefined,
		)
	)
		throw new TypeError("Invalid completed task experience");
	const reports = children.map((child, index) => {
		const summary = redactSummary(
			(child.report as { readonly summary: string }).summary,
			child.request.instruction,
		);
		return `- 子任务 ${index + 1} · 仓库 ${child.request.repositoryId} · 运行时 ${child.request.runtimeId}：${summary}`;
	});
	const content = [
		`任务 ${parentId} 已完成并通过核验。`,
		"以下经验来自已完成子 Agent 的结构化报告，原始任务指令和常见凭据已隐藏。",
		"",
		...reports,
	]
		.join("\n")
		.slice(0, 20_000);
	return {
		id: memoryId(parentId),
		kind: "experience",
		content,
		source: `task:${parentId}`,
		confidence: 0.8,
		sensitivity: "private",
	};
}

export async function recordTaskExperience(
	memory: InspectableMemoryPort,
	parentId: string,
	children: readonly SupervisorChild[],
): Promise<TaskExperienceRecordResult> {
	const input = buildTaskExperienceInput(parentId, children);
	const existing = await memory.get(input.id);
	if (existing !== undefined) return { created: false, record: existing };
	return { created: true, record: await memory.put(input) };
}
