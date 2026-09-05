import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { win32 } from "node:path";

import { AgentMeError } from "../../contracts/src/index.js";
import type {
	DesktopApplicationId,
	DesktopApplicationLauncher,
} from "./desktop-actions.js";

export interface DesktopApplicationCommand {
	readonly executable: string;
	readonly args: readonly string[];
}

export interface ResolveDesktopApplicationOptions {
	readonly platform?: NodeJS.Platform;
	readonly environment?: Readonly<NodeJS.ProcessEnv>;
	readonly fileExists?: (path: string) => Promise<boolean>;
}

function unavailable(message: string, cause?: unknown): AgentMeError {
	return new AgentMeError({
		code: "PROVIDER_UNAVAILABLE",
		message,
		isRetryable: false,
		cause,
	});
}

async function defaultFileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function windowsWechatCandidates(
	environment: Readonly<NodeJS.ProcessEnv>,
): readonly string[] {
	const roots = [
		environment.ProgramFiles,
		environment.ProgramW6432,
		environment.PROGRAMFILES,
		environment["ProgramFiles(x86)"],
		environment["PROGRAMFILES(X86)"],
		environment.LOCALAPPDATA,
	].filter(
		(root): root is string => typeof root === "string" && root.length > 0,
	);
	return [
		...new Set(
			roots.flatMap((root) => [
				win32.join(root, "Tencent", "WeChat", "WeChat.exe"),
				win32.join(root, "Tencent", "Weixin", "Weixin.exe"),
			]),
		),
	];
}

export async function resolveDesktopApplicationCommand(
	applicationId: DesktopApplicationId,
	options: ResolveDesktopApplicationOptions = {},
): Promise<DesktopApplicationCommand> {
	if (applicationId !== "wechat")
		throw unavailable("Application is not allowed");
	const platform = options.platform ?? process.platform;
	const environment = options.environment ?? process.env;
	const fileExists = options.fileExists ?? defaultFileExists;
	const candidates =
		platform === "win32"
			? windowsWechatCandidates(environment).map((executable) => ({
					executable,
					args: [] as const,
				}))
			: platform === "darwin"
				? [{ executable: "/usr/bin/open", args: ["-a", "WeChat"] as const }]
				: platform === "linux"
					? [
							{ executable: "/usr/bin/wechat", args: [] as const },
							{ executable: "/usr/local/bin/wechat", args: [] as const },
							{ executable: "/opt/wechat/wechat", args: [] as const },
						]
					: [];
	for (const command of candidates)
		if (await fileExists(command.executable)) return command;
	throw unavailable("WeChat is not installed at an allowlisted path");
}

export class PlatformDesktopApplicationLauncher
	implements DesktopApplicationLauncher
{
	async launch(
		applicationId: DesktopApplicationId,
		signal: AbortSignal,
	): Promise<void> {
		signal.throwIfAborted();
		const command = await resolveDesktopApplicationCommand(applicationId);
		signal.throwIfAborted();
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const child = spawn(command.executable, [...command.args], {
				detached: true,
				stdio: "ignore",
				shell: false,
				windowsHide: false,
			});
			const finish = (operation: () => void) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", onAbort);
				operation();
			};
			const onAbort = () => {
				child.kill();
				finish(() => reject(signal.reason));
			};
			signal.addEventListener("abort", onAbort, { once: true });
			child.once("error", (error) =>
				finish(() => reject(unavailable("WeChat could not be started", error))),
			);
			child.once("spawn", () =>
				finish(() => {
					child.unref();
					resolve();
				}),
			);
		});
	}
}
