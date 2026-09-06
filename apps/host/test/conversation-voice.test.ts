import { expect, it, vi } from "vitest";
import { executeConversationVoice } from "../src/conversation-voice.js";

it("uses the selected existing voice route for dictation without creating a coding task", async () => {
	const transcribe = vi.fn(async (_input: unknown) => ({
		value: "检查旅行安排",
		providerId: "voice-aliyun",
		fallbackUsed: false,
	}));
	const result = await executeConversationVoice(
		{ transcribe, synthesize: vi.fn() },
		"transcribe",
		{ audioBase64: "UklGRg==", mimeType: "audio/wav", route: "aliyun" },
		new AbortController().signal,
	);
	expect(result).toMatchObject({
		value: "检查旅行安排",
		providerId: "voice-aliyun",
	});
	expect(transcribe.mock.calls[0]?.[0]).toMatchObject({ route: "aliyun" });
});
it("rejects unknown voice routes and oversized dictation bodies", async () => {
	await expect(
		executeConversationVoice(
			undefined,
			"transcribe",
			{ route: "free-unlimited" },
			new AbortController().signal,
		),
	).rejects.toThrow();
});
