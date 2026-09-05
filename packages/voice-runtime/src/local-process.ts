import { spawn } from "node:child_process";
import type { TranscriptEvent } from "../../contracts/src/index.js";

export interface LocalProcessConfig {
	readonly executable: string;
	readonly args: readonly string[];
}
export async function transcribeLocally(
	config: LocalProcessConfig,
	wav: Uint8Array,
	signal: AbortSignal,
): Promise<readonly TranscriptEvent[]> {
	const text = await run(config, wav, signal);
	return [{ type: "final", text: text.trim() }];
}
export async function synthesizeLocally(
	config: LocalProcessConfig,
	text: string,
	signal: AbortSignal,
): Promise<Uint8Array> {
	return new Uint8Array(await runBuffer(config, Buffer.from(text), signal));
}
async function run(
	config: LocalProcessConfig,
	input: Uint8Array,
	signal: AbortSignal,
): Promise<string> {
	return (await runBuffer(config, input, signal)).toString("utf8");
}
async function runBuffer(
	config: LocalProcessConfig,
	input: Uint8Array,
	signal: AbortSignal,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const child = spawn(config.executable, [...config.args], {
			shell: false,
			windowsHide: true,
			signal,
		});
		const chunks: Buffer[] = [];
		const errors: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
		child.once("error", reject);
		child.once("close", (code) =>
			code === 0
				? resolve(Buffer.concat(chunks))
				: reject(
						new Error(
							`Local voice process failed (${code}): ${Buffer.concat(errors).toString("utf8").slice(-1000)}`,
						),
					),
		);
		child.stdin.end(input);
	});
}
