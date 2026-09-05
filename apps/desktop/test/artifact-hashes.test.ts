import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeArtifactHashes } from "../../../scripts/release/hash-artifacts.mjs";

const directories: string[] = [];

afterEach(async () => {
	for (const directory of directories.splice(0))
		await rm(directory, { recursive: true, force: true });
});

describe("release artifact hashes", () => {
	it("writes a deterministic manifest without hashing itself", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-artifacts-"));
		directories.push(directory);
		await mkdir(join(directory, "nested"));
		await writeFile(join(directory, "z.exe"), "z", "utf8");
		await writeFile(join(directory, "nested", "a.msi"), "a", "utf8");

		const manifest = await writeArtifactHashes(directory);
		const content = await readFile(manifest, "utf8");

		expect(content).toMatch(
			/^[0-9a-f]{64} {2}nested\/a\.msi\n[0-9a-f]{64} {2}z\.exe\n$/u,
		);
		expect(content).not.toContain("artifacts.sha256");
	});
});
