import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SupervisorGraphStore } from "../src/index.js";

describe("supervisor graph discovery", () => {
	it("pages durable parent tasks newest first with a stable cursor", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-parent-page-"));
		const store = new SupervisorGraphStore(join(directory, "agentme.sqlite"));
		for (const [id, at] of [
			["parent-one", "2026-08-24T01:00:00.000Z"],
			["parent-two", "2026-08-24T02:00:00.000Z"],
			["parent-three", "2026-08-24T03:00:00.000Z"],
		] as const)
			store.createPlan(
				id,
				"owner",
				[
					{
						repositoryId: "agentme",
						runtimeId: "runtime-codex",
						instruction: id,
						acceptanceCriteria: ["reported"],
					},
				],
				at,
			);

		const first = store.listParentPage("owner", { limit: 2 });
		if (first.nextCursor === undefined) throw new Error("missing cursor");
		const second = store.listParentPage("owner", {
			limit: 2,
			cursor: first.nextCursor,
		});

		expect(first.parents.map(({ parentId }) => parentId)).toEqual([
			"parent-three",
			"parent-two",
		]);
		expect(first.nextCursor).toBe("parent-two");
		expect(second.parents.map(({ parentId }) => parentId)).toEqual([
			"parent-one",
		]);
		expect(second.nextCursor).toBeUndefined();
		store.close();
	});
});
