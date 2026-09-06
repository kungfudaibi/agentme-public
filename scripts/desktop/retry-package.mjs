import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function buildWithDownloadRetry(run, wait = delay) {
	for (let attempt = 1; attempt <= 3; attempt++) {
		const { code, output } = await run();
		const transientDownload =
			/Downloading https:\/\/github\.com\/tauri-apps\/binary-releases\/[^\r\n]+[\s\S]*failed to bundle project:[^\r\n]*(?:Connection reset by peer|Connection timed out|operation timed out)/u.test(
				output,
			);
		if (code === 0 || !transientDownload || attempt === 3) return code;
		process.stderr.write(
			`Tauri tool download interrupted; retrying package build (${attempt + 1}/3).\n`,
		);
		await wait(attempt * 5000);
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const run = () =>
		new Promise((resolveRun) => {
			let output = "";
			const child = spawn(
				process.execPath,
				[
					fileURLToPath(new URL("./run-native.mjs", import.meta.url)),
					"build",
					...process.argv.slice(2),
				],
				{ windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
			);
			const capture = (stream, chunk) => {
				stream.write(chunk);
				output = (output + chunk.toString()).slice(-65536);
			};
			child.stdout.on("data", (chunk) => capture(process.stdout, chunk));
			child.stderr.on("data", (chunk) => capture(process.stderr, chunk));
			child.once("error", () =>
				resolveRun({ code: 1, output: "Unable to start native build" }),
			);
			child.once("close", (code) => resolveRun({ code: code ?? 1, output }));
		});
	process.exitCode = await buildWithDownloadRetry(run);
}
