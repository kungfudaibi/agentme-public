export type DesktopSkillProposalStatus =
	| "pending"
	| "evaluated"
	| "approved"
	| "rejected"
	| "applied"
	| "rolled_back";

export interface DesktopSkillProposal {
	readonly id: string;
	readonly skillId: string;
	readonly content: string;
	readonly contentHash: string;
	readonly source: string;
	readonly createdAt: string;
	readonly status: DesktopSkillProposalStatus;
	readonly scanFindings: readonly {
		readonly severity: "critical" | "warning";
		readonly rule: string;
	}[];
	readonly evaluation?: {
		readonly passed: boolean;
		readonly evaluatorId: string;
		readonly evidence: readonly string[];
	};
	readonly approvedAt?: string;
}

export interface DesktopSkillProposalPage {
	readonly data: readonly DesktopSkillProposal[];
	readonly pagination: {
		readonly limit: number;
		readonly offset: number;
		readonly totalItems: number;
	};
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new TypeError("Invalid skill workshop response");
	return value as Record<string, unknown>;
}

function proposal(value: unknown): DesktopSkillProposal {
	const item = record(value);
	const statuses = new Set<DesktopSkillProposalStatus>([
		"pending",
		"evaluated",
		"approved",
		"rejected",
		"applied",
		"rolled_back",
	]);
	if (
		typeof item.id !== "string" ||
		typeof item.skillId !== "string" ||
		typeof item.content !== "string" ||
		typeof item.contentHash !== "string" ||
		!/^[0-9a-f]{64}$/u.test(item.contentHash) ||
		typeof item.source !== "string" ||
		typeof item.createdAt !== "string" ||
		!statuses.has(item.status as DesktopSkillProposalStatus) ||
		!Array.isArray(item.scanFindings)
	)
		throw new TypeError("Invalid skill workshop response");
	const findings = item.scanFindings.map((value) => {
		const finding = record(value);
		if (
			(finding.severity !== "critical" && finding.severity !== "warning") ||
			typeof finding.rule !== "string"
		)
			throw new TypeError("Invalid skill workshop response");
		return {
			severity: finding.severity,
			rule: finding.rule,
		} as const;
	});
	let evaluation: DesktopSkillProposal["evaluation"];
	if (item.evaluation !== undefined) {
		const candidate = record(item.evaluation);
		if (
			typeof candidate.passed !== "boolean" ||
			typeof candidate.evaluatorId !== "string" ||
			!Array.isArray(candidate.evidence) ||
			!candidate.evidence.every((entry) => typeof entry === "string")
		)
			throw new TypeError("Invalid skill workshop response");
		evaluation = {
			passed: candidate.passed,
			evaluatorId: candidate.evaluatorId,
			evidence: candidate.evidence as string[],
		};
	}
	return {
		id: item.id,
		skillId: item.skillId,
		content: item.content,
		contentHash: item.contentHash,
		source: item.source,
		createdAt: item.createdAt,
		status: item.status as DesktopSkillProposalStatus,
		scanFindings: findings,
		...(evaluation === undefined ? {} : { evaluation }),
		...(typeof item.approvedAt === "string"
			? { approvedAt: item.approvedAt }
			: {}),
	};
}

export function parseSkillProposalPage(
	value: unknown,
): DesktopSkillProposalPage {
	const page = record(value);
	const pagination = record(page.pagination);
	if (
		!Array.isArray(page.data) ||
		!Number.isSafeInteger(pagination.limit) ||
		!Number.isSafeInteger(pagination.offset) ||
		!Number.isSafeInteger(pagination.totalItems)
	)
		throw new TypeError("Invalid skill workshop response");
	return {
		data: page.data.map(proposal),
		pagination: {
			limit: pagination.limit as number,
			offset: pagination.offset as number,
			totalItems: pagination.totalItems as number,
		},
	};
}

export function buildSkillProposalInput(
	skillId: string,
	content: string,
): {
	readonly skillId: string;
	readonly content: string;
} {
	const normalizedId = skillId.trim();
	const normalizedContent = content.trim();
	if (
		!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(normalizedId) ||
		normalizedContent.length < 1 ||
		normalizedContent.length > 64_000
	)
		throw new TypeError("技能提案格式无效");
	return { skillId: normalizedId, content: normalizedContent };
}
