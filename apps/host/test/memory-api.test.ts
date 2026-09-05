import { describe, expect, it } from "vitest";

import type { InspectableMemoryPort } from "../../../packages/assistant-supervisor/src/index.js";
import { executeMemoryRoute } from "../src/memory-api.js";

function malformedExportMemory(): InspectableMemoryPort {
	return {
		put: () => {
			throw new Error("unused");
		},
		get: () => undefined,
		list: () => ({
			data: [],
			pagination: { limit: 50, offset: 0, totalItems: 0 },
		}),
		update: () => {
			throw new Error("unused");
		},
		search: () => [],
		forget: () => false,
		export: () => JSON.stringify({ unexpected: "provider output" }),
	};
}

describe("memory API provider boundary", () => {
	it("rejects malformed memory export output", async () => {
		await expect(
			executeMemoryRoute(
				malformedExportMemory(),
				{ type: "memory.export" },
				{ query: new URLSearchParams() },
				new AbortController().signal,
			),
		).rejects.toMatchObject({ code: "INVALID_CONTRACT", isRetryable: false });
	});

	it("rejects a non-boolean forget result", async () => {
		const memory: InspectableMemoryPort = {
			...malformedExportMemory(),
			forget: () => "yes" as never,
		};
		await expect(
			executeMemoryRoute(
				memory,
				{ type: "memory.forget" },
				{
					query: new URLSearchParams(),
					contentType: "application/json",
					body: { id: "project-agentme" },
				},
				new AbortController().signal,
			),
		).rejects.toMatchObject({ code: "INVALID_CONTRACT", isRetryable: false });
	});
});
