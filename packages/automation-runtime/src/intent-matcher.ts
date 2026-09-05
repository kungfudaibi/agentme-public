export interface StandingIntent {
	readonly id: string;
	readonly ownerId: string;
	readonly eventType: string;
	readonly expiresAt: string;
	readonly cooldownMs: number;
	readonly maxFires: number;
	readonly allowedTools: readonly string[];
	readonly firedCount: number;
	readonly lastFiredAt?: string;
}
export function canFireIntent(
	intent: StandingIntent,
	event: {
		readonly type: string;
		readonly actorId: string;
		readonly authenticated: boolean;
	},
	now: string,
	requestedTools: readonly string[],
): boolean {
	if (
		!event.authenticated ||
		event.actorId !== intent.ownerId ||
		event.type !== intent.eventType ||
		Date.parse(now) >= Date.parse(intent.expiresAt) ||
		intent.firedCount >= intent.maxFires
	)
		return false;
	if (
		intent.lastFiredAt &&
		Date.parse(now) - Date.parse(intent.lastFiredAt) < intent.cooldownMs
	)
		return false;
	return requestedTools.every((tool) => intent.allowedTools.includes(tool));
}
