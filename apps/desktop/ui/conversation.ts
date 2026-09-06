import { officeAgents } from "../../../packages/agent-office/src/catalog.js";
import type {
	Conversation,
	HubMessage,
	HubTask,
} from "../../../packages/conversation-hub/src/types.js";
import {
	renderConversationTask,
	taskStateLabels,
} from "./conversation-view.js";
import { attachConversationVoice } from "./conversation-voice.js";
import { openModelOffers } from "./model-offers.js";
import { officeRequest } from "./office-connection.js";
import {
	escapeOfficeText as esc,
	renderOfficeMarkdown,
} from "./office-markdown.js";
import { createProviderPanel } from "./provider-panel.js";

interface Snapshot {
	conversation: Conversation;
	messages: HubMessage[];
	tasks: HubTask[];
	busy: boolean;
}
const root = document.createElement("div");
root.id = "agent-office";
root.className = "c-hub";
document.body.prepend(root);
document.body.classList.add("office-active");
root.innerHTML = `<aside class="o-sidebar"><a class="o-brand" href="#conversation"><span class="o-brand-symbol">a<span>m</span></span><strong>AgentMe<small>一个对话，接住每件事</small></strong></a><button class="o-new" id="c-new">＋ 新的对话</button><div class="o-sidebar-label">最近的对话</div><nav id="c-conversations" aria-label="对话列表"></nav><div class="o-sidebar-bottom"><button id="c-offers">◈ 模型与免费额度</button><button id="c-providers">⚙ 对话模型设置</button><button id="c-tools">▦ 看板、语音与历史任务</button><div class="o-owner"><span>你</span><div><strong>我的个人空间</strong><small>任务与成果保存在本机</small></div></div></div></aside><div class="o-workspace"><header class="o-topbar"><p><span>个人空间</span><span>/</span><strong id="c-title">日常对话</strong></p><div><span id="c-running">连接中</span><button id="c-new-top">＋ 新对话</button><button id="c-mobile-settings">模型与额度</button></div></header><div class="c-layout"><main class="c-main"><div id="c-messages" aria-label="对话记录"></div><form id="c-form" class="o-composer"><div id="c-reference" hidden></div><label for="c-input">交给小麦和你的助理团队</label><textarea id="c-input" rows="3" maxlength="8000" required placeholder="说说你想完成的事，或者继续聊聊刚才的任务…"></textarea><div class="c-options"><label>处理方式<select id="c-mode"><option value="auto">自动理解</option><option value="chat">只聊一聊</option><option value="office">办公任务</option><option value="coding">编码任务</option><option value="continue">继续任务</option><option value="update">调整任务</option></select></label><label>助理<select id="c-agent">${officeAgents.map((a) => `<option value="${a.id}">${a.name} · ${a.title}</option>`).join("")}</select></label><label>项目<select id="c-repo"><option value="">未选择项目</option></select></label><label>编码后端<select id="c-runtime"><option value="">未选择后端</option></select></label></div><details class="c-constraints"><summary>本次任务的约束</summary><label for="c-constraints">每行一条，例如“保留现有接口”</label><textarea id="c-constraints" rows="2" maxlength="6000"></textarea><label for="c-sources">资料网页（最多3个公开 HTTPS 地址，每行一个）</label><textarea id="c-sources" rows="2" maxlength="6000" placeholder="https://…"></textarea></details><div class="o-composer-actions"><span id="c-hint">任务执行时，你可以继续聊其他事。</span><div class="c-voice-controls"><label><select id="c-voice-route" aria-label="语音服务"><option value="auto">自动语音</option><option value="aliyun">阿里云语音</option><option value="local">本地语音</option></select></label><button type="button" id="c-dictate" aria-pressed="false">语音输入</button><button type="button" id="c-read">朗读回复</button></div><button type="submit" class="o-send" id="c-send">发送 ↑</button></div></form><p id="c-notice" role="status" class="o-model-note"></p></main><aside class="c-context"><p class="o-eyebrow">在这个对话里</p><h2>进行中的事</h2><div id="c-tasks"></div><div class="c-context-note"><strong>对话不断，工作继续</strong><p>点选任务可追问或补充要求。进度与成果会回到这里，详细证据按需展开。</p></div></aside></div></div>`;
function element<T extends HTMLElement>(id: string): T {
	return document.getElementById(id) as T;
}
const input = element<HTMLTextAreaElement>("c-input");
const mode = element<HTMLSelectElement>("c-mode");
let current = "";
let state: Snapshot | undefined;
let sending = false;
let reference: string | undefined;
let polling = false;
let generation = 0;
let rendered = "";
function notice(message: string) {
	element("c-notice").textContent = message;
}
async function api<T>(path: string, body?: unknown): Promise<T> {
	return (
		await officeRequest(
			path,
			body === undefined
				? {}
				: {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					},
		)
	).json() as Promise<T>;
}
function referenceTask(id?: string, action = "auto") {
	reference = id;
	mode.value = action;
	const task = state?.tasks.find((t) => t.id === id);
	const node = element("c-reference");
	node.hidden = !task;
	node.innerHTML = task
		? `正在引用：${esc(task.goal.slice(0, 70))} <button type="button" id="c-clear-reference">解除引用</button>`
		: "";
	document
		.getElementById("c-clear-reference")
		?.addEventListener("click", () => referenceTask());
	input.focus();
}
function render(snapshot: Snapshot) {
	state = snapshot;
	element("c-title").textContent = snapshot.conversation.title;
	const running = snapshot.tasks.filter((t) =>
		["running", "queued"].includes(t.state),
	);
	element("c-running").textContent = running.length
		? `${running.length} 件事正在处理`
		: "随时可以开始";
	element("c-tasks").innerHTML = running.length
		? running
				.map(
					(t) =>
						`<button class="c-task-short" data-task="${t.id}" data-mode="auto"><strong>${esc(t.goal.slice(0, 60))}</strong><small>${taskStateLabels[t.state]}</small></button>`,
				)
				.join("")
		: '<p class="c-empty-small">暂时没有进行中的任务。<br>聊聊想法，或交代一件事。</p>';
	const signature = JSON.stringify([snapshot.messages, snapshot.tasks]);
	if (signature !== rendered) {
		const list = element("c-messages");
		const nearBottom =
			list.scrollHeight - list.scrollTop - list.clientHeight < 150;
		const expanded = [
			...list.querySelectorAll<HTMLDetailsElement>("details[open]"),
		].map((d) => d.dataset.detail);
		const scroll = list.scrollTop;
		const shownTasks = new Set<string>();
		list.innerHTML = snapshot.messages.length
			? snapshot.messages
					.map((m) => {
						const task =
							m.kind === "task" && !shownTasks.has(m.taskId ?? "")
								? snapshot.tasks.find((t) => t.id === m.taskId)
								: undefined;
						if (task) shownTasks.add(task.id);
						return `<article class="c-message ${m.role} ${m.kind}"><div class="c-message-label">${m.role === "user" ? "你" : m.kind === "result" ? "任务成果" : "小麦"}</div><div class="o-prose">${renderOfficeMarkdown(m.content)}</div>${task ? renderConversationTask(task) : ""}${m.taskId && !task ? `<button class="c-inline-ref" data-task="${m.taskId}" data-mode="auto">引用这项任务 ↗</button>` : ""}</article>`;
					})
					.join("")
			: `<div class="c-welcome"><div class="c-spark">✳</div><p class="o-eyebrow">YOUR EVERYDAY ASSISTANT</p><h1>事情再多，<br>从一句话开始。</h1><p>整理资料、安排日常，或让编码助理处理项目。<br>你只需要在这里接着聊。</p><div class="c-suggestions"><button data-prompt="把下面的材料整理成一页简报，保留来源：" data-agent="research">▤ 整理一份资料</button><button data-prompt="帮我规划这周的工作优先级：" data-agent="schedule">◷ 理清一周安排</button><button data-prompt="请帮我修复项目中的问题：" data-agent="coding">⌘ 交给编码助理</button></div></div>`;
		for (const detail of list.querySelectorAll<HTMLDetailsElement>("details"))
			detail.open = expanded.includes(detail.dataset.detail);
		list.scrollTop = snapshot.messages.length
			? nearBottom
				? list.scrollHeight
				: scroll
			: 0;
		rendered = signature;
	}
	element<HTMLButtonElement>("c-send").disabled = sending || snapshot.busy;
}
async function conversations() {
	const data = await api<{ conversations: Conversation[] }>("/conversations");
	element("c-conversations").innerHTML = data.conversations
		.slice()
		.reverse()
		.map(
			(c) =>
				`<button class="c-conversation ${c.id === current ? "selected" : ""}" data-conversation="${c.id}">${esc(c.title)}</button>`,
		)
		.join("");
	return data.conversations;
}
async function select(id: string) {
	stopVoice();
	current = id;
	generation++;
	rendered = "";
	referenceTask();
	await poll();
	await conversations();
}
async function poll() {
	if (!current || polling) return;
	polling = true;
	const id = current;
	const version = generation;
	try {
		const snapshot = await api<Snapshot>(`/conversations/${id}`);
		if (version === generation && id === current) render(snapshot);
	} catch (error) {
		notice(error instanceof Error ? error.message : "连接失败");
	} finally {
		polling = false;
	}
}
async function send(action?: string, taskId?: string) {
	if (sending || !current) return;
	const message =
		action === "status"
			? "查看这项任务的进度"
			: action === "cancel"
				? "停止这项任务"
				: input.value.trim();
	if (!message) return;
	const id = current;
	sending = true;
	element<HTMLButtonElement>("c-send").disabled = true;
	notice("正在理解你的消息…");
	const selectedTask = taskId ?? reference;
	const repositoryId = element<HTMLSelectElement>("c-repo").value;
	const runtimeId = element<HTMLSelectElement>("c-runtime").value;
	try {
		const snapshot = await api<Snapshot>(`/conversations/${id}/messages`, {
			message,
			mode: action ?? mode.value,
			agentId: element<HTMLSelectElement>("c-agent").value,
			...(selectedTask ? { taskId: selectedTask } : {}),
			...(repositoryId ? { repositoryId } : {}),
			...(runtimeId ? { runtimeId } : {}),
			sources: element<HTMLTextAreaElement>("c-sources")
				.value.split("\n")
				.map((s) => s.trim())
				.filter(Boolean),
			constraints: element<HTMLTextAreaElement>("c-constraints")
				.value.split("\n")
				.map((s) => s.trim())
				.filter(Boolean),
		});
		if (id === current) {
			if (!action) {
				input.value = "";
				mode.value = "auto";
				element<HTMLTextAreaElement>("c-constraints").value = "";
				element<HTMLTextAreaElement>("c-sources").value = "";
			}
			render(snapshot);
		}
		notice("已保存。可以继续聊天。");
		await conversations();
	} catch (error) {
		notice(error instanceof Error ? error.message : "发送失败，输入已保留");
	} finally {
		sending = false;
		if (state && id === current) render(state);
	}
}
root.addEventListener("click", (event) => {
	const button = (event.target as HTMLElement).closest<HTMLElement>("button");
	if (!button) return;
	const {
		task,
		mode: action,
		conversation,
		prompt,
		agent,
		export: exportId,
	} = button.dataset;
	if (task) {
		if (action === "status" || action === "cancel") void send(action, task);
		else referenceTask(task, action);
	}
	if (conversation && !sending) void select(conversation);
	if (prompt) {
		input.value = prompt;
		element<HTMLSelectElement>("c-agent").value = agent ?? "coordinator";
		mode.value = agent === "coding" ? "coding" : "office";
		referenceTask(undefined, mode.value);
	}
	if (exportId) {
		const t = state?.tasks.find((t) => t.id === exportId);
		if (t) {
			const blob = new Blob(
				[
					`# ${t.goal}\n\n${t.result ?? t.progress}\n\n## 约束\n${t.constraints.join("\n")}\n\n## 决定\n${t.decisions.join("\n")}\n\n## 证据\n${t.evidence.join("\n")}`,
				],
				{ type: "text/markdown;charset=utf-8" },
			);
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `agentme-${t.id}.md`;
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		}
	}
});
element("c-form").addEventListener("submit", (event) => {
	event.preventDefault();
	void send();
});
input.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		void send();
	}
});
element("c-new-top").addEventListener("click", () => element("c-new").click());
element("c-new").addEventListener("click", () => {
	if (!sending)
		void api<Conversation>("/conversations", {})
			.then((c) => select(c.id))
			.catch((error) => notice(String(error)));
});
let legacy: Promise<unknown> | undefined;
const loadLegacy = () => (legacy ??= import("./app.js"));
const providerPanel = createProviderPanel({
	document,
	request: officeRequest,
	notify: notice,
});
element("c-providers").addEventListener(
	"click",
	() =>
		void providerPanel
			.open()
			.catch((error) =>
				notice(error instanceof Error ? error.message : "模型设置不可用"),
			),
);
element("provider-close").addEventListener("click", () =>
	providerPanel.close(),
);

for (const id of ["c-offers", "c-mobile-settings"])
	element(id).addEventListener(
		"click",
		() => void openModelOffers().catch((error) => notice(String(error))),
	);
const back = document.createElement("button");
back.id = "c-return";
back.textContent = "← 返回主对话";
back.hidden = true;
document.body.append(back);
element("c-tools").addEventListener("click", () => {
	stopVoice();
	void loadLegacy().catch((error) => notice(String(error)));
	root.hidden = true;
	document.body.classList.remove("office-active");
	back.hidden = false;
});
back.addEventListener("click", () => {
	root.hidden = false;
	document.body.classList.add("office-active");
	back.hidden = true;
	void poll();
});
async function start() {
	try {
		const list = await conversations();
		await select(
			list.at(-1)?.id ?? (await api<Conversation>("/conversations", {})).id,
		);
		const targets = await api<{
			repositories: { id: string }[];
			runtimes: { id: string; name: string }[];
		}>("/repositories");
		element("c-repo").innerHTML =
			'<option value="">未选择项目</option>' +
			targets.repositories
				.map((r) => `<option value="${esc(r.id)}">${esc(r.id)}</option>`)
				.join("");
		element("c-runtime").innerHTML =
			'<option value="">未选择后端</option>' +
			targets.runtimes
				.filter((r) => r.id !== "runtime-fake")
				.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`)
				.join("");
		notice("已连接本地服务");
	} catch (error) {
		notice(error instanceof Error ? error.message : "打开对话失败");
	}
}
const stopVoice = attachConversationVoice(
	element<HTMLButtonElement>("c-dictate"),
	element<HTMLButtonElement>("c-read"),
	element<HTMLSelectElement>("c-voice-route"),
	input,
	() => state?.messages.findLast((m) => m.role === "assistant")?.content ?? "",
	notice,
);
void start();
const timer = setInterval(() => {
	if (!document.hidden && !sending) void poll();
}, 1500);
window.addEventListener("beforeunload", () => clearInterval(timer));
