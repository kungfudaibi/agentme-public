import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWithDownloadRetry } from "./retry-package.mjs";
const network =
	"Downloading https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/AppRun-x86_64\nfailed to bundle project: `io: Connection reset by peer (os error 104)`";
test("retries the observed download failure and returns a successful package result", async () => {
	let attempts = 0;
	const delays = [];
	assert.equal(
		await buildWithDownloadRetry(
			async () =>
				++attempts === 1
					? { code: 1, output: network }
					: { code: 0, output: "" },
			async (ms) => {
				delays.push(ms);
			},
		),
		0,
	);
	assert.equal(attempts, 2);
	assert.deepEqual(delays, [5000]);
});
test("does not retry compiler errors or arbitrary network-looking messages", async () => {
	for (const output of [
		"error[E0308]: mismatched types",
		"Connection reset by peer",
	]) {
		let attempts = 0;
		assert.equal(
			await buildWithDownloadRetry(
				async () => {
					attempts++;
					return { code: 2, output };
				},
				async () => {},
			),
			2,
		);
		assert.equal(attempts, 1);
	}
});
test("fails after three unsuccessful downloads", async () => {
	let attempts = 0;
	assert.equal(
		await buildWithDownloadRetry(
			async () => {
				attempts++;
				return { code: 1, output: network };
			},
			async () => {},
		),
		1,
	);
	assert.equal(attempts, 3);
});
