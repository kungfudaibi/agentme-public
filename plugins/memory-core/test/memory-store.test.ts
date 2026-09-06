import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SecretReference } from "../../../packages/contracts/src/index.js";
import type { SecretStore } from "../../../packages/platform-runtime/src/index.js";
import { MemoryStore, PersonalDashboardStore } from "../src/index.js";

class MemoryKeyStore implements SecretStore {
	readonly values = new Map<string, string>();

	async set(reference: SecretReference, value: string): Promise<void> {
		this.values.set(reference.id, value);
	}

	async get(reference: SecretReference): Promise<string> {
		const value = this.values.get(reference.id);
		if (value === undefined) throw new Error("missing key");
		return value;
	}

	async delete(reference: SecretReference): Promise<void> {
		this.values.delete(reference.id);
	}
}

describe("inspectable memory", () => {
	it("round-trips Markdown, FTS, forget and reindex", () => {
		const root = mkdtempSync(join(tmpdir(), "agentme-memory-"));
		const memory = join(root, "notes");
		const db = join(root, "index.sqlite");
		let store = new MemoryStore(memory, db);
		store.put({
			id: "decision-1",
			kind: "decision",
			content: "使用 SQLite 全文搜索",
			source: "task-1",
			verifiedAt: new Date(0).toISOString(),
		});
		expect(readFileSync(join(memory, "decision-1.md"), "utf8")).toContain(
			'source: "task-1"',
		);
		expect(store.search("SQLite")).toHaveLength(1);
		store.close();
		store = new MemoryStore(memory, db);
		store.reindex();
		expect(store.search("SQLite")).toHaveLength(1);
		store.forget("decision-1");
		expect(store.search("SQLite")).toHaveLength(0);
		store.close();
	});

	it("lists, updates and exports provenance-bearing memory records", () => {
		const root = mkdtempSync(join(tmpdir(), "agentme-memory-crud-"));
		const store = new MemoryStore(
			join(root, "notes"),
			join(root, "db.sqlite"),
			{
				clock: () => new Date("2026-08-29T08:00:00.000Z"),
			},
		);
		const created = store.put({
			id: "experience-task-42",
			kind: "experience",
			content: "首次验证通过",
			source: "task:42",
			verifiedAt: "2026-08-29T07:00:00.000Z",
			confidence: 0.8,
			sensitivity: "private",
		});

		expect(created).toMatchObject({
			id: "experience-task-42",
			createdAt: "2026-08-29T08:00:00.000Z",
			confidence: 0.8,
			sensitivity: "private",
		});
		expect(store.list({ kind: "experience", limit: 10, offset: 0 })).toEqual({
			data: [created],
			pagination: { limit: 10, offset: 0, totalItems: 1 },
		});

		const updated = store.update("experience-task-42", {
			content: "首次验证通过，记录完整测试证据",
			verifiedAt: "2026-08-29T09:00:00.000Z",
			confidence: 0.95,
			sensitivity: "sensitive",
		});
		expect(updated).toMatchObject({
			content: "首次验证通过，记录完整测试证据",
			createdAt: created.createdAt,
			verifiedAt: "2026-08-29T09:00:00.000Z",
			confidence: 0.95,
			sensitivity: "sensitive",
		});
		expect(JSON.parse(store.export())).toMatchObject({
			schemaVersion: 1,
			purpose: "owner-inspectable-memory",
			entries: [{ id: "experience-task-42", confidence: 0.95 }],
		});
		expect(store.forget("experience-task-42")).toBe(true);
		expect(store.forget("experience-task-42")).toBe(false);
		store.close();
	});

	it("treats search text as bounded literal input", () => {
		const root = mkdtempSync(join(tmpdir(), "agentme-memory-search-"));
		const store = new MemoryStore(root, join(root, "db.sqlite"));
		store.put({
			id: "project-agentme",
			kind: "project",
			content: "AgentMe 使用 SQLite 全文索引",
			source: "user:local-owner",
		});

		expect(store.search('SQLite" OR *')).toEqual([]);
		expect(() => store.search("x".repeat(501))).toThrow(TypeError);
		expect(() =>
			store.put({
				id: "bad-confidence",
				kind: "profile",
				content: "invalid",
				source: "user:local-owner",
				confidence: 2,
			}),
		).toThrow(TypeError);
		store.close();
	});

	it("finds literal id prefixes and Chinese content fragments", () => {
		const root = mkdtempSync(join(tmpdir(), "agentme-memory-fragment-search-"));
		const store = new MemoryStore(root, join(root, "db.sqlite"));
		store.put({
			id: "browser-memory-acceptance",
			kind: "project",
			content: "长期记忆浏览器验收记录",
			source: "user:local-owner",
		});

		expect(store.search("browser").map((record) => record.id)).toEqual([
			"browser-memory-acceptance",
		]);
		expect(store.search("浏览器验收").map((record) => record.id)).toEqual([
			"browser-memory-acceptance",
		]);
		store.close();
	});

	it("exports and reindexes every memory beyond one API page", () => {
		const root = mkdtempSync(join(tmpdir(), "agentme-memory-complete-export-"));
		const notes = join(root, "notes");
		const database = join(root, "db.sqlite");
		let store = new MemoryStore(notes, database);
		for (let index = 0; index < 101; index += 1) {
			store.put({
				id: `daily-${index.toString().padStart(3, "0")}`,
				kind: "daily",
				content: index === 100 ? "最后一条完整导出证据" : `工作记录 ${index}`,
				source: "user:local-owner",
			});
		}
		expect(JSON.parse(store.export()).entries).toHaveLength(101);
		store.close();

		store = new MemoryStore(notes, database);
		store.reindex();
		expect(store.search("最后一条完整导出证据")).toHaveLength(1);
		store.close();
	});
	it("preserves the search index when a document prevents reindexing", () => {
		const root = mkdtempSync(
			join(tmpdir(), "agentme-memory-reindex-rollback-"),
		);
		const store = new MemoryStore(root, join(root, "db.sqlite"));
		try {
			store.put({
				id: "saved",
				kind: "daily",
				content: "searchable evidence",
				source: "user",
			});
			writeFileSync(join(root, "broken.md"), "invalid document");
			expect(() => store.reindex()).toThrow();
			expect(store.search("searchable").map((record) => record.id)).toEqual([
				"saved",
			]);
		} finally {
			store.close();
		}
	});
	it("rejects path traversal ids", () => {
		const root = mkdtempSync(join(tmpdir(), "agentme-memory-safe-"));
		const store = new MemoryStore(root, join(root, "db.sqlite"));
		expect(() =>
			store.put({
				id: "../escape",
				kind: "profile",
				content: "x",
				source: "user",
			}),
		).toThrow();
		store.close();
	});
});

describe("personal dashboard store", () => {
	it("persists sensitive entries without plaintext on disk", async () => {
		const root = mkdtempSync(join(tmpdir(), "agentme-dashboard-"));
		const path = join(root, "personal-dashboard.enc");
		const keys = new MemoryKeyStore();
		const store = new PersonalDashboardStore({
			path,
			keys,
			clock: () => new Date("2026-08-25T06:00:00.000Z"),
			createId: () => "income-1",
		});

		await store.create({
			type: "income",
			category: "咨询收入",
			amountMinor: 88_800,
			currency: "CNY",
			occurredAt: "2026-08-24T00:00:00.000Z",
			note: "敏感客户项目",
		});

		const persisted = readFileSync(path, "utf8");
		expect(persisted).not.toContain("咨询收入");
		expect(persisted).not.toContain("敏感客户项目");
		await expect(store.list()).resolves.toMatchObject([
			{ id: "income-1", type: "income", amountMinor: 88_800 },
		]);
	});

	it("updates, exports and deletes dashboard entries deterministically", async () => {
		const root = mkdtempSync(join(tmpdir(), "agentme-dashboard-crud-"));
		const path = join(root, "personal-dashboard.enc");
		const keys = new MemoryKeyStore();
		let now = new Date("2026-08-25T06:00:00.000Z");
		const store = new PersonalDashboardStore({
			path,
			keys,
			clock: () => now,
			createId: () => "skill-1",
		});
		await store.create({
			type: "skill",
			name: "TypeScript",
			category: "编程",
			level: 4,
			assessedAt: "2026-08-25T00:00:00.000Z",
		});
		now = new Date("2026-08-25T07:00:00.000Z");
		await store.update("skill-1", {
			type: "skill",
			name: "TypeScript",
			category: "编程",
			level: 5,
			assessedAt: "2026-08-25T00:00:00.000Z",
			evidence: "完成 AgentMe",
		});

		expect(JSON.parse(await store.export())).toMatchObject({
			schemaVersion: 1,
			purpose: "owner-personal-dashboard",
			retention: "until-owner-deletes",
			entries: [{ id: "skill-1", level: 5, evidence: "完成 AgentMe" }],
		});
		await expect(store.delete("skill-1")).resolves.toBe(true);
		await expect(store.list()).resolves.toEqual([]);
		await store.deleteAll();
		expect(existsSync(path)).toBe(false);
		expect(keys.values.size).toBe(0);
	});

	it("deletes corrupted dashboard data without requiring decryption", async () => {
		const root = mkdtempSync(join(tmpdir(), "agentme-dashboard-delete-"));
		const path = join(root, "personal-dashboard.enc");
		const keys = new MemoryKeyStore();
		const store = new PersonalDashboardStore({
			path,
			keys,
			createId: () => "balance-1",
		});
		await store.create({
			type: "balance",
			account: "储蓄账户",
			amountMinor: 123_456,
			currency: "CNY",
			recordedAt: "2026-08-25T00:00:00.000Z",
		});
		writeFileSync(path, "corrupted ciphertext", "utf8");

		await expect(store.deleteAll()).resolves.toBeUndefined();
		expect(existsSync(path)).toBe(false);
		expect(keys.values.size).toBe(0);
	});
});
