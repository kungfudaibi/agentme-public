import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const action = process.argv[2];
const rawArguments = process.argv.slice(3);
const forwardedArguments =
	rawArguments[0] === "--" ? rawArguments.slice(1) : rawArguments;
const commands = {
	check: [
		"cargo",
		...(process.platform === "win32" ? ["+stable-x86_64-pc-windows-msvc"] : []),
		"check",
		"--manifest-path",
		"apps/desktop/src-tauri/Cargo.toml",
	],
	test: [
		"cargo",
		...(process.platform === "win32" ? ["+stable-x86_64-pc-windows-msvc"] : []),
		"test",
		"--manifest-path",
		"apps/desktop/src-tauri/Cargo.toml",
	],
	dev: ["corepack", "pnpm", "--dir", "apps/desktop", "tauri", "dev"],
	build: ["corepack", "pnpm", "--dir", "apps/desktop", "tauri", "build"],
};

const baseCommand = commands[action];
const command =
	baseCommand === undefined
		? undefined
		: [...baseCommand, ...forwardedArguments];
if (command === undefined)
	throw new Error("Expected check, test, dev or build");

function quote(value) {
	return `"${value.replaceAll('"', '""')}"`;
}

let result;
if (process.platform === "win32") {
	let nativeCommand = command;
	if (command[0] === "corepack") {
		const resolved = spawnSync("where.exe", ["corepack"], { encoding: "utf8" });
		const executable = resolved.stdout
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.find((line) => line.toLowerCase().endsWith(".cmd"));
		if (resolved.status !== 0 || executable === undefined)
			throw new Error("corepack is required");
		nativeCommand = [
			process.execPath,
			join(
				dirname(executable),
				"node_modules",
				"corepack",
				"dist",
				"corepack.js",
			),
			...command.slice(1),
		];
	}
	const vswhere = `${process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"}\\Microsoft Visual Studio\\Installer\\vswhere.exe`;
	if (!existsSync(vswhere))
		throw new Error("Visual Studio Build Tools are required");
	const lookup = spawnSync(
		vswhere,
		[
			"-latest",
			"-products",
			"*",
			"-requires",
			"Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
			"-property",
			"installationPath",
		],
		{ encoding: "utf8" },
	);
	const installation = lookup.stdout.trim();
	if (lookup.status !== 0 || installation.length === 0)
		throw new Error("Visual Studio C++ Build Tools are required");
	const developerShell = `${installation}\\Common7\\Tools\\VsDevCmd.bat`;
	const developerEnvironment = spawnSync(
		"cmd.exe",
		[
			"/d",
			"/s",
			"/c",
			`"call ${quote(developerShell)} -arch=x64 -host_arch=x64 >nul && set"`,
		],
		{ encoding: "utf8", windowsVerbatimArguments: true },
	);
	if (developerEnvironment.status !== 0)
		throw new Error(
			"Could not initialize the Visual Studio developer environment",
		);
	const environment = { ...process.env };
	for (const line of developerEnvironment.stdout.split(/\r?\n/u)) {
		const separator = line.indexOf("=");
		if (separator > 0)
			environment[line.slice(0, separator)] = line.slice(separator + 1);
	}
	environment.RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-msvc";
	result = spawnSync(nativeCommand[0], nativeCommand.slice(1), {
		stdio: "inherit",
		env: environment,
	});
} else {
	result = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
}

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
