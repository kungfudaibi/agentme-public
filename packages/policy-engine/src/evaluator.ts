import type {
	ApprovalRecord,
	PolicyAction,
	PolicyDecision,
	PolicyInput,
} from "./policy.js";

const toolActions = new Set<PolicyAction["type"]>([
	"read_repository",
	"write_worktree",
	"run_configured_command",
	"install_dependencies",
	"access_network",
	"read_outside_roots",
	"modify_source_checkout",
	"git_commit",
	"git_push",
	"create_pr",
	"deploy",
	"delete_persistent",
	"activate_full_access",
]);

const approvalActions = new Set<PolicyAction["type"]>([
	"install_dependencies",
	"git_push",
	"create_pr",
	"deploy",
	"delete_persistent",
	"send_message",
	"activate_full_access",
]);

function actionTarget(input: PolicyInput): string {
	switch (input.action.type) {
		case "access_network":
		case "delete_persistent":
		case "send_message":
		case "activate_full_access":
			return input.action.target;
		default:
			return input.repository.worktreePath ?? input.repository.canonicalPath;
	}
}

function matchesApproval(
	input: PolicyInput,
	approval: ApprovalRecord,
	target: string,
): boolean {
	return (
		approval.taskId === input.taskId &&
		approval.action === input.action.type &&
		approval.target === target &&
		approval.expiresAt > input.now
	);
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
	if (!input.channel.isAuthenticated)
		return { decision: "deny", reasons: ["CHANNEL_NOT_AUTHENTICATED"] };
	if (input.actor.context === "group" && toolActions.has(input.action.type)) {
		return { decision: "deny", reasons: ["GROUP_CONTEXT_TOOLS_DENIED"] };
	}
	if (input.actor.trust === "untrusted" && toolActions.has(input.action.type)) {
		return { decision: "deny", reasons: ["UNTRUSTED_ACTOR_TOOLS_DENIED"] };
	}
	if (!input.repository.isRegistered && toolActions.has(input.action.type)) {
		return { decision: "deny", reasons: ["REPOSITORY_NOT_REGISTERED"] };
	}
	if (!input.executionTarget.isAllowed && toolActions.has(input.action.type)) {
		return { decision: "deny", reasons: ["EXECUTION_TARGET_DENIED"] };
	}
	if (input.action.type === "read_outside_roots") {
		return { decision: "deny", reasons: ["OUTSIDE_REGISTERED_ROOTS_DENIED"] };
	}
	if (input.action.type === "modify_source_checkout") {
		return { decision: "deny", reasons: ["SOURCE_CHECKOUT_WRITE_DENIED"] };
	}
	if (
		input.action.type === "access_network" &&
		!input.networkAllowlist.includes(input.action.target)
	) {
		return { decision: "deny", reasons: ["NETWORK_TARGET_DENIED"] };
	}
	if (input.action.type === "git_commit" && !input.repository.canCommit) {
		return { decision: "deny", reasons: ["GIT_COMMIT_DISABLED"] };
	}
	if (
		input.action.type === "send_message" &&
		input.action.target === input.actor.id
	) {
		return { decision: "allow", reasons: ["REQUESTING_IDENTITY_TARGET"] };
	}
	if (approvalActions.has(input.action.type)) {
		const target = actionTarget(input);
		if (
			input.approval !== undefined &&
			matchesApproval(input, input.approval, target)
		) {
			return input.approval.decision === "approved"
				? { decision: "allow", reasons: ["BOUND_APPROVAL_GRANTED"] }
				: { decision: "deny", reasons: ["BOUND_APPROVAL_DENIED"] };
		}
		return {
			decision: "approval_required",
			reasons: ["EXPLICIT_APPROVAL_REQUIRED"],
			binding: { taskId: input.taskId, action: input.action.type, target },
		};
	}
	return { decision: "allow", reasons: ["DEFAULT_POLICY_ALLOW"] };
}
