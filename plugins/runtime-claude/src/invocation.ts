export type ClaudePermissionMode =
	| "acceptEdits"
	| "dontAsk"
	| "bypassPermissions";

export interface ClaudeInvocationInput {
	readonly executable: string;
	readonly worktreePath: string;
	readonly prompt: string;
	readonly permissionMode?: ClaudePermissionMode;
	readonly model?: string;
	readonly maxBudgetUsd?: number;
	readonly hostEnvironment?: NodeJS.ProcessEnv;
	readonly platform?: NodeJS.Platform;
	readonly extraArgs?: readonly string[];
}

export interface ClaudeResumeInvocationInput extends ClaudeInvocationInput {
	readonly threadId: string;
}

export interface ClaudeInvocation {
	readonly executable: string;
	readonly args: readonly string[];
	readonly stdin: string;
	readonly cwd: string;
	readonly env?: NodeJS.ProcessEnv;
}

export function buildClaudeInvocation(
	input: ClaudeInvocationInput,
): ClaudeInvocation;
export function buildClaudeInvocation(
	executable: string,
	cwd: string,
	prompt: string,
	model?: string,
): ClaudeInvocation;
export function buildClaudeInvocation(
	inputOrExecutable: ClaudeInvocationInput | string,
	cwd?: string,
	prompt?: string,
	model?: string,
): ClaudeInvocation {
	const input =
		typeof inputOrExecutable === "string"
			? legacyInput(inputOrExecutable, cwd, prompt, model)
			: inputOrExecutable;
	return createInvocation(input);
}

export function buildClaudeResumeInvocation(
	input: ClaudeResumeInvocationInput,
): ClaudeInvocation {
	return createInvocation(input, input.threadId);
}

function createInvocation(
	input: ClaudeInvocationInput,
	threadId?: string,
): ClaudeInvocation {
	const permissionMode = input.permissionMode ?? "acceptEdits";
	const args = [
		...(input.extraArgs ?? []),
		"-p",
		"--output-format",
		"stream-json",
		"--verbose",
		"--include-partial-messages",
		"--safe-mode",
		"--permission-mode",
		permissionMode,
	];
	if (threadId !== undefined) args.push("--resume", threadId);
	if (input.model !== undefined) args.push("--model", input.model);
	if (input.maxBudgetUsd !== undefined) {
		if (!Number.isFinite(input.maxBudgetUsd) || input.maxBudgetUsd <= 0) {
			throw new TypeError("maxBudgetUsd must be a positive finite number");
		}
		args.push("--max-budget-usd", String(input.maxBudgetUsd));
	}
	return {
		executable: input.executable,
		args,
		stdin: input.prompt,
		cwd: input.worktreePath,
		env: isolateClaudeEnvironment(
			input.hostEnvironment ?? process.env,
			input.platform ?? process.platform,
		),
	};
}

function legacyInput(
	executable: string,
	cwd: string | undefined,
	prompt: string | undefined,
	model: string | undefined,
): ClaudeInvocationInput {
	if (cwd === undefined || prompt === undefined) {
		throw new TypeError("cwd and prompt are required");
	}
	return {
		executable,
		worktreePath: cwd,
		prompt,
		...(model === undefined ? {} : { model }),
	};
}

// OAuth remains available through the OS keychain and profile paths. Provider
// tokens and process-injection variables are intentionally not inherited by a
// coding worker or by shell commands that worker starts.
const allowedEnvironmentVariables = [
	"ALLUSERSPROFILE",
	"APPDATA",
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

export function isolateClaudeEnvironment(
	hostEnvironment: NodeJS.ProcessEnv,
	platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {};
	for (const name of allowedEnvironmentVariables) {
		const value = readEnvironmentVariable(hostEnvironment, name, platform);
		if (value !== undefined) environment[name] = value;
	}
	return environment;
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
