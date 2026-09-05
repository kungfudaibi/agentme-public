import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
	access,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const assets = [
	{
		id: "sensevoice",
		url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
		sha256: "7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e",
		size: 163_002_883,
	},
	{
		id: "piper-zh",
		url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-zh_CN-xiao_ya-medium.tar.bz2",
		sha256: "9396a3dffbb95b037acaa18094500f58d0db9a7c4f2689554e2539717cf0db65",
		size: 60_462_944,
	},
	{
		id: "kws-zh-en",
		url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2",
		sha256: "68447f4fbc67e70eee3a93961f36e81e98f47aef73ce7e7ca00885c6cd3616a6",
		size: 32_885_699,
	},
];

const root = resolve(process.cwd());
const stateRoot = resolve(
	process.env.AGENTME_DATA_DIRECTORY ?? join(root, ".agentme"),
);
const voiceServiceDirectory = resolve(
	process.env.AGENTME_VOICE_SERVICE_DIRECTORY ??
		join(root, "services", "voice-python"),
);
const downloads = join(stateRoot, "model-downloads");
const modelRoot = join(stateRoot, "models", "local-voice");
const environment = join(stateRoot, "voice-python");

function assertInside(target, parent) {
	if (target !== parent && !target.startsWith(`${parent}${sep}`))
		throw new Error(`Unsafe local voice path: ${target}`);
}

async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function sha256(path) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

async function download(asset) {
	const archive = join(downloads, `${asset.id}.tar.bz2`);
	if ((await exists(archive)) && (await sha256(archive)) === asset.sha256)
		return archive;
	const partial = `${archive}.partial`;
	await rm(partial, { force: true });
	process.stdout.write(`Downloading ${asset.id}...\n`);
	const response = await fetch(asset.url, { redirect: "follow" });
	if (!response.ok || response.body === null)
		throw new Error(`Could not download ${asset.id} (${response.status})`);
	await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
	const size = (await import("node:fs/promises"))
		.stat(partial)
		.then((value) => value.size);
	if ((await size) !== asset.size || (await sha256(partial)) !== asset.sha256) {
		await rm(partial, { force: true });
		throw new Error(`Downloaded ${asset.id} failed integrity verification`);
	}
	await rename(partial, archive);
	return archive;
}

async function run(executable, args) {
	await new Promise((resolveRun, reject) => {
		const child = spawn(executable, args, {
			stdio: "inherit",
			windowsHide: true,
			shell: false,
		});
		child.once("error", reject);
		child.once("close", (code) =>
			code === 0
				? resolveRun()
				: reject(new Error(`${executable} exited with ${code}`)),
		);
	});
}

async function extract(asset, archive) {
	const target = join(modelRoot, asset.id);
	if (await exists(target)) return target;
	const staging = join(modelRoot, `.install-${asset.id}`);
	assertInside(staging, modelRoot);
	await rm(staging, { recursive: true, force: true });
	await mkdir(staging, { recursive: true });
	try {
		await run("tar", ["-xjf", archive, "-C", staging]);
		const roots = (await readdir(staging, { withFileTypes: true })).filter(
			(entry) => entry.isDirectory(),
		);
		if (roots.length !== 1)
			throw new Error(`Unexpected ${asset.id} model archive`);
		await rename(join(staging, roots[0].name), target);
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
	return target;
}

async function installPython() {
	const python =
		process.env.AGENTME_BOOTSTRAP_PYTHON ??
		(process.platform === "win32" ? "python" : "python3");
	const executable = join(
		environment,
		process.platform === "win32" ? "Scripts" : "bin",
		process.platform === "win32" ? "python.exe" : "python",
	);
	if (!(await exists(executable)))
		await run(python, ["-m", "venv", environment]);
	await run(executable, [
		"-m",
		"pip",
		"install",
		"--disable-pip-version-check",
		"-r",
		join(voiceServiceDirectory, "requirements.txt"),
	]);
	return executable;
}

async function createWakeKeywords(kws) {
	const raw = join(kws, "keywords-agentme-raw.txt");
	const encoded = join(kws, "keywords-agentme.txt");
	await writeFile(raw, "小麦助手 @小麦助手\n", "utf8");
	const units = ["x", "iǎo", "m", "ài", "zh", "ù", "sh", "ǒu"];
	const tokenTable = new Set(
		(await readFile(join(kws, "tokens.txt"), "utf8"))
			.split(/\r?\n/u)
			.map((line) => line.split(/\s+/u)[0]),
	);
	if (units.some((unit) => !tokenTable.has(unit)))
		throw new Error("Wake phrase cannot be represented by the installed model");
	await writeFile(encoded, `${units.join(" ")} @小麦助手\n`, "utf8");
	return encoded;
}

async function configure(executable, asr, tts, kws) {
	const wakeKeywords = await createWakeKeywords(kws);
	const settingsPath = join(stateRoot, "settings.json");
	let settings = {};
	try {
		settings = JSON.parse(await readFile(settingsPath, "utf8"));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (
		typeof settings !== "object" ||
		settings === null ||
		Array.isArray(settings)
	)
		throw new Error("Existing AgentMe settings are invalid");
	const voice =
		typeof settings.voice === "object" &&
		settings.voice !== null &&
		!Array.isArray(settings.voice)
			? settings.voice
			: {};
	const next = {
		...settings,
		voice: {
			...voice,
			localExecutable: executable,
			localArgs: [
				join(voiceServiceDirectory, "sherpa_service.py"),
				"--asr-model-dir",
				asr,
				"--tts-model-dir",
				tts,
				"--kws-model-dir",
				kws,
				"--wake-keywords-file",
				wakeKeywords,
				"--wake-phrase",
				"小麦助手",
				"--num-threads",
				"2",
				"--kws-num-threads",
				"1",
				"--keywords-score",
				"1.0",
				"--keywords-threshold",
				"0.35",
			],
		},
	};
	await mkdir(dirname(settingsPath), { recursive: true });
	await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
}

assertInside(downloads, stateRoot);
assertInside(modelRoot, stateRoot);
assertInside(environment, stateRoot);
await mkdir(downloads, { recursive: true });
await mkdir(modelRoot, { recursive: true });
const archives = await Promise.all(assets.map(download));
const [asr, tts, kws] = await Promise.all(
	assets.map((asset, index) => extract(asset, archives[index])),
);
const executable = await installPython();
await configure(executable, asr, tts, kws);
process.stdout.write("Local voice is installed and configured.\n");
