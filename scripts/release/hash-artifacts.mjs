import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const manifestName = "artifacts.sha256";

async function filesBelow(directory, current = directory) {
	const files = [];
	for (const entry of await readdir(current, { withFileTypes: true })) {
		const path = resolve(current, entry.name);
		if (entry.isDirectory()) files.push(...(await filesBelow(directory, path)));
		else if (entry.isFile() && entry.name !== manifestName) files.push(path);
	}
	return files;
}

async function sha256(path) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

export async function writeArtifactHashes(directory) {
	const root = resolve(directory);
	const files = await filesBelow(root);
	const entries = await Promise.all(
		files.map(async (path) => ({
			path: relative(root, path).split(sep).join("/"),
			hash: await sha256(path),
		})),
	);
	entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
	const manifest = resolve(root, manifestName);
	await writeFile(
		manifest,
		entries.map(({ hash, path }) => `${hash}  ${path}\n`).join(""),
		{ encoding: "utf8", mode: 0o600 },
	);
	return manifest;
}

const invoked = process.argv[1]
	? pathToFileURL(resolve(process.argv[1])).href
	: undefined;
if (invoked === import.meta.url) {
	const directory = process.argv[2];
	if (directory === undefined)
		throw new TypeError("Expected an artifact directory");
	const manifest = await writeArtifactHashes(directory);
	process.stdout.write(`Wrote ${manifest}\n`);
}
