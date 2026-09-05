import { describe, expect, it } from "vitest";

import {
	buildMemoryCreateInput,
	buildMemoryUpdateInput,
	parseMemoryExport,
	parseMemoryPage,
} from "../ui/memory-state.js";

const record = {
	id: "project-agentme",
	kind: "project",
	content: "使用严格 TypeScript",
	source: "user:local-owner",
	createdAt: "2026-08-29T08:00:00.000Z",
	verifiedAt: "2026-08-29T09:00:00.000Z",
	confidence: 0.9,
	sensitivity: "private",
};

describe("desktop inspectable memory state", () => {
	it("validates a paginated Host memory response", () => {
		expect(
			parseMemoryPage({
				data: [record],
				pagination: { limit: 50, offset: 0, totalItems: 1 },
			}),
		).toEqual({
			data: [record],
			pagination: { limit: 50, offset: 0, totalItems: 1 },
		});
	});

	it("rejects malformed or oversized Host memory responses", () => {
		expect(() =>
			parseMemoryPage({
				data: [{ ...record, source: "x".repeat(501) }],
				pagination: { limit: 50, offset: 0, totalItems: 1 },
			}),
		).toThrow("Invalid memory page");
		expect(() =>
			parseMemoryPage({
				data: Array.from({ length: 101 }, () => record),
				pagination: { limit: 100, offset: 0, totalItems: 101 },
			}),
		).toThrow("Invalid memory page");
	});

	it("builds bounded create and update requests from form values", () => {
		expect(
			buildMemoryCreateInput({
				id: " project-agentme ",
				kind: "project",
				content: "  使用严格 TypeScript  ",
				verifiedAt: "2026-08-29T09:00:00.000Z",
				confidence: "0.9",
				sensitivity: "private",
			}),
		).toEqual({
			id: "project-agentme",
			kind: "project",
			content: "使用严格 TypeScript",
			verifiedAt: "2026-08-29T09:00:00.000Z",
			confidence: 0.9,
			sensitivity: "private",
		});
		expect(
			buildMemoryUpdateInput({
				content: "  已核验  ",
				verifiedAt: "",
				confidence: "1",
				sensitivity: "sensitive",
			}),
		).toEqual({
			content: "已核验",
			confidence: 1,
			sensitivity: "sensitive",
		});
	});

	it("rejects unsafe ids and invalid confidence", () => {
		expect(() =>
			buildMemoryCreateInput({
				id: "../escape",
				kind: "daily",
				content: "unsafe",
				verifiedAt: "",
				confidence: "0.5",
				sensitivity: "private",
			}),
		).toThrow("Invalid memory input");
		expect(() =>
			buildMemoryUpdateInput({
				content: "invalid",
				verifiedAt: "",
				confidence: "2",
				sensitivity: "private",
			}),
		).toThrow("Invalid memory input");
	});

	it("validates the complete owner memory export", () => {
		expect(
			parseMemoryExport({
				schemaVersion: 1,
				purpose: "owner-inspectable-memory",
				entries: [record],
			}),
		).toMatchObject({ entries: [{ id: "project-agentme" }] });
		expect(() =>
			parseMemoryExport({ schemaVersion: 1, entries: [record] }),
		).toThrow("Invalid memory export");
	});
});
