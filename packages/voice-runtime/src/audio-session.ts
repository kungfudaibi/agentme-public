import type {
	AudioFrame,
	AudioSessionState,
} from "../../contracts/src/index.js";
import { type AudioConsumer, PrivacyAudioRouter } from "./audio-router.js";

export class AudioSession {
	readonly #router: PrivacyAudioRouter;
	#state: AudioSessionState = "idle";
	#operation = new AbortController();
	constructor(router = new PrivacyAudioRouter()) {
		this.#router = router;
	}
	get state(): AudioSessionState {
		return this.#state;
	}
	listen(): void {
		if (this.#state !== "stopped" && this.#state !== "muted")
			this.#state = "listening";
	}
	wake(): readonly AudioFrame[] {
		if (this.#state !== "listening") return [];
		this.#state = "capturing";
		return this.#router.wake();
	}
	async frame(frame: AudioFrame, consumer: AudioConsumer): Promise<void> {
		if (this.#state === "listening") this.#router.buffer(frame);
		if (this.#state === "listening" || this.#state === "capturing")
			await this.#router.route(frame, consumer, this.#operation.signal);
	}
	speaking(): void {
		if (this.#state === "capturing") this.#state = "speaking";
	}
	mute(): void {
		this.#cancel();
		this.#state = "muted";
		this.#router.reset();
	}
	unmute(): void {
		if (this.#state === "muted") {
			this.#operation = new AbortController();
			this.#state = "idle";
		}
	}
	stop(): void {
		this.#cancel();
		this.#state = "stopped";
		this.#router.reset();
	}
	#cancel(): void {
		this.#operation.abort();
	}
}
