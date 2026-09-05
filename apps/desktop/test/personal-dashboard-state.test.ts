import { describe, expect, it } from "vitest";

import {
	buildPersonalDashboardInput,
	derivePersonalDashboardView,
	formatMinorAmount,
	parsePersonalDashboardPage,
} from "../ui/personal-dashboard-state.js";

const metadata = {
	id: "entry-1",
	createdAt: "2026-08-25T00:00:00.000Z",
	updatedAt: "2026-08-25T00:00:00.000Z",
};

describe("personal dashboard desktop state", () => {
	it("validates a bounded authenticated page at the desktop boundary", () => {
		expect(
			parsePersonalDashboardPage({
				data: [
					{
						...metadata,
						type: "income",
						category: "咨询",
						amountMinor: 88_801,
						currency: "CNY",
						occurredAt: "2026-08-25T00:00:00.000Z",
					},
				],
				pagination: { offset: 0, limit: 50, totalItems: 1 },
			}),
		).toMatchObject({ data: [{ type: "income", amountMinor: 88_801 }] });
	});

	it("rejects malformed or oversized Host pages", () => {
		expect(() =>
			parsePersonalDashboardPage({
				data: [{ type: "income", amountMinor: "secret" }],
				pagination: { offset: 0, limit: 50, totalItems: 1 },
			}),
		).toThrow("Invalid personal dashboard page");
	});

	it("derives per-currency totals and a descending timeline", () => {
		const view = derivePersonalDashboardView([
			{
				...metadata,
				type: "balance",
				account: "银行卡",
				amountMinor: 500_000,
				currency: "CNY",
				recordedAt: "2026-08-20T00:00:00.000Z",
			},
			{
				...metadata,
				id: "entry-2",
				type: "income",
				category: "咨询",
				amountMinor: 88_801,
				currency: "CNY",
				occurredAt: "2026-08-25T00:00:00.000Z",
			},
			{
				...metadata,
				id: "entry-3",
				type: "expense",
				category: "设备",
				amountMinor: 20_000,
				currency: "CNY",
				occurredAt: "2026-08-24T00:00:00.000Z",
			},
		]);

		expect(view.financial).toEqual([
			{
				currency: "CNY",
				balanceMinor: 500_000,
				incomeMinor: 88_801,
				expenseMinor: 20_000,
				investmentMinor: 0,
				netCashflowMinor: 68_801,
			},
		]);
		expect(view.timeline.map(({ entry }) => entry.id)).toEqual([
			"entry-2",
			"entry-3",
			"entry-1",
		]);
	});

	it("builds strict inputs for every editable category", () => {
		const date = "2026-08-25";
		expect(
			[
				buildPersonalDashboardInput({
					type: "balance",
					name: "储蓄账户",
					amount: "1234.56",
					currency: "CNY",
					date,
				}),
				buildPersonalDashboardInput({
					type: "income",
					name: "咨询",
					amount: "888.01",
					currency: "CNY",
					date,
					note: "项目收入",
				}),
				buildPersonalDashboardInput({
					type: "expense",
					name: "设备",
					amount: "100",
					currency: "CNY",
					date,
				}),
				buildPersonalDashboardInput({
					type: "investment",
					name: "示例公司",
					amount: "5000",
					currency: "CNY",
					date,
					status: "active",
				}),
				buildPersonalDashboardInput({
					type: "competition",
					name: "黑客松",
					date,
					role: "队长",
					result: "一等奖",
				}),
				buildPersonalDashboardInput({
					type: "skill",
					name: "TypeScript",
					category: "编程",
					level: "5",
					date,
					evidence: "完成 AgentMe",
				}),
			].map(({ type }) => type),
		).toEqual([
			"balance",
			"income",
			"expense",
			"investment",
			"competition",
			"skill",
		]);
	});

	it("formats minor amounts deterministically without locale ambiguity", () => {
		expect(formatMinorAmount(88_801, "CNY")).toBe("CNY 888.01");
	});

	it("rejects a calendar date that would otherwise roll into another month", () => {
		expect(() =>
			buildPersonalDashboardInput({
				type: "competition",
				name: "无效日期比赛",
				date: "2026-02-31",
			}),
		).toThrow("Invalid dashboard date");
	});
});
