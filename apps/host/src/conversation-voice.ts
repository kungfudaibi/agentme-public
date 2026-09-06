import {
	invalid,
	object,
	text,
} from "../../../packages/conversation-hub/src/storage.js";
import type {
	SpokenAudioInput,
	SpokenVoiceRuntime,
} from "../../../packages/voice-runtime/src/index.js";
export async function executeConversationVoice(
	voice: SpokenVoiceRuntime | undefined,
	action: string,
	value: unknown,
	signal: AbortSignal,
) {
	const body = object(value);
	const route = text(body.route, 20);
	if (route !== "local" && route !== "aliyun" && route !== "auto")
		invalid("未知语音路由");
	if (!voice) invalid("尚未配置语音服务，请在本机配置阿里云或本地语音");
	if (action === "speak") {
		if (Object.keys(body).some((k) => !["text", "route"].includes(k)))
			invalid();
		return voice.synthesize(text(body.text, 2000), route, signal);
	}
	if (
		action !== "transcribe" ||
		Object.keys(body).some(
			(k) => !["audioBase64", "mimeType", "route"].includes(k),
		)
	)
		invalid();
	const audio = text(body.audioBase64, 5_600_000);
	const mime = text(body.mimeType, 20);
	if (
		!/^[A-Za-z0-9+/]+={0,2}$/u.test(audio) ||
		audio.length < 8 ||
		!["audio/wav", "audio/webm", "audio/ogg", "audio/mp3"].includes(mime)
	)
		invalid("录音格式无效");
	return voice.transcribe(
		{
			audio: Buffer.from(audio, "base64"),
			mimeType: mime as SpokenAudioInput["mimeType"],
			route,
		},
		signal,
	);
}
