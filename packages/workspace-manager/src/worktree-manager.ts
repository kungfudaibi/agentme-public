import { lstat, mkdir, realpath } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { addWorktree, invalidWorktree } from "./git-client.js";
import type { RegisteredRepository } from "./types.js";
import type {
	RetainedWorkspaceReport,
	TaskWorkspace,
} from "./workspace-report.js";

const taskIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isWithin(parent: string, candidate: string): boolean {
	const fromParent = relative(parent, candidate);
	return (
		fromParent === "" ||
		(fromParent !== ".." &&
			!fromParent.startsWith(`..\\`) &&
			!fromParent.startsWith("../") &&
			!isAbsolute(fromParent))
	);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

async function canonicalizeProspectivePath(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			throw invalidWorktree(error);
		const parent = dirname(path);
		if (parent === path) throw invalidWorktree(error);
		return resolve(await canonicalizeProspectivePath(parent), basename(path));
	}
}

export class WorktreeManager {
	readonly #taskRoot: string;
	readonly #workspaces = new Map<string, TaskWorkspace>();

	private constructor(taskRoot: string) {
		this.#taskRoot = taskRoot;
	}

	static async create(
		taskRoot: string,
		sourcePaths: readonly string[] = [],
	): Promise<WorktreeManager> {
		const resolvedTaskRoot = resolve(taskRoot);
		const canonicalTaskRoot =
			await canonicalizeProspectivePath(resolvedTaskRoot);
		const canonicalSources = await Promise.all(
			sourcePaths.map((sourcePath) =>
				canonicalizeProspectivePath(resolve(sourcePath)),
			),
		);
		if (
			canonicalSources.some((canonicalSource) => {
				return (
					isWithin(canonicalSource, canonicalTaskRoot) ||
					isWithin(canonicalTaskRoot, canonicalSource)
				);
			})
		) {
			throw invalidWorktree();
		}
		await mkdir(resolvedTaskRoot, { recursive: true });
		return new WorktreeManager(await realpath(resolvedTaskRoot));
	}

	async create(
		taskId: string,
		repository: RegisteredRepository,
	): Promise<TaskWorkspace> {
		if (!taskIdPattern.test(taskId) || this.#workspaces.has(taskId))
			throw invalidWorktree();
		if (isWithin(repository.canonicalPath, this.#taskRoot))
			throw invalidWorktree();
		const requestedPath = resolve(join(this.#taskRoot, taskId));
		if (
			!isWithin(this.#taskRoot, requestedPath) ||
			(await pathExists(requestedPath))
		) {
			throw invalidWorktree();
		}
		const branch = `agentme/task-${taskId}`;
		await addWorktree(
			repository.canonicalPath,
			requestedPath,
			branch,
			repository.git.head,
		);
		const canonicalPath = await realpath(requestedPath);
		if (!isWithin(this.#taskRoot, canonicalPath)) throw invalidWorktree();
		const workspace: TaskWorkspace = {
			taskId,
			repositoryId: repository.id,
			canonicalPath,
			branch,
			baseRevision: repository.git.head,
		};
		this.#workspaces.set(taskId, workspace);
		return workspace;
	}

	retain(
		taskId: string,
		reason: RetainedWorkspaceReport["reason"],
	): RetainedWorkspaceReport {
		const workspace = this.#workspaces.get(taskId);
		if (workspace === undefined) throw invalidWorktree();
		return {
			taskId,
			disposition: "retained",
			reason,
			path: workspace.canonicalPath,
			branch: workspace.branch,
		};
	}
}
