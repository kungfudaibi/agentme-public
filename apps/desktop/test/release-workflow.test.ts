import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("native desktop release workflow", () => {
	it("passes Vitest exclusion globs without POSIX shell expansion", async () => {
		const packageJson = JSON.parse(
			await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
		) as { scripts: Record<string, string> };

		expect(packageJson.scripts.test).toContain('--exclude "dist/**"');
		expect(packageJson.scripts["desktop:check"]).toContain(
			'--exclude "apps/desktop/src-tauri/target/**"',
		);
	});

	it("builds and retains artifacts on each native operating system", async () => {
		const workflow = await readFile(
			new URL("../../../.github/workflows/desktop.yml", import.meta.url),
			"utf8",
		);

		for (const runner of ["windows-2025", "macos-15", "ubuntu-22.04"])
			expect(workflow).toContain(runner);
		expect(workflow).toContain("node-version: 24.10.0");
		expect(workflow).toContain("toolchain: 1.89.0");
		expect(workflow).toContain("# v7.0.0");
		expect(workflow).toContain("# v7.0.1");
		expect(workflow).not.toMatch(/uses:\s+[^\s]+@(?:v\d+|stable)\s*$/mu);
		expect(workflow).toContain("corepack pnpm audit --audit-level high");
		expect(workflow).toContain("corepack pnpm audit signatures");
		expect(workflow).toContain("corepack pnpm desktop:check");
		expect(workflow).toContain("hash-artifacts.mjs");
		expect(workflow).toContain("corepack pnpm desktop:build");
		expect(workflow).toContain("actions/upload-artifact");
		expect(workflow).not.toContain("cross");
	});
});
