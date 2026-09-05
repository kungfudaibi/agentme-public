import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ChannelDeliveryStore, permissionsFor } from "../src/index.js";

describe("Tencent channel safety", () => {
	it("grants task control only to a paired private owner", () => {
		const owners = new Set(["owner"]);
		expect(
			permissionsFor(
				{ senderId: "owner", conversation: "private", paired: true },
				owners,
			),
		).toContain("task.create");
		expect(
			permissionsFor(
				{ senderId: "owner", conversation: "group", paired: true },
				owners,
			),
		).toEqual(new Set(["chat"]));
		expect(
			permissionsFor(
				{ senderId: "stranger", conversation: "private", paired: false },
				owners,
			),
		).toEqual(new Set(["chat"]));
	});
	it("replays an undelivered result exactly once after restart", () => {
		const path = join(
			mkdtempSync(join(tmpdir(), "agentme-channel-")),
			"delivery.sqlite",
		);
		let store = new ChannelDeliveryStore(path);
		store.enqueue("owner", "task-1:completed", "done");
		store.enqueue("owner", "task-1:completed", "done");
		store.close();
		store = new ChannelDeliveryStore(path);
		expect(store.pending()).toHaveLength(1);
		const item = store.pending()[0];
		store.markDelivered(item?.id ?? 0);
		expect(store.pending()).toHaveLength(0);
		store.close();
	});
});
