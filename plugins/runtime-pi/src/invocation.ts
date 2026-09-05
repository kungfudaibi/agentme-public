export type PiPermissionProfile = "worktree-write" | "danger-full-access";

export interface PiInvocationInput {
	readonly executable: string;
	readonly worktreePath: string;
	readonly sessionDirectory: string;
	readonly sessionId: string;
	readonly prompt: string;
	readonly policyExtensionPath?: string;
	readonly provider?: string;
	readonly model?: string;
	readonly permissionProfile?: PiPermissionProfile;
	readonly hostEnvironment?: NodeJS.ProcessEnv;
	readonly providerEnvironment?: NodeJS.ProcessEnv;
	readonly platform?: NodeJS.Platform;
	readonly executableArgs?: readonly string[];
}

export interface PiInvocation {
	readonly executable: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly stdin?: string;
	readonly env?: NodeJS.ProcessEnv;
}

export function buildPiInvocation(input: PiInvocationInput): PiInvocation;
export function buildPiInvocation(
	executable: string,
	cwd: string,
): PiInvocation;
export function buildPiInvocation(
	inputOrExecutable: PiInvocationInput | string,
	cwd?: string,
): PiInvocation {
	if (typeof inputOrExecutable === "string") {
		if (cwd === undefined) throw new TypeError("cwd is required");
		return {
			executable: inputOrExecutable,
			args: ["--mode", "rpc", "--no-session"],
			cwd,
		};
	}
	const input = inputOrExecutable;
	const permissionProfile = input.permissionProfile ?? "worktree-write";
	if (
		permissionProfile === "worktree-write" &&
		input.policyExtensionPath === undefined
	)
		throw new TypeError("policyExtensionPath is required for worktree-write");
	const tools =
		permissionProfile === "danger-full-access"
			? "read,bash,powershell,edit,write,grep,find,ls"
			: "read,edit,write,grep,find,ls";
	const args = [
		...(input.executableArgs ?? []),
		"--mode",
		"rpc",
		"--session-id",
		input.sessionId,
		"--session-dir",
		input.sessionDirectory,
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--no-context-files",
		"--no-approve",
		...(input.policyExtensionPath === undefined
			? []
			: ["--extension", input.policyExtensionPath]),
		"--tools",
		tools,
	];
	if (input.provider !== undefined) args.push("--provider", input.provider);
	if (input.model !== undefined) args.push("--model", input.model);
	const environment = isolatePiEnvironment(
		input.hostEnvironment ?? process.env,
		input.platform ?? process.platform,
	);
	environment.AGENTME_PI_WORKTREE_ROOT = input.worktreePath;
	const providerEnvironment = isolatePiProviderEnvironment(
		input.providerEnvironment ?? {},
	);
	if (
		permissionProfile === "danger-full-access" &&
		Object.keys(providerEnvironment).length > 0
	) {
		throw new TypeError(
			"Provider credentials require the shell-free worktree profile",
		);
	}
	return {
		executable: input.executable,
		args,
		cwd: input.worktreePath,
		stdin: piPromptCommand(input.prompt, input.sessionId),
		env: { ...environment, ...providerEnvironment },
	};
}

export function piPromptCommand(message: string, id?: string): string {
	return `${JSON.stringify({ ...(id === undefined ? {} : { id }), type: "prompt", message })}\n`;
}

export function piAbortCommand(id?: string): string {
	return `${JSON.stringify({ ...(id === undefined ? {} : { id }), type: "abort" })}\n`;
}

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
	"PI_CODING_AGENT_DIR",
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

const providerEnvironmentVariables = [
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_AUTH_TOKEN",
	"ANTHROPIC_OAUTH_TOKEN",
	"DEEPSEEK_API_KEY",
	"OPENAI_API_KEY",
	"GEMINI_API_KEY",
	"GROQ_API_KEY",
	"MISTRAL_API_KEY",
	"OPENROUTER_API_KEY",
	"ZAI_API_KEY",
	"ZAI_CODING_CN_API_KEY",
	"MOONSHOT_API_KEY",
	"KIMI_API_KEY",
] as const;

export function isolatePiEnvironment(
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

export function isolatePiProviderEnvironment(
	providerEnvironment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {};
	for (const name of providerEnvironmentVariables) {
		const value = providerEnvironment[name];
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
