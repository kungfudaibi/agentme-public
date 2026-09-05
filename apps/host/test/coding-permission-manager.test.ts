import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ApprovalStore } from "../../../packages/policy-engine/src/index.js";
import {
	CodingPermissionManager,
	JsonCodingPermissionSettingsStore,
} from "../src/coding-permission-manager.js";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("coding permission manager", () => {
	it("defaults to unattended workspace isolation and requires a bound full-access approval", async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "agentme-coding-permissions-"),
		);
		directories.push(directory);
		const settingsPath = join(directory, "settings.json");
		const approvals = new ApprovalStore(join(directory, "approvals.sqlite"));
		const applied: unknown[] = [];
		const manager = new CodingPermissionManager({
			settings: { activeProfileId: "safe-auto" },
			settingsStore: new JsonCodingPermissionSettingsStore(settingsPath),
			approvals,
			apply: (policy) => applied.push(policy),
		});
		expect(manager.currentPolicy()).toEqual({
			sandboxMode: "workspace-write",
			approvalPolicy: "never",
		});
		await expect(
			manager.activate("full-auto", false, new AbortController().signal),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await manager.activate("full-auto", true, new AbortController().signal);
		expect(manager.currentPolicy()).toEqual({
			sandboxMode: "danger-full-access",
			approvalPolicy: "never",
		});
		expect(applied).toHaveLength(1);
		expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
			codingPermissions: { activeProfileId: "full-auto" },
		});
		expect(
			approvals.findValid(
				{
					taskId: "coding-permissions",
					action: "activate_full_access",
					target: "codex:danger-full-access",
				},
				new Date().toISOString(),
			),
		).toMatchObject({ decision: "approved" });
		manager.close();
	});

	it("switches back to the safe profile without another approval", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-coding-safe-"));
		directories.push(directory);
		const approvals = new ApprovalStore(join(directory, "approvals.sqlite"));
		const manager = new CodingPermissionManager({
			settings: { activeProfileId: "full-auto" },
			settingsStore: { save: async () => undefined },
			approvals,
			apply: () => undefined,
		});
		await manager.activate("safe-auto", false, new AbortController().signal);
		expect(manager.currentPolicy().sandboxMode).toBe("workspace-write");
		manager.close();
	});

	it("applies the persisted profile when a Codex runtime is attached", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-coding-attach-"));
		directories.push(directory);
		const approvals = new ApprovalStore(join(directory, "approvals.sqlite"));
		const applied: unknown[] = [];
		const manager = new CodingPermissionManager({
			settings: { activeProfileId: "full-auto" },
			settingsStore: { save: async () => undefined },
			approvals,
			apply: () => undefined,
		});
		manager.attachRuntime({
			setExecutionPolicy: (policy) => applied.push(policy),
		});
		expect(applied).toEqual([
			{ sandboxMode: "danger-full-access", approvalPolicy: "never" },
		]);
		manager.close();
	});
});
