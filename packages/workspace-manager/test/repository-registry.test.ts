import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { RepositoryRegistry } from "../src/index.js";

const execFileAsync = promisify(execFile);

async function createRepository(parent: string, name: string): Promise<string> {
	const path = join(parent, name);
	await mkdir(path, { recursive: true });
	await execFileAsync("git", ["init", "--initial-branch=main"], { cwd: path });
	await execFileAsync(
		"git",
		["config", "user.email", "agentme@example.invalid"],
		{ cwd: path },
	);
	await execFileAsync("git", ["config", "user.name", "AgentMe Test"], {
		cwd: path,
	});
	await writeFile(join(path, "README.md"), "fixture\n");
	await execFileAsync("git", ["add", "README.md"], { cwd: path });
	await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: path });
	return path;
}

describe("repository registry", () => {
	it("registers a canonical Git repository and resolves remote input only by id", async () => {
		const approvedRoot = await mkdtemp(
			join(tmpdir(), "agentme-approved-root-"),
		);
		const repositoryPath = await createRepository(approvedRoot, "sample-repo");
		const registry = await RepositoryRegistry.create([approvedRoot]);

		const registered = await registry.register({
			id: "sample-repo",
			path: repositoryPath,
			executionTarget: "windows",
			verificationCommands: [
				{ executable: "corepack", args: ["pnpm", "test"] },
			],
			permissionProfile: { canWrite: true, canUseNetwork: false },
		});

		expect(registered.canonicalPath).toBe(await realpath(repositoryPath));
		expect(registered.git.branch).toBe("main");
		expect(registered.git.isDirty).toBe(false);
		expect(registry.resolve("sample-repo")).toEqual(registered);
		expect(() => registry.resolve(repositoryPath)).toThrowError(
			expect.objectContaining({ code: "REPOSITORY_NOT_FOUND" }),
		);

		await writeFile(join(repositoryPath, "README.md"), "dirty fixture\n");
		const dirty = await registry.register({
			id: "dirty-repo",
			path: repositoryPath,
			executionTarget: "windows",
			verificationCommands: [],
			permissionProfile: { canWrite: false, canUseNetwork: false },
		});
		expect(dirty.git.isDirty).toBe(true);
	});

	it("rejects a Windows junction that escapes an approved root", async () => {
		const approvedRoot = await mkdtemp(
			join(tmpdir(), "agentme-approved-root-"),
		);
		const outsideRoot = await mkdtemp(join(tmpdir(), "agentme-outside-root-"));
		const outsideRepository = await createRepository(
			outsideRoot,
			"outside-repo",
		);
		const junctionPath = join(approvedRoot, "escaped-repo");
		await symlink(outsideRepository, junctionPath, "junction");
		const registry = await RepositoryRegistry.create([approvedRoot]);

		await expect(
			registry.register({
				id: "escaped-repo",
				path: junctionPath,
				executionTarget: "windows",
				verificationCommands: [],
				permissionProfile: { canWrite: false, canUseNetwork: false },
			}),
		).rejects.toMatchObject({ code: "INVALID_REPOSITORY" });
	});

	it("rejects non-Git paths and unsafe command shapes", async () => {
		const approvedRoot = await mkdtemp(
			join(tmpdir(), "agentme-approved-root-"),
		);
		const plainDirectory = join(approvedRoot, "plain");
		await mkdir(plainDirectory);
		const registry = await RepositoryRegistry.create([approvedRoot]);

		await expect(
			registry.register({
				id: "plain-directory",
				path: plainDirectory,
				executionTarget: "windows",
				verificationCommands: [{ executable: "pnpm test && steal", args: [] }],
				permissionProfile: { canWrite: true, canUseNetwork: false },
			}),
		).rejects.toMatchObject({ code: "INVALID_REPOSITORY" });
	});
});
