import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentMeHost } from "../../apps/host/src/server.js";
import { MemoryStore } from "../../plugins/memory-core/src/index.js";

const token = "agentme-memory-token-000000000000001";
const hosts: AgentMeHost[] = [];
const stores: MemoryStore[] = [];
const directories: string[] = [];

afterEach(async () => {
	for (const host of hosts.splice(0)) await host.stop();
	for (const store of stores.splice(0)) store.close();
	for (const directory of directories.splice(0))
		await rm(directory, { recursive: true, force: true });
});

async function start(
	options: { readonly audit?: (event: unknown) => void } = {},
): Promise<AgentMeHost> {
	const directory = await mkdtemp(join(tmpdir(), "agentme-memory-api-"));
	directories.push(directory);
	const memory = new MemoryStore(
		join(directory, "memory"),
		join(directory, "memory-index.sqlite"),
		{ clock: () => new Date("2026-08-29T08:00:00.000Z") },
	);
	stores.push(memory);
	const host = new AgentMeHost({
		databasePath: join(directory, "agentme.sqlite"),
		authToken: token,
		memory,
		...(options.audit === undefined ? {} : { memoryAudit: options.audit }),
	});
	await host.start(0);
	hosts.push(host);
	return host;
}

function request(host: AgentMeHost, path: string, init: RequestInit = {}) {
	return fetch(`${host.url}${path}`, {
		...init,
		headers: { authorization: `Bearer ${token}`, ...init.headers },
	});
}

describe("inspectable memory API", () => {
	it("creates, searches, updates, exports and forgets owner memory", async () => {
		const audit: unknown[] = [];
		const host = await start({ audit: (event) => audit.push(event) });
		const created = await request(host, "/memories", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: "project-agentme",
				kind: "project",
				content: "AgentMe 使用可检查的 Markdown 记忆",
				confidence: 0.9,
				sensitivity: "private",
			}),
		});
		expect(created.status).toBe(201);
		expect(await created.json()).toMatchObject({
			entry: {
				id: "project-agentme",
				createdAt: "2026-08-29T08:00:00.000Z",
			},
		});
		const replayed = await request(host, "/memories", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: "project-agentme",
				kind: "project",
				content: "AgentMe 使用可检查的 Markdown 记忆",
				confidence: 0.9,
				sensitivity: "private",
			}),
		});
		expect(replayed.status).toBe(201);
		const conflict = await request(host, "/memories", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: "project-agentme",
				kind: "project",
				content: "同一个标识不能覆盖另一份记忆",
			}),
		});
		expect(conflict.status).toBe(409);

		const searched = await request(
			host,
			"/memories?query=Markdown&limit=20&offset=0",
		);
		expect(searched.status).toBe(200);
		expect(await searched.json()).toMatchObject({
			data: [{ id: "project-agentme", kind: "project" }],
			pagination: { limit: 20, offset: 0, totalItems: 1 },
		});

		const updated = await request(host, "/memories/project-agentme", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				content: "AgentMe 使用 Markdown 和 SQLite FTS 记忆",
				verifiedAt: "2026-08-29T09:00:00.000Z",
				confidence: 1,
			}),
		});
		expect(updated.status).toBe(200);
		expect(await updated.json()).toMatchObject({
			entry: { content: expect.stringContaining("SQLite FTS"), confidence: 1 },
		});

		const exported = await request(host, "/memories/export");
		expect(exported.status).toBe(200);
		expect(await exported.json()).toMatchObject({
			schemaVersion: 1,
			purpose: "owner-inspectable-memory",
			entries: [{ id: "project-agentme" }],
		});

		const removed = await request(host, "/memories/removals", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: "project-agentme" }),
		});
		expect(removed.status).toBe(200);
		expect(await removed.json()).toEqual({ deleted: true });
		const empty = await request(host, "/memories");
		expect(empty.status).toBe(200);
		expect(await empty.json()).toMatchObject({
			data: [],
			pagination: { totalItems: 0 },
		});
		expect(audit).toMatchObject([
			{
				type: "memory.mutated",
				operation: "created",
				memoryId: "project-agentme",
			},
			{
				type: "memory.mutated",
				operation: "updated",
				memoryId: "project-agentme",
			},
			{
				type: "memory.mutated",
				operation: "deleted",
				memoryId: "project-agentme",
			},
		]);
		expect(JSON.stringify(audit)).not.toContain("Markdown");
	});

	it("authenticates and strictly validates memory requests", async () => {
		const host = await start();
		expect((await fetch(`${host.url}/memories`)).status).toBe(401);
		const invalid = await request(host, "/memories", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: "../escape",
				kind: "project",
				content: "unsafe",
				extra: true,
			}),
		});
		expect(invalid.status).toBe(422);
		expect(await invalid.json()).toEqual({
			error: {
				code: "INVALID_CONTRACT",
				message: "Invalid memory request",
				isRetryable: false,
			},
		});

		const missing = await request(host, "/memories/missing", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ content: "cannot update" }),
		});
		expect(missing.status).toBe(422);
		expect(await missing.json()).toMatchObject({
			error: { code: "INVALID_CONTRACT", isRetryable: false },
		});
	});
});
