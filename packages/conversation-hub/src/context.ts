import type { HubData, HubTask } from "./types.js";
/** Retrieval never rewrites the durable task. Execution receives the original facts. */
export function conversationContext(
	data: HubData,
	conversationId: string,
	message: string,
	target: HubTask | undefined,
	maximum: number,
) {
	const budget = Number.isFinite(maximum)
		? Math.max(4000, Math.min(24000, maximum))
		: 10000;
	const tasks = target
		? [target]
		: data.tasks
				.filter((t) => t.conversationId === conversationId)
				.slice(-6)
				.reverse();
	const facts: unknown[] = [];
	for (const t of tasks) {
		const fact = {
			id: t.id,
			kind: t.kind,
			goal: t.goal.slice(0, 500),
			constraints: t.constraints.slice(-4).map((s) => s.slice(0, 180)),
			decisions: t.decisions.slice(-4).map((s) => s.slice(0, 180)),
			state: t.state,
			progress: t.progress.slice(0, 200),
			repositoryId: t.repositoryId,
			runtimeId: t.runtimeId,
			result: t.result?.slice(0, 500),
			evidence: t.evidence.slice(-3).map((s) => s.slice(0, 120)),
			partial: true,
		};
		if (JSON.stringify([...facts, fact]).length > budget * 0.55) break;
		facts.push(fact);
	}
	const system = `你是用户的统一个人助理。以下是从持久任务中检索的局部事实，不是完整执行指令。完整目标与约束由执行器加载。只处理当前请求，无关聊天不能替换或停止任务。不要编造执行证据。\n任务事实：${JSON.stringify(facts)}`;
	const current = message.slice(0, Math.floor(budget * 0.25));
	let remaining = budget - system.length - current.length - 900;
	const history: { role: "user" | "assistant"; content: string }[] = [];
	const recent = data.messages
		.filter(
			(m) =>
				m.conversationId === conversationId &&
				(!target || m.taskId === target.id),
		)
		.slice(0, -1)
		.slice(-4);
	for (const m of [...recent].reverse()) {
		if (remaining < 100) break;
		const content = m.content.slice(0, Math.min(1000, remaining));
		history.unshift({ role: m.role, content });
		remaining -= content.length;
	}
	return [
		{ role: "system" as const, content: system },
		...history,
		{ role: "user" as const, content: current },
	];
}
