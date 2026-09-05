import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
	prepareHostRuntime,
	stageHostDependencies,
} from "../../../scripts/desktop/prepare-sidecar.mjs";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("native host runtime preparation", () => {
	it("copies the native Node runtime with a verifiable target manifest", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-sidecar-"));
		directories.push(directory);
		const source = join(directory, "source-node.exe");
		const output = join(directory, "runtime");
		await writeFile(source, "native-node-fixture");

		const manifest = await prepareHostRuntime({
			sourceExecutable: source,
			outputDirectory: output,
			platform: "win32",
			architecture: "x64",
			nodeVersion: "v24.10.0",
		});

		expect(await readFile(join(output, "node.exe"), "utf8")).toBe(
			"native-node-fixture",
		);
		expect(manifest).toMatchObject({
			platform: "win32",
			architecture: "x64",
			nodeVersion: "v24.10.0",
			executable: "node.exe",
		});
		expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/u);
		expect(
			JSON.parse(await readFile(join(output, "runtime.json"), "utf8")),
		).toEqual(manifest);
	});

	it("rejects a runtime from a different platform", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-sidecar-"));
		directories.push(directory);

		await expect(
			prepareHostRuntime({
				sourceExecutable: join(directory, "node"),
				outputDirectory: join(directory, "runtime"),
				platform: "unsupported" as NodeJS.Platform,
				architecture: "x64",
				nodeVersion: "v24.10.0",
			}),
		).rejects.toThrow("Unsupported native platform");
	});

	it("stages production dependencies beside the packaged ESM host", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-sidecar-"));
		directories.push(directory);
		const source = join(directory, "source-node-modules");
		const output = join(directory, "dist", "node_modules");
		await mkdir(join(source, "semver"), { recursive: true });
		await writeFile(
			join(source, "semver", "package.json"),
			'{"name":"semver"}',
		);

		await stageHostDependencies({
			sourceNodeModules: source,
			outputNodeModules: output,
			dependencyNames: ["semver"],
		});

		expect(await readFile(join(output, "semver", "package.json"), "utf8")).toBe(
			'{"name":"semver"}',
		);
	});

	it("stages transitive dependencies required by a packaged production SDK", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-sidecar-"));
		directories.push(directory);
		const output = join(directory, "dist", "node_modules");

		await stageHostDependencies({
			sourceNodeModules: join(process.cwd(), "node_modules"),
			outputNodeModules: output,
			dependencyNames: ["@tencent-connect/qqbot-nodejs"],
		});

		expect(
			JSON.parse(
				await readFile(
					join(
						output,
						"@tencent-connect",
						"qqbot-nodejs",
						"node_modules",
						"ws",
						"package.json",
					),
					"utf8",
				),
			),
		).toMatchObject({ name: "ws", version: "8.21.3" });
		const stagedSdk = await import(
			pathToFileURL(
				join(output, "@tencent-connect", "qqbot-nodejs", "dist", "index.js"),
			).href
		);
		expect(stagedSdk.QQBot).toBeTypeOf("function");
	});
});
