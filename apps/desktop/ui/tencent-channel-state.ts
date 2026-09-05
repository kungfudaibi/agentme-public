export type TencentChannelStatus =
	| "disabled"
	| "starting"
	| "running"
	| "error";

export interface TencentChannelView {
	readonly id: "tencent-qq";
	readonly isEnabled: boolean;
	readonly isConfigured: boolean;
	readonly status: TencentChannelStatus;
	readonly ownerId: string;
	readonly accountId: string;
}

export interface TencentChannelConfigurationInput {
	readonly isEnabled: boolean;
	readonly ownerId: string;
	readonly accountId: string;
	readonly appId: string;
	readonly appSecret: string;
}

export interface TencentChannelConfiguration {
	readonly isEnabled: boolean;
	readonly ownerId: string;
	readonly accountId: string;
	readonly appId?: string;
	readonly appSecret?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: string, allowEmpty = false): boolean {
	return (
		(allowEmpty && value.length === 0) ||
		/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)
	);
}

function ownerIdentifier(value: string, allowEmpty = false): boolean {
	return (
		(allowEmpty && value.length === 0) ||
		/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
	);
}

export function parseTencentChannelView(value: unknown): TencentChannelView {
	if (
		!isRecord(value) ||
		Object.keys(value).some(
			(key) =>
				![
					"id",
					"isEnabled",
					"isConfigured",
					"status",
					"ownerId",
					"accountId",
				].includes(key),
		) ||
		value.id !== "tencent-qq" ||
		typeof value.isEnabled !== "boolean" ||
		typeof value.isConfigured !== "boolean" ||
		!["disabled", "starting", "running", "error"].includes(
			value.status as string,
		) ||
		typeof value.ownerId !== "string" ||
		!ownerIdentifier(value.ownerId, !value.isEnabled) ||
		typeof value.accountId !== "string" ||
		!identifier(value.accountId)
	)
		throw new TypeError("Invalid Tencent channel view");
	return value as unknown as TencentChannelView;
}

export function buildTencentChannelConfiguration(
	input: TencentChannelConfigurationInput,
): TencentChannelConfiguration {
	const ownerId = input.ownerId.trim();
	const accountId = input.accountId.trim();
	const appId = input.appId.trim();
	const appSecret = input.appSecret.trim();
	if (
		!ownerIdentifier(ownerId, !input.isEnabled) ||
		!identifier(accountId) ||
		appId.length > 4_096 ||
		appSecret.length > 4_096 ||
		/[\r\n\0]/u.test(appId) ||
		/[\r\n\0]/u.test(appSecret)
	)
		throw new TypeError("Invalid Tencent channel configuration");
	return {
		isEnabled: input.isEnabled,
		ownerId,
		accountId,
		...(appId.length === 0 ? {} : { appId }),
		...(appSecret.length === 0 ? {} : { appSecret }),
	};
}
