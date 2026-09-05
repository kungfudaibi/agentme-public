import {
	loadRepositories,
	normalizeAccessToken,
} from "/ui/token-connection.js";

const form = document.querySelector("#task-form");
const token = document.querySelector("#token");
const instruction = document.querySelector("#instruction");
const repository = document.querySelector("#repository");
const cancel = document.querySelector("#cancel");
const status = document.querySelector("#status");
const timeline = document.querySelector("#timeline");
let taskId;
let tokenLoadTimer;
let tokenLoadGeneration = 0;

const headers = () => ({
	authorization: `Bearer ${normalizeAccessToken(token.value)}`,
});
const repositoryOption = (id, label = id) =>
	Object.assign(document.createElement("option"), {
		value: id,
		textContent: label,
	});

async function connectToken() {
	const generation = ++tokenLoadGeneration;
	repository.disabled = true;
	repository.replaceChildren(repositoryOption("", "正在验证令牌…"));
	status.textContent = "正在验证令牌…";
	const result = await loadRepositories(token.value);
	if (generation !== tokenLoadGeneration) return;
	if (result.status === "loaded") {
		repository.replaceChildren(
			...result.repositories.map(({ id }) =>
				repositoryOption(id === "fake" ? "" : id, id),
			),
		);
		repository.disabled = false;
		status.textContent = "令牌有效，已连接";
		return;
	}
	repository.replaceChildren(repositoryOption("", "尚未连接"));
	status.textContent =
		result.status === "unauthorized"
			? "令牌无效，请重新复制完整令牌"
			: result.status === "empty"
				? "请输入本机访问令牌"
				: "无法连接 AgentMe，请确认服务仍在运行";
}
token.addEventListener("input", () => {
	clearTimeout(tokenLoadTimer);
	tokenLoadTimer = setTimeout(() => void connectToken(), 300);
});
token.addEventListener("change", () => {
	clearTimeout(tokenLoadTimer);
	void connectToken();
});
const show = (event) => {
	const item = document.createElement("li");
	item.textContent =
		event.message ??
		event.report?.summary ??
		event.error?.message ??
		event.type;
	timeline.append(item);
	status.textContent = item.textContent;
};

async function streamEvents(id) {
	const response = await fetch(`/tasks/${id}/events`, { headers: headers() });
	if (!response.ok || !response.body) throw new Error("无法连接任务事件流");
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let pending = "";
	for (;;) {
		const { value = "", done } = await reader.read();
		pending += value;
		for (const block of pending.split("\n\n").slice(0, -1)) {
			const line = block
				.split("\n")
				.find((entry) => entry.startsWith("data: "));
			if (line) show(JSON.parse(line.slice(6)));
		}
		pending = pending.includes("\n\n")
			? pending.slice(pending.lastIndexOf("\n\n") + 2)
			: pending;
		if (done) break;
	}
	cancel.disabled = true;
}

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	timeline.replaceChildren();
	status.textContent = "正在创建…";
	const response = await fetch("/tasks", {
		method: "POST",
		headers: { ...headers(), "content-type": "application/json" },
		body: JSON.stringify({
			instruction: instruction.value,
			...(repository.value ? { repositoryId: repository.value } : {}),
		}),
	});
	if (!response.ok) {
		status.textContent = "创建失败，请检查令牌和任务说明";
		return;
	}
	({ taskId } = await response.json());
	cancel.disabled = false;
	try {
		await streamEvents(taskId);
	} catch (error) {
		status.textContent = error.message;
	}
});

cancel.addEventListener("click", async () => {
	if (!taskId) return;
	await fetch(`/tasks/${taskId}/cancel`, {
		method: "POST",
		headers: headers(),
	});
	cancel.disabled = true;
});
