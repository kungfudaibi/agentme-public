import { invoke, isTauri } from "@tauri-apps/api/core";

import {
	type AssistantChild,
	type AssistantTree,
	buildAssistantRequest,
	buildVoiceRequest,
	type DelegatedSubmission,
	encodePcm16Wav,
	parseAssistantSubmission,
	parseAssistantTreePage,
	parseSpokenAssistantResult,
	parseTaskWorkerActivity,
	parseWorkspaceIdentity,
	type SpokenAssistantResult,
	summarizeTree,
	type TaskWorkerActivity,
	taskPhase,
} from "./assistant-state.js";
import { createAutomationPanel } from "./automation-panel.js";
import { createMemoryPanel } from "./memory-panel.js";
import { createPersonalDashboardPanel } from "./personal-dashboard-panel.js";
import { createProviderPanel } from "./provider-panel.js";
import { createSkillWorkshopPanel } from "./skill-workshop-panel.js";
import { createTencentChannelPanel } from "./tencent-channel-panel.js";
import { cancelActiveVoiceResources } from "./voice-resources.js";

interface ConnectionInfo {
	readonly baseUrl: string;
	readonly authToken: string;
}

interface Message {
	readonly role: "user" | "assistant" | "system";
	readonly content: string;
}

interface SpokenStopResult {
	readonly control: "stop";
	readonly transcript: string;
}

const storageKey = "agentme.workspace.v1";
const trees = new Map<string, AssistantTree>();
const streamControllers = new Map<string, AbortController>();
let connection: ConnectionInfo | undefined;
let sessionId: string | undefined;
let parentIds: string[] = [];
let messages: Message[] = [];
let microphone: MediaStream | undefined;
let audioContext: AudioContext | undefined;
let audioSource: MediaStreamAudioSourceNode | undefined;
let audioProcessor: ScriptProcessorNode | undefined;
let recordingChunks: Float32Array[] = [];
let recordingSampleRate = 16_000;
let isRecording = false;
let discardRecording = false;
let recordingTimer: ReturnType<typeof setTimeout> | undefined;
let voiceOperation: AbortController | undefined;
let playback: HTMLAudioElement | undefined;
let wakeEnabled = false;
let wakeSuspended = false;
let wakeLoopRunning = false;
let wakeOperation: AbortController | undefined;
let selectedWorker:
	| { readonly parentId: string; readonly childId: string }
	| undefined;
let workerTurnPending = false;

function element<T extends Element>(selector: string): T {
	const value = document.querySelector<T>(selector);
	if (value === null) throw new Error(`Missing desktop element: ${selector}`);
	return value;
}

const connectionStatus = element<HTMLElement>("#connection");
const messageInput = element<HTMLTextAreaElement>("#message");
const repositorySelect = element<HTMLSelectElement>("#repository");
const backendSelect = element<HTMLSelectElement>("#coding-backend");
function selectedBackend(): string {
	return backendSelect.value;
}
const voiceRouteSelect = element<HTMLSelectElement>("#voice-route");
const runtimeChip = element<HTMLElement>("#runtime");
const sendButton = element<HTMLButtonElement>("#send");
const messagesElement = element<HTMLElement>("#messages");
const welcome = element<HTMLElement>("#welcome");
const activityList = element<HTMLElement>("#activity-list");
const toast = element<HTMLElement>("#toast");
const voiceButton = element<HTMLButtonElement>("#voice");
const voiceTitle = element<HTMLElement>("#voice-title");
const voiceDetail = element<HTMLElement>("#voice-detail");
const voiceBadge = element<HTMLElement>("#voice-badge");
const wakeButton = element<HTMLButtonElement>("#wake");
const autostartButton = element<HTMLButtonElement>("#autostart");
const conversation = element<HTMLElement>("#conversation");
const conversationScroll = element<HTMLElement>("#conversation-scroll");
const composer = element<HTMLFormElement>("#composer");
const taskWorkbench = element<HTMLElement>("#task-workbench");
const taskEvents = element<HTMLElement>("#task-workbench-events");
const taskContext = element<HTMLElement>("#task-workbench-context");
const taskTurnInput = element<HTMLTextAreaElement>("#task-turn-message");
const taskTurnSend = element<HTMLButtonElement>("#task-turn-send");
const taskTurnHint = element<HTMLElement>("#task-turn-hint");

function safeConnection(value: unknown): ConnectionInfo {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("Invalid desktop connection");
	const item = value as Record<string, unknown>;
	if (
		typeof item.baseUrl !== "string" ||
		!/^http:\/\/127\.0\.0\.1:\d+$/u.test(item.baseUrl) ||
		typeof item.authToken !== "string" ||
		!/^[0-9a-f]{64}$/iu.test(item.authToken)
	)
		throw new Error("Invalid desktop connection");
	return { baseUrl: item.baseUrl, authToken: item.authToken };
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
	if (connection === undefined) throw new Error("本地助手尚未连接");
	const response = await fetch(`${connection.baseUrl}${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${connection.authToken}`,
			...init.headers,
		},
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => undefined)) as
			| { error?: { message?: string } }
			| undefined;
		throw new Error(
			body?.error?.message ?? `本地请求失败 (${response.status})`,
		);
	}
	return response;
}

function persistIdentity(): void {
	localStorage.setItem(storageKey, JSON.stringify({ sessionId, parentIds }));
}

function showToast(message: string): void {
	toast.textContent = message;
	toast.hidden = false;
	window.setTimeout(() => {
		toast.hidden = true;
	}, 4_000);
}

const providerPanel = createProviderPanel({
	document,
	request: api,
	notify: showToast,
});
const tencentChannelPanel = createTencentChannelPanel({
	document,
	request: api,
	notify: showToast,
});
function setOwnerWorkspaceVisible(visible: boolean): void {
	if (visible) selectedWorker = undefined;
	conversationScroll.hidden = visible;
	composer.hidden = visible;
	taskWorkbench.hidden = true;
	conversation.classList.toggle("dashboard-open", visible);
}
const personalDashboardPanel = createPersonalDashboardPanel({
	document,
	request: api,
	notify: showToast,
	setWorkspaceVisible: setOwnerWorkspaceVisible,
});
const memoryPanel = createMemoryPanel({
	document,
	request: api,
	notify: showToast,
	setWorkspaceVisible: setOwnerWorkspaceVisible,
});
const skillWorkshopPanel = createSkillWorkshopPanel({
	document,
	request: api,
	notify: showToast,
	setWorkspaceVisible: setOwnerWorkspaceVisible,
});
const automationPanel = createAutomationPanel({
	document,
	request: api,
	notify: showToast,
	setWorkspaceVisible: setOwnerWorkspaceVisible,
	getTarget: () => ({
		repositoryId: repositorySelect.value,
		runtimeId: selectedBackend(),
	}),
	openTask: openScheduledParent,
});

function createText(
	tag: string,
	text: string,
	className?: string,
): HTMLElement {
	const node = document.createElement(tag);
	node.textContent = text;
	if (className !== undefined) node.className = className;
	return node;
}

function renderMessages(): void {
	welcome.hidden = messages.length > 0;
	messagesElement.replaceChildren(
		...messages.map((message) => {
			const row = document.createElement("article");
			row.className = `message ${message.role}`;
			const avatar = createText(
				"span",
				message.role === "user" ? "你" : "A",
				"message-avatar",
			);
			const bubble = document.createElement("div");
			bubble.append(
				createText("strong", message.role === "user" ? "你" : "AgentMe 调度器"),
				createText("p", message.content),
			);
			row.append(avatar, bubble);
			return row;
		}),
	);
	element<HTMLElement>("#conversation-scroll").scrollTop = element<HTMLElement>(
		"#conversation-scroll",
	).scrollHeight;
}

function stateLabel(state: AssistantChild["state"]): string {
	return {
		pending: "排队中",
		dispatched: "执行中",
		completed: "已完成",
		failed: "失败",
		cancelled: "已取消",
	}[state];
}

function eventSummary(event: Record<string, unknown>): string {
	if (event.type === "task.worker.input")
		return `你：${String(event.message ?? "")}`;
	if (
		event.type === "task.worker.event" &&
		typeof event.event === "object" &&
		event.event !== null
	) {
		const worker = event.event as Record<string, unknown>;
		switch (worker.type) {
			case "run.started":
				return `会话已连接 · ${String(worker.threadId ?? "")}`;
			case "run.progress":
				return String(worker.message ?? "Agent 正在处理");
			case "message.delta":
				return `Agent：${String(worker.text ?? "")}`;
			case "tool.requested":
				return `调用工具：${String(worker.tool ?? "unknown")}`;
			case "file.changed":
				return `修改文件：${Array.isArray(worker.paths) ? worker.paths.join("、") : ""}`;
			case "test.result":
				return `验证 ${Number(worker.exitCode) === 0 ? "通过" : "失败"}：${String(worker.command ?? "")}`;
			case "run.completed":
				return `执行完成：${String(worker.summary ?? "")}`;
			case "run.failed":
				return "执行 Agent 报告失败";
			case "run.cancelled":
				return "执行已取消";
		}
	}
	if (event.type === "task.worker.turn.completed")
		return `本轮完成（验证 ${String(event.verification ?? "未知")}）：${String(event.message ?? "")}`;
	if (event.type === "task.worker.turn.failed") return "本轮执行失败";
	if (event.type === "task.progress")
		return String(event.message ?? "任务进度更新");
	if (event.type === "task.completed") return "初始任务已完成";
	if (event.type === "task.failed") return "初始任务执行失败";
	return String(event.type ?? "任务事件");
}

function renderWorkerActivity(activity: TaskWorkerActivity): void {
	element<HTMLElement>("#task-workbench-title").textContent =
		activity.child.request.instruction;
	element<HTMLElement>("#task-workbench-state").textContent = stateLabel(
		activity.child.state,
	);
	taskContext.replaceChildren(
		...[
			["执行后端", activity.child.request.runtimeId],
			["会话", activity.runtime?.sessionId ?? "未保存 / 不支持续聊"],
			["仓库", activity.child.request.repositoryId],
			["工作树", activity.child.worktreeId ?? "未分配"],
		].map(([label, value]) => {
			const item = document.createElement("div");
			item.append(
				createText("span", label ?? ""),
				createText("strong", value ?? ""),
			);
			return item;
		}),
	);
	taskEvents.replaceChildren(
		...activity.events.map((item) => {
			const row = document.createElement("article");
			row.className = "workbench-event";
			const time = document.createElement("time");
			time.dateTime = item.createdAt;
			time.textContent = new Date(item.createdAt).toLocaleTimeString("zh-CN", {
				hour12: false,
			});
			row.append(
				time,
				createText("p", eventSummary(item.event).slice(0, 8_000)),
			);
			return row;
		}),
	);
	taskEvents.scrollTop = taskEvents.scrollHeight;
	const enabled = activity.canContinue && !workerTurnPending;
	taskTurnInput.disabled = !enabled;
	taskTurnSend.disabled = !enabled;
	taskTurnHint.textContent = workerTurnPending
		? "当前 Agent 正在处理这条消息，执行事件会持续更新。"
		: activity.canContinue
			? "消息会发送到此任务原来的编码后端会话，并继续使用同一个隔离工作树。"
			: activity.child.state === "dispatched"
				? "该 Agent 仍在执行；完成后可在这里继续对话。"
				: activity.runtime === undefined
					? "这个任务没有可恢复的会话，只能查看执行过程。"
					: "当前执行后端或任务状态不支持继续对话。";
}

async function refreshWorkerActivity(): Promise<void> {
	if (selectedWorker === undefined) return;
	const { parentId, childId } = selectedWorker;
	const response = await api(
		`/assistant/parents/${parentId}/children/${childId}/activity`,
	);
	if (
		selectedWorker?.parentId !== parentId ||
		selectedWorker.childId !== childId
	)
		return;
	renderWorkerActivity(parseTaskWorkerActivity(await response.json()));
}

async function openWorker(parentId: string, childId: string): Promise<void> {
	personalDashboardPanel.close();
	memoryPanel.close();
	skillWorkshopPanel.close();
	automationPanel.close();
	selectedWorker = { parentId, childId };
	conversation.classList.add("task-open");
	conversationScroll.hidden = true;
	composer.hidden = true;
	taskWorkbench.hidden = false;
	taskEvents.replaceChildren(createText("p", "正在载入持久执行记录…"));
	try {
		await refreshWorkerActivity();
	} catch (error) {
		showToast(error instanceof Error ? error.message : "无法打开任务");
	}
}

async function openScheduledParent(parentId: string): Promise<void> {
	await refreshTree(parentId);
	const child = trees.get(parentId)?.children[0];
	if (child === undefined) throw new Error("自动任务还没有可进入的子 Agent");
	await openWorker(parentId, child.childId);
}

function closeWorker(): void {
	selectedWorker = undefined;
	taskWorkbench.hidden = true;
	conversationScroll.hidden = false;
	composer.hidden = false;
	conversation.classList.remove("task-open");
	messageInput.focus();
}

async function submitWorkerTurn(): Promise<void> {
	if (selectedWorker === undefined || workerTurnPending) return;
	const message = taskTurnInput.value.trim();
	if (message.length < 1) return;
	const worker = selectedWorker;
	workerTurnPending = true;
	taskTurnInput.disabled = true;
	taskTurnSend.disabled = true;
	taskTurnHint.textContent = "当前 Agent 正在处理这条消息…";
	const poll = window.setInterval(() => void refreshWorkerActivity(), 750);
	try {
		await api(
			`/assistant/parents/${worker.parentId}/children/${worker.childId}/turns`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ message }),
			},
		);
		taskTurnInput.value = "";
		await refreshWorkerActivity();
		showToast("当前 Agent 已完成这一轮，并重新运行了仓库验证。");
	} catch (error) {
		showToast(error instanceof Error ? error.message : "任务续聊失败");
	} finally {
		window.clearInterval(poll);
		workerTurnPending = false;
		await refreshWorkerActivity().catch(() => undefined);
	}
}

function renderChild(parentId: string, child: AssistantChild): HTMLElement {
	const card = document.createElement("article");
	card.className = `worker-card state-${child.state}`;
	card.tabIndex = 0;
	card.setAttribute("role", "button");
	card.addEventListener(
		"click",
		() => void openWorker(parentId, child.childId),
	);
	card.addEventListener("keydown", (event) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			void openWorker(parentId, child.childId);
		}
	});
	const header = document.createElement("header");
	const identity = document.createElement("div");
	identity.append(
		createText(
			"span",
			String(child.ordinal + 1).padStart(2, "0"),
			"worker-index",
		),
		createText("strong", child.request.runtimeId.replace("runtime-", "")),
	);
	header.append(
		identity,
		createText("span", stateLabel(child.state), "state-pill"),
	);
	card.append(
		header,
		createText("p", child.request.instruction, "worker-instruction"),
	);
	const details = document.createElement("dl");
	for (const [label, value] of [
		["阶段", taskPhase(child)],
		["仓库", child.request.repositoryId],
		["工作树", child.worktreeId ?? "隔离空间准备中"],
	] as const) {
		details.append(createText("dt", label), createText("dd", value));
	}
	card.append(details);
	if (child.state === "pending" || child.state === "dispatched") {
		const cancel = createText("button", "停止这个 Agent", "cancel-worker");
		cancel.setAttribute("type", "button");
		cancel.addEventListener("click", (event) => {
			event.stopPropagation();
			void cancelChild(parentId, child.childId);
		});
		card.append(cancel);
	}
	return card;
}

function renderActivity(): void {
	const allTrees = [...trees.values()];
	const totals = allTrees.reduce(
		(accumulator, tree) => {
			const summary = summarizeTree(tree);
			accumulator.active += summary.active;
			accumulator.completed += summary.completed;
			accumulator.failed += summary.failed;
			return accumulator;
		},
		{ active: 0, completed: 0, failed: 0 },
	);
	element<HTMLElement>("#worker-count").textContent = `${totals.active} 运行中`;
	element<HTMLElement>("#metric-active").textContent = String(totals.active);
	element<HTMLElement>("#metric-completed").textContent = String(
		totals.completed,
	);
	element<HTMLElement>("#metric-attention").textContent = String(totals.failed);
	element<HTMLElement>("#chat-summary").textContent =
		parentIds.length === 0
			? "等待你的第一个任务"
			: `${parentIds.length} 个主任务 · ${totals.active} 个 Agent 运行中`;

	if (allTrees.length === 0) {
		const empty = document.createElement("div");
		empty.className = "empty-activity";
		empty.append(
			createText("span", "⌁"),
			createText("strong", "暂无运行任务"),
			createText(
				"p",
				"提交目标后，这里会显示主任务、子 Agent、工作树和验证状态。",
			),
		);
		activityList.replaceChildren(empty);
		return;
	}

	activityList.replaceChildren(
		...allTrees.reverse().map((tree) => {
			const group = document.createElement("section");
			group.className = "task-group";
			const heading = document.createElement("div");
			heading.className = "task-heading";
			heading.append(
				createText(
					"strong",
					tree.parent.state === "active" ? "主任务执行中" : "主任务已完成",
				),
				createText("small", tree.parent.parentId.slice(0, 8)),
			);
			group.append(
				heading,
				...tree.children.map((child) =>
					renderChild(tree.parent.parentId, child),
				),
			);
			return group;
		}),
	);
}

async function refreshTree(parentId: string): Promise<void> {
	try {
		const response = await api(`/assistant/parents/${parentId}`);
		const tree = (await response.json()) as AssistantTree;
		if (tree.parent.parentId !== parentId || !Array.isArray(tree.children))
			throw new Error("任务树响应无效");
		trees.set(parentId, tree);
		renderActivity();
	} catch (error) {
		if (error instanceof Error && error.message === "Route not found") {
			parentIds = parentIds.filter((item) => item !== parentId);
			persistIdentity();
			return;
		}
		throw error;
	}
}

async function loadRecentTrees(): Promise<void> {
	const response = await api("/assistant/parents?limit=20");
	const page = parseAssistantTreePage(await response.json());
	trees.clear();
	for (const tree of page.items) trees.set(tree.parent.parentId, tree);
	parentIds = page.items.map(({ parent }) => parent.parentId);
	persistIdentity();
	renderActivity();
}

async function followTree(parentId: string): Promise<void> {
	if (streamControllers.has(parentId)) return;
	const controller = new AbortController();
	streamControllers.set(parentId, controller);
	try {
		const response = await api(`/assistant/parents/${parentId}/events`, {
			signal: controller.signal,
		});
		if (response.body === null) throw new Error("任务事件流不可用");
		const reader = response.body.getReader();
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			await refreshTree(parentId);
		}
		await refreshTree(parentId);
	} catch (error) {
		if (!controller.signal.aborted)
			showToast(error instanceof Error ? error.message : "任务事件流中断");
	} finally {
		streamControllers.delete(parentId);
	}
}

async function cancelChild(parentId: string, childId: string): Promise<void> {
	try {
		await api(`/assistant/parents/${parentId}/children/${childId}/cancel`, {
			method: "POST",
		});
		await refreshTree(parentId);
	} catch (error) {
		showToast(error instanceof Error ? error.message : "取消失败");
	}
}

async function loadMessages(): Promise<void> {
	if (sessionId === undefined) return;
	try {
		const response = await api(`/assistant/sessions/${sessionId}/messages`);
		const body = (await response.json()) as { messages?: Message[] };
		if (Array.isArray(body.messages)) messages = body.messages;
	} catch {
		sessionId = undefined;
		persistIdentity();
	}
	renderMessages();
}

async function deleteCurrentConversation(): Promise<void> {
	if (sessionId === undefined) {
		showToast("当前没有可删除的对话");
		return;
	}
	if (
		!window.confirm(
			"删除当前对话和其中的语音转写？任务执行记录与个人看板不会被删除。",
		)
	)
		return;
	const deletedSessionId = sessionId;
	try {
		const response = await api(
			`/assistant/sessions/${deletedSessionId}/messages`,
			{ method: "DELETE" },
		);
		const result = (await response.json()) as { deleted?: boolean };
		if (result.deleted !== true) throw new Error("对话已经不存在");
		sessionId = undefined;
		messages = [];
		persistIdentity();
		renderMessages();
		showToast("当前对话已删除，任务记录和个人看板已保留");
	} catch (error) {
		showToast(error instanceof Error ? error.message : "删除对话失败");
	}
}

async function trackTask(identity: DelegatedSubmission): Promise<void> {
	sessionId = identity.sessionId;
	parentIds.push(identity.parentId);
	parentIds = [...new Set(parentIds)].slice(-20);
	persistIdentity();
	await refreshTree(identity.parentId);
	void followTree(identity.parentId);
}

function updateVoiceState(
	title: string,
	detail: string,
	badge = voiceRouteSelect.value.toUpperCase(),
): void {
	voiceTitle.textContent = title;
	voiceDetail.textContent = detail;
	voiceBadge.textContent = badge;
}

function releaseMicrophone(): void {
	if (recordingTimer !== undefined) clearTimeout(recordingTimer);
	recordingTimer = undefined;
	audioProcessor?.disconnect();
	audioSource?.disconnect();
	if (audioContext !== undefined) void audioContext.close();
	audioProcessor = undefined;
	audioSource = undefined;
	audioContext = undefined;
	for (const track of microphone?.getTracks() ?? []) track.stop();
	microphone = undefined;
	isRecording = false;
	voiceButton.classList.remove("recording");
	voiceButton.setAttribute("aria-pressed", "false");
	voiceButton.querySelector("span")?.replaceChildren("语音");
}

function finishRecording(submit: boolean): void {
	if (!isRecording) return;
	const chunks = recordingChunks;
	const sampleRate = recordingSampleRate;
	releaseMicrophone();
	if (submit && chunks.some((chunk) => chunk.length > 0)) {
		const wav = encodePcm16Wav(chunks, sampleRate);
		void submitVoice(new Blob([wav], { type: "audio/wav" }));
	}
}

function pauseWakeListener(): void {
	wakeOperation?.abort();
	wakeOperation = undefined;
}

function stopWakeListener(): void {
	wakeEnabled = false;
	wakeSuspended = false;
	pauseWakeListener();
	wakeButton.setAttribute("aria-pressed", "false");
	wakeButton.setAttribute("aria-label", "小麦助手：启用本地唤醒监听");
}

function cancelVoice(): void {
	cancelActiveVoiceResources({
		releaseCapture: () => {
			discardRecording = true;
			finishRecording(false);
		},
		stopWake: stopWakeListener,
		...(voiceOperation === undefined ? {} : { inference: voiceOperation }),
		...(playback === undefined ? {} : { playback }),
	});
	voiceOperation = undefined;
	playback = undefined;
	updateVoiceState("按键说话", "录音后由本地或阿里云识别");
}

function base64(bytes: Uint8Array): string {
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 32_768)
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
	return btoa(binary);
}

async function playSpeech(result: SpokenAssistantResult): Promise<void> {
	const audio = result.speech;
	if (audio?.audioBase64 === undefined) return;
	const mute = element<HTMLButtonElement>("#mute");
	if (mute.getAttribute("aria-pressed") === "true") return;
	playback?.pause();
	playback = new Audio(`data:${audio.mimeType};base64,${audio.audioBase64}`);
	await playback.play();
}

async function submitVoice(blob: Blob): Promise<void> {
	if (blob.size < 32 || blob.size > 10 * 1024 * 1024) {
		showToast("录音为空或过长，请重试。");
		updateVoiceState("按键说话", "录音后由本地或阿里云识别");
		return;
	}
	voiceOperation?.abort();
	const operation = new AbortController();
	voiceOperation = operation;
	updateVoiceState("正在识别", "识别完成后会立即创建同一类主任务", "…");
	try {
		const repositoryId = repositorySelect.value;
		const runtimeId = selectedBackend();
		const mimeType = blob.type.startsWith("audio/ogg")
			? ("audio/ogg" as const)
			: blob.type.startsWith("audio/wav")
				? ("audio/wav" as const)
				: ("audio/webm" as const);
		const response = await api("/assistant/voice/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(
				buildVoiceRequest({
					audioBase64: base64(new Uint8Array(await blob.arrayBuffer())),
					mimeType,
					route: voiceRouteSelect.value as "local" | "aliyun" | "auto",
					repositoryId,
					runtimeId,
					...(sessionId === undefined ? {} : { sessionId }),
				}),
			),
			signal: operation.signal,
		});
		const body: unknown = await response.json();
		if (
			typeof body === "object" &&
			body !== null &&
			"control" in body &&
			(body as SpokenStopResult).control === "stop"
		) {
			cancelVoice();
			showToast("已停止语音捕获和播放");
			return;
		}
		const result = parseSpokenAssistantResult(body);
		messages.push({ role: "user", content: result.transcript });
		messages.push({ role: "assistant", content: result.acknowledgement });
		renderMessages();
		if (result.type !== "supervisor.delegated") {
			sessionId = result.sessionId;
			persistIdentity();
		} else {
			await trackTask(result);
		}
		updateVoiceState(
			result.type !== "supervisor.delegated"
				? "桌面操作已完成"
				: "语音任务已派发",
			result.voice.fallbackUsed
				? `已回退到 ${result.voice.providerId}`
				: `已由 ${result.voice.providerId} 识别`,
			result.voice.fallbackUsed ? "FALLBACK" : "DONE",
		);
		await playSpeech(result).catch(() => undefined);
	} catch (error) {
		if (!operation.signal.aborted)
			showToast(error instanceof Error ? error.message : "语音任务失败");
		updateVoiceState("按键说话", "录音后由本地或阿里云识别");
	} finally {
		if (voiceOperation === operation) voiceOperation = undefined;
		wakeSuspended = false;
		if (wakeEnabled) void runWakeLoop();
	}
}

async function startVoice(maxDurationMs = 30_000): Promise<void> {
	if (
		element<HTMLButtonElement>("#mute").getAttribute("aria-pressed") === "true"
	) {
		showToast("请先取消静音。");
		return;
	}
	if (isRecording) {
		finishRecording(true);
		return;
	}
	if (
		!navigator.mediaDevices?.getUserMedia ||
		typeof AudioContext === "undefined"
	) {
		showToast("当前系统 WebView 不支持麦克风录制。");
		return;
	}
	discardRecording = false;
	recordingChunks = [];
	wakeSuspended = true;
	pauseWakeListener();
	try {
		microphone = await navigator.mediaDevices.getUserMedia({
			audio: { echoCancellation: true, noiseSuppression: true },
		});
		audioContext = new AudioContext();
		recordingSampleRate = audioContext.sampleRate;
		audioSource = audioContext.createMediaStreamSource(microphone);
		audioProcessor = audioContext.createScriptProcessor(4_096, 1, 1);
		audioProcessor.onaudioprocess = ({ inputBuffer }) => {
			const mono = new Float32Array(inputBuffer.length);
			for (
				let channel = 0;
				channel < inputBuffer.numberOfChannels;
				channel += 1
			) {
				const input = inputBuffer.getChannelData(channel);
				for (let index = 0; index < input.length; index += 1)
					mono[index] =
						(mono[index] ?? 0) +
						(input[index] ?? 0) / inputBuffer.numberOfChannels;
			}
			recordingChunks.push(mono);
		};
		audioSource.connect(audioProcessor);
		audioProcessor.connect(audioContext.destination);
		isRecording = true;
		voiceButton.classList.add("recording");
		voiceButton.setAttribute("aria-pressed", "true");
		voiceButton.querySelector("span")?.replaceChildren("结束");
		updateVoiceState(
			"正在聆听",
			`再次点击结束，最长 ${Math.round(maxDurationMs / 1_000)} 秒`,
			"REC",
		);
		recordingTimer = setTimeout(() => {
			if (isRecording) finishRecording(!discardRecording);
		}, maxDurationMs);
	} catch (error) {
		releaseMicrophone();
		wakeSuspended = false;
		if (wakeEnabled) void runWakeLoop();
		showToast(error instanceof Error ? error.message : "无法访问麦克风");
	}
}

async function captureWakeWindow(signal: AbortSignal): Promise<Uint8Array> {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: { echoCancellation: true, noiseSuppression: true },
	});
	if (signal.aborted) {
		for (const track of stream.getTracks()) track.stop();
		throw signal.reason;
	}
	const context = new AudioContext();
	const source = context.createMediaStreamSource(stream);
	const processor = context.createScriptProcessor(4_096, 1, 1);
	const chunks: Float32Array[] = [];
	processor.onaudioprocess = ({ inputBuffer }) => {
		const mono = new Float32Array(inputBuffer.length);
		for (
			let channel = 0;
			channel < inputBuffer.numberOfChannels;
			channel += 1
		) {
			const input = inputBuffer.getChannelData(channel);
			for (let index = 0; index < input.length; index += 1)
				mono[index] =
					(mono[index] ?? 0) +
					(input[index] ?? 0) / inputBuffer.numberOfChannels;
		}
		chunks.push(mono);
	};
	source.connect(processor);
	processor.connect(context.destination);
	return new Promise<Uint8Array>((resolveCapture, reject) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const cleanup = (): void => {
			if (timer !== undefined) clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			processor.disconnect();
			source.disconnect();
			void context.close();
			for (const track of stream.getTracks()) track.stop();
		};
		const abort = (): void => {
			cleanup();
			reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
		};
		signal.addEventListener("abort", abort, { once: true });
		timer = setTimeout(() => {
			cleanup();
			try {
				resolveCapture(encodePcm16Wav(chunks, context.sampleRate));
			} catch (error) {
				reject(error);
			}
		}, 2_500);
	});
}

async function runWakeLoop(): Promise<void> {
	if (wakeLoopRunning || !wakeEnabled || wakeSuspended) return;
	wakeLoopRunning = true;
	try {
		while (wakeEnabled && !wakeSuspended) {
			const operation = new AbortController();
			wakeOperation = operation;
			updateVoiceState("本地等待唤醒", "说“小麦助手”开始任务", "LOCAL");
			try {
				const wav = await captureWakeWindow(operation.signal);
				const response = await api("/assistant/voice/wake", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						audioBase64: base64(wav),
						mimeType: "audio/wav",
					}),
					signal: operation.signal,
				});
				const result = (await response.json()) as {
					awake: boolean;
					phrase: string;
				};
				if (result.awake) {
					wakeOperation = undefined;
					updateVoiceState("已唤醒", "请说任务，8 秒后自动提交", "AWAKE");
					await startVoice(8_000);
					return;
				}
			} catch (error) {
				if (!operation.signal.aborted) {
					stopWakeListener();
					showToast(error instanceof Error ? error.message : "本地唤醒不可用");
					updateVoiceState("按键说话", "本地唤醒不可用，可继续手动录音");
					return;
				}
			} finally {
				if (wakeOperation === operation) wakeOperation = undefined;
			}
			if (wakeEnabled && !wakeSuspended)
				await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
		}
	} finally {
		wakeLoopRunning = false;
	}
}

async function submitMessage(): Promise<void> {
	const content = messageInput.value.trim();
	if (content.length === 0 || connection === undefined) return;
	messageInput.value = "";
	messages.push({ role: "user", content });
	renderMessages();
	sendButton.disabled = true;
	try {
		const repositoryId = repositorySelect.value;
		const runtimeId = selectedBackend();
		const response = await api("/assistant/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(
				buildAssistantRequest({
					message: content,
					repositoryId,
					runtimeId,
					...(sessionId === undefined ? {} : { sessionId }),
				}),
			),
		});
		const result = parseAssistantSubmission(await response.json());
		if (result.type !== "supervisor.delegated") {
			sessionId = result.sessionId;
			persistIdentity();
			messages.push({
				role: "assistant",
				content:
					result.type === "desktop-action.completed"
						? result.acknowledgement
						: result.message,
			});
			renderMessages();
		} else {
			messages.push({
				role: "assistant",
				content:
					"目标已接收。我已创建主任务，并把执行工作交给独立 Agent；你可以在右侧观察和停止它。",
			});
			renderMessages();
			await trackTask(result);
		}
	} catch (error) {
		showToast(error instanceof Error ? error.message : "任务提交失败");
	} finally {
		sendButton.disabled = false;
		messageInput.focus();
	}
}

async function loadRepositories(): Promise<void> {
	const response = await api("/repositories");
	const body = (await response.json()) as {
		repositories?: { id: string }[];
		runtimes?: { id: string; name: string }[];
	};
	const backends = body.runtimes ?? [];
	backendSelect.replaceChildren(
		...backends.map(({ id, name }) => {
			const option = document.createElement("option");
			option.value = id;
			option.textContent = name;
			return option;
		}),
	);
	const saved = localStorage.getItem("agentme-coding-backend");
	if (saved && backends.some((item) => item.id === saved))
		backendSelect.value = saved;
	const repositories = Array.isArray(body.repositories)
		? body.repositories
		: [];
	repositorySelect.replaceChildren(
		...repositories.map(({ id }) => {
			const option = document.createElement("option");
			option.value = id;
			option.textContent = id === "fake" ? "演示仓库" : id;
			return option;
		}),
	);
	runtimeChip.textContent =
		backendSelect.selectedOptions[0]?.textContent ?? "未配置编码后端";
}

async function initialize(): Promise<void> {
	try {
		connection = isTauri()
			? safeConnection(await invoke("connection_info"))
			: { baseUrl: `${location.origin}/api`, authToken: "" };
		await api("/health");
		connectionStatus.classList.add("online");
		connectionStatus.lastChild?.remove();
		connectionStatus.append("本地助手已就绪");
		const autostart = await invoke<boolean>("autostart_status").catch(
			() => false,
		);
		autostartButton.setAttribute("aria-pressed", String(autostart));
		autostartButton.setAttribute(
			"aria-label",
			autostart ? "关闭开机启动" : "启用开机启动",
		);
		const identity = parseWorkspaceIdentity(localStorage.getItem(storageKey));
		sessionId = identity.sessionId;
		parentIds = [...identity.parentIds];
		await Promise.all([
			loadRepositories(),
			loadMessages(),
			providerPanel
				.load()
				.catch((error) =>
					showToast(error instanceof Error ? error.message : "API 配置不可用"),
				),
			tencentChannelPanel
				.load()
				.catch((error) =>
					showToast(error instanceof Error ? error.message : "QQ 通道不可用"),
				),
		]);
		try {
			await loadRecentTrees();
		} catch {
			await Promise.all(parentIds.map((parentId) => refreshTree(parentId)));
		}
		for (const [parentId, tree] of trees) {
			if (tree.parent.state === "active") void followTree(parentId);
		}
		renderActivity();
		if (!document.body.classList.contains("office-active"))
			messageInput.focus();
	} catch (error) {
		connectionStatus.classList.add("offline");
		connectionStatus.textContent = "本地助手启动失败";
		showToast(error instanceof Error ? error.message : "无法启动本地助手");
	}
}

element<HTMLFormElement>("#composer").addEventListener("submit", (event) => {
	event.preventDefault();
	void submitMessage();
});
element<HTMLButtonElement>("#task-back").addEventListener("click", closeWorker);
element<HTMLFormElement>("#task-turn-form").addEventListener(
	"submit",
	(event) => {
		event.preventDefault();
		void submitWorkerTurn();
	},
);
messageInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		void submitMessage();
	}
});
repositorySelect.addEventListener("change", () => {
	runtimeChip.textContent =
		backendSelect.selectedOptions[0]?.textContent ?? "未配置编码后端";
});
for (const suggestion of document.querySelectorAll<HTMLButtonElement>(
	"[data-prompt]",
)) {
	suggestion.addEventListener("click", () => {
		messageInput.value = suggestion.dataset.prompt ?? "";
		messageInput.focus();
	});
}
element<HTMLButtonElement>("#new-chat").addEventListener("click", () => {
	personalDashboardPanel.close();
	memoryPanel.close();
	skillWorkshopPanel.close();
	automationPanel.close();
	sessionId = undefined;
	messages = [];
	persistIdentity();
	renderMessages();
	messageInput.focus();
});
element<HTMLButtonElement>("#delete-chat").addEventListener(
	"click",
	() => void deleteCurrentConversation(),
);
element<HTMLButtonElement>("#personal-dashboard-nav").addEventListener(
	"click",
	() => {
		memoryPanel.close();
		skillWorkshopPanel.close();
		automationPanel.close();
		void personalDashboardPanel.open();
	},
);
element<HTMLButtonElement>("#personal-dashboard-top").addEventListener(
	"click",
	() => {
		memoryPanel.close();
		skillWorkshopPanel.close();
		automationPanel.close();
		void personalDashboardPanel.open();
	},
);
element<HTMLButtonElement>("#dashboard-back").addEventListener("click", () =>
	personalDashboardPanel.close(),
);
element<HTMLButtonElement>("#memory-nav").addEventListener("click", () => {
	personalDashboardPanel.close();
	skillWorkshopPanel.close();
	automationPanel.close();
	void memoryPanel.open();
});
element<HTMLButtonElement>("#memory-top").addEventListener("click", () => {
	personalDashboardPanel.close();
	skillWorkshopPanel.close();
	automationPanel.close();
	void memoryPanel.open();
});
element<HTMLButtonElement>("#memory-back").addEventListener("click", () =>
	memoryPanel.close(),
);
element<HTMLButtonElement>("#skill-workshop-nav").addEventListener(
	"click",
	() => {
		personalDashboardPanel.close();
		memoryPanel.close();
		automationPanel.close();
		void skillWorkshopPanel.open();
	},
);
element<HTMLButtonElement>("#skill-workshop-top").addEventListener(
	"click",
	() => {
		personalDashboardPanel.close();
		memoryPanel.close();
		automationPanel.close();
		void skillWorkshopPanel.open();
	},
);
element<HTMLButtonElement>("#skill-workshop-back").addEventListener(
	"click",
	() => skillWorkshopPanel.close(),
);
element<HTMLButtonElement>("#automation-nav").addEventListener("click", () => {
	personalDashboardPanel.close();
	memoryPanel.close();
	skillWorkshopPanel.close();
	void automationPanel.open();
});
element<HTMLButtonElement>("#automation-top").addEventListener("click", () => {
	personalDashboardPanel.close();
	memoryPanel.close();
	skillWorkshopPanel.close();
	void automationPanel.open();
});
element<HTMLButtonElement>("#automation-back").addEventListener("click", () =>
	automationPanel.close(),
);
voiceButton.addEventListener("click", () => void startVoice());
wakeButton.addEventListener("click", () => {
	if (wakeEnabled) {
		stopWakeListener();
		updateVoiceState("按键说话", "本地唤醒已关闭");
		return;
	}
	if (
		element<HTMLButtonElement>("#mute").getAttribute("aria-pressed") === "true"
	) {
		showToast("请先取消静音。");
		return;
	}
	wakeEnabled = true;
	wakeSuspended = false;
	wakeButton.setAttribute("aria-pressed", "true");
	wakeButton.setAttribute("aria-label", "小麦助手：关闭本地唤醒监听");
	void runWakeLoop();
});
autostartButton.addEventListener("click", async () => {
	const enabled = autostartButton.getAttribute("aria-pressed") !== "true";
	autostartButton.disabled = true;
	try {
		const actual = await invoke<boolean>("set_autostart", { enabled });
		autostartButton.setAttribute("aria-pressed", String(actual));
		autostartButton.setAttribute(
			"aria-label",
			actual ? "关闭开机启动" : "启用开机启动",
		);
		showToast(actual ? "已启用开机启动" : "已关闭开机启动");
	} catch (error) {
		showToast(error instanceof Error ? error.message : "无法更新开机启动");
	} finally {
		autostartButton.disabled = false;
	}
});
element<HTMLButtonElement>("#providers").addEventListener("click", () => {
	void providerPanel
		.open()
		.catch((error) =>
			showToast(error instanceof Error ? error.message : "API 配置不可用"),
		);
});
element<HTMLButtonElement>("#provider-close").addEventListener("click", () =>
	providerPanel.close(),
);
element<HTMLButtonElement>("#tencent-channel").addEventListener("click", () => {
	void tencentChannelPanel
		.open()
		.catch((error) =>
			showToast(error instanceof Error ? error.message : "QQ 通道不可用"),
		);
});
element<HTMLButtonElement>("#tencent-channel-close").addEventListener(
	"click",
	() => tencentChannelPanel.close(),
);
voiceRouteSelect.addEventListener("change", () => {
	if (!wakeEnabled) updateVoiceState("按键说话", "录音后由本地或阿里云识别");
});
element<HTMLButtonElement>("#mute").addEventListener("click", (event) => {
	const button = event.currentTarget as HTMLButtonElement;
	const muted = button.getAttribute("aria-pressed") !== "true";
	button.setAttribute("aria-pressed", String(muted));
	button.setAttribute("aria-label", muted ? "取消静音" : "静音");
	if (muted) cancelVoice();
	showToast(muted ? "语音已静音" : "语音已恢复待命");
});
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") cancelVoice();
});
window.addEventListener("beforeunload", () => {
	cancelVoice();
	for (const controller of streamControllers.values()) controller.abort();
});

void initialize();

backendSelect.addEventListener("change", () => {
	localStorage.setItem("agentme-coding-backend", backendSelect.value);
	runtimeChip.textContent =
		backendSelect.selectedOptions[0]?.textContent ?? "未配置编码后端";
});
