import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	ApprovalStore,
	evaluatePolicy,
	type PolicyInput,
} from "../src/index.js";

const base: Omit<PolicyInput, "action"> = {
	taskId: "task-1",
	actor: { id: "owner", trust: "owner", context: "direct" },
	channel: { id: "desktop", isAuthenticated: true },
	repository: {
		id: "sample-repo",
		isRegistered: true,
		canonicalPath: "D:\\code\\sample-repo",
		worktreePath: "D:\\agentme-tasks\\task-1",
		canCommit: true,
	},
	executionTarget: { id: "windows", isAllowed: true },
	networkAllowlist: ["api.openai.com"],
	now: "2026-08-20T08:00:00.000Z",
};

describe("permission matrix", () => {
	it.each([
		["read_repository", "allow"],
		["write_worktree", "allow"],
		["run_configured_command", "allow"],
		["install_dependencies", "approval_required"],
		["access_network", "allow"],
		["read_outside_roots", "deny"],
		["modify_source_checkout", "deny"],
		["git_commit", "allow"],
		["git_push", "approval_required"],
		["create_pr", "approval_required"],
		["deploy", "approval_required"],
		["delete_persistent", "approval_required"],
		["send_message", "approval_required"],
		["activate_full_access", "approval_required"],
	] as const)("evaluates %s as %s by default", (type, expected) => {
		const action =
			type === "access_network"
				? { type, target: "api.openai.com" as const }
				: type === "send_message"
					? { type, target: "different-user" as const }
					: type === "activate_full_access"
						? { type, target: "codex:danger-full-access" as const }
						: type === "delete_persistent"
							? { type, target: "worktree:task-1" as const }
							: { type };
		expect(evaluatePolicy({ ...base, action } as PolicyInput).decision).toBe(
			expected,
		);
	});

	it("gives deny precedence over approvals and defaults groups to no tools", () => {
		const decision = evaluatePolicy({
			...base,
			actor: { id: "owner", trust: "owner", context: "group" },
			action: { type: "git_push" },
			approval: {
				id: "approval-1",
				taskId: "task-1",
				action: "git_push",
				target: "D:\\agentme-tasks\\task-1",
				decision: "approved",
				expiresAt: "2026-08-20T09:00:00.000Z",
			},
		});

		expect(decision).toMatchObject({
			decision: "deny",
			reasons: ["GROUP_CONTEXT_TOOLS_DENIED"],
		});
	});

	it("denies network targets outside the provider allowlist", () => {
		expect(
			evaluatePolicy({
				...base,
				action: { type: "access_network", target: "evil.invalid" },
			}),
		).toMatchObject({ decision: "deny", reasons: ["NETWORK_TARGET_DENIED"] });
	});
});

describe("durable approvals", () => {
	it("binds an approval to task, action, canonical target and expiry across restart", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-approvals-"));
		const databasePath = join(directory, "approvals.sqlite");
		const first = new ApprovalStore(databasePath);
		first.record({
			id: "approval-1",
			taskId: "task-1",
			action: "git_push",
			target: "D:\\agentme-tasks\\task-1",
			decision: "approved",
			expiresAt: "2026-08-20T09:00:00.000Z",
		});
		first.close();

		const restarted = new ApprovalStore(databasePath);
		expect(
			restarted.findValid(
				{
					taskId: "task-1",
					action: "git_push",
					target: "D:\\agentme-tasks\\task-1",
				},
				"2026-08-20T08:30:00.000Z",
			),
		).toMatchObject({ id: "approval-1", decision: "approved" });
		expect(
			restarted.findValid(
				{
					taskId: "task-2",
					action: "git_push",
					target: "D:\\agentme-tasks\\task-1",
				},
				"2026-08-20T08:30:00.000Z",
			),
		).toBeUndefined();
		expect(
			restarted.findValid(
				{
					taskId: "task-1",
					action: "git_push",
					target: "D:\\agentme-tasks\\task-1",
				},
				"2026-08-20T09:00:00.000Z",
			),
		).toBeUndefined();
		restarted.close();
	});
});
