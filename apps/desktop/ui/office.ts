import {
	isOfficeAgentId,
	type OfficeAgentId,
	type OfficeSnapshot,
	type OfficeTask,
	officeAgents,
} from "../../../packages/agent-office/src/catalog.js";
import { parseOfficeSnapshot } from "../../../packages/agent-office/src/parse.js";
import { officeRequest } from "./office-connection.js";
import { renderOfficeMarkdown } from "./office-markdown.js";
import {
	agentAvatar,
	dateLabel,
	escapeHtml,
	type OfficePage,
	renderOfficePage,
	stateLabels,
} from "./office-view.js";

interface OfficeView extends OfficeSnapshot {
	readonly model: { name: string; model: string; ready: boolean };
}
const root = document.createElement("div");
root.id = "agent-office";
document.body.prepend(root);
document.body.classList.add("office-active");
let state: OfficeView = {
	version: 1,
	tasks: [],
	instructions: {},
	model: { name: "正在连接", model: "", ready: false },
};
let page: OfficePage = "home";
let filter = "all";
let query = "";
let selectedTaskId: string | undefined;
let loaded = false;
let busy = false;
let disposed = false;
const drafts = new Map<OfficeAgentId, string>();
let draftAgent: OfficeAgentId = "coordinator";
const nav = (id: string, label: string, icon: string) =>
	`<button data-page="${id}" class="o-nav-button"><span aria-hidden="true">${icon}</span>${label}${id === "tasks" ? '<small id="o-task-count">0</small>' : ""}</button>`;
root.innerHTML = `<aside class="o-sidebar"><a class="o-brand" href="#" data-page="home" aria-label="AgentMe 个人助理工作台"><span class="o-brand-symbol" aria-hidden="true">a<span>m</span></span><strong>AgentMe<small>你的个人助理团队</small></strong></a><button class="o-new" data-new><span aria-hidden="true">＋</span> 安排一件事 <kbd>N</kbd></button><nav aria-label="工作空间">${nav("home", "工作台", "▦")}${nav("tasks", "所有任务", "☷")}${nav("results", "成果库", "▤")}${nav("team", "我的团队", "♧")}</nav><div class="o-sidebar-label">我的助理 <span>5</span></div><nav class="o-agent-nav" aria-label="助理团队">${officeAgents.map((agent) => `<button data-page="${agent.id}" aria-label="${agent.name} ${agent.title}" aria-describedby="o-dot-${agent.id}">${agentAvatar(agent.id, true)}<span>${agent.name}<small>${agent.title}</small></span><i id="o-dot-${agent.id}" aria-label="待命"></i></button>`).join("")}</nav><div class="o-sidebar-bottom"><button data-legacy="personal-dashboard-nav">▦ <span>个人看板</span><span>↗</span></button><button data-legacy="memory-nav">◇ <span>长期记忆</span><span>↗</span></button><button data-legacy="providers">⚙ <span>模型与设置</span><span>↗</span></button><div class="o-owner"><span>你</span><div><strong>我的私人办公室</strong><small>本机保存 · 由你掌控</small></div><span class="o-live-dot"></span></div></div></aside><div class="o-workspace"><header class="o-topbar"><p><span>个人空间</span><span aria-hidden="true">/</span><strong id="o-breadcrumb">工作台</strong></p><div><span id="o-date"></span><button class="o-mobile-settings" data-legacy="providers" aria-label="模型与设置">⚙</button><button class="o-secondary" data-new>＋ 新任务</button></div></header><div class="o-workspace-body"><main class="o-main"><div id="o-search-wrap" hidden><label class="o-search"><span aria-hidden="true">⌕</span><input id="o-search" type="search" placeholder="搜索任务…" aria-label="搜索任务"></label></div><div id="o-content" aria-busy="true"><div class="o-loading">正在打开你的办公室…</div></div><form id="o-composer" class="o-composer"><label for="o-message" id="o-composer-label">交给小麦，先把事情理清楚</label><textarea id="o-message" rows="2" maxlength="8000" required placeholder="说说你想完成的事，也可以粘贴需要整理的材料…"></textarea><div class="o-composer-actions"><div><span class="o-mini-mark" aria-hidden="true">✳</span><span id="o-composer-agent">小麦 · 总助理</span><span class="o-composer-hint">Enter 发送 · Shift + Enter 换行</span></div><button class="o-send" id="o-send" type="submit" aria-label="发送给助理">发送 <span aria-hidden="true">↑</span></button></div></form><p id="o-model-note" class="o-model-note">正在连接本地服务</p></main><aside class="o-context" aria-label="工作概览"><div class="o-context-heading"><span class="o-live-dot"></span> 工作概览 <small>LIVE</small></div><div id="o-stats" class="o-stats"></div><div class="o-context-divider"></div><h2>接下来</h2><div id="o-upcoming"></div><div class="o-context-tip"><span aria-hidden="true">✳</span><h3>给事情一个明确的主人</h3><p>直接找专业助理，或先和小麦一起理清思路。完成的成果可以交给下一位助理继续。</p></div><div class="o-connection-card"><span class="o-live-dot"></span><strong id="o-model-status">本地服务连接中</strong><small id="o-model-detail">你的工作会保存在本机</small><button class="o-text-button" data-legacy="providers">管理连接 ↗</button></div></aside></div></div><dialog id="o-dialog" aria-labelledby="o-dialog-title"><div id="o-dialog-body"></div></dialog><div id="o-notice" role="status" hidden></div>`;
function element<T extends HTMLElement>(id: string): T {
	const node = document.getElementById(id);
	if (!node) throw new Error(`Missing office element ${id}`);
	return node as T;
}
const content = element("o-content");
const dialog = element<HTMLDialogElement>("o-dialog");
const input = element<HTMLTextAreaElement>("o-message");
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function notify(message: string): void {
	const node = element("o-notice");
	node.textContent = message;
	node.hidden = false;
	clearTimeout(noticeTimer);
	noticeTimer = setTimeout(() => {
		node.hidden = true;
	}, 5000);
}
function title(): string {
	return (
		{ home: "工作台", tasks: "所有任务", results: "成果库", team: "我的团队" }[
			page as "home"
		] ??
		officeAgents.find((agent) => agent.id === page)?.title ??
		"工作台"
	);
}
function render(): void {
	const scrollingChat =
		isOfficeAgentId(page) &&
		content.scrollHeight - content.scrollTop - content.clientHeight < 100;
	content.innerHTML = renderOfficePage(page, state, filter, query);
	content.setAttribute("aria-busy", "false");
	element("o-breadcrumb").textContent = title();
	for (const button of root.querySelectorAll<HTMLButtonElement>(
		"[data-page]",
	)) {
		button.classList.toggle("selected", button.dataset.page === page);
		if (button.dataset.page === page)
			button.setAttribute("aria-current", "page");
		else button.removeAttribute("aria-current");
	}
	element("o-search-wrap").hidden = page !== "tasks";
	element("o-composer").hidden = ![
		"home",
		...officeAgents.map((agent) => agent.id),
	].includes(page);
	element("o-model-note").hidden = element("o-composer").hidden;
	const agent =
		officeAgents.find((agent) => agent.id === page) ?? officeAgents[0];
	element("o-composer-label").textContent =
		`交给${agent?.name}，${page === "home" ? "先把事情理清楚" : agent?.title}`;
	element("o-composer-agent").textContent = `${agent?.name} · ${agent?.title}`;
	const active = state.tasks.filter((task) =>
		["queued", "running"].includes(task.state),
	);
	const attention = state.tasks.filter((task) =>
		["blocked", "failed", "interrupted"].includes(task.state),
	);
	element("o-task-count").textContent = String(active.length);
	element("o-stats").innerHTML =
		`<button data-page="tasks"><strong>${active.length.toString().padStart(2, "0")}</strong><small>待推进</small></button><button data-page="results"><strong>${state.tasks
			.filter((task) => task.state === "completed")
			.length.toString()
			.padStart(2, "0")}</strong><small>已完成</small></button>`;
	element("o-upcoming").innerHTML = active.length
		? active
				.slice(0, 3)
				.map(
					(task) =>
						`<button class="o-upcoming-task" data-task="${task.id}"><span class="o-outline-dot"></span><span>${escapeHtml(task.instruction.slice(0, 40))}<small>${task.scheduledAt ? dateLabel(task.scheduledAt) : stateLabels[task.state]}</small></span></button>`,
				)
				.join("")
		: `<p class="o-context-empty">暂时没有待办。<br>留一点空间给新的想法。</p>`;
	if (attention.length)
		element("o-upcoming").innerHTML +=
			`<button class="o-attention" data-filter="attention">${attention.length} 件任务需要你关注 →</button>`;
	for (const agent of officeAgents) {
		const node = element(`o-dot-${agent.id}`);
		const running = state.tasks.some(
			(task) => task.agentId === agent.id && task.state === "running",
		);
		node.classList.toggle("working", running);
		node.setAttribute("aria-label", running ? "工作中" : "待命");
	}
	element("o-model-status").textContent = state.model.ready
		? `${state.model.name} 已连接`
		: "模型待连接";
	element("o-model-detail").textContent = state.model.ready
		? state.model.model
		: "待办可直接使用，AI 工作需配置模型";
	element("o-model-note").textContent = state.model.ready
		? `${state.model.name} · 独立工作上下文 · 结果保存至本机`
		: "尚未连接模型 · 可先创建待办，或在模型与设置中连接 API";
	if (scrollingChat) content.scrollTop = content.scrollHeight;
}
async function refresh(force = false): Promise<void> {
	try {
		const value: unknown = await (await officeRequest("/office")).json();
		if (
			typeof value !== "object" ||
			value === null ||
			!("version" in value) ||
			value.version !== 1 ||
			!("tasks" in value) ||
			!Array.isArray(value.tasks) ||
			!("model" in value)
		)
			throw new Error("工作台数据无效");
		const snapshot = parseOfficeSnapshot(value);
		const model = (value as { model: unknown }).model;
		if (
			typeof model !== "object" ||
			model === null ||
			!("name" in model) ||
			typeof model.name !== "string" ||
			!("model" in model) ||
			typeof model.model !== "string" ||
			!("ready" in model) ||
			typeof model.ready !== "boolean"
		)
			throw new Error("模型状态无效");
		const next: OfficeView = {
			...snapshot,
			model: { name: model.name, model: model.model, ready: model.ready },
		};
		if (force || JSON.stringify(next) !== JSON.stringify(state)) {
			state = next;
			render();
		}
		loaded = true;
	} catch (error) {
		if (!loaded) {
			content.innerHTML = `<div class="o-empty"><h1>还没有连上本地助手</h1><p>${escapeHtml(error instanceof Error ? error.message : "连接失败")}</p><button class="o-primary" data-refresh>重新连接</button></div>`;
			content.setAttribute("aria-busy", "false");
		}
		element("o-model-status").textContent = "本地服务未连接";
	}
}
function navigate(next: OfficePage): void {
	drafts.set(draftAgent, input.value);
	page = next;
	if (isOfficeAgentId(page) || page === "home") {
		draftAgent = isOfficeAgentId(page) ? page : "coordinator";
		input.value = drafts.get(draftAgent) ?? "";
	}
	render();
	content.scrollTop = 0;
	if (isOfficeAgentId(page)) input.focus();
}
async function mutation(
	path: string,
	body: unknown = {},
	method = "POST",
): Promise<unknown> {
	const response = await officeRequest(path, {
		method,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const result: unknown = await response.json();
	await refresh(true);
	return result;
}
function agentOptions(selected: string): string {
	return officeAgents
		.map(
			(agent) =>
				`<option value="${agent.id}" ${agent.id === selected ? "selected" : ""}>${agent.name} · ${agent.title}</option>`,
		)
		.join("");
}
function openDialog(html: string): void {
	element("o-dialog-body").innerHTML = html;
	if (!dialog.open) dialog.showModal();
}
const closeButton =
	'<button class="o-dialog-close" data-close aria-label="关闭对话框">×</button>';
function newTask(source?: OfficeTask): void {
	selectedTaskId = undefined;
	openDialog(
		`${closeButton}<p class="o-eyebrow">${source ? "PASS THE BATON" : "MAKE ROOM FOR WHAT MATTERS"}</p><h2 id="o-dialog-title">${source ? "交给下一位助理" : "安排一件事"}</h2><p class="o-dialog-description">${source ? "只分享这件任务的要求和成果，其他对话保持独立。" : "明确负责人，再选择现在处理或留到合适的时间。"}</p><form id="o-task-form" ${source ? `data-source="${source.id}"` : ""}><label>交给谁<select name="agentId">${agentOptions(source ? "schedule" : isOfficeAgentId(page) ? page : "coordinator")}</select></label><label>需要完成什么<textarea name="instruction" rows="4" required maxlength="8000" placeholder="目标是什么？有什么要求或参考材料？"></textarea></label>${source ? `<div class="o-note"><strong>交接内容</strong><p>${escapeHtml(source.instruction.slice(0, 100))}</p></div>` : `<div class="o-form-row"><label>处理方式<select name="mode"><option value="assist">请助理处理</option><option value="todo">只记为待办</option></select></label><label>安排时间（可选）<input type="datetime-local" name="scheduledAt"></label></div><p class="o-form-hint">定时 AI 任务在后台运行时执行；待办时间仅供你查看，不会发送外部提醒。</p>`}<button class="o-primary o-wide" type="submit">${source ? "确认交接" : "创建任务"} <span aria-hidden="true">↗</span></button></form>`,
	);
}
function showTask(id: string): void {
	const task = state.tasks.find((item) => item.id === id);
	if (!task) return;
	selectedTaskId = id;
	openDialog(
		`${closeButton}<p class="o-eyebrow">TASK DETAIL</p><h2 id="o-dialog-title">${escapeHtml(task.instruction.slice(0, 80))}</h2><div class="o-detail-meta">${agentAvatar(task.agentId, true)}<span>${officeAgents.find((agent) => agent.id === task.agentId)?.name}</span><span class="o-status ${task.state}">${stateLabels[task.state]}</span><small>${dateLabel(task.createdAt)}</small></div><div class="o-detail-content"><h3>任务要求</h3><pre>${escapeHtml(task.instruction)}</pre>${task.sourceTaskId ? '<p class="o-form-hint">此任务包含用户确认交接的上游成果。</p>' : ""}<h3>${task.result ? "工作成果" : "当前进度"}</h3><div class="o-prose">${renderOfficeMarkdown(task.result ?? task.error ?? (task.state === "completed" ? "这条待办已标记完成。" : task.state === "running" ? "助理正在处理。你可以关闭详情继续使用其他助理，或停止本次任务。" : task.state === "cancelled" ? "任务已取消。" : task.scheduledAt ? `安排于 ${dateLabel(task.scheduledAt)}` : "已记录，等待处理。"))}</div></div><div class="o-detail-actions">${task.state === "queued" && task.mode === "todo" ? `<button class="o-primary" data-action="complete" data-id="${id}">标记完成</button>` : ""}${["running", "queued"].includes(task.state) ? `<button class="o-secondary" data-action="cancel" data-id="${id}">停止任务</button>` : ""}${["failed", "blocked", "interrupted", "cancelled"].includes(task.state) ? `<button class="o-primary" data-action="retry" data-id="${id}">重试</button>` : ""}${task.state === "blocked" ? '<button class="o-secondary" data-legacy="providers">配置模型</button>' : ""}${task.state === "completed" ? `<button class="o-primary" data-handoff="${id}">交给另一位助理 ↗</button>` : ""}<button class="o-secondary" data-export="${id}">导出 Markdown</button>${task.state !== "running" ? `<button class="o-danger" data-delete="${id}">删除</button>` : ""}</div>`,
	);
}
function exportTask(id: string): void {
	const task = state.tasks.find((item) => item.id === id);
	if (!task) return;
	const blob = new Blob(
		[
			`# ${task.instruction.slice(0, 80)}\n\n负责人：${task.agentId}\n状态：${stateLabels[task.state]}\n创建：${task.createdAt}\n\n## 要求\n${task.instruction}\n\n## 成果\n${task.result ?? task.error ?? stateLabels[task.state]}\n`,
		],
		{ type: "text/markdown;charset=utf-8" },
	);
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `agentme-${task.id}.md`;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function openLegacy(target: string): void {
	dialog.close();
	document.body.classList.remove("office-active");
	root.hidden = true;
	const button = document.getElementById(target);
	if (target !== "coding") button?.click();
	else document.getElementById("task-back")?.click();
}
root.addEventListener("click", (event) => {
	const button = (event.target as Element).closest<HTMLElement>("button, a");
	if (!button) return;
	if (button.dataset.page) {
		event.preventDefault();
		navigate(button.dataset.page as OfficePage);
	}
	if (button.hasAttribute("data-new")) newTask();
	if (button.dataset.task) showTask(button.dataset.task);
	if (button.dataset.legacy) openLegacy(button.dataset.legacy);
	if (button.hasAttribute("data-close")) {
		dialog.close();
		selectedTaskId = undefined;
	}
	if (button.hasAttribute("data-refresh")) void refresh(true);
	if (button.dataset.filter) {
		filter = button.dataset.filter;
		navigate("tasks");
	}
	if (button.dataset.prompt) {
		input.value = button.dataset.prompt;
		input.focus();
	}
	if (button.dataset.export) exportTask(button.dataset.export);
	if (button.dataset.handoff) {
		const task = state.tasks.find((item) => item.id === button.dataset.handoff);
		if (task) newTask(task);
	}
	if (button.dataset.instructions) {
		const id = button.dataset.instructions as OfficeAgentId;
		selectedTaskId = undefined;
		openDialog(
			`${closeButton}<p class="o-eyebrow">WORKING TOGETHER</p><h2 id="o-dialog-title">${officeAgents.find((agent) => agent.id === id)?.name}的工作偏好</h2><p class="o-dialog-description">告诉助理你的习惯、输出格式和长期目标。仅用于这位助理。</p><form id="o-instructions-form" data-agent="${id}"><label>工作偏好<textarea name="instructions" rows="7" maxlength="2000" placeholder="例如：先给结论，使用简洁中文；周五整理下周计划。">${escapeHtml(state.instructions[id] ?? "")}</textarea></label><button class="o-primary o-wide">保存偏好</button></form>`,
		);
	}
	if (button.dataset.action && button.dataset.id) {
		const id = button.dataset.id;
		button.setAttribute("disabled", "");
		void mutation(`/office/tasks/${id}/${button.dataset.action}`)
			.then(() => showTask(id))
			.catch((error) => {
				button.removeAttribute("disabled");
				notify(String(error));
			});
	}
	if (button.dataset.delete) {
		const id = button.dataset.delete;
		if (window.confirm("删除这条任务及成果？已交接给其他助理的副本会保留。"))
			void mutation(`/office/tasks/${id}`, {}, "DELETE")
				.then(() => {
					dialog.close();
					selectedTaskId = undefined;
				})
				.catch((error) => notify(String(error)));
	}
});
root.addEventListener("submit", (event) => {
	const form = event.target as HTMLFormElement;
	event.preventDefault();
	if (busy) return;
	busy = true;
	for (const button of form.querySelectorAll<HTMLButtonElement>(
		'button[type="submit"], button:not([type])',
	))
		button.disabled = true;
	const values = new FormData(form);
	let request: Promise<unknown>;
	if (form.id === "o-composer") {
		const instruction = input.value.trim();
		if (!instruction) {
			busy = false;
			return;
		}
		const agentId = isOfficeAgentId(page) ? page : "coordinator";
		request = mutation("/office/tasks", {
			agentId,
			instruction,
			mode: "assist",
		}).then(() => {
			drafts.delete(agentId);
			if (draftAgent === agentId) {
				input.value = "";
				if (page === "home" || page === agentId) navigate(agentId);
			}
		});
	} else if (form.id === "o-instructions-form") {
		request = mutation(
			"/office/instructions",
			{ agentId: form.dataset.agent, instructions: values.get("instructions") },
			"PUT",
		).then(() => {
			dialog.close();
			notify("已保存，这位助理下次工作时会使用你的偏好。");
		});
	} else {
		const fields = {
			agentId: values.get("agentId"),
			instruction: values.get("instruction"),
		};
		const scheduled = values.get("scheduledAt");
		request = form.dataset.source
			? mutation(`/office/tasks/${form.dataset.source}/handoff`, fields)
			: mutation("/office/tasks", {
					...fields,
					mode: values.get("mode"),
					...(typeof scheduled === "string" && scheduled
						? { scheduledAt: new Date(scheduled).toISOString() }
						: {}),
				});
		request = request.then(() => {
			dialog.close();
			navigate(fields.agentId as OfficeAgentId);
			notify(form.dataset.source ? "已交接给下一位助理。" : "任务已安排。");
		});
	}
	void request
		.catch((error) =>
			notify(error instanceof Error ? error.message : "操作失败，请重试"),
		)
		.finally(() => {
			busy = false;
			for (const button of form.querySelectorAll<HTMLButtonElement>("button"))
				button.disabled = false;
		});
});
input.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		element<HTMLFormElement>("o-composer").requestSubmit();
	}
});
element<HTMLInputElement>("o-search").addEventListener("input", (event) => {
	query = (event.target as HTMLInputElement).value;
	render();
});
const back = document.createElement("button");
back.className = "o-return";
back.type = "button";
back.textContent = "← 返回助理工作台";
back.addEventListener("click", () => {
	root.hidden = false;
	document.body.classList.add("office-active");
	void refresh(true);
});
document.querySelector(".topbar-actions")?.prepend(back);
element("o-date").textContent = new Date().toLocaleDateString("zh-CN", {
	month: "long",
	day: "numeric",
	weekday: "long",
});
document.addEventListener("keydown", (event) => {
	if (
		event.key.toLowerCase() === "n" &&
		!event.ctrlKey &&
		!event.metaKey &&
		!event.altKey &&
		!dialog.open &&
		document.body.classList.contains("office-active") &&
		!(event.target instanceof HTMLInputElement) &&
		!(event.target instanceof HTMLTextAreaElement)
	)
		newTask();
});
async function poll(): Promise<void> {
	await refresh();
	if (selectedTaskId && dialog.open) {
		const task = state.tasks.find((task) => task.id === selectedTaskId);
		const status = dialog.querySelector(".o-status");
		if (task && status && status.textContent !== stateLabels[task.state])
			showTask(task.id);
	}
	if (!disposed) setTimeout(() => void poll(), 2000);
}
window.addEventListener("beforeunload", () => {
	disposed = true;
});
void poll();
