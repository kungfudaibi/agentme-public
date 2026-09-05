import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import type { ClaudeRuntimeConfig } from "../../../plugins/runtime-claude/src/index.js";
import {
	isolatePiProviderEnvironment,
	type PiRuntimeConfig,
	piWorktreePolicySource,
} from "../../../plugins/runtime-pi/src/index.js";

export async function codingBackendConfig(
	directory: string,
	environment: NodeJS.ProcessEnv = process.env,
): Promise<{ claude: ClaudeRuntimeConfig; pi: PiRuntimeConfig }> {
	const policy = join(directory, "coding-runtime", "pi-policy.mjs");
	await mkdir(join(directory, "coding-runtime"), { recursive: true });
	await writeFile(policy, piWorktreePolicySource, "utf8");
	const candidates = (environment.PATH ?? environment.Path ?? "")
		.split(delimiter)
		.map((path) =>
			join(
				path,
				"node_modules",
				"@mariozechner",
				"pi-coding-agent",
				"dist",
				"cli.js",
			),
		);
	const cli =
		environment.AGENTME_PI_CLI ?? candidates.find((path) => existsSync(path));
	return {
		claude: {
			executable: environment.AGENTME_CLAUDE_EXECUTABLE ?? "claude",
			...(environment.AGENTME_CLAUDE_MODEL
				? { model: environment.AGENTME_CLAUDE_MODEL }
				: {}),
		},
		pi: {
			executable: cli
				? process.execPath
				: (environment.AGENTME_PI_EXECUTABLE ?? "pi"),
			...(cli ? { executableArgs: [resolve(cli)] } : {}),
			sessionDirectory: join(directory, "coding-runtime", "pi-sessions"),
			policyExtensionPath: policy,
			permissionProfile: "worktree-write",
			...(environment.AGENTME_PI_PROVIDER
				? { provider: environment.AGENTME_PI_PROVIDER }
				: {}),
			...(environment.AGENTME_PI_MODEL
				? { model: environment.AGENTME_PI_MODEL }
				: {}),
			credentialResolver: async () => isolatePiProviderEnvironment(environment),
		},
	};
}
