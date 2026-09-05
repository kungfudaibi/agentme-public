import { describe, expect, it, vi } from "vitest";
import { cancelActiveVoiceResources } from "../ui/voice-resources.js";

describe("desktop voice resource lifecycle", () => {
	it("releases capture, wake, inference and playback on one cancellation", () => {
		const releaseCapture = vi.fn();
		const stopWake = vi.fn();
		const inference = new AbortController();
		const pause = vi.fn();
		const removeAttribute = vi.fn();
		const load = vi.fn();

		expect(
			cancelActiveVoiceResources({
				releaseCapture,
				stopWake,
				inference,
				playback: { pause, removeAttribute, load },
			}),
		).toEqual({ released: 4, active: 0 });
		expect(releaseCapture).toHaveBeenCalledOnce();
		expect(stopWake).toHaveBeenCalledOnce();
		expect(inference.signal.aborted).toBe(true);
		expect(pause).toHaveBeenCalledOnce();
		expect(removeAttribute).toHaveBeenCalledWith("src");
		expect(load).toHaveBeenCalledOnce();
	});
});
