import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TaskStore } from "../src/index.js";

describe("outbox restart recovery", () => {
	it("replays committed undelivered events and forgets acknowledged events", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-task-restart-"));
		const databasePath = join(directory, "agentme.sqlite");
		const first = new TaskStore(databasePath);
		first.createTask({
			taskId: "task-1",
			actorId: "owner",
			at: "2026-08-20T08:00:00.000Z",
		});
		const pendingBeforeCrash = first.listPendingEvents();
		first.close();

		const restarted = new TaskStore(databasePath);
		const replayed = restarted.listPendingEvents();
		expect(replayed).toEqual(pendingBeforeCrash);
		expect(replayed).toHaveLength(1);
		const replayedEvent = replayed[0];
		if (replayedEvent === undefined)
			throw new Error("Expected one replayed event");
		restarted.markEventDelivered(replayedEvent.id, "2026-08-20T08:00:10.000Z");
		restarted.close();

		const acknowledged = new TaskStore(databasePath);
		expect(acknowledged.listPendingEvents()).toEqual([]);
		acknowledged.close();
	});
});
