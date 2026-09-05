import { AgentMeError } from "../../../packages/contracts/src/index.js";
import type {
	SkillEvaluator,
	SkillProposal,
	SkillWorkshop,
} from "../../../packages/skill-workshop/src/index.js";

export type SkillWorkshopRoute =
	| { readonly type: "skill-proposal.list" }
	| { readonly type: "skill-proposal.create" }
	| {
			readonly type:
				| "skill-proposal.evaluate"
				| "skill-proposal.approve"
				| "skill-proposal.apply"
				| "skill-proposal.rollback";
			readonly proposalId: string;
	  };

export interface SkillWorkshopAuditEvent {
	readonly type: "skill-proposal.mutated";
	readonly operation:
		| "created"
		| "evaluated"
		| "approved"
		| "applied"
		| "rolled_back";
	readonly proposalId: string;
	readonly skillId: string;
	readonly contentHash: string;
	readonly at: string;
}

export interface SkillWorkshopRouteInput {
	readonly query?: URLSearchParams;
	readonly contentType?: string;
	readonly body?: unknown;
	readonly audit?: (event: SkillWorkshopAuditEvent) => void | Promise<void>;
}

const proposalIdPattern = /^[0-9a-f-]{1,100}$/iu;

export function matchSkillWorkshopRoute(
	method: string | undefined,
	pathname: string,
): SkillWorkshopRoute | undefined {
	if (pathname === "/skills/proposals") {
		if (method === "GET") return { type: "skill-proposal.list" };
		if (method === "POST") return { type: "skill-proposal.create" };
		return undefined;
	}
	const match = pathname.match(
		/^\/skills\/proposals\/([^/]+)\/(evaluate|approve|apply|rollback)$/u,
	);
	if (method !== "POST" || match === null) return undefined;
	let proposalId: string;
	try {
		proposalId = decodeURIComponent(match[1] ?? "");
	} catch {
		return undefined;
	}
	if (!proposalIdPattern.test(proposalId)) return undefined;
	return {
		type: `skill-proposal.${match[2]}` as Exclude<
			SkillWorkshopRoute["type"],
			"skill-proposal.list" | "skill-proposal.create"
		>,
		proposalId,
	};
}

export async function executeSkillWorkshopRoute(
	workshop: SkillWorkshop,
	evaluator: SkillEvaluator,
	route: SkillWorkshopRoute,
	input: SkillWorkshopRouteInput,
	signal?: AbortSignal,
): Promise<unknown> {
	if (route.type === "skill-proposal.list") {
		const query = input.query ?? new URLSearchParams();
		if ([...query.keys()].some((key) => !["limit", "offset"].includes(key)))
			return invalidInput();
		const limit = Number(query.get("limit") ?? "50");
		const offset = Number(query.get("offset") ?? "0");
		if (
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > 100 ||
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			offset > 10_000
		)
			return invalidInput();
		const proposals = workshop.list();
		return {
			data: proposals.slice(offset, offset + limit),
			pagination: { limit, offset, totalItems: proposals.length },
		};
	}
	try {
		let proposal: SkillProposal;
		let operation: SkillWorkshopAuditEvent["operation"];
		switch (route.type) {
			case "skill-proposal.create": {
				const body = jsonBody(input);
				if (
					!hasOnlyKeys(body, ["skillId", "content"]) ||
					typeof body.skillId !== "string" ||
					typeof body.content !== "string"
				)
					return invalidInput();
				proposal = workshop.propose(body.skillId, body.content, "owner:local");
				operation = "created";
				break;
			}
			case "skill-proposal.evaluate":
				noBody(input);
				proposal = await workshop.evaluate(route.proposalId, evaluator, signal);
				operation = "evaluated";
				break;
			case "skill-proposal.approve": {
				const contentHash = hashBody(input);
				proposal = workshop.approve(route.proposalId, contentHash);
				operation = "approved";
				break;
			}
			case "skill-proposal.apply": {
				const contentHash = hashBody(input);
				proposal = workshop.apply(route.proposalId, contentHash);
				operation = "applied";
				break;
			}
			case "skill-proposal.rollback":
				noBody(input);
				proposal = workshop.rollback(route.proposalId);
				operation = "rolled_back";
				break;
		}
		await input.audit?.({
			type: "skill-proposal.mutated",
			operation,
			proposalId: proposal.id,
			skillId: proposal.skillId,
			contentHash: proposal.contentHash,
			at: new Date().toISOString(),
		});
		return proposal;
	} catch (cause) {
		if (cause instanceof AgentMeError) throw cause;
		throw new AgentMeError({
			code: "INVALID_TASK_TRANSITION",
			message: "Skill proposal transition is not allowed",
			isRetryable: false,
			cause,
		});
	}
}

function jsonBody(input: SkillWorkshopRouteInput): Record<string, unknown> {
	if (
		input.contentType?.toLowerCase().startsWith("application/json") !== true ||
		typeof input.body !== "object" ||
		input.body === null ||
		Array.isArray(input.body)
	)
		return invalidInput();
	return input.body as Record<string, unknown>;
}

function hashBody(input: SkillWorkshopRouteInput): string {
	const body = jsonBody(input);
	if (
		!hasOnlyKeys(body, ["contentHash"]) ||
		typeof body.contentHash !== "string" ||
		!/^[0-9a-f]{64}$/u.test(body.contentHash)
	)
		return invalidInput();
	return body.contentHash;
}

function noBody(input: SkillWorkshopRouteInput): void {
	if (input.body !== undefined || input.contentType !== undefined)
		invalidInput();
}

function hasOnlyKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	return Object.keys(value).every((key) => keys.includes(key));
}

function invalidInput(): never {
	throw new AgentMeError({
		code: "INVALID_CONTRACT",
		message: "Invalid skill workshop request",
		isRetryable: false,
	});
}
