import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
	AgentMeError,
	parseSecretReference,
	type SecretReference,
} from "../../contracts/src/index.js";
import {
	type NativeCommand,
	type NativeCommandRunner,
	SpawnNativeCommandRunner,
} from "./native-command.js";

const SERVICE_NAME = "AgentMe";
const noCancellation = new AbortController().signal;
const protectScript = [
	"$plain = [Console]::In.ReadToEnd()",
	"$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force",
	"[Console]::Out.Write(($secure | ConvertFrom-SecureString))",
].join("; ");
const unprotectScript = [
	"$cipher = [Console]::In.ReadToEnd()",
	"$secure = $cipher | ConvertTo-SecureString",
	"$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
	"try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }",
].join("; ");

export interface SecretStore {
	set(
		reference: SecretReference,
		value: string,
		signal?: AbortSignal,
	): Promise<void>;
	get(reference: SecretReference, signal?: AbortSignal): Promise<string>;
	delete(reference: SecretReference, signal?: AbortSignal): Promise<void>;
}

function safeReference(reference: SecretReference): SecretReference {
	return parseSecretReference(reference);
}

function safeValue(value: string): string {
	if (typeof value !== "string" || value.length < 1 || value.length > 65_536) {
		throw new AgentMeError({
			code: "INVALID_PROVIDER_CONFIG",
			message: "Credential value is invalid",
			isRetryable: false,
		});
	}
	return value;
}

function credentialUnavailable(cause?: unknown): AgentMeError {
	return new AgentMeError({
		code: "INVALID_PROVIDER_CONFIG",
		message: "Credential is unavailable",
		isRetryable: false,
		cause,
	});
}

function ensureNotCancelled(signal: AbortSignal): void {
	if (!signal.aborted) return;
	throw new AgentMeError({
		code: "CANCELLED",
		message: "Credential operation was cancelled",
		isRetryable: false,
	});
}

function removeOneTrailingNewline(value: string): string {
	return value.endsWith("\r\n")
		? value.slice(0, -2)
		: value.endsWith("\n")
			? value.slice(0, -1)
			: value;
}

async function checkedRun(
	runner: NativeCommandRunner,
	command: NativeCommand,
): Promise<string> {
	try {
		const result = await runner.run(command);
		if (result.exitCode !== 0) throw credentialUnavailable();
		return result.stdout;
	} catch (error) {
		if (error instanceof AgentMeError) throw error;
		throw credentialUnavailable(error);
	}
}

export class WindowsDpapiSecretStore implements SecretStore {
	readonly #directory: string;
	readonly #runner: NativeCommandRunner;

	constructor(
		directory: string,
		runner: NativeCommandRunner = new SpawnNativeCommandRunner(),
	) {
		this.#directory = resolve(directory);
		this.#runner = runner;
	}

	async set(
		reference: SecretReference,
		value: string,
		signal: AbortSignal = noCancellation,
	): Promise<void> {
		ensureNotCancelled(signal);
		const file = this.#file(reference);
		const ciphertext = await checkedRun(this.#runner, {
			executable: "pwsh.exe",
			args: [
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				protectScript,
			],
			stdin: safeValue(value),
			signal,
			script: protectScript,
		});
		if (ciphertext.length < 1) throw credentialUnavailable();
		ensureNotCancelled(signal);
		await mkdir(this.#directory, { recursive: true });
		await writeFile(file, ciphertext, {
			encoding: "utf8",
			mode: 0o600,
			signal,
		});
	}

	async get(
		reference: SecretReference,
		signal: AbortSignal = noCancellation,
	): Promise<string> {
		try {
			ensureNotCancelled(signal);
			const ciphertext = (
				await readFile(this.#file(reference), { encoding: "utf8", signal })
			).trim();
			if (ciphertext.length < 1) throw credentialUnavailable();
			const plaintext = await checkedRun(this.#runner, {
				executable: "pwsh.exe",
				args: [
					"-NoLogo",
					"-NoProfile",
					"-NonInteractive",
					"-Command",
					unprotectScript,
				],
				stdin: ciphertext,
				signal,
				script: unprotectScript,
			});
			return safeValue(plaintext);
		} catch (error) {
			if (error instanceof AgentMeError) throw error;
			ensureNotCancelled(signal);
			throw credentialUnavailable(error);
		}
	}

	async delete(
		reference: SecretReference,
		signal: AbortSignal = noCancellation,
	): Promise<void> {
		ensureNotCancelled(signal);
		await rm(this.#file(reference), { force: true });
	}

	#file(reference: SecretReference): string {
		return resolve(this.#directory, `${safeReference(reference).id}.dpapi`);
	}
}

abstract class CommandVaultSecretStore implements SecretStore {
	readonly #runner: NativeCommandRunner;

	constructor(runner: NativeCommandRunner = new SpawnNativeCommandRunner()) {
		this.#runner = runner;
	}

	protected abstract setCommand(
		reference: SecretReference,
		value: string,
		signal: AbortSignal,
	): NativeCommand;
	protected abstract getCommand(
		reference: SecretReference,
		signal: AbortSignal,
	): NativeCommand;
	protected abstract deleteCommand(
		reference: SecretReference,
		signal: AbortSignal,
	): NativeCommand;

	async set(
		reference: SecretReference,
		value: string,
		signal: AbortSignal = noCancellation,
	): Promise<void> {
		ensureNotCancelled(signal);
		await checkedRun(
			this.#runner,
			this.setCommand(safeReference(reference), safeValue(value), signal),
		);
	}

	async get(
		reference: SecretReference,
		signal: AbortSignal = noCancellation,
	): Promise<string> {
		ensureNotCancelled(signal);
		const value = removeOneTrailingNewline(
			await checkedRun(
				this.#runner,
				this.getCommand(safeReference(reference), signal),
			),
		);
		return safeValue(value);
	}

	async delete(
		reference: SecretReference,
		signal: AbortSignal = noCancellation,
	): Promise<void> {
		ensureNotCancelled(signal);
		await checkedRun(
			this.#runner,
			this.deleteCommand(safeReference(reference), signal),
		);
	}
}

export class MacOsKeychainStore extends CommandVaultSecretStore {
	protected setCommand(
		reference: SecretReference,
		value: string,
		signal: AbortSignal,
	): NativeCommand {
		return {
			executable: "/usr/bin/security",
			args: [
				"add-generic-password",
				"-U",
				"-s",
				SERVICE_NAME,
				"-a",
				reference.id,
				"-w",
				value,
			],
			signal,
			script: "security add-generic-password",
		};
	}

	protected getCommand(
		reference: SecretReference,
		signal: AbortSignal,
	): NativeCommand {
		return {
			executable: "/usr/bin/security",
			args: [
				"find-generic-password",
				"-w",
				"-s",
				SERVICE_NAME,
				"-a",
				reference.id,
			],
			signal,
			script: "security find-generic-password",
		};
	}

	protected deleteCommand(
		reference: SecretReference,
		signal: AbortSignal,
	): NativeCommand {
		return {
			executable: "/usr/bin/security",
			args: ["delete-generic-password", "-s", SERVICE_NAME, "-a", reference.id],
			signal,
			script: "security delete-generic-password",
		};
	}
}

export class LinuxSecretServiceStore extends CommandVaultSecretStore {
	protected setCommand(
		reference: SecretReference,
		value: string,
		signal: AbortSignal,
	): NativeCommand {
		return {
			executable: "secret-tool",
			args: [
				"store",
				`--label=${SERVICE_NAME}`,
				"service",
				SERVICE_NAME,
				"account",
				reference.id,
			],
			stdin: value,
			signal,
			script: "secret-tool store",
		};
	}

	protected getCommand(
		reference: SecretReference,
		signal: AbortSignal,
	): NativeCommand {
		return {
			executable: "secret-tool",
			args: ["lookup", "service", SERVICE_NAME, "account", reference.id],
			signal,
			script: "secret-tool lookup",
		};
	}

	protected deleteCommand(
		reference: SecretReference,
		signal: AbortSignal,
	): NativeCommand {
		return {
			executable: "secret-tool",
			args: ["clear", "service", SERVICE_NAME, "account", reference.id],
			signal,
			script: "secret-tool clear",
		};
	}
}

export interface PlatformSecretStoreOptions {
	readonly platform?: NodeJS.Platform;
	readonly dataDirectory: string;
	readonly runner?: NativeCommandRunner;
}

export function createPlatformSecretStore(
	options: PlatformSecretStoreOptions,
): SecretStore {
	const runner = options.runner ?? new SpawnNativeCommandRunner();
	switch (options.platform ?? process.platform) {
		case "win32":
			return new WindowsDpapiSecretStore(options.dataDirectory, runner);
		case "darwin":
			return new MacOsKeychainStore(runner);
		case "linux":
			return new LinuxSecretServiceStore(runner);
		default:
			throw new AgentMeError({
				code: "INVALID_PROVIDER_CONFIG",
				message: "This operating system has no credential-store adapter",
				isRetryable: false,
			});
	}
}
