import { describe, expect, it, vi } from "vitest";

import { loadRepositories } from "./token-connection.js";

describe("operator token connection", () => {
	it("trims pasted whitespace before authenticating", async () => {
		const fetcher = vi.fn(
			async () =>
				new Response(JSON.stringify({ repositories: [{ id: "agentme" }] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);

		const result = await loadRepositories(
			"  valid-token\r\n",
			fetcher as typeof fetch,
		);

		expect(fetcher).toHaveBeenCalledWith("/repositories", {
			headers: { authorization: "Bearer valid-token" },
		});
		expect(result).toEqual({
			status: "loaded",
			repositories: [{ id: "agentme" }],
		});
	});

	it("distinguishes an invalid token from a network failure", async () => {
		expect(
			await loadRepositories(
				"bad-token",
				async () => new Response(null, { status: 401 }),
			),
		).toEqual({ status: "unauthorized" });
		expect(
			await loadRepositories("token", async () => {
				throw new Error("offline");
			}),
		).toEqual({ status: "unavailable" });
	});
});
