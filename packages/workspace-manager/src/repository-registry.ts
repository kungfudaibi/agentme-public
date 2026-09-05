import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { AgentMeError } from "../../contracts/src/index.js";
import {
	assertPathInApprovedRoots,
	canonicalizeApprovedRoots,
	invalidRepository,
} from "./path-policy.js";
import type {
	GitRepositoryState,
	RegisteredRepository,
	RegisterRepositoryInput,
	VerificationCommand,
} from "./types.js";

const execFileAsync = promisify(execFile);
const repositoryIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const executablePattern = /^[A-Za-z0-9_.-]+$/;

function isVerificationCommandValid(command: VerificationCommand): boolean {
	return (
		executablePattern.test(command.executable) &&
		command.args.length <= 100 &&
		command.args.every(
			(argument) => argument.length <= 4_000 && !argument.includes("\0"),
		)
	);
}

async function inspectGit(canonicalPath: string): Promise<GitRepositoryState> {
	try {
		const [topLevel, head, branch, status] = await Promise.all([
			execFileAsync("git", ["rev-parse", "--show-toplevel"], {
				cwd: canonicalPath,
			}),
			execFileAsync("git", ["rev-parse", "HEAD"], { cwd: canonicalPath }),
			execFileAsync("git", ["branch", "--show-current"], {
				cwd: canonicalPath,
			}),
			execFileAsync("git", ["status", "--porcelain=v1"], {
				cwd: canonicalPath,
			}),
		]);
		const canonicalTopLevel = await assertPathInApprovedRoots(
			topLevel.stdout.trim(),
			[canonicalPath],
		);
		if (canonicalTopLevel !== canonicalPath) throw invalidRepository();
		return {
			branch: branch.stdout.trim() || null,
			head: head.stdout.trim(),
			isDirty: status.stdout.length > 0,
		};
	} catch (error) {
		if (error instanceof AgentMeError) throw error;
		throw invalidRepository(error);
	}
}

export class RepositoryRegistry {
	readonly #approvedRoots: readonly string[];
	readonly #repositories = new Map<string, RegisteredRepository>();

	private constructor(approvedRoots: readonly string[]) {
		this.#approvedRoots = approvedRoots;
	}

	static async create(
		approvedRoots: readonly string[],
	): Promise<RepositoryRegistry> {
		return new RepositoryRegistry(
			await canonicalizeApprovedRoots(approvedRoots),
		);
	}

	async register(
		input: RegisterRepositoryInput,
	): Promise<RegisteredRepository> {
		if (
			!repositoryIdPattern.test(input.id) ||
			this.#repositories.has(input.id) ||
			!(["windows", "wsl2", "docker"] as const).includes(
				input.executionTarget,
			) ||
			input.verificationCommands.length > 20 ||
			!input.verificationCommands.every(isVerificationCommandValid) ||
			typeof input.permissionProfile?.canWrite !== "boolean" ||
			typeof input.permissionProfile.canUseNetwork !== "boolean"
		) {
			throw invalidRepository();
		}
		const canonicalPath = await assertPathInApprovedRoots(
			input.path,
			this.#approvedRoots,
		);
		const repository: RegisteredRepository = {
			id: input.id,
			canonicalPath,
			executionTarget: input.executionTarget,
			verificationCommands: input.verificationCommands.map((command) => ({
				executable: command.executable,
				args: [...command.args],
			})),
			permissionProfile: { ...input.permissionProfile },
			git: await inspectGit(canonicalPath),
		};
		this.#repositories.set(input.id, repository);
		return repository;
	}

	resolve(repositoryId: string): RegisteredRepository {
		const repository = this.#repositories.get(repositoryId);
		if (repository === undefined) {
			throw new AgentMeError({
				code: "REPOSITORY_NOT_FOUND",
				message: "Registered repository not found",
				isRetryable: false,
			});
		}
		return repository;
	}

	list(): readonly RegisteredRepository[] {
		return [...this.#repositories.values()];
	}
}
