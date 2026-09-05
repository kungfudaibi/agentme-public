import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const repositoryFile = (path: string) =>
	readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("release sign-off", () => {
	it("keeps public release metadata aligned", async () => {
		const packageJson = JSON.parse(await repositoryFile("package.json")) as {
			version: string;
		};
		const tauriConfig = JSON.parse(
			await repositoryFile("apps/desktop/src-tauri/tauri.conf.json"),
		) as { version: string };
		const cargoManifest = await repositoryFile(
			"apps/desktop/src-tauri/Cargo.toml",
		);
		const cargoVersion = cargoManifest.match(
			/^version = "(?<version>[^"]+)"$/mu,
		)?.groups?.version;

		expect(packageJson.version).toBe("0.1.0");
		expect(tauriConfig.version).toBe(packageJson.version);
		expect(cargoVersion).toBe(packageJson.version);
	});

	it("ships versioned release and evidence documents", async () => {
		const [changelog, checklist, evidence] = await Promise.all([
			repositoryFile("CHANGELOG.md"),
			repositoryFile("docs/release-checklist.md"),
			repositoryFile("docs/release-evidence.md"),
		]);

		expect(changelog).toContain("## [0.1.0] - 2026-08-29");
		expect(checklist).toContain("Release: 0.1.0");
		expect(checklist).toContain("Rollback decision");
		for (let criterion = 1; criterion <= 12; criterion += 1)
			expect(evidence).toContain(`SC-${criterion}`);
	});
});
