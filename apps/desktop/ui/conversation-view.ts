import type { HubTask } from "../../../packages/conversation-hub/src/types.js";
import { escapeOfficeText as escapeText } from "./office-markdown.js";
export const taskStateLabels = {
	queued: "排队中",
	running: "正在处理",
	completed: "已完成",
	failed: "需要处理",
	cancelled: "已停止",
	interrupted: "已中断",
};
export function renderConversationTask(task: HubTask): string {
	const field = (label: string, values: string[]) =>
		values.length
			? `<h4>${label}</h4><ul>${values.map((v) => `<li>${escapeText(v)}</li>`).join("")}</ul>`
			: "";
	return `<details class="c-task" data-detail="${escapeText(task.id)}"><summary><span class="c-task-icon">${task.kind === "coding" ? "⌘" : "✳"}</span><span><strong>${escapeText(task.goal.slice(0, 90))}</strong><small>${escapeText(task.progress)}</small></span><span class="c-status ${task.state}">${taskStateLabels[task.state]}</span></summary><div class="c-task-body"><p>${escapeText(task.goal)}</p>${field("约束", task.constraints)}${field("已确认的调整", task.decisions)}${field("执行证据", task.evidence)}${field("项目与后端", [task.repositoryId ?? "", task.runtimeId ?? "", task.executionId ?? ""].filter(Boolean))}${field("执行后待处理", task.pending)}<div class="c-task-actions"><button type="button" data-task="${escapeText(task.id)}" data-mode="continue">继续这项任务</button><button type="button" data-task="${escapeText(task.id)}" data-mode="update">调整要求</button><button type="button" data-task="${escapeText(task.id)}" data-mode="status">查看进度</button>${["running", "queued"].includes(task.state) ? `<button type="button" data-task="${escapeText(task.id)}" data-mode="cancel">停止任务</button>` : ""}<button type="button" data-export="${escapeText(task.id)}">导出成果</button></div></div></details>`;
}
