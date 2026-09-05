import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	randomUUID,
} from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
	AgentMeError,
	type PersonalDashboardDocument,
	type PersonalDashboardEntry,
	parsePersonalDashboardDocument,
	parsePersonalDashboardEntry,
	parsePersonalDashboardEntryInput,
	type SecretReference,
} from "../../../packages/contracts/src/index.js";

const dashboardKeyReference = {
	type: "secret-reference",
	id: "personal-dashboard-key-v1",
} satisfies SecretReference;
const noCancellation = new AbortController().signal;
const algorithm = "aes-256-gcm";
const associatedData = Buffer.from("AgentMe personal dashboard v1", "utf8");
const maximumEncryptedBytes = 1_048_576;

interface EncryptedDashboardEnvelope {
	readonly version: 1;
	readonly iv: string;
	readonly authTag: string;
	readonly ciphertext: string;
}

export interface DashboardKeyStore {
	set(
		reference: SecretReference,
		value: string,
		signal?: AbortSignal,
	): Promise<void>;
	get(reference: SecretReference, signal?: AbortSignal): Promise<string>;
	delete(reference: SecretReference, signal?: AbortSignal): Promise<void>;
}

export interface PersonalDashboardStoreOptions {
	readonly path: string;
	readonly keys: DashboardKeyStore;
	readonly clock?: () => Date;
	readonly createId?: () => string;
}

export class PersonalDashboardStore {
	readonly #path: string;
	readonly #keys: DashboardKeyStore;
	readonly #clock: () => Date;
	readonly #createId: () => string;

	constructor(options: PersonalDashboardStoreOptions) {
		this.#path = resolve(options.path);
		this.#keys = options.keys;
		this.#clock = options.clock ?? (() => new Date());
		this.#createId = options.createId ?? randomUUID;
	}

	async list(
		signal: AbortSignal = noCancellation,
	): Promise<readonly PersonalDashboardEntry[]> {
		return (await this.#load(signal)).document.entries;
	}

	async create(
		input: unknown,
		signal: AbortSignal = noCancellation,
	): Promise<PersonalDashboardEntry> {
		const parsed = parsePersonalDashboardEntryInput(input);
		const loaded = await this.#load(signal);
		const at = this.#now();
		const entry = parsePersonalDashboardEntry({
			...parsed,
			id: this.#createId(),
			createdAt: at,
			updatedAt: at,
		});
		if (loaded.document.entries.some(({ id }) => id === entry.id))
			throw invalidDashboard("Personal dashboard entry already exists");
		await this.#save(
			{
				schemaVersion: 1,
				purpose: "owner-personal-dashboard",
				retention: "until-owner-deletes",
				updatedAt: at,
				entries: [...loaded.document.entries, entry],
			},
			loaded.exists,
			signal,
		);
		return entry;
	}

	async update(
		id: string,
		input: unknown,
		signal: AbortSignal = noCancellation,
	): Promise<PersonalDashboardEntry> {
		const parsed = parsePersonalDashboardEntryInput(input);
		const loaded = await this.#load(signal);
		const existing = loaded.document.entries.find((entry) => entry.id === id);
		if (existing === undefined)
			throw invalidDashboard("Personal dashboard entry was not found");
		const at = this.#now();
		const entry = parsePersonalDashboardEntry({
			...parsed,
			id: existing.id,
			createdAt: existing.createdAt,
			updatedAt: at,
		});
		await this.#save(
			{
				schemaVersion: 1,
				purpose: "owner-personal-dashboard",
				retention: "until-owner-deletes",
				updatedAt: at,
				entries: loaded.document.entries.map((candidate) =>
					candidate.id === id ? entry : candidate,
				),
			},
			loaded.exists,
			signal,
		);
		return entry;
	}

	async delete(
		id: string,
		signal: AbortSignal = noCancellation,
	): Promise<boolean> {
		const loaded = await this.#load(signal);
		const entries = loaded.document.entries.filter((entry) => entry.id !== id);
		if (entries.length === loaded.document.entries.length) return false;
		await this.#save(
			{
				schemaVersion: 1,
				purpose: "owner-personal-dashboard",
				retention: "until-owner-deletes",
				updatedAt: this.#now(),
				entries,
			},
			loaded.exists,
			signal,
		);
		return true;
	}

	async export(signal: AbortSignal = noCancellation): Promise<string> {
		return JSON.stringify((await this.#load(signal)).document, null, 2);
	}

	async deleteAll(signal: AbortSignal = noCancellation): Promise<void> {
		ensureNotCancelled(signal);
		try {
			await stat(this.#path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw invalidDashboard("Personal dashboard data is unavailable", error);
		}
		await rm(this.#path, { force: true });
		await this.#keys.delete(dashboardKeyReference, signal);
	}

	async #load(signal: AbortSignal): Promise<{
		readonly document: PersonalDashboardDocument;
		readonly exists: boolean;
	}> {
		ensureNotCancelled(signal);
		let serialized: string;
		try {
			serialized = await readFile(this.#path, { encoding: "utf8", signal });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return {
					document: {
						schemaVersion: 1,
						purpose: "owner-personal-dashboard",
						retention: "until-owner-deletes",
						updatedAt: this.#now(),
						entries: [],
					},
					exists: false,
				};
			}
			throw invalidDashboard("Personal dashboard data is unavailable", error);
		}
		if (Buffer.byteLength(serialized, "utf8") > maximumEncryptedBytes)
			throw invalidDashboard("Personal dashboard data is invalid");
		try {
			const envelope = parseEnvelope(JSON.parse(serialized));
			const key = await this.#readKey(signal);
			const decipher = createDecipheriv(
				algorithm,
				key,
				Buffer.from(envelope.iv, "base64"),
			);
			decipher.setAAD(associatedData);
			decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
			const plaintext = Buffer.concat([
				decipher.update(Buffer.from(envelope.ciphertext, "base64")),
				decipher.final(),
			]).toString("utf8");
			return {
				document: parsePersonalDashboardDocument(JSON.parse(plaintext)),
				exists: true,
			};
		} catch (error) {
			if (error instanceof AgentMeError) throw error;
			throw invalidDashboard("Personal dashboard data is invalid", error);
		}
	}

	async #save(
		document: PersonalDashboardDocument,
		hasExistingFile: boolean,
		signal: AbortSignal,
	): Promise<void> {
		ensureNotCancelled(signal);
		const parsed = parsePersonalDashboardDocument(document);
		const key = hasExistingFile
			? await this.#readKey(signal)
			: await this.#createKey(signal);
		const iv = randomBytes(12);
		const cipher = createCipheriv(algorithm, key, iv);
		cipher.setAAD(associatedData);
		const ciphertext = Buffer.concat([
			cipher.update(JSON.stringify(parsed), "utf8"),
			cipher.final(),
		]);
		const envelope: EncryptedDashboardEnvelope = {
			version: 1,
			iv: iv.toString("base64"),
			authTag: cipher.getAuthTag().toString("base64"),
			ciphertext: ciphertext.toString("base64"),
		};
		const serialized = JSON.stringify(envelope);
		if (Buffer.byteLength(serialized, "utf8") > maximumEncryptedBytes)
			throw invalidDashboard("Personal dashboard data is too large");
		await mkdir(dirname(this.#path), { recursive: true });
		const temporaryPath = `${this.#path}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporaryPath, serialized, {
				encoding: "utf8",
				mode: 0o600,
				signal,
			});
			ensureNotCancelled(signal);
			await rename(temporaryPath, this.#path);
		} finally {
			await rm(temporaryPath, { force: true });
		}
	}

	async #readKey(signal: AbortSignal): Promise<Buffer> {
		try {
			const key = Buffer.from(
				await this.#keys.get(dashboardKeyReference, signal),
				"base64",
			);
			if (key.length !== 32) throw new Error("invalid key length");
			return key;
		} catch (error) {
			if (error instanceof AgentMeError) throw error;
			throw new AgentMeError({
				code: "INVALID_PROVIDER_CONFIG",
				message: "Personal dashboard key is unavailable",
				isRetryable: false,
				cause: error,
			});
		}
	}

	async #createKey(signal: AbortSignal): Promise<Buffer> {
		const key = randomBytes(32);
		await this.#keys.set(dashboardKeyReference, key.toString("base64"), signal);
		return key;
	}

	#now(): string {
		return this.#clock().toISOString();
	}
}

function parseEnvelope(input: unknown): EncryptedDashboardEnvelope {
	if (
		typeof input !== "object" ||
		input === null ||
		Array.isArray(input) ||
		Object.keys(input).some(
			(key) => !["version", "iv", "authTag", "ciphertext"].includes(key),
		)
	)
		throw invalidDashboard("Personal dashboard data is invalid");
	const value = input as Record<string, unknown>;
	if (
		value.version !== 1 ||
		typeof value.iv !== "string" ||
		typeof value.authTag !== "string" ||
		typeof value.ciphertext !== "string"
	)
		throw invalidDashboard("Personal dashboard data is invalid");
	return {
		version: value.version,
		iv: value.iv,
		authTag: value.authTag,
		ciphertext: value.ciphertext,
	};
}

function ensureNotCancelled(signal: AbortSignal): void {
	if (!signal.aborted) return;
	throw new AgentMeError({
		code: "CANCELLED",
		message: "Personal dashboard operation was cancelled",
		isRetryable: false,
	});
}

function invalidDashboard(message: string, cause?: unknown): AgentMeError {
	return new AgentMeError({
		code: "INVALID_CONTRACT",
		message,
		isRetryable: false,
		...(cause === undefined ? {} : { cause }),
	});
}
