import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { OfficeSnapshot } from "./catalog.js";
import { parseOfficeSnapshot } from "./parse.js";

export function readOffice(path: string): OfficeSnapshot {
	try {
		if (statSync(path).size > 24 * 1024 * 1024)
			throw new Error("Office data exceeds its storage limit");
		return parseOfficeSnapshot(JSON.parse(readFileSync(path, "utf8")));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return { version: 1, tasks: [], instructions: {} };
		throw error;
	}
}
export function writeOffice(path: string, state: OfficeSnapshot): void {
	const serialized = JSON.stringify(state);
	if (Buffer.byteLength(serialized) > 24 * 1024 * 1024)
		throw new Error(
			"Office storage is full; export and delete old tasks first",
		);
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, serialized, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}
