export interface AudioFrame {
	readonly pcm: Uint8Array;
	readonly capturedAt: number;
}
export type AudioSessionState =
	| "idle"
	| "listening"
	| "capturing"
	| "speaking"
	| "muted"
	| "stopped";
export interface WakeEvent {
	readonly phrase: string;
	readonly confidence: number;
	readonly at: string;
}
export type TranscriptEvent = {
	readonly type: "partial" | "final";
	readonly text: string;
};
export interface AudioSink {
	write(frame: AudioFrame, signal: AbortSignal): Promise<void>;
	stop(): Promise<void>;
}
