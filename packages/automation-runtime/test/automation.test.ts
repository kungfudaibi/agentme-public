import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	canFireIntent,
	DurableScheduler,
	StandingIntentStore,
} from "../src/index.js";

describe("bounded automation", () => {
	it("claims a durable due job once across restart", () => {
		const path = join(
			mkdtempSync(join(tmpdir(), "agentme-schedule-")),
			"db.sqlite",
		);
		let scheduler = new DurableScheduler(path);
		scheduler.schedule({
			id: "job",
			ownerId: "owner",
			runAt: new Date(0).toISOString(),
			payload: "run",
		});
		expect(scheduler.claim("job", new Date().toISOString())).toBe(true);
		scheduler.recordDispatch("job", "parent-job");
		scheduler.close();
		scheduler = new DurableScheduler(path);
		expect(scheduler.due(new Date().toISOString())).toEqual([]);
		expect(scheduler.list()).toMatchObject([
			{
				id: "job",
				ownerId: "owner",
				payload: "run",
				state: "dispatched",
				parentId: "parent-job",
			},
		]);
		scheduler.close();
	});

	it("cancels only pending work and records bounded dispatch failures", () => {
		const path = join(
			mkdtempSync(join(tmpdir(), "agentme-schedule-control-")),
			"db.sqlite",
		);
		const scheduler = new DurableScheduler(path);
		scheduler.schedule({
			id: "cancel-me",
			ownerId: "owner",
			runAt: "2030-01-01T00:00:00.000Z",
			payload: "later",
		});
		expect(
			scheduler.cancel("cancel-me", "owner", "2029-01-01T00:00:00.000Z"),
		).toBe(true);
		expect(
			scheduler.cancel("cancel-me", "owner", "2029-01-01T00:00:01.000Z"),
		).toBe(false);
		scheduler.schedule({
			id: "fail-me",
			ownerId: "owner",
			runAt: "2029-01-01T00:00:00.000Z",
			payload: "now",
		});
		expect(scheduler.claim("fail-me", "2029-01-01T00:00:00.000Z")).toBe(true);
		scheduler.recordFailure("fail-me", "bounded failure");
		expect(scheduler.list().map(({ state }) => state)).toEqual([
			"cancelled",
			"failed",
		]);
		expect(() =>
			scheduler.recordFailure("fail-me", "x".repeat(1_001)),
		).toThrow();
		scheduler.close();
	});

	it("rejects malformed persisted job inputs", () => {
		const path = join(
			mkdtempSync(join(tmpdir(), "agentme-schedule-validation-")),
			"db.sqlite",
		);
		const scheduler = new DurableScheduler(path);
		expect(() =>
			scheduler.schedule({
				id: "../escape",
				ownerId: "owner",
				runAt: "not-a-date",
				payload: "run",
			}),
		).toThrow();
		expect(() =>
			scheduler.schedule({
				id: "valid-id",
				ownerId: "",
				runAt: "2030-01-01T00:00:00.000Z",
				payload: "run",
			}),
		).toThrow();
		scheduler.close();
	});
	it("enforces auth, scope, expiry, cooldown, fire budget and tool subset", () => {
		const intent = {
			id: "i",
			ownerId: "owner",
			eventType: "build.failed",
			expiresAt: "2030-01-01T00:00:00.000Z",
			cooldownMs: 1000,
			maxFires: 2,
			firedCount: 0,
			allowedTools: ["task.create"],
		};
		expect(
			canFireIntent(
				intent,
				{ type: "build.failed", actorId: "owner", authenticated: true },
				"2029-01-01T00:00:00.000Z",
				["task.create"],
			),
		).toBe(true);
		expect(
			canFireIntent(
				intent,
				{ type: "build.failed", actorId: "stranger", authenticated: true },
				"2029-01-01T00:00:00.000Z",
				["task.create"],
			),
		).toBe(false);
		expect(
			canFireIntent(
				intent,
				{ type: "build.failed", actorId: "owner", authenticated: true },
				"2029-01-01T00:00:00.000Z",
				["git.push"],
			),
		).toBe(false);
	});

	it("durably claims bounded standing intents across cooldown and restart", () => {
		const path = join(
			mkdtempSync(join(tmpdir(), "agentme-standing-intent-")),
			"db.sqlite",
		);
		let store = new StandingIntentStore(path);
		store.create({
			id: "intent-1",
			ownerId: "owner",
			eventType: "task.failed",
			expiresAt: "2030-01-01T00:00:00.000Z",
			cooldownMs: 60_000,
			maxFires: 2,
			allowedTools: ["task.create"],
			payload: "retry safely",
			createdAt: "2029-01-01T00:00:00.000Z",
		});
		expect(
			store.matchAndClaim(
				{ type: "task.failed", actorId: "owner", authenticated: true },
				"2029-01-01T00:01:00.000Z",
				["task.create"],
			),
		).toMatchObject([{ id: "intent-1", firedCount: 1 }]);
		expect(
			store.matchAndClaim(
				{ type: "task.failed", actorId: "owner", authenticated: true },
				"2029-01-01T00:01:30.000Z",
				["task.create"],
			),
		).toEqual([]);
		store.close();
		store = new StandingIntentStore(path);
		expect(
			store.matchAndClaim(
				{ type: "task.failed", actorId: "owner", authenticated: true },
				"2029-01-01T00:02:00.000Z",
				["task.create"],
			),
		).toMatchObject([{ id: "intent-1", firedCount: 2 }]);
		store.recordDispatch("intent-1", "parent-intent-1");
		expect(
			store.matchAndClaim(
				{ type: "task.failed", actorId: "owner", authenticated: true },
				"2029-01-01T00:03:00.000Z",
				["task.create"],
			),
		).toEqual([]);
		expect(store.list("owner")).toMatchObject([
			{
				id: "intent-1",
				firedCount: 2,
				state: "exhausted",
				lastParentId: "parent-intent-1",
			},
		]);
		store.close();
	});

	it("cancels only active owner-bound standing intents", () => {
		const path = join(
			mkdtempSync(join(tmpdir(), "agentme-standing-cancel-")),
			"db.sqlite",
		);
		const store = new StandingIntentStore(path);
		store.create({
			id: "intent-2",
			ownerId: "owner",
			eventType: "task.completed",
			expiresAt: "2030-01-01T00:00:00.000Z",
			cooldownMs: 0,
			maxFires: 1,
			allowedTools: ["task.create"],
			payload: "review completion",
			createdAt: "2029-01-01T00:00:00.000Z",
		});
		expect(
			store.cancel("intent-2", "stranger", "2029-01-01T00:00:01.000Z"),
		).toBe(false);
		expect(store.cancel("intent-2", "owner", "2029-01-01T00:00:01.000Z")).toBe(
			true,
		);
		expect(store.get("intent-2").state).toBe("cancelled");
		store.close();
	});
});
