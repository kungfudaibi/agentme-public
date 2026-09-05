export type ActorTrust = "owner" | "trusted" | "untrusted";

export type PolicyAction =
	| { readonly type: "read_repository" }
	| { readonly type: "write_worktree" }
	| { readonly type: "run_configured_command" }
	| { readonly type: "install_dependencies" }
	| { readonly type: "access_network"; readonly target: string }
	| { readonly type: "read_outside_roots" }
	| { readonly type: "modify_source_checkout" }
	| { readonly type: "git_commit" }
	| { readonly type: "git_push" }
	| { readonly type: "create_pr" }
	| { readonly type: "deploy" }
	| { readonly type: "delete_persistent"; readonly target: string }
	| { readonly type: "send_message"; readonly target: string }
	| { readonly type: "activate_full_access"; readonly target: string };

export type ApprovalAction = PolicyAction["type"];
export type ApprovalDecision = "approved" | "denied";

export interface ApprovalRecord {
	readonly id: string;
	readonly taskId: string;
	readonly action: ApprovalAction;
	readonly target: string;
	readonly decision: ApprovalDecision;
	readonly expiresAt: string;
}

export interface PolicyInput {
	readonly taskId: string;
	readonly actor: {
		readonly id: string;
		readonly trust: ActorTrust;
		readonly context: "direct" | "group";
	};
	readonly channel: { readonly id: string; readonly isAuthenticated: boolean };
	readonly repository: {
		readonly id: string;
		readonly isRegistered: boolean;
		readonly canonicalPath: string;
		readonly worktreePath?: string;
		readonly canCommit: boolean;
	};
	readonly executionTarget: {
		readonly id: string;
		readonly isAllowed: boolean;
	};
	readonly networkAllowlist: readonly string[];
	readonly action: PolicyAction;
	readonly approval?: ApprovalRecord;
	readonly now: string;
}

export type PolicyDecision =
	| { readonly decision: "allow"; readonly reasons: readonly string[] }
	| { readonly decision: "deny"; readonly reasons: readonly string[] }
	| {
			readonly decision: "approval_required";
			readonly reasons: readonly string[];
			readonly binding: {
				readonly taskId: string;
				readonly action: ApprovalAction;
				readonly target: string;
			};
	  };
