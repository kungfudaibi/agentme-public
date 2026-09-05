import { AgentMeError } from "../../../packages/contracts/src/index.js";
import type {
	TencentChannelConfiguration,
	TencentChannelService,
	TencentChannelView,
} from "./tencent-channel-manager.js";

export type TencentChannelRoute =
	| { readonly type: "tencent-channel.view" }
	| { readonly type: "tencent-channel.replace" };

function invalidRequest(message: string): AgentMeError {
	return new AgentMeError({
		code: "INVALID_CONTRACT",
		message,
		isRetryable: false,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function matchTencentChannelRoute(
	method: string | undefined,
	pathname: string,
): TencentChannelRoute | undefined {
	if (pathname !== "/channels/tencent-qq") return undefined;
	if (method === "GET") return { type: "tencent-channel.view" };
	if (method === "PUT") return { type: "tencent-channel.replace" };
	return undefined;
}

export async function executeTencentChannelRoute(
	service: TencentChannelService,
	route: TencentChannelRoute,
	input: { readonly contentType?: string; readonly body?: unknown },
	signal: AbortSignal,
): Promise<TencentChannelView> {
	if (route.type === "tencent-channel.view") return service.view(signal);
	if (!input.contentType?.toLowerCase().startsWith("application/json"))
		throw invalidRequest("Tencent channel configuration requires JSON");
	if (!isRecord(input.body))
		throw invalidRequest("Tencent channel configuration is invalid");
	const value = input.body;
	if (
		Object.keys(value).some(
			(key) =>
				!["isEnabled", "ownerId", "accountId", "appId", "appSecret"].includes(
					key,
				),
		) ||
		typeof value.isEnabled !== "boolean" ||
		typeof value.ownerId !== "string" ||
		typeof value.accountId !== "string" ||
		(value.appId !== undefined && typeof value.appId !== "string") ||
		(value.appSecret !== undefined && typeof value.appSecret !== "string")
	)
		throw invalidRequest("Tencent channel configuration is invalid");
	const configuration: TencentChannelConfiguration = {
		isEnabled: value.isEnabled,
		ownerId: value.ownerId,
		accountId: value.accountId,
		...(typeof value.appId === "string" ? { appId: value.appId } : {}),
		...(typeof value.appSecret === "string"
			? { appSecret: value.appSecret }
			: {}),
	};
	return service.configure(configuration, signal);
}
