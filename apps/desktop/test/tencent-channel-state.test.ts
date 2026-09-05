import { describe, expect, it } from "vitest";

import {
	buildTencentChannelConfiguration,
	parseTencentChannelView,
} from "../ui/tencent-channel-state.js";

describe("desktop Tencent channel state", () => {
	it("parses a redacted running channel view", () => {
		expect(
			parseTencentChannelView({
				id: "tencent-qq",
				isEnabled: true,
				isConfigured: true,
				status: "running",
				ownerId: "owner-openid",
				accountId: "agentme",
			}),
		).toEqual({
			id: "tencent-qq",
			isEnabled: true,
			isConfigured: true,
			status: "running",
			ownerId: "owner-openid",
			accountId: "agentme",
		});
	});

	it("builds a bounded configuration and omits blank retained secrets", () => {
		expect(
			buildTencentChannelConfiguration({
				isEnabled: true,
				ownerId: " owner-openid ",
				accountId: " agentme ",
				appId: " ",
				appSecret: " ",
			}),
		).toEqual({
			isEnabled: true,
			ownerId: "owner-openid",
			accountId: "agentme",
		});
	});

	it("rejects any credential accidentally returned by the Host", () => {
		expect(() =>
			parseTencentChannelView({
				id: "tencent-qq",
				isEnabled: true,
				isConfigured: true,
				status: "running",
				ownerId: "owner-openid",
				accountId: "agentme",
				appSecret: "leaked",
			}),
		).toThrow("Invalid Tencent channel view");
	});
});
