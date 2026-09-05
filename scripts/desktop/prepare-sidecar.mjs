import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import {
	chmod,
	copyFile,
	cp,
	mkdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const requiredNodeVersion = "v24.10.0";
const supportedPlatforms = new Set(["win32", "darwin", "linux"]);
const supportedArchitectures = new Set(["x64", "arm64"]);

async function sha256(path) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

export async function prepareHostRuntime({
	sourceExecutable,
	outputDirectory,
	platform,
	architecture,
	nodeVersion,
}) {
	if (!supportedPlatforms.has(platform))
		throw new Error(`Unsupported native platform: ${platform}`);
	if (!supportedArchitectures.has(architecture))
		throw new Error(`Unsupported native architecture: ${architecture}`);
	if (nodeVersion !== requiredNodeVersion)
		throw new Error(
			`Native package requires Node ${requiredNodeVersion}; received ${nodeVersion}`,
		);
	const executable = platform === "win32" ? "node.exe" : "node";
	await mkdir(outputDirectory, { recursive: true });
	for (const stale of ["node", "node.exe"])
		if (stale !== executable)
			await rm(resolve(outputDirectory, stale), { force: true });
	const target = resolve(outputDirectory, executable);
	await copyFile(sourceExecutable, target);
	if (platform !== "win32") await chmod(target, 0o755);
	const manifest = {
		nodeVersion,
		platform,
		architecture,
		executable,
		sha256: await sha256(target),
	};
	await writeFile(
		resolve(outputDirectory, "runtime.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
		"utf8",
	);
	return manifest;
}

export async function stageHostDependencies({
	sourceNodeModules,
	outputNodeModules,
	dependencyNames,
}) {
	await rm(outputNodeModules, { recursive: true, force: true });
	await mkdir(outputNodeModules, { recursive: true });
	for (const dependency of dependencyNames) {
		if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(dependency))
			throw new Error(`Invalid production dependency: ${dependency}`);
		await stagePackage(
			await realpath(resolve(sourceNodeModules, dependency)),
			resolve(outputNodeModules, dependency),
		);
	}
}

async function stagePackage(sourcePackage, outputPackage, ancestry = new Set()) {
	const metadata = JSON.parse(
		await readFile(resolve(sourcePackage, "package.json"), "utf8"),
	);
	if (typeof metadata.name !== "string" || ancestry.has(sourcePackage)) return;
	await cp(sourcePackage, outputPackage, {
		recursive: true,
		dereference: true,
		filter: (path) => {
			const fromPackage = relative(sourcePackage, path);
			return (
				fromPackage !== "node_modules" &&
				!fromPackage.startsWith(`node_modules${sep}`)
			);
		},
	});
	const dependencies = metadata.dependencies;
	if (
		typeof dependencies !== "object" ||
		dependencies === null ||
		Array.isArray(dependencies)
	)
		return;
	const nextAncestry = new Set(ancestry).add(sourcePackage);
	const require = createRequire(resolve(sourcePackage, "package.json"));
	for (const dependency of Object.keys(dependencies)) {
		if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(dependency))
			throw new Error(`Invalid transitive production dependency: ${dependency}`);
		const source = await packageRoot(require.resolve(dependency), dependency);
		await stagePackage(
			source,
			resolve(outputPackage, "node_modules", dependency),
			nextAncestry,
		);
	}
}

async function packageRoot(entryPath, expectedName) {
	let current = dirname(entryPath);
	for (;;) {
		try {
			const metadata = JSON.parse(
				await readFile(resolve(current, "package.json"), "utf8"),
			);
			if (metadata.name === expectedName) return current;
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
		const parent = dirname(current);
		if (parent === current)
			throw new Error(`Cannot resolve production dependency: ${expectedName}`);
		current = parent;
	}
}

const invokedPath = process.argv[1]
	? pathToFileURL(resolve(process.argv[1])).href
	: "";
if (import.meta.url === invokedPath) {
	const scriptDirectory = dirname(fileURLToPath(import.meta.url));
	const root = resolve(scriptDirectory, "../..");
	const outputDirectory = resolve(
		scriptDirectory,
		"../../apps/desktop/src-tauri/runtime",
	);
	const manifest = await prepareHostRuntime({
		sourceExecutable: process.execPath,
		outputDirectory,
		platform: process.platform,
		architecture: process.arch,
		nodeVersion: process.version,
	});
	const packageJson = JSON.parse(
		await readFile(resolve(root, "package.json"), "utf8"),
	);
	await stageHostDependencies({
		sourceNodeModules: resolve(root, "node_modules"),
		outputNodeModules: resolve(root, "dist/node_modules"),
		dependencyNames: Object.keys(packageJson.dependencies ?? {}),
	});
	process.stdout.write(
		`Prepared ${manifest.platform}/${manifest.architecture} Node host runtime.\n`,
	);
}
