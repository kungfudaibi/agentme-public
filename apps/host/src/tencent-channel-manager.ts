import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { SecretStore } from "../../../packages/platform-runtime/src/index.js";
import type {
	TaskEvidencePort,
	TaskSubmissionPort,
	TencentChannel,
	TencentChannelConfig,
	TencentChannelDependencies,
} from "../../../plugins/channel-tencent/src/index.js";

const appIdReference = {
	type: "secret-reference",
	id: "qq-app-id",
} as const;
const appSecretReference = {
	type: "secret-reference",
	id: "qq-app-secret",
} as const;

export interface TencentChannelSettings {
	readonly isEnabled: boolean;
	readonly ownerId: string;
	readonly accountId: string;
}

export interface TencentChannelConfiguration extends TencentChannelSettings {
	readonly appId?: string;
	readonly appSecret?: string;
}

export interface TencentChannelView extends TencentChannelSettings {
	readonly id: "tencent-qq";
	readonly isConfigured: boolean;
	readonly status: "disabled" | "starting" | "running" | "error";
}

export interface TencentChannelSettingsStore {
	save(settings: TencentChannelSettings, signal: AbortSignal): Promise<void>;
}

export interface TencentChannelService {
	bind(
		ports: {
			readonly taskSubmission: TaskSubmissionPort;
			readonly taskEvidence: TaskEvidencePort;
		},
		signal: AbortSignal,
	): Promise<void>;
	view(signal: AbortSignal): Promise<TencentChannelView>;
	configure(
		input: TencentChannelConfiguration,
		signal: AbortSignal,
	): Promise<TencentChannelView>;
	close(): Promise<void>;
}

type ChannelFactory = (
	config: TencentChannelConfig,
	dependencies: Omit<TencentChannelDependencies, "QQBot">,
) => TencentChannel;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: string, allowEmpty = false): boolean {
	return (
		(allowEmpty && value.length === 0) ||
		/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)
	);
}

function ownerIdentifier(value: string, allowEmpty = false): boolean {
	return (
		(allowEmpty && value.length === 0) ||
		/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
	);
}

export function parseTencentChannelSettings(
	value: unknown,
): TencentChannelSettings {
	if (
		!isRecord(value) ||
		Object.keys(value).some(
			(key) => !["isEnabled", "ownerId", "accountId"].includes(key),
		) ||
		typeof value.isEnabled !== "boolean" ||
		typeof value.ownerId !== "string" ||
		!ownerIdentifier(value.ownerId, !value.isEnabled) ||
		typeof value.accountId !== "string" ||
		!identifier(value.accountId)
	)
		throw new TypeError("Tencent channel settings are invalid");
	return {
		isEnabled: value.isEnabled,
		ownerId: value.ownerId,
		accountId: value.accountId,
	};
}

function parseConfiguration(
	value: TencentChannelConfiguration,
): TencentChannelConfiguration {
	if (
		Object.keys(value).some(
			(key) =>
				!["isEnabled", "ownerId", "accountId", "appId", "appSecret"].includes(
					key,
				),
		) ||
		(value.appId !== undefined &&
			(value.appId.length < 1 ||
				value.appId.length > 4_096 ||
				/[\r\n\0]/u.test(value.appId))) ||
		(value.appSecret !== undefined &&
			(value.appSecret.length < 1 ||
				value.appSecret.length > 4_096 ||
				/[\r\n\0]/u.test(value.appSecret)))
	)
		throw new TypeError("Tencent channel configuration is invalid");
	const settings = parseTencentChannelSettings({
		isEnabled: value.isEnabled,
		ownerId: value.ownerId,
		accountId: value.accountId,
	});
	return {
		...settings,
		...(value.appId === undefined ? {} : { appId: value.appId }),
		...(value.appSecret === undefined ? {} : { appSecret: value.appSecret }),
	};
}

export class JsonTencentChannelSettingsStore
	implements TencentChannelSettingsStore
{
	readonly #path: string;

	constructor(path: string) {
		this.#path = resolve(path);
	}

	async save(
		settings: TencentChannelSettings,
		signal: AbortSignal,
	): Promise<void> {
		const tencent = parseTencentChannelSettings(settings);
		let current: unknown = {};
		try {
			current = JSON.parse(
				await readFile(this.#path, { encoding: "utf8", signal }),
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (!isRecord(current)) throw new TypeError("AgentMe settings are invalid");
		const temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
		await mkdir(dirname(this.#path), { recursive: true });
		try {
			await writeFile(
				temporary,
				`${JSON.stringify({ ...current, tencent }, null, 2)}\n`,
				{ encoding: "utf8", mode: 0o600, signal },
			);
			signal.throwIfAborted();
			await rename(temporary, this.#path);
		} catch (error) {
			await rm(temporary, { force: true });
			throw error;
		}
	}
}

export class TencentChannelManager implements TencentChannelService {
	readonly #settingsStore: TencentChannelSettingsStore;
	readonly #secrets: SecretStore;
	readonly #databasePath: string;
	readonly #createChannel: ChannelFactory;
	#settings: TencentChannelSettings;
	#ports:
		| {
				readonly taskSubmission: TaskSubmissionPort;
				readonly taskEvidence: TaskEvidencePort;
		  }
		| undefined;
	#hostSignal: AbortSignal | undefined;
	#channel: TencentChannel | undefined;
	#operation: Promise<void> | undefined;
	#operationAbort: AbortController | undefined;
	#unlinkHostAbort: (() => void) | undefined;
	#status: TencentChannelView["status"];
	#changes: Promise<void> = Promise.resolve();

	constructor(dependencies: {
		readonly settings: TencentChannelSettings;
		readonly settingsStore: TencentChannelSettingsStore;
		readonly secrets: SecretStore;
		readonly databasePath: string;
		readonly createChannel: ChannelFactory;
	}) {
		this.#settings = parseTencentChannelSettings(dependencies.settings);
		this.#settingsStore = dependencies.settingsStore;
		this.#secrets = dependencies.secrets;
		this.#databasePath = resolve(dependencies.databasePath);
		this.#createChannel = dependencies.createChannel;
		this.#status = this.#settings.isEnabled ? "starting" : "disabled";
	}

	async bind(
		ports: {
			readonly taskSubmission: TaskSubmissionPort;
			readonly taskEvidence: TaskEvidencePort;
		},
		signal: AbortSignal,
	): Promise<void> {
		await this.#change(signal, async () => {
			if (this.#ports !== undefined)
				throw new TypeError("Tencent channel is already bound");
			this.#ports = ports;
			this.#hostSignal = signal;
			try {
				await this.#restart();
			} catch (error) {
				this.#status = "error";
				throw error;
			}
		});
	}

	async view(signal: AbortSignal): Promise<TencentChannelView> {
		await this.#waitForChanges(signal);
		return this.#view(await this.#hasCredentials(signal));
	}

	async configure(
		input: TencentChannelConfiguration,
		signal: AbortSignal,
	): Promise<TencentChannelView> {
		let result: TencentChannelView | undefined;
		await this.#change(signal, async () => {
			const configuration = parseConfiguration(input);
			if (configuration.appId !== undefined)
				await this.#secrets.set(appIdReference, configuration.appId, signal);
			if (configuration.appSecret !== undefined)
				await this.#secrets.set(
					appSecretReference,
					configuration.appSecret,
					signal,
				);
			const isConfigured = await this.#hasCredentials(signal);
			if (configuration.isEnabled && !isConfigured)
				throw new TypeError(
					"Tencent channel requires both protected credentials",
				);
			const settings = parseTencentChannelSettings({
				isEnabled: configuration.isEnabled,
				ownerId: configuration.ownerId,
				accountId: configuration.accountId,
			});
			await this.#settingsStore.save(settings, signal);
			this.#settings = settings;
			try {
				await this.#restart();
			} catch (error) {
				this.#status = "error";
				throw error;
			}
			result = this.#view(isConfigured);
		});
		if (result === undefined)
			throw new Error("Tencent configuration did not apply");
		return result;
	}

	async close(): Promise<void> {
		await this.#changes;
		await this.#stopActive();
		this.#ports = undefined;
		this.#hostSignal = undefined;
	}

	async #restart(): Promise<void> {
		await this.#stopActive();
		if (
			!this.#settings.isEnabled ||
			this.#ports === undefined ||
			this.#hostSignal === undefined ||
			this.#hostSignal.aborted
		) {
			this.#status = "disabled";
			return;
		}
		this.#status = "starting";
		const channel = this.#createChannel(
			{
				databasePath: this.#databasePath,
				ownerIds: new Set([this.#settings.ownerId]),
				appId: appIdReference,
				appSecret: appSecretReference,
				accountId: this.#settings.accountId,
			},
			{
				resolveSecret: (reference, signal) =>
					this.#secrets.get(reference, signal),
				...this.#ports,
			},
		);
		channel.pairOwner(this.#settings.ownerId);
		const operationAbort = new AbortController();
		const abort = () => operationAbort.abort(this.#hostSignal?.reason);
		this.#hostSignal.addEventListener("abort", abort, { once: true });
		this.#unlinkHostAbort = () =>
			this.#hostSignal?.removeEventListener("abort", abort);
		this.#channel = channel;
		this.#operationAbort = operationAbort;
		this.#status = "running";
		this.#operation = channel.start(operationAbort.signal).catch(() => {
			if (!operationAbort.signal.aborted) this.#status = "error";
		});
	}

	async #stopActive(): Promise<void> {
		const channel = this.#channel;
		const operation = this.#operation;
		this.#unlinkHostAbort?.();
		this.#operationAbort?.abort();
		this.#channel = undefined;
		this.#operation = undefined;
		this.#operationAbort = undefined;
		this.#unlinkHostAbort = undefined;
		if (operation !== undefined) await operation;
		channel?.close();
	}

	async #hasCredentials(signal: AbortSignal): Promise<boolean> {
		try {
			await Promise.all([
				this.#secrets.get(appIdReference, signal),
				this.#secrets.get(appSecretReference, signal),
			]);
			return true;
		} catch {
			if (signal.aborted) throw signal.reason;
			return false;
		}
	}

	#view(isConfigured: boolean): TencentChannelView {
		return {
			id: "tencent-qq",
			...this.#settings,
			isConfigured,
			status: this.#status,
		};
	}

	#change(signal: AbortSignal, change: () => Promise<void>): Promise<void> {
		const operation = this.#changes.then(async () => {
			signal.throwIfAborted();
			await change();
		});
		this.#changes = operation.catch(() => undefined);
		return operation;
	}

	async #waitForChanges(signal: AbortSignal): Promise<void> {
		if (signal.aborted) throw signal.reason;
		await this.#changes;
		signal.throwIfAborted();
	}
}
