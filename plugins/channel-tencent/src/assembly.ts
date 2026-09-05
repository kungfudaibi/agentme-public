import type { SecretReference } from "../../../packages/contracts/src/index.js";
import { TencentTaskController } from "./controller.js";
import { ChannelDeliveryStore } from "./delivery.js";
import {
	createOfficialQQBotClientFactory,
	type OfficialQQBotConstructor,
} from "./official-qq-client.js";
import { TencentPairingStore } from "./pairing.js";
import { QQDeliveryPump } from "./qq-delivery.js";
import { QQTransport } from "./qq-transport.js";
import { TencentChannelRuntime } from "./runtime.js";
import {
	OrchestratorTaskControl,
	type TaskEvidencePort,
	type TaskSubmissionPort,
	TencentTaskRequestStore,
} from "./task-control.js";

export interface TencentChannelConfig {
	readonly databasePath: string;
	readonly ownerIds: ReadonlySet<string>;
	readonly appId: SecretReference;
	readonly appSecret: SecretReference;
	readonly accountId?: string;
}

export interface TencentChannelDependencies {
	readonly QQBot: OfficialQQBotConstructor;
	readonly resolveSecret: (
		reference: SecretReference,
		signal: AbortSignal,
	) => Promise<string>;
	readonly taskSubmission: TaskSubmissionPort;
	readonly taskEvidence: TaskEvidencePort;
}

export interface TencentChannel {
	pairOwner(senderId: string): void;
	unpairOwner(senderId: string): boolean;
	start(signal: AbortSignal): Promise<void>;
	commitResult(recipientId: string, dedupeKey: string, text: string): void;
	close(): void;
}

class AssembledTencentChannel implements TencentChannel {
	readonly #ownerIds: ReadonlySet<string>;
	readonly #pairing: TencentPairingStore;
	readonly #delivery: ChannelDeliveryStore;
	readonly #requests: TencentTaskRequestStore;
	readonly #runtime: TencentChannelRuntime;
	#active = false;

	constructor(
		config: TencentChannelConfig,
		dependencies: TencentChannelDependencies,
	) {
		this.#ownerIds = new Set(config.ownerIds);
		this.#pairing = new TencentPairingStore(config.databasePath);
		this.#delivery = new ChannelDeliveryStore(config.databasePath);
		this.#requests = new TencentTaskRequestStore(config.databasePath);
		const taskControl = new OrchestratorTaskControl(
			dependencies.taskSubmission,
			dependencies.taskEvidence,
			this.#requests,
		);
		const controller = new TencentTaskController(
			{ ownerIds: this.#ownerIds, pairing: this.#pairing },
			taskControl,
		);
		const transport = new QQTransport(
			{
				appId: config.appId,
				appSecret: config.appSecret,
				...(config.accountId === undefined
					? {}
					: { accountId: config.accountId }),
			},
			{
				resolveSecret: dependencies.resolveSecret,
				createClient: createOfficialQQBotClientFactory(dependencies.QQBot),
			},
		);
		const pump = new QQDeliveryPump(this.#delivery, {
			send: ({ targetId, text }) =>
				transport.sendText({ scope: "c2c", targetId }, text),
		});
		this.#runtime = new TencentChannelRuntime({
			transport,
			controller,
			store: this.#delivery,
			pump,
		});
	}

	pairOwner(senderId: string): void {
		if (!this.#ownerIds.has(senderId))
			throw new TypeError("Tencent sender is not an allowlisted owner");
		this.#pairing.pair(senderId);
	}

	unpairOwner(senderId: string): boolean {
		if (!this.#ownerIds.has(senderId)) return false;
		return this.#pairing.unpair(senderId);
	}

	async start(signal: AbortSignal): Promise<void> {
		if (this.#active) throw new TypeError("Tencent channel is active");
		this.#active = true;
		try {
			await this.#runtime.start(signal);
		} finally {
			this.#active = false;
		}
	}

	commitResult(recipientId: string, dedupeKey: string, text: string): void {
		if (
			!this.#ownerIds.has(recipientId) ||
			!this.#pairing.isPaired(recipientId)
		)
			throw new TypeError("Tencent result recipient is not a paired owner");
		this.#runtime.commitResult(recipientId, dedupeKey, text);
	}

	close(): void {
		if (this.#active) throw new TypeError("Tencent channel is active");
		this.#requests.close();
		this.#delivery.close();
		this.#pairing.close();
	}
}

export function createTencentChannel(
	config: TencentChannelConfig,
	dependencies: TencentChannelDependencies,
): TencentChannel {
	return new AssembledTencentChannel(config, dependencies);
}
