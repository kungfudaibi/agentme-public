import type { AudioFrame } from "../../contracts/src/index.js";

export interface AudioConsumer {
	readonly networkCapable: boolean;
	accept(frame: AudioFrame, signal: AbortSignal): Promise<void>;
}

export class PrivacyAudioRouter {
	readonly #preRoll: AudioFrame[] = [];
	readonly #maxFrames: number;
	#woken = false;
	constructor(maxFrames = 50) {
		this.#maxFrames = maxFrames;
	}
	buffer(frame: AudioFrame): void {
		this.#preRoll.push(frame);
		while (this.#preRoll.length > this.#maxFrames) this.#preRoll.shift();
	}
	wake(): readonly AudioFrame[] {
		this.#woken = true;
		return [...this.#preRoll];
	}
	reset(): void {
		this.#woken = false;
		this.#preRoll.length = 0;
	}
	async route(
		frame: AudioFrame,
		consumer: AudioConsumer,
		signal: AbortSignal,
	): Promise<void> {
		if (!this.#woken && consumer.networkCapable) return;
		await consumer.accept(frame, signal);
	}
}
