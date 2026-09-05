import type { ChannelDeliveryStore } from "./delivery.js";

export interface QQDeliverySender {
	send(input: {
		readonly targetId: string;
		readonly text: string;
	}): Promise<void>;
}

function parsePayload(value: string): {
	readonly targetId: string;
	readonly text: string;
} {
	const parsed: unknown = JSON.parse(value);
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed) ||
		Object.keys(parsed).some((key) => !["targetId", "text"].includes(key)) ||
		typeof (parsed as Record<string, unknown>).targetId !== "string" ||
		typeof (parsed as Record<string, unknown>).text !== "string"
	)
		throw new TypeError("QQ delivery payload is invalid");
	const { targetId, text } = parsed as { targetId: string; text: string };
	if (
		!/^[A-Za-z0-9._:-]{1,256}$/u.test(targetId) ||
		text.trim().length < 1 ||
		text.length > 4_000
	)
		throw new TypeError("QQ delivery payload is invalid");
	return { targetId, text };
}

export class QQDeliveryPump {
	readonly #store: ChannelDeliveryStore;
	readonly #sender: QQDeliverySender;
	#active: Promise<void> | undefined;

	constructor(store: ChannelDeliveryStore, sender: QQDeliverySender) {
		this.#store = store;
		this.#sender = sender;
	}

	flush(): Promise<void> {
		if (this.#active !== undefined) return this.#active;
		const operation = this.#flush().finally(() => {
			if (this.#active === operation) this.#active = undefined;
		});
		this.#active = operation;
		return operation;
	}

	async #flush(): Promise<void> {
		for (const delivery of this.#store.pending().slice(0, 100)) {
			const payload = parsePayload(delivery.payload);
			if (payload.targetId !== delivery.recipientId)
				throw new TypeError("QQ delivery recipient mismatch");
			await this.#sender.send(payload);
			this.#store.markDelivered(delivery.id);
		}
	}
}
