export interface SkillEvaluationRequest {
	readonly proposalId: string;
	readonly skillId: string;
	readonly content: string;
	readonly contentHash: string;
}

export interface SkillEvaluationResult {
	readonly passed: boolean;
	readonly evaluatorId: string;
	readonly evidence: readonly string[];
}

export interface SkillEvaluator {
	evaluate(
		request: SkillEvaluationRequest,
		signal?: AbortSignal,
	): Promise<SkillEvaluationResult>;
}
