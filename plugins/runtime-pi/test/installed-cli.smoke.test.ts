import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { CodingEvent } from "../../../packages/contracts/src/index.js";
import { PiRpcRuntime, piWorktreePolicySource } from "../src/index.js";

const execFileAsync = promisify(execFile);
const enabled = process.env.AGENTME_PI_SMOKE === "1";

describe.skipIf(!enabled)("installed Pi CLI smoke", () => {
	it("changes and verifies only its disposable worktree", async () => {
		const root = await mkdtemp(join(tmpdir(), "agentme-pi-smoke-"));
		const repository = join(root, "repository");
		const worktree = join(root, "worktree");
		await execFileAsync("git", ["init", repository]);
		await writeFile(join(repository, "value.txt"), "before\n");
		await execFileAsync("git", ["-C", repository, "add", "value.txt"]);
		await execFileAsync("git", [
			"-C",
			repository,
			"-c",
			"user.name=AgentMe Smoke",
			"-c",
			"user.email=agentme@example.invalid",
			"commit",
			"-m",
			"fixture",
		]);
		await execFileAsync("git", [
			"-C",
			repository,
			"worktree",
			"add",
			"-b",
			"pi-smoke",
			worktree,
		]);
		try {
			await writeFile(join(root, "policy.mjs"), piWorktreePolicySource);
			const cli = process.env.AGENTME_PI_CLI;
			const key = process.env.AGENTME_PI_PROVIDER_KEY;
			if (cli === undefined || key === undefined)
				throw new Error("Pi smoke executable and credential are required");
			const runtime = new PiRpcRuntime({
				executable: process.execPath,
				executableArgs: [cli],
				sessionDirectory: join(root, "sessions"),
				provider: "deepseek",
				model: "deepseek-v4-flash",
				permissionProfile: "worktree-write",
				policyExtensionPath: join(root, "policy.mjs"),
				credentialResolver: async () => ({ DEEPSEEK_API_KEY: key }),
			});
			expect(await runtime.health()).toEqual({
				status: "healthy",
				provider: "deepseek",
			});
			const events: CodingEvent[] = [];
			for await (const event of runtime.start(
				{
					runId: "pi-installed-smoke",
					taskId: "pi-installed-smoke",
					worktreePath: worktree,
					instruction:
						"Modify only value.txt. Replace its entire content with exactly the word after followed by one newline. Read the file after editing to verify it. Do not modify or create any other file.",
				},
				AbortSignal.timeout(120_000),
			))
				events.push(event);
			expect(events.some((event) => event.type === "run.started")).toBe(true);
			expect(events).toContainEqual({
				type: "file.changed",
				runId: "pi-installed-smoke",
				paths: ["value.txt"],
			});
			expect(events.at(-1)?.type).toBe("run.completed");
			expect(await readFile(join(worktree, "value.txt"), "utf8")).toBe(
				"after\n",
			);
			expect(await readFile(join(repository, "value.txt"), "utf8")).toBe(
				"before\n",
			);
			const diff = await execFileAsync("git", [
				"-C",
				worktree,
				"diff",
				"--name-only",
			]);
			expect(diff.stdout.trim()).toBe("value.txt");
		} finally {
			await execFileAsync("git", [
				"-C",
				repository,
				"worktree",
				"remove",
				"--force",
				worktree,
			]);
			await rm(root, { recursive: true, force: true, maxRetries: 5 });
		}
	}, 150_000);
});
