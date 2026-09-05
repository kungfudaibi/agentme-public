import { randomUUID } from "node:crypto";

import type {
	StandingIntentRecord,
	StandingIntentStore,
} from "../../../packages/automation-runtime/src/index.js";
import { AgentMeError } from "../../../packages/contracts/src/index.js";
import {
	parseScheduledAssistantPayload,
	type ScheduledAssistantPayload,
} from "./automation-api.js";

export type StandingIntentRoute =
	| { readonly type: "standing-intent.list" }
	| { readonly type: "standing-intent.create" }
	| { readonly type: "standing-intent.cancel"; readonly intentId: string };

export interface StandingIntentAuditEvent {
	readonly type: "standing-intent.mutated";
	readonly operation: "created" | "cancelled" | "dispatched" | "failed";
	readonly intentId: string;
	readonly at: string;
	readonly parentId?: string;
}

export interface PublicStandingIntent {
	readonly id: string;
	readonly eventType: "task.completed" | "task.failed";
	readonly expiresAt: string;
	readonly cooldownMinutes: number;
	readonly maxFires: number;
	readonly firedCount: number;
	readonly state: StandingIntentRecord["state"];
	readonly instruction: string;
	readonly repositoryId: string;
	readonly runtimeId: string;
	readonly createdAt: string;
	readonly lastFiredAt?: string;
	readonly cancelledAt?: string;
	readonly lastParentId?: string;
	readonly lastFailureMessage?: string;
}

interface StandingIntentRouteInput {
	readonly contentType?: string;
	readonly body?: unknown;
	readonly now?: string;
	readonly audit?: (event: StandingIntentAuditEvent) => void | Promise<void>;
}

const idPattern = /^[a-z0-9][a-z0-9-]{0,99}$/u;
const eventTypes = new Set(["task.completed", "task.failed"] as const);

export function matchStandingIntentRoute(
	method: string | undefined,
	pathname: string,
): StandingIntentRoute | undefined {
	if (pathname === "/automations/intents") {
		if (method === "GET") return { type: "standing-intent.list" };
		if (method === "POST") return { type: "standing-intent.create" };
		return undefined;
	}
	const match = /^\/automations\/intents\/([^/]+)\/cancel$/u.exec(pathname);
	if (method !== "POST" || match === null) return undefined;
	let intentId: string;
	try {
		intentId = decodeURIComponent(match[1] ?? "");
	} catch {
		return undefined;
	}
	return idPattern.test(intentId)
		? { type: "standing-intent.cancel", intentId }
		: undefined;
}

export async function executeStandingIntentRoute(
	store: StandingIntentStore,
	route: StandingIntentRoute,
	input: StandingIntentRouteInput,
): Promise<
	PublicStandingIntent | { readonly data: readonly PublicStandingIntent[] }
> {
	const now = input.now ?? new Date().toISOString();
	if (route.type === "standing-intent.list") {
		if (input.body !== undefined || input.contentType !== undefined) invalid();
		return { data: store.list("local-owner", 100, now).map(publicRecord) };
	}
	if (route.type === "standing-intent.cancel") {
		if (input.body !== undefined || input.contentType !== undefined) invalid();
		if (!store.cancel(route.intentId, "local-owner", now))
			throw new AgentMeError({
				code: "INVALID_TASK_TRANSITION",
				message: "Only active standing intents can be cancelled",
				isRetryable: false,
			});
		const record = store.get(route.intentId, now);
		await input.audit?.({
			type: "standing-intent.mutated",
			operation: "cancelled",
			intentId: record.id,
			at: now,
		});
		return publicRecord(record);
	}
	const body = jsonBody(input);
	if (
		!hasOnlyKeys(body, [
			"eventType",
			"expiresAt",
			"cooldownMinutes",
			"maxFires",
			"instruction",
			"repositoryId",
			"runtimeId",
		]) ||
		(body.eventType !== "task.completed" && body.eventType !== "task.failed") ||
		typeof body.expiresAt !== "string" ||
		!Number.isSafeInteger(body.cooldownMinutes) ||
		(body.cooldownMinutes as number) < 0 ||
		(body.cooldownMinutes as number) > 525_600 ||
		!Number.isSafeInteger(body.maxFires) ||
		(body.maxFires as number) < 1 ||
		(body.maxFires as number) > 100 ||
		typeof body.instruction !== "string" ||
		typeof body.repositoryId !== "string" ||
		typeof body.runtimeId !== "string" ||
		!canonicalTimestamp(body.expiresAt) ||
		Date.parse(body.expiresAt) <= Date.parse(now) ||
		Date.parse(body.expiresAt) > Date.parse(now) + 365 * 86_400_000
	)
		return invalid();
	const payload = parseScheduledAssistantPayload(
		JSON.stringify({
			instruction: body.instruction,
			repositoryId: body.repositoryId,
			runtimeId: body.runtimeId,
		}),
	);
	const record = store.create({
		id: randomUUID(),
		ownerId: "local-owner",
		eventType: body.eventType,
		expiresAt: body.expiresAt,
		cooldownMs: (body.cooldownMinutes as number) * 60_000,
		maxFires: body.maxFires as number,
		allowedTools: ["task.create"],
		payload: JSON.stringify(payload),
		createdAt: now,
	});
	await input.audit?.({
		type: "standing-intent.mutated",
		operation: "created",
		intentId: record.id,
		at: now,
	});
	return publicRecord(record);
}

export function parseStandingIntentPayload(
	value: string,
): ScheduledAssistantPayload {
	return parseScheduledAssistantPayload(value);
}

function publicRecord(record: StandingIntentRecord): PublicStandingIntent {
	const payload = parseStandingIntentPayload(record.payload);
	if (!eventTypes.has(record.eventType as "task.completed" | "task.failed"))
		return invalid();
	return {
		id: record.id,
		eventType: record.eventType as "task.completed" | "task.failed",
		expiresAt: record.expiresAt,
		cooldownMinutes: record.cooldownMs / 60_000,
		maxFires: record.maxFires,
		firedCount: record.firedCount,
		state: record.state,
		instruction: payload.instruction,
		repositoryId: payload.repositoryId,
		runtimeId: payload.runtimeId,
		createdAt: record.createdAt,
		...(record.lastFiredAt === undefined
			? {}
			: { lastFiredAt: record.lastFiredAt }),
		...(record.cancelledAt === undefined
			? {}
			: { cancelledAt: record.cancelledAt }),
		...(record.lastParentId === undefined
			? {}
			: { lastParentId: record.lastParentId }),
		...(record.lastFailureMessage === undefined
			? {}
			: { lastFailureMessage: record.lastFailureMessage }),
	};
}

function jsonBody(input: StandingIntentRouteInput): Record<string, unknown> {
	if (
		input.contentType?.toLowerCase().startsWith("application/json") !== true ||
		typeof input.body !== "object" ||
		input.body === null ||
		Array.isArray(input.body)
	)
		return invalid();
	return input.body as Record<string, unknown>;
}

function hasOnlyKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	return Object.keys(value).every((key) => keys.includes(key));
}

function canonicalTimestamp(value: string): boolean {
	const milliseconds = Date.parse(value);
	return (
		!Number.isNaN(milliseconds) &&
		new Date(milliseconds).toISOString() === value
	);
}

function invalid(): never {
	throw new AgentMeError({
		code: "INVALID_CONTRACT",
		message: "Invalid standing intent request",
		isRetryable: false,
	});
}
