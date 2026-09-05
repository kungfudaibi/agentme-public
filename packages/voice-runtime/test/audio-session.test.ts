import { describe, expect, it, vi } from "vitest";
import { AudioSession } from "../src/index.js";

const frame = { pcm: new Uint8Array([1, 2]), capturedAt: 1 };
describe("audio session privacy and lifecycle", () => {
	it("never routes pre-wake frames to a network consumer", async () => {
		const accept = vi.fn(async () => undefined);
		const session = new AudioSession();
		session.listen();
		await session.frame(frame, { networkCapable: true, accept });
		expect(accept).not.toHaveBeenCalled();
		expect(session.wake()).toEqual([frame]);
		await session.frame(frame, { networkCapable: true, accept });
		expect(accept).toHaveBeenCalledOnce();
	});
	it("mute and stop synchronously revoke the active session", () => {
		const session = new AudioSession();
		session.listen();
		session.wake();
		session.mute();
		expect(session.state).toBe("muted");
		session.unmute();
		expect(session.state).toBe("idle");
		session.stop();
		expect(session.state).toBe("stopped");
		session.listen();
		expect(session.state).toBe("stopped");
	});
});
