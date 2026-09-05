import {
	type PersonalDashboardEntry,
	type PersonalDashboardEntryInput,
	parsePersonalDashboardEntry,
	parsePersonalDashboardEntryInput,
} from "../../../packages/contracts/src/index.js";

export type DashboardEntryType = PersonalDashboardEntry["type"];

export interface PersonalDashboardPage {
	readonly data: readonly PersonalDashboardEntry[];
	readonly pagination: {
		readonly offset: number;
		readonly limit: number;
		readonly totalItems: number;
	};
}

export interface PersonalDashboardFormValues {
	readonly type: DashboardEntryType;
	readonly name: string;
	readonly date: string;
	readonly amount?: string;
	readonly currency?: string;
	readonly category?: string;
	readonly status?: string;
	readonly role?: string;
	readonly result?: string;
	readonly note?: string;
	readonly level?: string;
	readonly evidence?: string;
}

export interface FinancialSummary {
	readonly currency: string;
	readonly balanceMinor: number;
	readonly incomeMinor: number;
	readonly expenseMinor: number;
	readonly investmentMinor: number;
	readonly netCashflowMinor: number;
}

export interface PersonalDashboardView {
	readonly financial: readonly FinancialSummary[];
	readonly timeline: readonly {
		readonly entry: PersonalDashboardEntry;
		readonly at: string;
	}[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pageError(): never {
	throw new TypeError("Invalid personal dashboard page");
}

export function parsePersonalDashboardPage(
	value: unknown,
): PersonalDashboardPage {
	if (
		!isRecord(value) ||
		Object.keys(value).some((key) => !["data", "pagination"].includes(key)) ||
		!Array.isArray(value.data) ||
		value.data.length > 100 ||
		!isRecord(value.pagination)
	)
		return pageError();
	const pagination = value.pagination;
	if (
		Object.keys(pagination).some(
			(key) => !["offset", "limit", "totalItems"].includes(key),
		) ||
		![pagination.offset, pagination.limit, pagination.totalItems].every(
			(item) => Number.isSafeInteger(item) && (item as number) >= 0,
		) ||
		(pagination.limit as number) < 1 ||
		(pagination.limit as number) > 100 ||
		(pagination.offset as number) > 512 ||
		(pagination.totalItems as number) > 512
	)
		return pageError();
	try {
		return {
			data: value.data.map(parsePersonalDashboardEntry),
			pagination: pagination as unknown as PersonalDashboardPage["pagination"],
		};
	} catch {
		return pageError();
	}
}

export function buildPersonalDashboardInput(
	values: PersonalDashboardFormValues,
): PersonalDashboardEntryInput {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(values.date))
		throw new TypeError("Invalid dashboard date");
	const at = new Date(`${values.date}T00:00:00.000Z`).toISOString();
	if (at.slice(0, 10) !== values.date)
		throw new TypeError("Invalid dashboard date");
	const optional = (name: string, value: string | undefined) =>
		value === undefined || value.trim().length === 0
			? {}
			: { [name]: value.trim() };
	let input: unknown;
	switch (values.type) {
		case "balance":
			input = {
				type: values.type,
				account: values.name,
				amountMinor: parseMinorAmount(values.amount),
				currency: values.currency,
				recordedAt: at,
			};
			break;
		case "income":
		case "expense":
			input = {
				type: values.type,
				category: values.name,
				amountMinor: parseMinorAmount(values.amount),
				currency: values.currency,
				occurredAt: at,
				...optional("note", values.note),
			};
			break;
		case "investment":
			input = {
				type: values.type,
				company: values.name,
				amountMinor: parseMinorAmount(values.amount),
				currency: values.currency,
				investedAt: at,
				status: values.status,
				...optional("note", values.note),
			};
			break;
		case "competition":
			input = {
				type: values.type,
				name: values.name,
				occurredAt: at,
				...optional("role", values.role),
				...optional("result", values.result),
				...optional("note", values.note),
			};
			break;
		case "skill":
			input = {
				type: values.type,
				name: values.name,
				category: values.category,
				level: Number(values.level),
				assessedAt: at,
				...optional("evidence", values.evidence),
			};
			break;
	}
	return parsePersonalDashboardEntryInput(input);
}

export function derivePersonalDashboardView(
	entries: readonly PersonalDashboardEntry[],
): PersonalDashboardView {
	const summaries = new Map<string, Omit<FinancialSummary, "currency">>();
	for (const entry of entries) {
		if (!("currency" in entry)) continue;
		const summary = summaries.get(entry.currency) ?? {
			balanceMinor: 0,
			incomeMinor: 0,
			expenseMinor: 0,
			investmentMinor: 0,
			netCashflowMinor: 0,
		};
		const next = { ...summary };
		switch (entry.type) {
			case "balance":
				next.balanceMinor += entry.amountMinor;
				break;
			case "income":
				next.incomeMinor += entry.amountMinor;
				next.netCashflowMinor += entry.amountMinor;
				break;
			case "expense":
				next.expenseMinor += entry.amountMinor;
				next.netCashflowMinor -= entry.amountMinor;
				break;
			case "investment":
				next.investmentMinor += entry.amountMinor;
				break;
		}
		summaries.set(entry.currency, next);
	}
	return {
		financial: [...summaries]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([currency, summary]) => ({ currency, ...summary })),
		timeline: entries
			.map((entry) => ({ entry, at: entryTimestamp(entry) }))
			.sort(
				(left, right) =>
					right.at.localeCompare(left.at) ||
					right.entry.id.localeCompare(left.entry.id),
			),
	};
}

export function formatMinorAmount(
	amountMinor: number,
	currency: string,
): string {
	const sign = amountMinor < 0 ? "-" : "";
	const absolute = Math.abs(amountMinor);
	return `${currency} ${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function parseMinorAmount(value: string | undefined): number {
	if (value === undefined || !/^-?[0-9]+(?:\.[0-9]{1,2})?$/u.test(value))
		throw new TypeError("Invalid dashboard amount");
	const negative = value.startsWith("-");
	const [whole = "", fraction = ""] = value.replace("-", "").split(".");
	const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
	if (minor > 9_000_000_000_000_000n)
		throw new TypeError("Invalid dashboard amount");
	return Number(minor) * (negative ? -1 : 1);
}

function entryTimestamp(entry: PersonalDashboardEntry): string {
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
