import { AgentMeError } from "../../../packages/contracts/src/index.js";
import type {
	CodingPermissionCatalog,
	CodingPermissionProfileId,
	CodingPermissionService,
} from "./coding-permission-manager.js";

export type CodingPermissionRoute =
	| { readonly type: "coding-permissions.list" }
	| { readonly type: "coding-permissions.activate" };

export interface CodingPermissionAuditEvent {
	readonly type: "coding-permissions.activated";
	readonly profileId: CodingPermissionProfileId;
}

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

export function matchCodingPermissionRoute(
	method: string | undefined,
	pathname: string,
): CodingPermissionRoute | undefined {
	if (method === "GET" && pathname === "/coding/permissions")
		return { type: "coding-permissions.list" };
	if (method === "POST" && pathname === "/coding/permissions/activate")
		return { type: "coding-permissions.activate" };
	return undefined;
}

export async function executeCodingPermissionRoute(
	service: CodingPermissionService,
	route: CodingPermissionRoute,
	input: {
		readonly contentType?: string;
		readonly body?: unknown;
		readonly audit?: (
			event: CodingPermissionAuditEvent,
		) => void | Promise<void>;
	},
	signal: AbortSignal,
): Promise<CodingPermissionCatalog> {
	if (route.type === "coding-permissions.list") return service.list(signal);
	if (!input.contentType?.toLowerCase().startsWith("application/json"))
		throw invalidRequest("Coding permission activation requires JSON");
	if (!isRecord(input.body))
		throw invalidRequest("Coding permission activation is invalid");
	if (
		Object.keys(input.body).some(
			(key) => !["profileId", "acknowledgeFullAccess"].includes(key),
		) ||
		(input.body.profileId !== "safe-auto" &&
			input.body.profileId !== "full-auto") ||
		typeof input.body.acknowledgeFullAccess !== "boolean"
	)
		throw invalidRequest("Coding permission activation is invalid");
	const profileId = input.body.profileId;
	const catalog = await service.activate(
		profileId,
		input.body.acknowledgeFullAccess,
		signal,
	);
	await input.audit?.({ type: "coding-permissions.activated", profileId });
	return catalog;
}
