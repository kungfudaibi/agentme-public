export interface CancellableVoicePlayback {
	pause(): void;
	removeAttribute(name: "src"): void;
	load(): void;
}

export interface ActiveVoiceResources {
	readonly releaseCapture?: () => void;
	readonly stopWake?: () => void;
	readonly inference?: AbortController;
	readonly playback?: CancellableVoicePlayback;
}

export function cancelActiveVoiceResources(resources: ActiveVoiceResources): {
	readonly released: number;
	readonly active: 0;
} {
	let released = 0;
	if (resources.releaseCapture !== undefined) {
		resources.releaseCapture();
		released += 1;
	}
	if (resources.stopWake !== undefined) {
		resources.stopWake();
		released += 1;
	}
	if (resources.inference !== undefined) {
		resources.inference.abort();
		released += 1;
	}
	if (resources.playback !== undefined) {
		resources.playback.pause();
		resources.playback.removeAttribute("src");
		resources.playback.load();
		released += 1;
	}
	return { released, active: 0 };
}
