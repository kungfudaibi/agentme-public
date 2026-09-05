import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentOffice } from "../src/office.js";

const directories: string[] = [];
function path() {
	const directory = mkdtempSync(join(tmpdir(), "agent-office-"));
	directories.push(directory);
	return join(directory, "office.json");
}
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

describe("personal agent office", () => {
	it("allows deleting a cancelled task while its model operation unwinds", async () => {
		const office = new AgentOffice(
			path(),
			async () => new Promise<string>(() => {}),
		);
		const task = office.create({
			agentId: "research",
			instruction: "分析示例",
			mode: "assist",
		});
		const running = office.run(task.id);
		office.cancel(task.id);
		office.delete(task.id);
		await expect(running).resolves.toBeUndefined();
		expect(office.snapshot().tasks).toHaveLength(0);
	});
	it("persists ordinary assigned tasks without a repository", async () => {
		const file = path();
		const office = new AgentOffice(file);
		const task = office.create({
			agentId: "schedule",
			instruction: "整理下周安排",
			mode: "todo",
		});
		expect(task.state).toBe("queued");
		office.complete(task.id);
		expect(new AgentOffice(file).snapshot().tasks[0]?.state).toBe("completed");
	});
	it("keeps model context separate between assistants", async () => {
		const requests: string[] = [];
		const office = new AgentOffice(path(), async (request) => {
			requests.push(JSON.stringify(request));
			return "已整理你提供的材料";
		});
		const finance = office.create({
			agentId: "finance",
			instruction: "我的预算是 500 元",
			mode: "assist",
		});
		await office.run(finance.id);
		const research = office.create({
			agentId: "research",
			instruction: "整理这段访谈",
			mode: "assist",
		});
		await office.run(research.id);
		expect(requests[1]).not.toContain("500");
		expect(
			office.snapshot().tasks.every((task) => task.state === "completed"),
		).toBe(true);
	});
	it("hands off only the chosen result and records its origin", async () => {
		const office = new AgentOffice(path(), async () => "三条待办建议");
		const first = office.create({
			agentId: "coordinator",
			instruction: "拆解周计划",
			mode: "assist",
		});
		await office.run(first.id);
		const next = office.handoff(first.id, {
			agentId: "schedule",
			instruction: "把建议整理成安排",
		});
		expect(next.sourceTaskId).toBe(first.id);
		expect(next.context).toContain("三条待办建议");
		expect(next.agentId).toBe("schedule");
	});
	it("cancels the model signal and never commits a late completion", async () => {
		let release: ((text: string) => void) | undefined;
		let signal: AbortSignal | undefined;
		const office = new AgentOffice(path(), async (_request, abort) => {
			signal = abort;
			return new Promise<string>((resolve) => {
				release = resolve;
			});
		});
		const task = office.create({
			agentId: "research",
			instruction: "分析材料",
			mode: "assist",
		});
		const running = office.run(task.id);
		office.cancel(task.id);
		expect(signal?.aborted).toBe(true);
		release?.("迟到结果");
		await running;
		expect(office.snapshot().tasks[0]?.state).toBe("cancelled");
		expect(office.snapshot().tasks[0]?.result).toBeUndefined();
	});
	it("records unavailable providers as blocked instead of successful", async () => {
		const office = new AgentOffice(path());
		const task = office.create({
			agentId: "research",
			instruction: "分析材料",
			mode: "assist",
		});
		await office.run(task.id);
		expect(office.snapshot().tasks[0]?.state).toBe("blocked");
	});
	it("does not run a future task early and requires retry after restart", async () => {
		const file = path();
		const office = new AgentOffice(
			file,
			async () => new Promise<string>(() => {}),
		);
		const future = office.create({
			agentId: "schedule",
			instruction: "整理计划",
			mode: "assist",
			scheduledAt: "2099-01-01T00:00:00.000Z",
		});
		await office.run(future.id);
		expect(office.snapshot().tasks[0]?.state).toBe("queued");
		const now = office.create({
			agentId: "research",
			instruction: "分析材料",
			mode: "assist",
		});
		void office.run(now.id);
		const reopened = new AgentOffice(file);
		expect(
			reopened.snapshot().tasks.find((task) => task.id === now.id)?.state,
		).toBe("interrupted");
		office.shutdown();
	});
	it("rejects unknown roles and oversized instructions", () => {
		const office = new AgentOffice(path());
		expect(() =>
			office.create({ agentId: "admin", instruction: "hello", mode: "assist" }),
		).toThrow();
		expect(() =>
			office.create({
				agentId: "research",
				instruction: "hello",
				mode: ["assist"],
			}),
		).toThrow();
		expect(() =>
			office.create({
				agentId: "research",
				instruction: "x".repeat(8001),
				mode: "assist",
			}),
		).toThrow();
	});
});
