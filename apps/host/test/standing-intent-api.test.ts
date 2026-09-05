import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { StandingIntentStore } from "../../../packages/automation-runtime/src/index.js";
import {
	executeStandingIntentRoute,
	matchStandingIntentRoute,
} from "../src/standing-intent-api.js";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("standing intent API", () => {
	it("creates, lists and cancels a bounded owner intent", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-intent-api-"));
		directories.push(directory);
		const store = new StandingIntentStore(join(directory, "intents.sqlite"));
		const now = "2029-01-01T00:00:00.000Z";
		const createRoute = matchStandingIntentRoute(
			"POST",
			"/automations/intents",
		);
		expect(createRoute).toEqual({ type: "standing-intent.create" });
		const created = await executeStandingIntentRoute(
			store,
			createRoute as { type: "standing-intent.create" },
			{
				contentType: "application/json",
				now,
				body: {
					eventType: "task.failed",
					expiresAt: "2029-02-01T00:00:00.000Z",
					cooldownMinutes: 30,
					maxFires: 3,
					instruction: "Inspect the failure and propose a bounded fix",
					repositoryId: "fake",
					runtimeId: "runtime-fake",
				},
			},
		);
		expect(created).toMatchObject({
			eventType: "task.failed",
			state: "active",
			firedCount: 0,
			maxFires: 3,
		});
		if (!("id" in created)) throw new Error("Expected one standing intent");
		const listed = await executeStandingIntentRoute(
			store,
			{ type: "standing-intent.list" },
			{ now },
		);
		expect(listed).toMatchObject({ data: [{ id: created.id }] });
		const cancelled = await executeStandingIntentRoute(
			store,
			{ type: "standing-intent.cancel", intentId: created.id },
			{ now: "2029-01-01T00:01:00.000Z" },
		);
		expect(cancelled).toMatchObject({ state: "cancelled" });
		store.close();
	});

	it("rejects unbounded event and tool inputs", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agentme-intent-invalid-"));
		directories.push(directory);
		const store = new StandingIntentStore(join(directory, "intents.sqlite"));
		await expect(
			executeStandingIntentRoute(
				store,
				{ type: "standing-intent.create" },
				{
					contentType: "application/json",
					now: "2029-01-01T00:00:00.000Z",
					body: {
						eventType: "shell.requested",
						expiresAt: "2029-02-01T00:00:00.000Z",
						cooldownMinutes: 0,
						maxFires: 1000,
						instruction: "run",
						repositoryId: "fake",
						runtimeId: "runtime-fake",
					},
				},
			),
		).rejects.toMatchObject({ code: "INVALID_CONTRACT" });
		store.close();
	});
});
