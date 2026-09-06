import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { AgentMeError } from "../../contracts/src/index.js";
import type { HubData } from "./types.js";
export function invalid(message = "对话请求无效"): never {
	throw new AgentMeError({
		code: "INVALID_CONTRACT",
		message,
		isRetryable: false,
	});
}
export function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
	return value as Record<string, unknown>;
}
export function text(value: unknown, max = 8000): string {
	if (typeof value !== "string" || !value.trim() || value.length > max)
		invalid();
	return value.trim();
}
export function strings(value: unknown, max = 16): string[] {
	if (!Array.isArray(value) || value.length > max) invalid();
	return value.map((v) => text(v, 2000));
}
export function loadHub(path: string): HubData {
	try {
		if (statSync(path).size > 24 * 1024 * 1024) invalid("对话数据超过大小限制");
		const raw = object(JSON.parse(readFileSync(path, "utf8")));
		if (
			Object.keys(raw).some(
				(k) => !["version", "conversations", "messages", "tasks"].includes(k),
			) ||
			raw.version !== 1 ||
			!Array.isArray(raw.conversations) ||
			!Array.isArray(raw.messages) ||
			!Array.isArray(raw.tasks) ||
			raw.conversations.length > 100 ||
			raw.messages.length > 5000 ||
			raw.tasks.length > 500
		)
			invalid();
		const ids = new Set<string>();
		const uuid = (value: unknown) => {
			const id = text(value, 36);
			if (
				value !== id ||
				!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
					id,
				) ||
				ids.has(id)
			)
				invalid();
			ids.add(id);
			return id;
		};
		const date = (value: unknown) => {
			const str = text(value, 40);
			if (!Number.isFinite(Date.parse(str))) invalid();
			return str;
		};
		const conversations = raw.conversations.map((item) => {
			const v = object(item);
			return {
				id: uuid(v.id),
				title: text(v.title, 100),
				createdAt: date(v.createdAt),
			};
		});
		for (const item of raw.tasks) {
			const v = object(item);
			if (
				Object.keys(v).some(
					(k) =>
						![
							"id",
							"conversationId",
							"kind",
							"goal",
							"sources",
							"constraints",
							"decisions",
							"progress",
							"state",
							"createdAt",
							"updatedAt",
							"revision",
							"result",
							"evidence",
							"executionId",
							"repositoryId",
							"runtimeId",
							"agentId",
							"pending",
						].includes(k),
				)
			)
				invalid();
			uuid(v.id);
			date(v.createdAt);
			date(v.updatedAt);
			text(v.goal);
			text(v.progress, 2000);
			strings(v.constraints);
			if (v.sources !== undefined) strings(v.sources, 3);
			strings(v.decisions, 32);
			strings(v.evidence, 32);
			strings(v.pending, 8);
			text(v.agentId, 40);
			if (
				!conversations.some((c) => c.id === v.conversationId) ||
				typeof v.kind !== "string" ||
				!["office", "coding"].includes(v.kind) ||
				![
					"queued",
					"running",
					"completed",
					"failed",
					"cancelled",
					"interrupted",
				].includes(typeof v.state === "string" ? v.state : "") ||
				!Number.isSafeInteger(v.revision) ||
				Number(v.revision) < 0
			)
				invalid();
			for (const key of ["repositoryId", "runtimeId", "executionId"])
				if (v[key] !== undefined) text(v[key], 200);
			if (v.result !== undefined) text(v.result, 24000);
		}
		for (const item of raw.messages) {
			const v = object(item);
			uuid(v.id);
			date(v.createdAt);
			text(v.content, 24000);
			if (
				!conversations.some((c) => c.id === v.conversationId) ||
				typeof v.role !== "string" ||
				!["user", "assistant"].includes(v.role) ||
				typeof v.kind !== "string" ||
				!["chat", "task", "result", "notice"].includes(v.kind)
			)
				invalid();
			if (
				v.taskId !== undefined &&
				!raw.tasks.some(
					(t) =>
						object(t).id === v.taskId &&
						object(t).conversationId === v.conversationId,
				)
			)
				invalid();
		}
		return {
			version: 1,
			conversations,
			messages: raw.messages,
			tasks: raw.tasks,
		} as HubData;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return { version: 1, conversations: [], messages: [], tasks: [] };
		throw error;
	}
}
export function saveHub(path: string, data: HubData): void {
	const body = JSON.stringify(data);
	if (Buffer.byteLength(body) > 24 * 1024 * 1024) invalid("对话存储已满");
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temp, body, { mode: 0o600 });
		renameSync(temp, path);
	} finally {
		rmSync(temp, { force: true });
	}
}
