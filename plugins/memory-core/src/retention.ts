import { rmSync, statSync } from "node:fs";
import { join } from "node:path";
export function purgeExpiredTranscripts(
	directory: string,
	files: readonly string[],
	nowMs = Date.now(),
	retentionDays = 7,
): readonly string[] {
	const removed: string[] = [];
	const cutoff = nowMs - retentionDays * 86_400_000;
	for (const file of files) {
		if (!/^[a-zA-Z0-9._-]+$/.test(file)) continue;
		const path = join(directory, file);
		if (statSync(path).mtimeMs < cutoff) {
			rmSync(path, { force: true });
			removed.push(file);
		}
	}
	return removed;
}
