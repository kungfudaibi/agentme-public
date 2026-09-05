export interface CodexInvocationInput {
	readonly executable: string;
	readonly worktreePath: string;
	readonly prompt: string;
	readonly model?: string;
	readonly windowsSandbox?: "elevated" | "unelevated";
	readonly resourceDirectory?: string;
	readonly hostEnvironment?: NodeJS.ProcessEnv;
	readonly platform?: NodeJS.Platform;
	readonly executionPolicy?: CodexExecutionPolicy;
}

export interface CodexExecutionPolicy {
	readonly sandboxMode: "workspace-write" | "danger-full-access";
	readonly approvalPolicy: "untrusted" | "on-request" | "never";
}

export const safeUnattendedCodexPolicy: CodexExecutionPolicy = {
	sandboxMode: "workspace-write",
	approvalPolicy: "never",
};

export interface CodexResumeInvocationInput extends CodexInvocationInput {
	readonly threadId: string;
}

export interface CodexInvocation {
	readonly executable: string;
	readonly args: readonly string[];
	readonly stdin: string;
	readonly env?: NodeJS.ProcessEnv;
}

export function buildCodexInvocation(
	input: CodexInvocationInput,
): CodexInvocation {
	const policy = input.executionPolicy ?? safeUnattendedCodexPolicy;
	const args = [
		"--ask-for-approval",
		policy.approvalPolicy,
		"--sandbox",
		policy.sandboxMode,
		"--cd",
		input.worktreePath,
		"exec",
		"--json",
		"--color",
		"never",
	];
	if (input.model !== undefined) args.push("--model", input.model);
	if (input.windowsSandbox !== undefined) {
		args.push("--config", `windows.sandbox="${input.windowsSandbox}"`);
	}
	args.push("-");
	return withResourceDirectory(
		{ executable: input.executable, args, stdin: input.prompt },
		input.resourceDirectory,
		input.hostEnvironment ?? process.env,
		input.platform ?? process.platform,
	);
}

export function buildCodexResumeInvocation(
	input: CodexResumeInvocationInput,
): CodexInvocation {
	const policy = input.executionPolicy ?? safeUnattendedCodexPolicy;
	const args = [
		"--ask-for-approval",
		policy.approvalPolicy,
		"--cd",
		input.worktreePath,
		"--sandbox",
		policy.sandboxMode,
		"exec",
		"resume",
		"--json",
	];
	if (input.model !== undefined) args.push("--model", input.model);
	if (input.windowsSandbox !== undefined) {
		args.push("--config", `windows.sandbox="${input.windowsSandbox}"`);
	}
	args.push(input.threadId, "-");
	return withResourceDirectory(
		{ executable: input.executable, args, stdin: input.prompt },
		input.resourceDirectory,
		input.hostEnvironment ?? process.env,
		input.platform ?? process.platform,
	);
}

// Keep credentials and process-injection hooks out of coding workers. This list
// contains only locations and runtime metadata needed to start portable tools.
const allowedEnvironmentVariables = [
	"ALLUSERSPROFILE",
	"APPDATA",
	"CODEX_HOME",
	"COMSPEC",
	"HOME",
	"HOMEDRIVE",
	"HOMEPATH",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"LOCALAPPDATA",
	"OS",
	"PATH",
	"PATHEXT",
	"PROGRAMDATA",
	"PROGRAMFILES",
	"PROGRAMFILES(X86)",
	"PROGRAMW6432",
	"SHELL",
	"SYSTEMDRIVE",
	"SYSTEMROOT",
	"TEMP",
	"TERM",
	"TMP",
	"TMPDIR",
	"USERPROFILE",
	"WINDIR",
	"XDG_CACHE_HOME",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
] as const;

function withResourceDirectory(
	invocation: CodexInvocation,
	resourceDirectory: string | undefined,
	hostEnvironment: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
): CodexInvocation {
	const env: NodeJS.ProcessEnv = {};
	for (const name of allowedEnvironmentVariables) {
		const value = readEnvironmentVariable(hostEnvironment, name, platform);
		if (value !== undefined) env[name] = value;
	}
	if (resourceDirectory !== undefined) {
		const separator = platform === "win32" ? ";" : ":";
		env.PATH = env.PATH
			? `${resourceDirectory}${separator}${env.PATH}`
			: resourceDirectory;
	}
	return {
		...invocation,
		env,
	};
}

function readEnvironmentVariable(
	environment: NodeJS.ProcessEnv,
	name: string,
	platform: NodeJS.Platform,
): string | undefined {
	if (platform !== "win32") return environment[name];
	const matchingName = Object.keys(environment).find(
		(candidate) => candidate.toUpperCase() === name,
	);
	return matchingName === undefined ? undefined : environment[matchingName];
}
