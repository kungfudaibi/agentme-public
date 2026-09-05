import { describe, expect, it } from "vitest";

import {
	buildProviderConfiguration,
	parseProviderCatalog,
} from "../ui/provider-state.js";

describe("desktop provider state", () => {
	it("parses redacted provider cards and active state", () => {
		expect(
			parseProviderCatalog({
				activeProfileId: "deepseek",
				profiles: [
					{
						id: "deepseek",
						name: "DeepSeek",
						endpoint: "https://api.deepseek.com/chat/completions",
						model: "deepseek-v4-flash",
						isActive: true,
						isConfigured: true,
						health: "ready",
					},
				],
			}),
		).toMatchObject({
			activeProfileId: "deepseek",
			profiles: [{ id: "deepseek", isActive: true, health: "ready" }],
		});
	});

	it("rejects provider responses containing a credential field", () => {
		expect(() =>
			parseProviderCatalog({
				activeProfileId: "deepseek",
				profiles: [
					{
						id: "deepseek",
						name: "DeepSeek",
						endpoint: "https://api.deepseek.com/chat/completions",
						model: "deepseek-v4-flash",
						isActive: true,
						isConfigured: true,
						health: "ready",
						apiKey: "must-not-cross-boundary",
					},
				],
			}),
		).toThrow("Invalid provider catalog");
	});

	it("omits a blank key so saving keeps the protected credential", () => {
		expect(
			buildProviderConfiguration({
				endpoint: "https://api.deepseek.com/chat/completions",
				model: "deepseek-v4-flash",
				apiKey: "   ",
			}),
		).toEqual({
			endpoint: "https://api.deepseek.com/chat/completions",
			model: "deepseek-v4-flash",
		});
	});
});
