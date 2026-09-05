import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { AssistantSessionStore } from "../src/session-store.js";

const directories: string[] = [];
const stores: AssistantSessionStore[] = [];

afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function createStore(now: Date): AssistantSessionStore {
	const directory = mkdtempSync(join(tmpdir(), "agentme-session-privacy-"));
	directories.push(directory);
	const store = new AssistantSessionStore(join(directory, "agentme.sqlite"), {
		clock: () => now,
	});
	stores.push(store);
	return store;
}

describe("assistant session privacy", () => {
	it("deletes one conversation independently", () => {
		const store = createStore(new Date("2026-08-28T00:00:00.000Z"));
		const deletedSession = store.appendUserMessage("需要删除的转写");
		const retainedSession = store.appendUserMessage("保留的对话");

		expect(store.deleteSession(deletedSession)).toBe(true);
		expect(() => store.listMessages(deletedSession)).toThrow();
		expect(store.listMessages(retainedSession)).toHaveLength(1);
	});

	it("purges conversations after the seven-day operational window", () => {
		const store = createStore(new Date("2026-08-01T00:00:00.000Z"));
		const expiredSession = store.appendUserMessage("过期转写");

		expect(
			store.purgeExpiredSessions(new Date("2026-08-08T00:00:00.001Z")),
		).toBe(1);
		expect(() => store.listMessages(expiredSession)).toThrow();
	});
});
