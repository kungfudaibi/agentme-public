import type { ChannelDeliveryStore } from "./delivery.js";
import type { QQDeliveryPump } from "./qq-delivery.js";
import type {
	QQBotLifecycleEvent,
	QQReplyTarget,
	TencentInboundMessage,
} from "./qq-transport.js";

export interface TencentChannelTransport {
	onMessage(
		handler: (message: TencentInboundMessage) => void | Promise<void>,
	): void;
	onLifecycle(
		event: QQBotLifecycleEvent,
		handler: () => void | Promise<void>,
	): void;
	start(signal: AbortSignal): Promise<void>;
	sendText(target: QQReplyTarget, text: string): Promise<void>;
}

export interface TencentMessageController {
	handle(message: TencentInboundMessage, signal: AbortSignal): Promise<string>;
}

function identifier(value: string): boolean {
	return /^[A-Za-z0-9._:-]{1,256}$/u.test(value);
}

export class TencentChannelRuntime {
	readonly #transport: TencentChannelTransport;
	readonly #controller: TencentMessageController;
	readonly #store: ChannelDeliveryStore;
	readonly #pump: QQDeliveryPump;
	#signal: AbortSignal | undefined;

	constructor(dependencies: {
		readonly transport: TencentChannelTransport;
		readonly controller: TencentMessageController;
		readonly store: ChannelDeliveryStore;
		readonly pump: QQDeliveryPump;
	}) {
		this.#transport = dependencies.transport;
		this.#controller = dependencies.controller;
		this.#store = dependencies.store;
		this.#pump = dependencies.pump;
		this.#transport.onMessage((message) => this.#handle(message));
		for (const event of ["ready", "resumed"] as const)
			this.#transport.onLifecycle(event, () => this.#pump.flush());
	}

	start(signal: AbortSignal): Promise<void> {
		if (this.#signal !== undefined)
			throw new TypeError("Tencent channel is active");
		this.#signal = signal;
		return this.#transport.start(signal).finally(() => {
			if (this.#signal === signal) this.#signal = undefined;
		});
	}

	commitResult(recipientId: string, dedupeKey: string, text: string): void {
		if (
			!identifier(recipientId) ||
			dedupeKey.length < 1 ||
			dedupeKey.length > 256 ||
			/[\r\n\0]/u.test(dedupeKey) ||
			text.trim().length < 1 ||
			text.length > 4_000
		)
			throw new TypeError("Tencent result delivery is invalid");
		this.#store.enqueue(
			recipientId,
			dedupeKey,
			JSON.stringify({ targetId: recipientId, text }),
		);
	}

	async #handle(message: TencentInboundMessage): Promise<void> {
		const signal = this.#signal;
		if (signal === undefined || signal.aborted) return;
		const response = await this.#controller.handle(message, signal);
		signal.throwIfAborted();
		await this.#transport.sendText(message.replyTarget, response);
	}
}
