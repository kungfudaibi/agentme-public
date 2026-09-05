import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { AgentMeError } from "../../../packages/contracts/src/index.js";
import {
	type ApprovalStore,
	evaluatePolicy,
} from "../../../packages/policy-engine/src/index.js";
import type { CodexExecutionPolicy } from "../../../plugins/runtime-codex/src/index.js";

export type CodingPermissionProfileId = "safe-auto" | "full-auto";

export interface CodingPermissionSettings {
	readonly activeProfileId: CodingPermissionProfileId;
}

export interface CodingPermissionSettingsStore {
	save(settings: CodingPermissionSettings, signal: AbortSignal): Promise<void>;
}

export interface CodingPermissionCatalog {
	readonly activeProfileId: CodingPermissionProfileId;
	readonly profiles: readonly {
		readonly id: CodingPermissionProfileId;
		readonly name: string;
		readonly sandboxMode: CodexExecutionPolicy["sandboxMode"];
		readonly approvalPolicy: CodexExecutionPolicy["approvalPolicy"];
		readonly isActive: boolean;
		readonly requiresExplicitApproval: boolean;
		readonly warning: string;
	}[];
}

export interface CodingPermissionService {
	list(signal: AbortSignal): Promise<CodingPermissionCatalog>;
	activate(
		id: CodingPermissionProfileId,
		acknowledgeFullAccess: boolean,
		signal: AbortSignal,
	): Promise<CodingPermissionCatalog>;
	currentPolicy(): CodexExecutionPolicy;
	attachRuntime(runtime: CodingPermissionRuntime): void;
	close(): void;
}

export interface CodingPermissionRuntime {
	setExecutionPolicy(policy: CodexExecutionPolicy): void;
}

const profilePolicies = {
	"safe-auto": {
		name: "安全自动",
		policy: {
			sandboxMode: "workspace-write",
			approvalPolicy: "never",
		},
		requiresExplicitApproval: false,
		warning: "无需逐次确认，但只能写入任务工作树。",
	},
	"full-auto": {
		name: "完全访问",
		policy: {
			sandboxMode: "danger-full-access",
			approvalPolicy: "never",
		},
		requiresExplicitApproval: true,
		warning: "Codex 可访问工作树之外的文件和网络；仅在你信任任务与环境时启用。",
	},
} as const satisfies Record<
	CodingPermissionProfileId,
	{
		readonly name: string;
		readonly policy: CodexExecutionPolicy;
		readonly requiresExplicitApproval: boolean;
		readonly warning: string;
	}
>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProfileId(value: unknown): value is CodingPermissionProfileId {
	return value === "safe-auto" || value === "full-auto";
}

export function parseCodingPermissionSettings(
	value: unknown,
): CodingPermissionSettings {
	if (
		!isRecord(value) ||
		Object.keys(value).some((key) => key !== "activeProfileId") ||
		!isProfileId(value.activeProfileId)
	)
		throw new AgentMeError({
			code: "INVALID_PROVIDER_CONFIG",
			message: "Coding permission settings are invalid",
			isRetryable: false,
		});
	return { activeProfileId: value.activeProfileId };
}

export class JsonCodingPermissionSettingsStore
	implements CodingPermissionSettingsStore
{
	readonly #path: string;

	constructor(path: string) {
		this.#path = resolve(path);
	}

	async save(
		settings: CodingPermissionSettings,
		signal: AbortSignal,
	): Promise<void> {
		const codingPermissions = parseCodingPermissionSettings(settings);
		let current: unknown = {};
		try {
			current = JSON.parse(
				await readFile(this.#path, { encoding: "utf8", signal }),
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (!isRecord(current)) throw new TypeError("Invalid AgentMe settings");
		const temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
		await mkdir(dirname(this.#path), { recursive: true });
		try {
			await writeFile(
				temporary,
				`${JSON.stringify({ ...current, codingPermissions }, null, 2)}\n`,
				{ encoding: "utf8", mode: 0o600, signal },
			);
			if (signal.aborted) throw signal.reason;
			await rename(temporary, this.#path);
		} catch (error) {
			await rm(temporary, { force: true });
			throw error;
		}
	}
}

interface CodingPermissionManagerDependencies {
	readonly settings: CodingPermissionSettings;
	readonly settingsStore: CodingPermissionSettingsStore;
	readonly approvals: ApprovalStore;
	readonly apply: (policy: CodexExecutionPolicy) => void;
}

export class CodingPermissionManager implements CodingPermissionService {
	readonly #settingsStore: CodingPermissionSettingsStore;
	readonly #approvals: ApprovalStore;
	readonly #apply: (policy: CodexExecutionPolicy) => void;
	#settings: CodingPermissionSettings;
	#runtime: CodingPermissionRuntime | undefined;
	#changes: Promise<void> = Promise.resolve();

	constructor(dependencies: CodingPermissionManagerDependencies) {
		this.#settings = parseCodingPermissionSettings(dependencies.settings);
		this.#settingsStore = dependencies.settingsStore;
		this.#approvals = dependencies.approvals;
		this.#apply = dependencies.apply;
	}

	currentPolicy(): CodexExecutionPolicy {
		return { ...profilePolicies[this.#settings.activeProfileId].policy };
	}

	attachRuntime(runtime: CodingPermissionRuntime): void {
		runtime.setExecutionPolicy(this.currentPolicy());
		this.#runtime = runtime;
	}

	async list(signal: AbortSignal): Promise<CodingPermissionCatalog> {
		await withCancellation(this.#changes, signal);
		return this.#catalog();
	}

	async activate(
		id: CodingPermissionProfileId,
		acknowledgeFullAccess: boolean,
		signal: AbortSignal,
	): Promise<CodingPermissionCatalog> {
		if (!isProfileId(id)) throw permissionDenied();
		const operation = this.#changes.then(async () => {
			if (signal.aborted) throw signal.reason;
			if (id === "full-auto")
				this.#approveFullAccess(acknowledgeFullAccess, new Date());
			const previous = this.currentPolicy();
			const next = { ...profilePolicies[id].policy };
			try {
				this.#applyPolicy(next);
				const settings = parseCodingPermissionSettings({ activeProfileId: id });
				await this.#settingsStore.save(settings, signal);
				this.#settings = settings;
			} catch (error) {
				this.#applyPolicy(previous);
				throw error;
			}
		});
		this.#changes = operation.then(
			() => undefined,
			() => undefined,
		);
		await withCancellation(operation, signal);
		return this.#catalog();
	}

	close(): void {
		this.#approvals.close();
	}

	#applyPolicy(policy: CodexExecutionPolicy): void {
		this.#apply(policy);
		this.#runtime?.setExecutionPolicy(policy);
	}

	#approveFullAccess(acknowledged: boolean, now: Date): void {
		if (!acknowledged) throw permissionDenied();
		const at = now.toISOString();
		const target = "codex:danger-full-access";
		this.#approvals.record({
			id: randomUUID(),
			taskId: "coding-permissions",
			action: "activate_full_access",
			target,
			decision: "approved",
			expiresAt: new Date(now.getTime() + 365 * 86_400_000).toISOString(),
		});
		const approval = this.#approvals.findValid(
			{ taskId: "coding-permissions", action: "activate_full_access", target },
			at,
		);
		const decision = evaluatePolicy({
			taskId: "coding-permissions",
			actor: { id: "local-owner", trust: "owner", context: "direct" },
			channel: { id: "desktop", isAuthenticated: true },
			repository: {
				id: "coding-permissions",
				isRegistered: true,
				canonicalPath: "agentme:managed",
				canCommit: false,
			},
			executionTarget: { id: "local", isAllowed: true },
			networkAllowlist: [],
			action: { type: "activate_full_access", target },
			...(approval === undefined ? {} : { approval }),
			now: at,
		});
		if (decision.decision !== "allow") throw permissionDenied();
	}

	#catalog(): CodingPermissionCatalog {
		return {
			activeProfileId: this.#settings.activeProfileId,
			profiles: (
				Object.keys(profilePolicies) as CodingPermissionProfileId[]
			).map((id) => ({
				id,
				name: profilePolicies[id].name,
				...profilePolicies[id].policy,
				isActive: id === this.#settings.activeProfileId,
				requiresExplicitApproval: profilePolicies[id].requiresExplicitApproval,
				warning: profilePolicies[id].warning,
			})),
		};
	}
}

function permissionDenied(): AgentMeError {
	return new AgentMeError({
		code: "PERMISSION_DENIED",
		message: "Full coding access requires explicit owner approval",
		isRetryable: false,
	});
}

function withCancellation<T>(
	operation: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		operation.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", abort);
		});
	});
}
