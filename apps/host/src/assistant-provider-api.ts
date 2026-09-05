import { AgentMeError } from "../../../packages/contracts/src/index.js";
import type {
	AssistantProviderCatalog,
	AssistantProviderProfileId,
	AssistantProviderService,
} from "./assistant-provider-manager.js";

export type AssistantProviderRoute =
	| { readonly type: "provider.list" }
	| {
			readonly type: "provider.configure" | "provider.activate";
			readonly profileId: AssistantProviderProfileId;
	  };

function invalidRequest(message: string): AgentMeError {
	return new AgentMeError({
		code: "INVALID_CONTRACT",
		message,
		isRetryable: false,
	});
}

export function matchAssistantProviderRoute(
	method: string | undefined,
	pathname: string,
): AssistantProviderRoute | undefined {
	if (method === "GET" && pathname === "/assistant/providers")
		return { type: "provider.list" };
	if (method !== "POST") return undefined;
	const match =
		/^\/assistant\/providers\/(deepseek|aliyun)\/(configure|activate)$/.exec(
			pathname,
		);
	if (match === null) return undefined;
	return {
		type: match[2] === "configure" ? "provider.configure" : "provider.activate",
		profileId: match[1] as AssistantProviderProfileId,
	};
}

export async function executeAssistantProviderRoute(
	service: AssistantProviderService,
	route: AssistantProviderRoute,
	input: { readonly contentType?: string; readonly body?: unknown },
	signal: AbortSignal,
): Promise<AssistantProviderCatalog> {
	if (route.type === "provider.list") return service.list(signal);
	if (route.type === "provider.activate") {
		await service.activate(route.profileId, signal);
		return service.list(signal);
	}
	if (!input.contentType?.toLowerCase().startsWith("application/json"))
		throw invalidRequest("Provider configuration requires JSON");
	if (
		typeof input.body !== "object" ||
		input.body === null ||
		Array.isArray(input.body)
	)
		throw invalidRequest("Provider configuration is invalid");
	const value = input.body as Record<string, unknown>;
	if (
		Object.keys(value).some(
			(key) => !["endpoint", "model", "apiKey"].includes(key),
		) ||
		typeof value.endpoint !== "string" ||
		typeof value.model !== "string" ||
		(value.apiKey !== undefined && typeof value.apiKey !== "string")
	)
		throw invalidRequest("Provider configuration is invalid");
	await service.configure(
		route.profileId,
		{
			endpoint: value.endpoint,
			model: value.model,
			...(typeof value.apiKey === "string" ? { apiKey: value.apiKey } : {}),
		},
		signal,
	);
	return service.list(signal);
}
