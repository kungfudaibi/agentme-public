import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildTaskReport, verifyWorkspace } from "../src/index.js";

function repository(): string {
	const path = mkdtempSync(join(tmpdir(), "agentme-report-"));
	execFileSync("git", ["init", "-q"], { cwd: path });
	writeFileSync(join(path, "changed.txt"), "evidence");
	return path;
}

describe("verified task reports", () => {
	it("reports changed files and successful terminal commands", async () => {
		const path = repository();
		const verification = await verifyWorkspace(
			path,
			[{ executable: process.execPath, args: ["-e", "process.exit(0)"] }],
			new AbortController().signal,
		);
		const report = await buildTaskReport({
			workspace: {
				taskId: "task-1",
				repositoryId: "repo-1",
				canonicalPath: path,
				branch: "agentme/task-1",
				baseRevision: "abc",
			},
			verification,
			runtimeSummary: "Implemented change",
		});
		expect(report.summary).toBe("Task changes verified");
		expect(report.details).toMatchObject({
			status: "passed",
			changedFiles: ["changed.txt"],
			commands: [{ exitCode: 0 }],
		});
	});

	it("stops at the first failure and never reports success", async () => {
		const verification = await verifyWorkspace(
			repository(),
			[
				{ executable: process.execPath, args: ["-e", "process.exit(3)"] },
				{ executable: process.execPath, args: ["-e", "process.exit(0)"] },
			],
			new AbortController().signal,
		);
		expect(verification.status).toBe("failed");
		expect(verification.results).toHaveLength(1);
		expect(verification.results[0]?.exitCode).toBe(3);
	});
});
