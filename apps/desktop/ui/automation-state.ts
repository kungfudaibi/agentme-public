export type DesktopScheduledTaskState =
	| "scheduled"
	| "claimed"
	| "dispatched"
	| "cancelled"
	| "failed";

export interface DesktopScheduledTask {
	readonly id: string;
	readonly runAt: string;
	readonly createdAt: string;
	readonly state: DesktopScheduledTaskState;
	readonly instruction: string;
	readonly repositoryId: string;
	readonly runtimeId: string;
	readonly firedAt?: string;
	readonly cancelledAt?: string;
	readonly parentId?: string;
	readonly failureMessage?: string;
}

export interface DesktopScheduledTaskPage {
	readonly data: readonly DesktopScheduledTask[];
}

export interface DesktopStandingIntent {
	readonly id: string;
	readonly eventType: "task.completed" | "task.failed";
	readonly expiresAt: string;
	readonly cooldownMinutes: number;
	readonly maxFires: number;
	readonly firedCount: number;
	readonly state: "active" | "exhausted" | "expired" | "cancelled";
	readonly instruction: string;
	readonly repositoryId: string;
	readonly runtimeId: string;
	readonly createdAt: string;
	readonly lastFiredAt?: string;
	readonly cancelledAt?: string;
	readonly lastParentId?: string;
	readonly lastFailureMessage?: string;
}

export interface DesktopStandingIntentPage {
	readonly data: readonly DesktopStandingIntent[];
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new TypeError("Invalid automation response");
	return value as Record<string, unknown>;
}

function canonicalTimestamp(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const milliseconds = Date.parse(value);
	return (
		!Number.isNaN(milliseconds) &&
		new Date(milliseconds).toISOString() === value
	);
}

function scheduledTask(value: unknown): DesktopScheduledTask {
	const item = record(value);
	const states = new Set<DesktopScheduledTaskState>([
		"scheduled",
		"claimed",
		"dispatched",
		"cancelled",
		"failed",
	]);
	if (
		typeof item.id !== "string" ||
		!canonicalTimestamp(item.runAt) ||
		!canonicalTimestamp(item.createdAt) ||
		!states.has(item.state as DesktopScheduledTaskState) ||
		typeof item.instruction !== "string" ||
		typeof item.repositoryId !== "string" ||
		typeof item.runtimeId !== "string" ||
		(item.firedAt !== undefined && !canonicalTimestamp(item.firedAt)) ||
		(item.cancelledAt !== undefined && !canonicalTimestamp(item.cancelledAt)) ||
		(item.parentId !== undefined && typeof item.parentId !== "string") ||
		(item.failureMessage !== undefined &&
			typeof item.failureMessage !== "string")
	)
		throw new TypeError("Invalid automation response");
	return {
		id: item.id,
		runAt: item.runAt,
		createdAt: item.createdAt,
		state: item.state as DesktopScheduledTaskState,
		instruction: item.instruction,
		repositoryId: item.repositoryId,
		runtimeId: item.runtimeId,
		...(item.firedAt === undefined ? {} : { firedAt: item.firedAt as string }),
		...(item.cancelledAt === undefined
			? {}
			: { cancelledAt: item.cancelledAt as string }),
		...(item.parentId === undefined
			? {}
			: { parentId: item.parentId as string }),
		...(item.failureMessage === undefined
			? {}
			: { failureMessage: item.failureMessage as string }),
	};
}

export function parseScheduledTaskPage(
	value: unknown,
): DesktopScheduledTaskPage {
	const page = record(value);
	if (!Array.isArray(page.data))
		throw new TypeError("Invalid automation response");
	return { data: page.data.map(scheduledTask) };
}

export function buildScheduledTaskInput(
	localRunAt: string,
	instruction: string,
	repositoryId: string,
	runtimeId: string,
): {
	readonly runAt: string;
	readonly instruction: string;
	readonly repositoryId: string;
	readonly runtimeId: string;
} {
	const timestamp = Date.parse(localRunAt);
	const normalizedInstruction = instruction.trim();
	if (
		Number.isNaN(timestamp) ||
		normalizedInstruction.length < 2 ||
		normalizedInstruction.length > 8_000 ||
		!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(repositoryId) ||
		!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(runtimeId)
	)
		throw new TypeError("自动任务格式无效");
	return {
		runAt: new Date(timestamp).toISOString(),
		instruction: normalizedInstruction,
		repositoryId,
		runtimeId,
	};
}

function standingIntent(value: unknown): DesktopStandingIntent {
	const item = record(value);
	if (
		typeof item.id !== "string" ||
		(item.eventType !== "task.completed" && item.eventType !== "task.failed") ||
		!canonicalTimestamp(item.expiresAt) ||
		!Number.isSafeInteger(item.cooldownMinutes) ||
		(item.cooldownMinutes as number) < 0 ||
		(item.cooldownMinutes as number) > 525_600 ||
		!Number.isSafeInteger(item.maxFires) ||
		(item.maxFires as number) < 1 ||
		(item.maxFires as number) > 100 ||
		!Number.isSafeInteger(item.firedCount) ||
		(item.firedCount as number) < 0 ||
		(item.state !== "active" &&
			item.state !== "exhausted" &&
			item.state !== "expired" &&
			item.state !== "cancelled") ||
		typeof item.instruction !== "string" ||
		typeof item.repositoryId !== "string" ||
		typeof item.runtimeId !== "string" ||
		!canonicalTimestamp(item.createdAt) ||
		(item.lastFiredAt !== undefined && !canonicalTimestamp(item.lastFiredAt)) ||
		(item.cancelledAt !== undefined && !canonicalTimestamp(item.cancelledAt)) ||
		(item.lastParentId !== undefined &&
			typeof item.lastParentId !== "string") ||
		(item.lastFailureMessage !== undefined &&
			typeof item.lastFailureMessage !== "string")
	)
		throw new TypeError("Invalid standing intent response");
	return item as unknown as DesktopStandingIntent;
}

export function parseStandingIntentPage(
	value: unknown,
): DesktopStandingIntentPage {
	const page = record(value);
	if (!Array.isArray(page.data))
		throw new TypeError("Invalid standing intent response");
	return { data: page.data.map(standingIntent) };
}

export function buildStandingIntentInput(
	eventType: "task.completed" | "task.failed",
	localExpiresAt: string,
	cooldownMinutes: number,
	maxFires: number,
	instruction: string,
	repositoryId: string,
	runtimeId: string,
): {
	readonly eventType: "task.completed" | "task.failed";
	readonly expiresAt: string;
	readonly cooldownMinutes: number;
	readonly maxFires: number;
	readonly instruction: string;
	readonly repositoryId: string;
	readonly runtimeId: string;
} {
	const timestamp = Date.parse(localExpiresAt);
	const normalizedInstruction = instruction.trim();
	if (
		Number.isNaN(timestamp) ||
		!Number.isSafeInteger(cooldownMinutes) ||
		cooldownMinutes < 0 ||
		cooldownMinutes > 525_600 ||
		!Number.isSafeInteger(maxFires) ||
		maxFires < 1 ||
		maxFires > 100 ||
		normalizedInstruction.length < 2 ||
		normalizedInstruction.length > 8_000 ||
		!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(repositoryId) ||
		!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(runtimeId)
	)
		throw new TypeError("条件任务格式无效");
	return {
		eventType,
		expiresAt: new Date(timestamp).toISOString(),
		cooldownMinutes,
		maxFires,
		instruction: normalizedInstruction,
		repositoryId,
		runtimeId,
	};
}
