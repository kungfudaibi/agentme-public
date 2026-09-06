import { randomUUID } from "node:crypto";
import { AgentMeError } from "../../contracts/src/index.js";
import { conversationContext } from "./context.js";
import { invalid, loadHub, object, saveHub, strings, text } from "./storage.js";
import type {
	HubData,
	HubDependencies,
	HubMessage,
	HubSend,
	HubTask,
	ModelPolicy,
	SendMode,
} from "./types.js";
export class ConversationHub {
	readonly #lifecycle = new AbortController();
	readonly #runs = new Set<Promise<void>>();
	readonly #data: HubData;
	readonly #active = new Map<string, AbortController>();
	readonly #turns = new Set<string>();
	#stopped = false;
	constructor(
		readonly path: string,
		readonly dependencies: HubDependencies,
	) {
		this.#data = loadHub(path);
		for (const task of this.#data.tasks)
			if (task.state === "running" || task.state === "queued") {
				task.state = "interrupted";
				task.progress = "后台已重启，任务事实已保留；可继续此任务。";
			}
		this.#save();
	}
	#save() {
		saveHub(this.path, this.#data);
	}
	createConversation() {
		if (this.#data.conversations.length >= 100) invalid("最多保留100个对话");
		const conversation = {
			id: randomUUID(),
			title: "新的对话",
			createdAt: new Date().toISOString(),
		};
		this.#data.conversations.push(conversation);
		this.#save();
		return structuredClone(conversation);
	}
	list() {
		return structuredClone(this.#data.conversations);
	}
	snapshot(id: string) {
		if (!this.#data.conversations.some((c) => c.id === id))
			invalid("对话不存在");
		return structuredClone({
			conversation: this.#data.conversations.find((c) => c.id === id),
			messages: this.#data.messages.filter((m) => m.conversationId === id),
			tasks: this.#data.tasks.filter((t) => t.conversationId === id),
			busy: this.#turns.has(id),
		});
	}
	#message(
		conversationId: string,
		role: HubMessage["role"],
		content: string,
		kind: HubMessage["kind"] = "chat",
		taskId?: string,
	) {
		if (this.#data.messages.length >= 5000)
			invalid("对话记录已满，请导出后清理");
		this.#data.messages.push({
			id: randomUUID(),
			conversationId,
			role,
			content: content.slice(0, 24000) || "暂无内容",
			kind,
			createdAt: new Date().toISOString(),
			...(taskId ? { taskId } : {}),
		});
		this.#save();
	}
	#target(input: HubSend): HubTask | undefined {
		const tasks = this.#data.tasks.filter(
			(t) => t.conversationId === input.conversationId,
		);
		if (input.taskId) {
			const found = tasks.find((t) => t.id === input.taskId);
			if (!found) invalid("关联任务不属于此对话");
			return found;
		}
		return tasks.length === 1 ? tasks[0] : undefined;
	}
	async send(
		value: unknown,
		signal: AbortSignal = new AbortController().signal,
	) {
		if (this.#stopped) invalid("后台已停止");
		if (this.#data.messages.length >= 4900)
			invalid("对话记录接近容量上限，请先导出归档");
		const v = object(value);
		if (
			Object.keys(v).some(
				(key) =>
					![
						"conversationId",
						"message",
						"mode",
						"taskId",
						"repositoryId",
						"runtimeId",
						"agentId",
						"constraints",
						"sources",
					].includes(key),
			)
		)
			invalid();
		const mode = v.mode ?? "auto";
		if (
			typeof mode !== "string" ||
			![
				"auto",
				"chat",
				"office",
				"coding",
				"continue",
				"update",
				"status",
				"cancel",
			].includes(mode)
		)
			invalid();
		const input: HubSend = {
			conversationId: text(v.conversationId, 36),
			message: text(v.message),
			mode: mode as SendMode,
			...(v.taskId !== undefined ? { taskId: text(v.taskId, 36) } : {}),
			...(v.repositoryId !== undefined
				? { repositoryId: text(v.repositoryId, 100) }
				: {}),
			...(v.runtimeId !== undefined
				? { runtimeId: text(v.runtimeId, 100) }
				: {}),
			...(v.agentId !== undefined ? { agentId: text(v.agentId, 40) } : {}),
			...(v.sources !== undefined ? { sources: strings(v.sources, 3) } : {}),
			...(v.constraints !== undefined
				? { constraints: strings(v.constraints) }
				: {}),
		};
		this.snapshot(input.conversationId);
		if (this.#turns.has(input.conversationId))
			invalid("上一条消息仍在处理中，请稍后发送");
		const target = this.#target(input);
		this.#turns.add(input.conversationId);
		const conversation = this.#data.conversations.find(
			(c) => c.id === input.conversationId,
		);
		if (conversation?.title === "新的对话")
			conversation.title = input.message.slice(0, 60);
		this.#message(
			input.conversationId,
			"user",
			input.message,
			"chat",
			input.taskId ? target?.id : undefined,
		);
		try {
			if (mode === "office" || mode === "coding") {
				this.#create(input, mode);
				return { ...this.snapshot(input.conversationId), busy: false };
			}
			if (["continue", "update", "status", "cancel"].includes(mode)) {
				await this.#act(input, mode as SendMode, target);
				return { ...this.snapshot(input.conversationId), busy: false };
			}
			if (!this.dependencies.model) {
				this.#message(
					input.conversationId,
					"assistant",
					"请先配置对话模型。已有任务事实会继续保留，也可以明确选择“办公任务”或“编码任务”。",
					"notice",
				);
				return { ...this.snapshot(input.conversationId), busy: false };
			}
			const policy: ModelPolicy = this.dependencies.getModelPolicy?.() ??
				this.dependencies.modelPolicy ?? {
					actions: "structured",
					contextCharacters: 10000,
				};
			const messages = conversationContext(
				this.#data,
				input.conversationId,
				input.message,
				input.taskId ? target : undefined,
				policy.contextCharacters,
			);
			const system = messages[0];
			if (!system) invalid();
			const limited = AbortSignal.any([
				signal,
				this.#lifecycle.signal,
				AbortSignal.timeout(60000),
			]);
			if (mode === "chat" || policy.actions === "chat-only") {
				const reply = await this.#model(messages, limited);
				this.#message(
					input.conversationId,
					"assistant",
					reply,
					"chat",
					input.taskId ? target?.id : undefined,
				);
				return { ...this.snapshot(input.conversationId), busy: false };
			}
			system.content += `\n用户已选目标：${JSON.stringify({ repositoryId: input.repositoryId, runtimeId: input.runtimeId, taskId: input.taskId })}`;
			const instructions =
				'只返回JSON：{"action":"reply|office|coding|continue|update|status|cancel|clarify","message":"给用户的简短回复","taskId":"仅已有任务ID，可省略","agentId":"coordinator|schedule|research|finance|coding，可省略"}。普通问答、资料检查、旅行/生活项目默认reply。只有用户实际要求完成工作才office；要求修改仓库代码且当前已选仓库才coding。追问关联已有任务；多个候选不明确用clarify。办公任务按实际意图选择专业助理：research整理研究、schedule日程、finance财务、coordinator统筹。禁止虚构ID，不允许输出命令或替用户改写目标。';
			system.content += `\n${instructions}`;
			let action: Record<string, unknown> | undefined;
			for (let attempt = 0; attempt < 2; attempt++) {
				const reply = await this.#model(messages, limited);
				try {
					const parsed = object(
						JSON.parse(reply.replace(/^```(?:json)?\s*|\s*```$/gu, "")),
					);
					if (
						typeof parsed.action !== "string" ||
						![
							"reply",
							"office",
							"coding",
							"continue",
							"update",
							"status",
							"cancel",
							"clarify",
						].includes(parsed.action) ||
						Object.keys(parsed).some(
							(k) => !["action", "message", "taskId", "agentId"].includes(k),
						)
					)
						throw Error("invalid");
					text(parsed.message, 4000);
					if (
						parsed.agentId !== undefined &&
						(typeof parsed.agentId !== "string" ||
							![
								"coordinator",
								"schedule",
								"research",
								"finance",
								"coding",
							].includes(parsed.agentId))
					)
						invalid();
					if (parsed.taskId !== undefined) text(parsed.taskId, 36);
					action = parsed;
					break;
				} catch {
					if (attempt === 0)
						system.content +=
							"\n上次输出不符合上述JSON格式。请仅返回该格式；无法判断时用clarify。";
				}
			}
			if (!action) {
				this.#message(
					input.conversationId,
					"assistant",
					"模型未能可靠识别操作。请明确选择办公/编码任务，或点选已有任务后继续；没有执行任何新操作。",
					"notice",
				);
				return { ...this.snapshot(input.conversationId), busy: false };
			}
			const routed = action.taskId
				? this.#target({ ...input, taskId: String(action.taskId) })
				: target;
			if (action.action === "reply" || action.action === "clarify")
				this.#message(
					input.conversationId,
					"assistant",
					String(action.message),
					"chat",
					input.taskId ? target?.id : undefined,
				);
			else if (action.action === "office" || action.action === "coding") {
				if (input.taskId) await this.#act(input, "update", target);
				else
					this.#create(
						{
							...input,
							...(typeof action.agentId === "string" &&
							(!input.agentId || input.agentId === "coordinator")
								? { agentId: action.agentId }
								: {}),
						},
						action.action,
					);
			} else await this.#act(input, action.action as SendMode, routed);
		} catch (error) {
			if (signal.aborted || this.#stopped) throw error;
			this.#message(
				input.conversationId,
				"assistant",
				error instanceof AgentMeError && error.code === "INVALID_CONTRACT"
					? error.message
					: "这次请求未完成，已有任务与上下文均已保留。请重试，或明确选择任务操作。",
				"notice",
			);
		} finally {
			this.#turns.delete(input.conversationId);
		}
		return { ...this.snapshot(input.conversationId), busy: false };
	}
	#create(input: HubSend, kind: "office" | "coding") {
		for (const source of input.sources ?? []) {
			let url: URL;
			try {
				url = new URL(source);
			} catch {
				invalid("资料来源须为公开 HTTPS 地址");
			}
			if (
				url.protocol !== "https:" ||
				url.username ||
				url.password ||
				(url.port && url.port !== "443")
			)
				invalid("资料来源不能包含凭据，且必须使用 HTTPS");
		}
		if (kind === "coding" && input.sources?.length)
			invalid("网页资料请交给办公助理整理后，将结论补充到编码任务");
		if (
			kind === "coding" &&
			JSON.stringify({
				goal: input.message,
				constraints: input.constraints ?? [],
				...(input.sources?.length ? { sources: input.sources } : {}),
				decisions: [],
			}).length > 4000
		)
			invalid("编码目标和约束合计最多4000字符，请精简后发送");
		if ((input.message + (input.constraints ?? []).join("")).length > 16000)
			invalid("任务事实超过16000字符，请精简材料");
		if (
			input.agentId &&
			!["coordinator", "schedule", "research", "finance", "coding"].includes(
				input.agentId,
			)
		)
			invalid("未知助理");
		if (this.#data.tasks.length >= 500) invalid("任务已满");
		if (
			kind === "coding" &&
			(!input.repositoryId ||
				!input.runtimeId ||
				this.dependencies.validateTarget?.(
					input.repositoryId,
					input.runtimeId,
				) === false)
		) {
			this.#message(
				input.conversationId,
				"assistant",
				"这是编码工作。请在输入框旁选择已注册仓库和编码后端，然后发送；当前尚未执行。",
				"notice",
			);
			return;
		}
		const now = new Date().toISOString();
		const task: HubTask = {
			id: randomUUID(),
			conversationId: input.conversationId,
			kind,
			goal: input.message,
			constraints: input.constraints ?? [],
			...(input.sources?.length ? { sources: input.sources } : {}),
			decisions: [],
			progress: "准备执行",
			state: "queued",
			createdAt: now,
			updatedAt: now,
			revision: 0,
			evidence: [],
			agentId: kind === "coding" ? "coding" : (input.agentId ?? "coordinator"),
			pending: [],
			...(kind === "coding"
				? {
						repositoryId: text(input.repositoryId, 100),
						runtimeId: text(input.runtimeId, 100),
					}
				: {}),
		};
		this.#data.tasks.push(task);
		this.#message(
			input.conversationId,
			"assistant",
			"已接下这项工作。可以继续聊天，也可以引用任务追问或调整。",
			"task",
			task.id,
		);
		this.#launch(task);
	}
	async #act(input: HubSend, action: SendMode, task: HubTask | undefined) {
		if (!task) {
			this.#message(
				input.conversationId,
				"assistant",
				"你指的是哪一项任务？请点选对话中的任务卡片，再发送这条消息。",
				"notice",
			);
			return;
		}
		if (action === "status") {
			this.#message(
				input.conversationId,
				"assistant",
				`${task.goal}\n状态：${task.state}\n${task.progress}\n${task.result ?? ""}`,
				"notice",
				task.id,
			);
			return;
		}
		if (action === "cancel") {
			if (!["running", "queued"].includes(task.state)) {
				this.#message(
					input.conversationId,
					"assistant",
					"此任务当前未在运行，已保留原状态。",
					"notice",
					task.id,
				);
				return;
			}
			this.#active.get(task.id)?.abort();
			task.pending = [];
			task.state = "cancelled";
			task.progress = "用户已停止";
			this.#message(
				input.conversationId,
				"assistant",
				"已停止这项任务，已有结果和约束仍保留。",
				"notice",
				task.id,
			);
			return;
		}
		if (input.message.length > 2000)
			invalid("任务补充最多2000字符，请精简后重试");
		if (input.sources?.length)
			invalid("继续任务时沿用原资料来源；新资料请直接粘贴到本次补充");
		const constraints = [
			...new Set([...task.constraints, ...(input.constraints ?? [])]),
		];
		if (constraints.length > 16) invalid("约束最多16条");
		if (
			(
				task.goal +
				constraints.join("") +
				task.decisions.join("") +
				input.message
			).length > 16000
		)
			invalid("任务事实已满，请精简补充");
		if (task.pending.length >= 8) invalid("待处理补充过多");
		if (task.decisions.length >= 32) invalid("本任务的调整记录已满");
		if (
			task.kind === "coding" &&
			JSON.stringify({
				goal: task.goal,
				constraints,
				decisions: [...task.decisions, input.message],
			}).length > 3800
		)
			invalid("编码任务事实已达到本次上下文上限，请将补充缩短后重试");
		task.constraints = constraints;
		task.decisions.push(input.message);
		task.updatedAt = new Date().toISOString();
		if (task.state === "running" || this.#active.has(task.id)) {
			if (task.pending.length >= 8) invalid("待处理补充过多");
			task.pending.push(input.message);
			this.#message(
				input.conversationId,
				"assistant",
				"补充已记录到此任务，当前执行结束后会沿用原工作区继续处理。",
				"notice",
				task.id,
			);
			return;
		}
		this.#message(
			input.conversationId,
			"assistant",
			"已记录本次调整，继续处理原任务。",
			"task",
			task.id,
		);
		this.#launch(task, input.message);
	}
	#launch(task: HubTask, continuation?: string) {
		const run = this.#run(task, continuation);
		this.#runs.add(run);
		void run.finally(() => this.#runs.delete(run)).catch(() => undefined);
	}
	async stopped() {
		this.shutdown();
		await Promise.allSettled([...this.#runs]);
	}
	async #run(task: HubTask, continuation?: string) {
		if (this.#stopped) return;
		if (this.#active.size >= 2) {
			task.state = "queued";
			task.progress = "等待执行名额";
			this.#save();
			return;
		}
		task.pending = [];
		const controller = new AbortController();
		this.#active.set(task.id, controller);
		task.state = "running";
		task.progress = continuation ? "按最新决定继续执行" : "执行中";
		task.revision++;
		this.#save();
		try {
			const execute =
				continuation && task.executionId
					? this.dependencies.continue
					: undefined;
			const result = execute
				? await execute(
						structuredClone(task),
						continuation ?? "",
						controller.signal,
					)
				: await this.dependencies.execute?.(
						structuredClone(task),
						controller.signal,
						(id) => {
							if (!controller.signal.aborted) {
								task.executionId = id;
								this.#save();
							}
						},
					);
			if (controller.signal.aborted || this.#stopped) return;
			task.state = result?.state ?? "failed";
			task.result = (
				result?.result ?? "执行器尚未连接，请检查配置后继续此任务。"
			).slice(0, 24000);
			task.evidence = (result?.evidence ?? [])
				.slice(0, 32)
				.map((s) => s.slice(0, 2000));
			task.progress =
				task.state === "completed" ? "已完成并收到执行结果" : "执行未完成";
			task.updatedAt = new Date().toISOString();
			this.#message(
				task.conversationId,
				"assistant",
				task.result,
				"result",
				task.id,
			);
		} catch (error) {
			if (!controller.signal.aborted && !this.#stopped) {
				task.state = "failed";
				task.progress =
					error instanceof AgentMeError && error.code === "INVALID_CONTRACT"
						? error.message
						: "执行失败，目标和约束已保留。请检查模型或编码后端配置后继续。";
				this.#message(
					task.conversationId,
					"assistant",
					task.progress,
					"notice",
					task.id,
				);
			}
		} finally {
			this.#active.delete(task.id);
			this.#save();
			if (task.pending.length && task.state === "completed" && !this.#stopped) {
				const next = task.pending.splice(0).join("\n");
				this.#save();
				this.#launch(task, next);
			}
			for (const queued of this.#data.tasks.filter(
				(t) => t.state === "queued",
			)) {
				if (this.#active.size >= 2) break;
				this.#launch(queued, queued.decisions.at(-1));
			}
		}
	}
	async #model(
		messages: readonly {
			role: "system" | "user" | "assistant";
			content: string;
		}[],
		signal: AbortSignal,
	): Promise<string> {
		signal.throwIfAborted();
		let abort: () => void = () => {};
		try {
			const reply = await Promise.race([
				this.dependencies.model?.(messages, signal),
				new Promise<never>((_, reject) => {
					abort = () => reject(signal.reason);
					signal.addEventListener("abort", abort, { once: true });
				}),
			]);
			signal.throwIfAborted();
			return text(reply, 24000);
		} finally {
			signal.removeEventListener("abort", abort);
		}
	}
	shutdown() {
		this.#stopped = true;
		this.#lifecycle.abort();
		for (const [id, controller] of this.#active) {
			controller.abort();
			const task = this.#data.tasks.find((t) => t.id === id);
			if (task) {
				task.state = "interrupted";
				task.progress = "后台停止；任务状态已保留";
			}
		}
		this.#save();
	}
}
