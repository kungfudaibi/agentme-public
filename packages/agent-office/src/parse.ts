import { isOfficeAgentId, type OfficeSnapshot } from "./catalog.js";

const taskId = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
function date(value: unknown): boolean {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}
export function parseOfficeSnapshot(value: unknown): OfficeSnapshot {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("Invalid office data");
	const state = value as OfficeSnapshot;
	if (
		state.version !== 1 ||
		!Array.isArray(state.tasks) ||
		state.tasks.length > 500 ||
		typeof state.instructions !== "object" ||
		state.instructions === null ||
		Array.isArray(state.instructions)
	)
		throw new Error("Invalid office data");
	for (const [id, instructions] of Object.entries(state.instructions))
		if (
			!isOfficeAgentId(id) ||
			typeof instructions !== "string" ||
			instructions.length > 2000
		)
			throw new Error("Invalid office instructions");
	const seen = new Set<string>();
	for (const task of state.tasks) {
		if (
			!task ||
			!isOfficeAgentId(task.agentId) ||
			typeof task.id !== "string" ||
			!taskId.test(task.id) ||
			seen.has(task.id) ||
			typeof task.instruction !== "string" ||
			!task.instruction.trim() ||
			task.instruction.length > 8000 ||
			!["todo", "assist"].includes(task.mode) ||
			![
				"queued",
				"running",
				"completed",
				"blocked",
				"failed",
				"cancelled",
				"interrupted",
			].includes(task.state) ||
			!date(task.createdAt) ||
			!date(task.updatedAt)
		)
			throw new Error("Invalid office task");
		seen.add(task.id);
		for (const text of [task.context, task.result, task.error])
			if (
				text !== undefined &&
				(typeof text !== "string" || text.length > 24000)
			)
				throw new Error("Invalid office content");
		if (task.scheduledAt !== undefined && !date(task.scheduledAt))
			throw new Error("Invalid office schedule");
		if (
			task.sourceTaskId !== undefined &&
			(typeof task.sourceTaskId !== "string" || !taskId.test(task.sourceTaskId))
		)
			throw new Error("Invalid handoff source");
	}
	return { version: 1, tasks: state.tasks, instructions: state.instructions };
}
