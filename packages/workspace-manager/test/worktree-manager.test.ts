import { execFile } from "node:child_process";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { RepositoryRegistry, WorktreeManager } from "../src/index.js";

const execFileAsync = promisify(execFile);

async function fixtureRepository(): Promise<{
	root: string;
	repository: string;
}> {
	const root = await mkdtemp(join(tmpdir(), "agentme-worktree-source-"));
	const repository = join(root, "repository");
	await execFileAsync("git", ["init", "--initial-branch=main", repository]);
	await execFileAsync(
		"git",
		["config", "user.email", "agentme@example.invalid"],
		{ cwd: repository },
	);
	await execFileAsync("git", ["config", "user.name", "AgentMe Test"], {
		cwd: repository,
	});
	await writeFile(join(repository, "README.md"), "committed\n");
	await execFileAsync("git", ["add", "README.md"], { cwd: repository });
	await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: repository });
	return { root, repository };
}

describe("isolated task worktrees", () => {
	it("creates a unique retained worktree without touching a dirty source checkout", async () => {
		const { root, repository } = await fixtureRepository();
		await writeFile(join(repository, "README.md"), "user's dirty change\n");
		const statusBefore = await execFileAsync(
			"git",
			["status", "--porcelain=v1"],
			{ cwd: repository },
		);
		const registry = await RepositoryRegistry.create([root]);
		const registered = await registry.register({
			id: "fixture-repo",
			path: repository,
			executionTarget: "windows",
			verificationCommands: [],
			permissionProfile: { canWrite: true, canUseNetwork: false },
		});
		const taskRoot = await mkdtemp(join(tmpdir(), "agentme-task-root-"));
		const manager = await WorktreeManager.create(taskRoot);

		const workspace = await manager.create("task-001", registered);
		await writeFile(
			join(workspace.canonicalPath, "README.md"),
			"agent change\n",
		);
		const report = manager.retain("task-001", "cancelled");

		expect(workspace.branch).toBe("agentme/task-task-001");
		expect(await readFile(join(repository, "README.md"), "utf8")).toBe(
			"user's dirty change\n",
		);
		expect(
			(
				await execFileAsync("git", ["status", "--porcelain=v1"], {
					cwd: repository,
				})
			).stdout,
		).toBe(statusBefore.stdout);
		expect(
			(
				await execFileAsync("git", ["status", "--porcelain=v1"], {
					cwd: workspace.canonicalPath,
				})
			).stdout,
		).toContain("README.md");
		expect(report).toMatchObject({
			disposition: "retained",
			reason: "cancelled",
			path: workspace.canonicalPath,
		});
	});

	it("rejects a task root nested inside the source repository", async () => {
		const { root, repository } = await fixtureRepository();
		const registry = await RepositoryRegistry.create([root]);
		const registered = await registry.register({
			id: "fixture-repo",
			path: repository,
			executionTarget: "windows",
			verificationCommands: [],
			permissionProfile: { canWrite: true, canUseNetwork: false },
		});
		await expect(
			WorktreeManager.create(join(repository, ".agentme-tasks"), [
				registered.canonicalPath,
			]),
		).rejects.toMatchObject({
			code: "INVALID_WORKTREE",
		});
	});

	it("rejects a task root nested through a filesystem alias", async () => {
		const { root, repository } = await fixtureRepository();
		const alias = join(root, "repository-alias");
		await symlink(repository, alias, "junction");

		await expect(
			WorktreeManager.create(join(alias, ".agentme-tasks"), [repository]),
		).rejects.toMatchObject({ code: "INVALID_WORKTREE" });
	});
});
