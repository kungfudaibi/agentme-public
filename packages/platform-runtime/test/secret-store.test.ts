import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SecretReference } from "../../contracts/src/index.js";
import {
	createPlatformSecretStore,
	LinuxSecretServiceStore,
	MacOsKeychainStore,
	type NativeCommand,
	type NativeCommandResult,
	type NativeCommandRunner,
	WindowsDpapiSecretStore,
} from "../src/index.js";

const reference: SecretReference = {
	type: "secret-reference",
	id: "deepseek-api-key",
};

class RecordingRunner implements NativeCommandRunner {
	readonly commands: NativeCommand[] = [];
	readonly #respond: (command: NativeCommand) => NativeCommandResult;

	constructor(respond: (command: NativeCommand) => NativeCommandResult) {
		this.#respond = respond;
	}

	async run(command: NativeCommand): Promise<NativeCommandResult> {
		this.commands.push(command);
		return this.#respond(command);
	}
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("portable secret stores", () => {
	it("keeps Windows plaintext off disk and resolves a DPAPI ciphertext", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-secret-"));
		temporaryDirectories.push(directory);
		const runner = new RecordingRunner((command) => ({
			stdout: command.script.includes("ConvertFrom-SecureString")
				? "encrypted-for-current-user"
				: "resolved-secret",
			stderr: "",
			exitCode: 0,
		}));
		const store = new WindowsDpapiSecretStore(directory, runner);
		const signal = new AbortController().signal;

		await store.set(reference, "plain-secret", signal);

		expect(
			await readFile(join(directory, "deepseek-api-key.dpapi"), "utf8"),
		).toBe("encrypted-for-current-user");
		expect(runner.commands[0]).toMatchObject({
			executable: "pwsh.exe",
			stdin: "plain-secret",
			signal,
		});
		expect(runner.commands[0]?.args.join(" ")).not.toContain("plain-secret");
		await expect(store.get(reference, signal)).resolves.toBe("resolved-secret");
		expect(runner.commands[1]?.stdin).toBe("encrypted-for-current-user");

		await store.delete(reference, signal);
		await expect(
			readFile(join(directory, "deepseek-api-key.dpapi"), "utf8"),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("does not delete a Windows credential after cancellation", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-secret-"));
		temporaryDirectories.push(directory);
		const runner = new RecordingRunner(() => ({
			stdout: "encrypted-for-current-user",
			stderr: "",
			exitCode: 0,
		}));
		const store = new WindowsDpapiSecretStore(directory, runner);
		await store.set(reference, "plain-secret");
		const controller = new AbortController();
		controller.abort();

		await expect(
			store.delete(reference, controller.signal),
		).rejects.toMatchObject({ code: "CANCELLED" });
		await expect(
			readFile(join(directory, "deepseek-api-key.dpapi"), "utf8"),
		).resolves.toBe("encrypted-for-current-user");
	});

	it("uses macOS Keychain without creating a credential file", async () => {
		const runner = new RecordingRunner(() => ({
			stdout: "keychain-secret\n",
			stderr: "",
			exitCode: 0,
		}));
		const store = new MacOsKeychainStore(runner);

		await store.set(reference, "mac-secret");
		await expect(store.get(reference)).resolves.toBe("keychain-secret");
		await store.delete(reference);

		expect(runner.commands.map(({ executable }) => executable)).toEqual([
			"/usr/bin/security",
			"/usr/bin/security",
			"/usr/bin/security",
		]);
		expect(runner.commands[0]?.args).toContain("add-generic-password");
		expect(runner.commands[1]?.args).toContain("find-generic-password");
		expect(runner.commands[2]?.args).toContain("delete-generic-password");
	});

	it("pipes Linux secrets through Secret Service stdin", async () => {
		const runner = new RecordingRunner(() => ({
			stdout: "linux-secret\n",
			stderr: "",
			exitCode: 0,
		}));
		const store = new LinuxSecretServiceStore(runner);

		await store.set(reference, "linux-secret");
		await expect(store.get(reference)).resolves.toBe("linux-secret");

		expect(runner.commands[0]).toMatchObject({
			executable: "secret-tool",
			stdin: "linux-secret",
		});
		expect(runner.commands[0]?.args.join(" ")).not.toContain("linux-secret");
	});

	it.each([
		["win32", WindowsDpapiSecretStore],
		["darwin", MacOsKeychainStore],
		["linux", LinuxSecretServiceStore],
	] as const)(
		"selects the %s adapter at the platform boundary",
		(platform, type) => {
			const runner = new RecordingRunner(() => ({
				stdout: "",
				stderr: "",
				exitCode: 0,
			}));
			expect(
				createPlatformSecretStore({
					platform,
					dataDirectory: "ignored-by-vault-platforms",
					runner,
				}),
			).toBeInstanceOf(type);
		},
	);
});
