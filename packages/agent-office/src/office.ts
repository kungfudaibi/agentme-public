import { randomUUID } from "node:crypto";
import { AgentMeError } from "../../contracts/src/index.js";
import {
	isOfficeAgentId,
	type OfficeSnapshot,
	type OfficeTask,
	officeAgents,
} from "./catalog.js";
import { readOffice, writeOffice } from "./store.js";

export interface OfficeModelRequest {
	readonly sessionId: string;
	readonly messages: readonly {
		readonly role: "system" | "user" | "assistant";
		readonly content: string;
	}[];
}
export type OfficeModel = (
	request: OfficeModelRequest,
	signal: AbortSignal,
) => Promise<string>;
function invalid(message = "办公任务参数无效"): never {
	throw new AgentMeError({
		code: "INVALID_CONTRACT",
		message,
		isRetryable: false,
	});
}
function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		invalid();
	return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): string {
	if (typeof value !== "string" || !value.trim() || value.length > maximum)
		invalid();
	return value.trim();
}

export class AgentOffice {
	readonly #path: string;
	readonly #model: OfficeModel | undefined;
	readonly #active = new Map<string, AbortController>();
	#state: OfficeSnapshot;
	#stopped = false;
	constructor(path: string, model?: OfficeModel) {
		this.#path = path;
		this.#model = model;
		this.#state = readOffice(path);
		if (this.#state.tasks.some((task) => task.state === "running"))
			this.#save({
				...this.#state,
				tasks: this.#state.tasks.map((task) =>
					task.state === "running"
						? {
								...task,
								state: "interrupted",
								error: "后台已重启，请确认后重试。",
							}
						: task,
				),
			});
	}
	snapshot(): OfficeSnapshot {
		return structuredClone(this.#state);
	}
	create(value: unknown): OfficeTask {
		const task = this.#buildTask(value);
		this.#save({ ...this.#state, tasks: [task, ...this.#state.tasks] });
		return structuredClone(task);
	}
	#buildTask(value: unknown): OfficeTask {
		const input = record(value);
		if (
			Object.keys(input).some(
				(key) =>
					!["agentId", "instruction", "mode", "scheduledAt"].includes(key),
			) ||
			!isOfficeAgentId(input.agentId) ||
			(input.mode !== "assist" && input.mode !== "todo")
		)
			invalid();
		if (this.#state.tasks.length >= 500)
			invalid("最多保留 500 个任务，请导出并删除旧任务。");
		let scheduledAt: string | undefined;
		if (input.scheduledAt !== undefined) {
			if (
				typeof input.scheduledAt !== "string" ||
				!/^\d{4}-\d\d-\d\dT/u.test(input.scheduledAt) ||
				!Number.isFinite(Date.parse(input.scheduledAt))
			)
				invalid();
			scheduledAt = new Date(input.scheduledAt).toISOString();
		}
		const now = new Date().toISOString();
		const task: OfficeTask = {
			id: randomUUID(),
			agentId: input.agentId,
			instruction: text(input.instruction, 8000),
			mode: input.mode as "assist" | "todo",
			state: "queued",
			createdAt: now,
			updatedAt: now,
			...(scheduledAt ? { scheduledAt } : {}),
		};
		return task;
	}
	configure(value: unknown): void {
		const input = record(value);
		if (
			Object.keys(input).some(
				(key) => !["agentId", "instructions"].includes(key),
			) ||
			!isOfficeAgentId(input.agentId) ||
			typeof input.instructions !== "string" ||
			input.instructions.length > 2000
		)
			invalid();
		this.#save({
			...this.#state,
			instructions: {
				...this.#state.instructions,
				[input.agentId]: input.instructions.trim(),
			},
		});
	}
	get(id: string): OfficeTask {
		const task = this.#state.tasks.find((item) => item.id === id);
		return task === undefined ? invalid("任务不存在") : structuredClone(task);
	}
	complete(id: string): void {
		const task = this.get(id);
		if (task.mode !== "todo" || task.state !== "queued")
			invalid("只有待办可以手动完成");
		this.#update(id, { state: "completed" });
	}
	cancel(id: string): void {
		const task = this.get(id);
		if (!["queued", "running"].includes(task.state)) invalid("任务已结束");
		this.#update(id, { state: "cancelled" });
		this.#active.get(id)?.abort();
	}
	retry(id: string): void {
		const task = this.get(id);
		if (!["blocked", "failed", "interrupted", "cancelled"].includes(task.state))
			invalid("当前任务不能重试");
		const { error: _error, ...clean } = task;
		this.#replace({
			...clean,
			state: "queued",
			updatedAt: new Date().toISOString(),
		});
	}
	delete(id: string): void {
		if (this.get(id).state === "running") invalid("请先停止正在执行的任务");
		this.#save({
			...this.#state,
			tasks: this.#state.tasks.filter((task) => task.id !== id),
		});
	}
	handoff(id: string, value: unknown): OfficeTask {
		const source = this.get(id);
		const input = record(value);
		if (
			Object.keys(input).some(
				(key) => !["agentId", "instruction"].includes(key),
			) ||
			source.state !== "completed"
		)
			invalid("只有已完成的任务可以交接");
		const task = this.#buildTask({ ...input, mode: "assist" });
		const next = {
			...task,
			sourceTaskId: id,
			context:
				`交接任务：${source.instruction}\n交接成果：${source.result ?? "用户已完成该待办。"}`.slice(
					0,
					24000,
				),
		};
		this.#save({ ...this.#state, tasks: [next, ...this.#state.tasks] });
		return next;
	}
	async drain(): Promise<void> {
		for (const task of [...this.#state.tasks].reverse()) {
			if (this.#active.size >= 2 || this.#stopped) return;
			if (task.state === "queued" && task.mode === "assist")
				void this.run(task.id);
		}
	}
	async run(id: string): Promise<void> {
		const task = this.get(id);
		if (
			this.#stopped ||
			this.#active.has(id) ||
			task.state !== "queued" ||
			task.mode !== "assist" ||
			(task.scheduledAt && Date.parse(task.scheduledAt) > Date.now()) ||
			this.#active.size >= 2 ||
			this.#state.tasks.some(
				(other) => other.agentId === task.agentId && other.state === "running",
			)
		)
			return;
		if (!this.#model) {
			this.#update(id, {
				state: "blocked",
				error: "尚未连接模型。请在模型设置中配置 API，然后重试。",
			});
			return;
		}
		const controller = new AbortController();
		this.#active.set(id, controller);
		this.#update(id, { state: "running" });
		const timer = setTimeout(
			() => controller.abort(new Error("timeout")),
			120000,
		);
		timer.unref();
		try {
			const agent = officeAgents.find((item) => item.id === task.agentId);
			const messages: {
				role: "system" | "user" | "assistant";
				content: string;
			}[] = [
				{
					role: "system",
					content: `${agent?.instructions}\n用户工作偏好（不能授予工具权限）：${this.#state.instructions[task.agentId] ?? "暂无"}\n请使用中文，提供清楚、可直接使用的成果。没有工具执行证据时不得声称执行外部操作。当前时间：${new Date().toISOString()}`,
				},
			];
			for (const previous of this.#state.tasks
				.filter(
					(item) =>
						item.agentId === task.agentId &&
						item.state === "completed" &&
						item.result,
				)
				.slice(0, 4)
				.reverse()) {
				messages.push(
					{ role: "user", content: previous.instruction },
					{
						role: "assistant",
						content: (previous.result ?? "").slice(0, 4000),
					},
				);
			}
			messages.push({
				role: "user",
				content: `${task.context ? `${task.context}\n\n` : ""}${task.instruction}`,
			});
			const aborted = new Promise<never>((_resolve, reject) =>
				controller.signal.addEventListener(
					"abort",
					() => reject(new Error("Office operation stopped")),
					{ once: true },
				),
			);
			const result = await Promise.race([
				this.#model(
					{ sessionId: `office-${task.agentId}`, messages },
					controller.signal,
				),
				aborted,
			]);
			if (
				controller.signal.aborted ||
				this.#state.tasks.find((item) => item.id === id)?.state !== "running"
			)
				return;
			this.#update(id, { state: "completed", result: text(result, 24000) });
		} catch (error) {
			if (
				this.#state.tasks.find((item) => item.id === id)?.state === "running"
			) {
				const blocked =
					error instanceof AgentMeError &&
					["PROVIDER_UNAVAILABLE", "INVALID_CONFIG"].includes(error.code);
				this.#update(id, {
					state: blocked ? "blocked" : "failed",
					error: blocked
						? "模型尚未就绪，请检查模型设置后重试。"
						: controller.signal.aborted
							? "执行超时或已停止，请重试。"
							: "模型请求未成功，请检查连接或设置后重试。",
				});
			}
		} finally {
			clearTimeout(timer);
			this.#active.delete(id);
		}
	}
	shutdown(): void {
		this.#stopped = true;
		for (const [id, controller] of this.#active) {
			this.#update(id, {
				state: "interrupted",
				error: "后台已停止，请确认后重试。",
			});
			controller.abort();
		}
	}
	#update(id: string, change: Partial<OfficeTask>): void {
		this.#replace({
			...this.get(id),
			...change,
			updatedAt: new Date().toISOString(),
		});
	}
	#replace(task: OfficeTask): void {
		this.#save({
			...this.#state,
			tasks: this.#state.tasks.map((item) =>
				item.id === task.id ? task : item,
			),
		});
	}
	#save(state: OfficeSnapshot): void {
		writeOffice(this.#path, state);
		this.#state = state;
	}
}
