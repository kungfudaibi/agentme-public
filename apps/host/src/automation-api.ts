import { randomUUID } from "node:crypto";

import type {
	DurableScheduler,
	ScheduledJobRecord,
} from "../../../packages/automation-runtime/src/index.js";
import { AgentMeError } from "../../../packages/contracts/src/index.js";

export interface ScheduledAssistantPayload {
	readonly instruction: string;
	readonly repositoryId: string;
	readonly runtimeId: string;
}

export type AutomationRoute =
	| { readonly type: "automation.list" }
	| { readonly type: "automation.create" }
	| { readonly type: "automation.cancel"; readonly jobId: string };

export interface AutomationAuditEvent {
	readonly type: "automation.mutated";
	readonly operation: "scheduled" | "cancelled" | "dispatched" | "failed";
	readonly jobId: string;
	readonly at: string;
	readonly parentId?: string;
}

export interface AutomationRouteInput {
	readonly contentType?: string;
	readonly body?: unknown;
	readonly now?: string;
	readonly audit?: (event: AutomationAuditEvent) => void | Promise<void>;
}

const jobIdPattern = /^[a-z0-9][a-z0-9-]{0,99}$/u;
const capabilityIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export function matchAutomationRoute(
	method: string | undefined,
	pathname: string,
): AutomationRoute | undefined {
	if (pathname === "/automations/jobs") {
		if (method === "GET") return { type: "automation.list" };
		if (method === "POST") return { type: "automation.create" };
		return undefined;
	}
	const match = pathname.match(/^\/automations\/jobs\/([^/]+)\/cancel$/u);
	if (method !== "POST" || match === null) return undefined;
	let jobId: string;
	try {
		jobId = decodeURIComponent(match[1] ?? "");
	} catch {
		return undefined;
	}
	return jobIdPattern.test(jobId)
		? { type: "automation.cancel", jobId }
		: undefined;
}

export async function executeAutomationRoute(
	scheduler: DurableScheduler,
	route: AutomationRoute,
	input: AutomationRouteInput,
): Promise<unknown> {
	if (route.type === "automation.list") {
		if (input.body !== undefined || input.contentType !== undefined)
			invalidInput();
		return { data: scheduler.list("local-owner").map(publicRecord) };
	}
	const now = input.now ?? new Date().toISOString();
	if (route.type === "automation.create") {
		const body = jsonBody(input);
		if (
			!hasOnlyKeys(body, [
				"runAt",
				"instruction",
				"repositoryId",
				"runtimeId",
			]) ||
			typeof body.runAt !== "string" ||
			typeof body.instruction !== "string" ||
			typeof body.repositoryId !== "string" ||
			typeof body.runtimeId !== "string"
		)
			return invalidInput();
		const payload = validatePayload({
			instruction: body.instruction,
			repositoryId: body.repositoryId,
			runtimeId: body.runtimeId,
		});
		if (!isCanonicalTimestamp(body.runAt)) return invalidInput();
		const runAtMs = Date.parse(body.runAt);
		const nowMs = Date.parse(now);
		if (runAtMs < nowMs - 5 * 60_000 || runAtMs > nowMs + 10 * 365 * 86_400_000)
			return invalidInput();
		const record = scheduler.schedule({
			id: randomUUID(),
			ownerId: "local-owner",
			runAt: body.runAt,
			payload: JSON.stringify(payload),
		});
		await input.audit?.({
			type: "automation.mutated",
			operation: "scheduled",
			jobId: record.id,
			at: now,
		});
		return publicRecord(record);
	}
	if (input.body !== undefined || input.contentType !== undefined)
		invalidInput();
	if (!scheduler.cancel(route.jobId, "local-owner", now))
		throw new AgentMeError({
			code: "INVALID_TASK_TRANSITION",
			message: "Only pending scheduled work can be cancelled",
			isRetryable: false,
		});
	const record = scheduler.get(route.jobId);
	await input.audit?.({
		type: "automation.mutated",
		operation: "cancelled",
		jobId: record.id,
		at: now,
	});
	return publicRecord(record);
}

export function parseScheduledAssistantPayload(
	value: string,
): ScheduledAssistantPayload {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return invalidPayload();
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
		return invalidPayload();
	const item = parsed as Record<string, unknown>;
	if (
		!hasOnlyKeys(item, ["instruction", "repositoryId", "runtimeId"]) ||
		typeof item.instruction !== "string" ||
		typeof item.repositoryId !== "string" ||
		typeof item.runtimeId !== "string"
	)
		return invalidPayload();
	return validatePayload({
		instruction: item.instruction,
		repositoryId: item.repositoryId,
		runtimeId: item.runtimeId,
	});
}

function publicRecord(record: ScheduledJobRecord) {
	const payload = parseScheduledAssistantPayload(record.payload);
	return {
		id: record.id,
		runAt: record.runAt,
		createdAt: record.createdAt,
		state: record.state,
		instruction: payload.instruction,
		repositoryId: payload.repositoryId,
		runtimeId: payload.runtimeId,
		...(record.firedAt === undefined ? {} : { firedAt: record.firedAt }),
		...(record.cancelledAt === undefined
			? {}
			: { cancelledAt: record.cancelledAt }),
		...(record.parentId === undefined ? {} : { parentId: record.parentId }),
		...(record.failureMessage === undefined
			? {}
			: { failureMessage: record.failureMessage }),
	};
}

function validatePayload(
	payload: ScheduledAssistantPayload,
): ScheduledAssistantPayload {
	const instruction = payload.instruction.trim();
	if (
		instruction.length < 2 ||
		instruction.length > 8_000 ||
		!capabilityIdPattern.test(payload.repositoryId) ||
		!capabilityIdPattern.test(payload.runtimeId)
	)
		return invalidPayload();
	return { ...payload, instruction };
}

function jsonBody(input: AutomationRouteInput): Record<string, unknown> {
	if (
		input.contentType?.toLowerCase().startsWith("application/json") !== true ||
		typeof input.body !== "object" ||
		input.body === null ||
		Array.isArray(input.body)
	)
		return invalidInput();
	return input.body as Record<string, unknown>;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
	return Object.keys(value).every((key) => keys.includes(key));
}

function isCanonicalTimestamp(value: string): boolean {
	const milliseconds = Date.parse(value);
	return (
		!Number.isNaN(milliseconds) &&
		new Date(milliseconds).toISOString() === value
	);
}

function invalidPayload(): never {
	throw new AgentMeError({
		code: "INVALID_CONTRACT",
		message: "Invalid scheduled assistant task",
		isRetryable: false,
	});
}

function invalidInput(): never {
	throw new AgentMeError({
		code: "INVALID_CONTRACT",
		message: "Invalid automation request",
		isRetryable: false,
	});
}
