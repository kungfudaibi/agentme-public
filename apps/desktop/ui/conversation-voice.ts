import { officeRequest } from "./office-connection.js";
export function attachConversationVoice(
	button: HTMLButtonElement,
	readButton: HTMLButtonElement,
	route: HTMLSelectElement,
	input: HTMLTextAreaElement,
	latest: () => string,
	notice: (text: string) => void,
) {
	let recorder: MediaRecorder | undefined;
	let stream: MediaStream | undefined;
	let captureTimer: ReturnType<typeof setTimeout> | undefined;
	let operation: AbortController | undefined;
	let playback: HTMLAudioElement | undefined;
	let stopped = false;
	let captureStarting = false;
	const release = () => {
		if (captureTimer) clearTimeout(captureTimer);
		for (const track of stream?.getTracks() ?? []) track.stop();
		stream = undefined;
		button.textContent = "语音输入";
		button.setAttribute("aria-pressed", "false");
	};
	const cleanup = () => {
		stopped = true;
		operation?.abort();
		playback?.pause();
		if (recorder?.state === "recording") recorder.stop();
		release();
	};
	button.addEventListener(
		"click",
		() =>
			void (async () => {
				if (recorder?.state === "recording") {
					recorder.stop();
					release();
					return;
				}
				if (captureStarting) return;
				if (
					!navigator.mediaDevices?.getUserMedia ||
					typeof MediaRecorder === "undefined"
				) {
					notice("当前环境不支持录音，请使用文字输入。");
					return;
				}
				stopped = false;
				captureStarting = true;
				try {
					stream = await navigator.mediaDevices.getUserMedia({ audio: true });
					if (stopped) {
						release();
						return;
					}
					const mime = ["audio/webm", "audio/ogg"].find((t) =>
						MediaRecorder.isTypeSupported(t),
					);
					if (!mime) throw new Error("当前环境缺少支持的录音格式");
					recorder = new MediaRecorder(stream, { mimeType: mime });
					const chunks: BlobPart[] = [];
					let size = 0;
					recorder.addEventListener("dataavailable", (event) => {
						size += event.data.size;
						if (size > 4 * 1024 * 1024) {
							stopped = true;
							recorder?.stop();
							release();
							notice("录音过长，请分段录制。");
							return;
						}
						chunks.push(event.data);
					});
					recorder.addEventListener("stop", () => {
						release();
						if (stopped) return;
						void (async () => {
							try {
								notice("正在识别，文本会放入输入框供你检查。");
								const blob = new Blob(chunks, { type: mime });
								const bytes = new Uint8Array(await blob.arrayBuffer());
								let binary = "";
								for (const byte of bytes) binary += String.fromCharCode(byte);
								operation?.abort();
								operation = new AbortController();
								const result = (await (
									await officeRequest("/conversation-voice/transcribe", {
										method: "POST",
										headers: { "content-type": "application/json" },
										signal: operation.signal,
										body: JSON.stringify({
											audioBase64: btoa(binary),
											mimeType: mime,
											route: route.value,
										}),
									})
								).json()) as { value: string };
								if (!stopped) {
									input.value =
										(input.value ? `${input.value}\n` : "") + result.value;
									input.focus();
									notice("语音已转为文字，确认后发送。");
								}
							} catch (error) {
								notice(error instanceof Error ? error.message : "语音识别失败");
							}
						})();
					});
					recorder.start(1000);
					button.textContent = "结束录音";
					button.setAttribute("aria-pressed", "true");
					notice("正在录音，最长60秒。");
					captureTimer = setTimeout(() => {
						recorder?.stop();
						release();
					}, 60000);
				} catch (error) {
					release();
					notice(error instanceof Error ? error.message : "无法打开麦克风");
				} finally {
					captureStarting = false;
				}
			})(),
	);
	readButton.addEventListener(
		"click",
		() =>
			void (async () => {
				if (playback && !playback.paused) {
					playback.pause();
					operation?.abort();
					readButton.textContent = "朗读回复";
					return;
				}
				const text = latest().slice(0, 2000);
				if (!text) {
					notice("还没有可朗读的回复");
					return;
				}
				try {
					operation?.abort();
					operation = new AbortController();
					readButton.textContent = "正在合成…";
					const result = (await (
						await officeRequest("/conversation-voice/speak", {
							method: "POST",
							headers: { "content-type": "application/json" },
							signal: operation.signal,
							body: JSON.stringify({ text, route: route.value }),
						})
					).json()) as { value: { mimeType: string; audioBase64?: string } };
					if (
						!result.value.audioBase64 ||
						!["audio/wav", "audio/mpeg", "audio/ogg"].includes(
							result.value.mimeType,
						)
					)
						throw new Error("语音服务未返回可播放音频");
					playback = new Audio(
						`data:${result.value.mimeType};base64,${result.value.audioBase64}`,
					);
					playback.addEventListener("ended", () => {
						readButton.textContent = "朗读回复";
					});
					await playback.play();
					readButton.textContent = "停止朗读";
				} catch (error) {
					readButton.textContent = "朗读回复";
					notice(error instanceof Error ? error.message : "朗读失败");
				}
			})(),
	);
	window.addEventListener("beforeunload", cleanup);
	return cleanup;
}
