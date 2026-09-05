import {
	type OfficeAgentId,
	type OfficeSnapshot,
	type OfficeTask,
	officeAgents,
} from "../../../packages/agent-office/src/catalog.js";
import { escapeOfficeText, renderOfficeMarkdown } from "./office-markdown.js";

export type OfficePage = "home" | "tasks" | "results" | "team" | OfficeAgentId;
export const stateLabels = {
	queued: "待处理",
	running: "进行中",
	completed: "已完成",
	blocked: "待配置",
	failed: "未完成",
	cancelled: "已取消",
	interrupted: "已中断",
} as const;
export function escapeHtml(value: string): string {
	return escapeOfficeText(value);
}
export function agentAvatar(id: OfficeAgentId, small = false): string {
	const agent = officeAgents.find((item) => item.id === id);
	return `<span class="o-avatar ${agent?.color} ${small ? "small" : ""}" aria-hidden="true">${agent?.initials}</span>`;
}
export function dateLabel(value: string): string {
	return new Date(value).toLocaleString("zh-CN", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}
function taskRow(task: OfficeTask): string {
	const agent = officeAgents.find((item) => item.id === task.agentId);
	return `<button class="o-task-row" data-task="${task.id}">${agentAvatar(task.agentId, true)}<span class="o-task-description"><strong>${escapeHtml(task.instruction.slice(0, 100))}</strong><small>${agent?.name} · ${agent?.title}${task.sourceTaskId ? " · 协作交接" : ""}${task.scheduledAt ? ` · ${dateLabel(task.scheduledAt)}` : ""}</small></span><span class="o-status ${task.state}">${stateLabels[task.state]}</span><span class="o-arrow" aria-hidden="true">↗</span></button>`;
}
function empty(title: string, detail: string): string {
	return `<div class="o-empty"><span aria-hidden="true">▤</span><h3>${title}</h3><p>${detail}</p><button class="o-secondary" data-new>安排第一件事 <span aria-hidden="true">＋</span></button></div>`;
}
export function renderOfficePage(
	page: OfficePage,
	snapshot: OfficeSnapshot,
	filter: string,
	query: string,
): string {
	const { tasks } = snapshot;
	const active = tasks.filter((task) =>
		["queued", "running"].includes(task.state),
	);
	if (page === "home")
		return `<div class="o-home-intro"><p class="o-eyebrow">YOUR PERSONAL OFFICE</p><h1>把日常，交给你的团队<span>。</span></h1><p>想法、计划、琐事和重要的工作。<br>从一件事开始，让合适的助理陪你完成。</p></div><div class="o-section-heading"><h2>你的助理团队 <span>5</span></h2><button class="o-text-button" data-page="team">了解团队 <span aria-hidden="true">↗</span></button></div><div class="o-agent-strip">${officeAgents.map((agent) => `<button class="o-agent-card" data-page="${agent.id}">${agentAvatar(agent.id)}<strong>${agent.name}<small>${agent.title}</small></strong><p>${agent.description}</p><span class="o-card-action">开始对话 <span aria-hidden="true">↗</span></span></button>`).join("")}</div><div class="o-section-heading"><h2>最近的工作</h2><button class="o-text-button" data-page="tasks">全部任务 <span aria-hidden="true">→</span></button></div><div class="o-task-list">${tasks.length ? tasks.slice(0, 5).map(taskRow).join("") : empty("还没有待处理的工作", "交代一件事，或先记下一条待办。任务和成果都会留在这里。")}</div>`;
	if (page === "tasks") {
		const matches = tasks.filter(
			(task) =>
				(filter === "all" ||
					(filter === "active"
						? ["queued", "running"].includes(task.state)
						: filter === "attention"
							? ["blocked", "failed", "interrupted"].includes(task.state)
							: task.state === filter)) &&
				(!query ||
					task.instruction.toLowerCase().includes(query.toLowerCase())),
		);
		return `<div class="o-page-heading"><p class="o-eyebrow">WORK, IN ONE PLACE</p><h1>每件事，都有着落。</h1><p>${active.length} 件待推进 · ${tasks.filter((task) => task.state === "completed").length} 件已完成</p></div><div class="o-filterbar" aria-label="任务筛选">${[
			["all", "全部"],
			["active", "待推进"],
			["attention", "需要关注"],
			["completed", "已完成"],
		]
			.map(
				([value, label]) =>
					`<button data-filter="${value}" class="${filter === value ? "selected" : ""}" aria-pressed="${filter === value}">${label}</button>`,
			)
			.join(
				"",
			)}</div><div class="o-task-list">${matches.length ? matches.map(taskRow).join("") : empty("这里暂时没有任务", "可以调整筛选，或把一件新工作交给团队。")}</div>`;
	}
	if (page === "results") {
		const results = tasks.filter(
			(task) => task.state === "completed" && task.result,
		);
		return `<div class="o-page-heading"><p class="o-eyebrow">MADE FOR YOU</p><h1>留下来的，不只是对话。</h1><p>每份成果都可以继续讨论、交给另一位助理，或导出带走。</p></div><div class="o-result-grid">${results.length ? results.map((task) => `<button class="o-result-card" data-task="${task.id}"><span class="o-result-type">${agentAvatar(task.agentId, true)} 工作成果 <span>↗</span></span><h2>${escapeHtml(task.instruction.slice(0, 60))}</h2><p>${escapeHtml((task.result ?? "").slice(0, 180))}</p><small>${dateLabel(task.updatedAt)}</small></button>`).join("") : empty("第一份成果，等你开始", "向助理提出一个问题；完成后的简报、计划和分析会保存在这里。")}</div>`;
	}
	if (page === "team")
		return `<div class="o-page-heading"><p class="o-eyebrow">A SMALL TEAM, ALL YOURS</p><h1>不同所长，同一个目标。</h1><p>每位助理保留自己的工作上下文。你可以告诉他们你的偏好。</p></div><div class="o-team-list">${officeAgents.map((agent) => `<article class="o-team-member">${agentAvatar(agent.id)}<div><h2>${agent.name} <span>${agent.title}</span></h2><p>${agent.description}</p><small>${snapshot.instructions[agent.id] ? `工作偏好：${escapeHtml(snapshot.instructions[agent.id]?.slice(0, 100) ?? "")}` : "还没有设置个人工作偏好"}</small></div><button class="o-secondary" data-instructions="${agent.id}">工作偏好</button><button class="o-primary" data-page="${agent.id}">交给 ${agent.name} <span aria-hidden="true">↗</span></button></article>`).join("")}</div><div class="o-note"><strong>能力与连接</strong><p>助理可分析你提供的资料、整理计划与撰写内容。联网检索、外部日历和邮箱尚未接入。编程执行、个人账本与语音在专属工作台中使用。</p></div>`;
	const agent = officeAgents.find((item) => item.id === page);
	if (!agent) return "";
	const history = tasks
		.filter((task) => task.agentId === page)
		.slice(0, 50)
		.reverse();
	return `<div class="o-chat-heading">${agentAvatar(agent.id)}<div><h1>${agent.name}<span>${agent.title}</span></h1><p>${agent.description}</p></div><button class="o-text-button" data-instructions="${agent.id}">工作偏好</button></div>${page === "coding" ? `<div class="o-note"><p>这里讨论方案与代码。进入编程工作台后，可选择 Codex、Claude Code 或 Pi 执行。后端需在本机安装并完成登录或 API 配置；已有任务续聊沿用原后端。</p><button class="o-secondary" data-legacy="coding">打开编程工作台 ↗</button></div>` : ""}<div class="o-chat-log" role="log" aria-label="${agent.name}的工作对话">${history.length ? history.map((task) => `<article class="o-turn"><div class="o-owner-message"><span>你 · ${dateLabel(task.createdAt)}</span><p>${escapeHtml(task.instruction)}</p></div><div class="o-agent-message">${agentAvatar(agent.id, true)}<div><strong>${agent.name} <span class="o-status ${task.state}">${stateLabels[task.state]}</span></strong>${task.sourceTaskId ? `<small>从一份已完成的成果交接而来</small>` : ""}<div class="o-prose">${renderOfficeMarkdown(task.result ?? task.error ?? (task.mode === "todo" ? (task.state === "completed" ? "这条待办已完成。" : task.state === "cancelled" ? "这条待办已取消。" : "已记下这条待办，可在任务详情中标记完成。") : task.scheduledAt ? `将在 ${dateLabel(task.scheduledAt)} 运行（需保持后台开启）。` : task.state === "running" ? "正在整理，请稍候…" : task.state === "cancelled" ? "本次工作已取消。" : "已加入工作队列。"))}</div><button class="o-text-button" data-task="${task.id}">查看任务${task.result ? " · 导出 / 交接" : ""} ↗</button></div></div></article>`).join("") : `<div class="o-chat-welcome"><h2>你好，我是${agent.name}。</h2><p>${agent.description}</p><div class="o-prompt-list">${agent.prompts.map((prompt) => `<button data-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)} <span aria-hidden="true">↗</span></button>`).join("")}</div></div>`}</div>`;
}
