import type { PersonalDashboardEntry } from "../../../packages/contracts/src/index.js";
import type { DashboardEntryType } from "./personal-dashboard-state.js";
import { formatMinorAmount } from "./personal-dashboard-state.js";

export function dashboardTypeLabel(type: DashboardEntryType): string {
	return {
		balance: "存款",
		income: "收入",
		expense: "支出",
		investment: "投资",
		competition: "比赛",
		skill: "技能",
	}[type];
}

export function dashboardNameLabel(type: DashboardEntryType): string {
	return {
		balance: "账户",
		income: "收入分类",
		expense: "支出分类",
		investment: "公司",
		competition: "比赛名称",
		skill: "技能名称",
	}[type];
}

export function dashboardEntryName(entry: PersonalDashboardEntry): string {
	switch (entry.type) {
		case "balance":
			return entry.account;
		case "income":
		case "expense":
			return entry.category;
		case "investment":
			return entry.company;
		case "competition":
		case "skill":
			return entry.name;
	}
}

export function dashboardEntryDate(entry: PersonalDashboardEntry): string {
	switch (entry.type) {
		case "balance":
			return entry.recordedAt;
		case "income":
		case "expense":
		case "competition":
			return entry.occurredAt;
		case "investment":
			return entry.investedAt;
		case "skill":
			return entry.assessedAt;
	}
}

export function dashboardEntryDetails(entry: PersonalDashboardEntry): string {
	if ("amountMinor" in entry)
		return formatMinorAmount(entry.amountMinor, entry.currency);
	if (entry.type === "skill")
		return `${entry.category} · ${entry.level}/5${entry.evidence === undefined ? "" : ` · ${entry.evidence}`}`;
	return (
		[entry.role, entry.result, entry.note].filter(Boolean).join(" · ") ||
		"未填写补充信息"
	);
}

export function dashboardMinorInput(value: number): string {
	const sign = value < 0 ? "-" : "";
	const absolute = Math.abs(value);
	return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
