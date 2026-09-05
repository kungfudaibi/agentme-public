import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WorktreeSnapshot = ReadonlyMap<string, string>;

export async function snapshotDirtyFiles(
	cwd: string,
	environment: NodeJS.ProcessEnv,
): Promise<WorktreeSnapshot> {
	const paths = await listDirtyFiles(cwd, environment);
	const snapshot = new Map<string, string>();
	for (const path of paths) snapshot.set(path, await fingerprint(cwd, path));
	return snapshot;
}

export async function changedFilesSince(
	cwd: string,
	before: WorktreeSnapshot,
	environment: NodeJS.ProcessEnv,
): Promise<readonly string[]> {
	const afterPaths = await listDirtyFiles(cwd, environment);
	const candidates = new Set([...before.keys(), ...afterPaths]);
	const changed: string[] = [];
	for (const path of candidates) {
		const after = afterPaths.has(path) ? await fingerprint(cwd, path) : "clean";
		if ((before.get(path) ?? "clean") !== after) changed.push(path);
	}
	return changed.sort((left, right) => left.localeCompare(right));
}

async function listDirtyFiles(
	cwd: string,
	environment: NodeJS.ProcessEnv,
): Promise<ReadonlySet<string>> {
	try {
		const commonOptions = {
			cwd,
			env: environment,
			windowsHide: true,
			encoding: "buffer" as const,
		};
		const [tracked, staged, untracked] = await Promise.all([
			execFileAsync(
				"git",
				["diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", "--"],
				commonOptions,
			),
			execFileAsync(
				"git",
				[
					"diff",
					"--cached",
					"--no-ext-diff",
					"--no-textconv",
					"--name-only",
					"-z",
					"--",
				],
				commonOptions,
			),
			execFileAsync(
				"git",
				["ls-files", "--others", "--exclude-standard", "-z"],
				commonOptions,
			),
		]);
		return new Set(
			[tracked.stdout, staged.stdout, untracked.stdout].flatMap(parseNullPaths),
		);
	} catch {
		return new Set();
	}
}

function parseNullPaths(value: string | Buffer): string[] {
	return value
		.toString("utf8")
		.split("\0")
		.filter((path) => path.length > 0);
}

async function fingerprint(cwd: string, path: string): Promise<string> {
	try {
		const content = await readFile(join(cwd, path));
		return createHash("sha256").update(content).digest("hex");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "deleted";
		return "unreadable";
	}
}
