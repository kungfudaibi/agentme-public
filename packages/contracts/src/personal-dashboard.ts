import { AgentMeError } from "./errors.js";

interface DashboardEntryMetadata {
	readonly id: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

interface FinancialFields {
	readonly amountMinor: number;
	readonly currency: string;
}

export interface BalanceDashboardInput extends FinancialFields {
	readonly type: "balance";
	readonly account: string;
	readonly recordedAt: string;
}

export interface TransactionDashboardInput extends FinancialFields {
	readonly type: "income" | "expense";
	readonly category: string;
	readonly occurredAt: string;
	readonly note?: string;
}

export interface InvestmentDashboardInput extends FinancialFields {
	readonly type: "investment";
	readonly company: string;
	readonly investedAt: string;
	readonly status: "active" | "exited" | "written-off";
	readonly note?: string;
}

export interface CompetitionDashboardInput {
	readonly type: "competition";
	readonly name: string;
	readonly occurredAt: string;
	readonly role?: string;
	readonly result?: string;
	readonly note?: string;
}

export interface SkillDashboardInput {
	readonly type: "skill";
	readonly name: string;
	readonly category: string;
	readonly level: 1 | 2 | 3 | 4 | 5;
	readonly assessedAt: string;
	readonly evidence?: string;
}

export type PersonalDashboardEntryInput =
	| BalanceDashboardInput
	| TransactionDashboardInput
	| InvestmentDashboardInput
	| CompetitionDashboardInput
	| SkillDashboardInput;

export type PersonalDashboardEntry = PersonalDashboardEntryInput &
	DashboardEntryMetadata;

export interface PersonalDashboardDocument {
	readonly schemaVersion: 1;
	readonly purpose: "owner-personal-dashboard";
	readonly retention: "until-owner-deletes";
	readonly updatedAt: string;
	readonly entries: readonly PersonalDashboardEntry[];
}

type UnknownRecord = Record<string, unknown>;
const identifierPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const currencyPattern = /^[A-Z]{3}$/;
const maximumEntries = 512;
const maximumAmountMinor = 9_000_000_000_000_000;

function invalidDashboardContract(): never {
	throw new AgentMeError({
		code: "INVALID_CONTRACT",
		message: "Invalid personal dashboard contract",
		isRetryable: false,
	});
}

function record(value: unknown): UnknownRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return invalidDashboardContract();
	return value as UnknownRecord;
}

function onlyKeys(value: UnknownRecord, keys: readonly string[]): void {
	const allowed = new Set(keys);
	if (Object.keys(value).some((key) => !allowed.has(key)))
		invalidDashboardContract();
}

function text(value: unknown, maximumLength: number): string {
	if (typeof value !== "string") return invalidDashboardContract();
	const normalized = value.trim();
	if (normalized.length < 1 || normalized.length > maximumLength)
		return invalidDashboardContract();
	return normalized;
}

function optionalText(
	value: unknown,
	maximumLength: number,
): string | undefined {
	return value === undefined ? undefined : text(value, maximumLength);
}

function timestamp(value: unknown): string {
	if (typeof value !== "string") return invalidDashboardContract();
	const parsed = new Date(value);
	if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
		return invalidDashboardContract();
	return value;
}

function identifier(value: unknown): string {
	const parsed = text(value, 128);
	return identifierPattern.test(parsed) ? parsed : invalidDashboardContract();
}

function currency(value: unknown): string {
	return typeof value === "string" && currencyPattern.test(value)
		? value
		: invalidDashboardContract();
}

function amount(value: unknown, allowNegative = false): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		Math.abs(value) > maximumAmountMinor ||
		(allowNegative ? false : value < 1)
	)
		return invalidDashboardContract();
	return value;
}

function optionalField(
	name: string,
	value: string | undefined,
): Record<string, string> {
	return value === undefined ? {} : { [name]: value };
}

export function parsePersonalDashboardEntryInput(
	input: unknown,
): PersonalDashboardEntryInput {
	const value = record(input);
	switch (value.type) {
		case "balance":
			onlyKeys(value, [
				"type",
				"account",
				"amountMinor",
				"currency",
				"recordedAt",
			]);
			return {
				type: value.type,
				account: text(value.account, 120),
				amountMinor: amount(value.amountMinor, true),
				currency: currency(value.currency),
				recordedAt: timestamp(value.recordedAt),
			};
		case "income":
		case "expense":
			onlyKeys(value, [
				"type",
				"category",
				"amountMinor",
				"currency",
				"occurredAt",
				"note",
			]);
			return {
				type: value.type,
				category: text(value.category, 120),
				amountMinor: amount(value.amountMinor),
				currency: currency(value.currency),
				occurredAt: timestamp(value.occurredAt),
				...optionalField("note", optionalText(value.note, 1_000)),
			} as TransactionDashboardInput;
		case "investment": {
			onlyKeys(value, [
				"type",
				"company",
				"amountMinor",
				"currency",
				"investedAt",
				"status",
				"note",
			]);
			if (!["active", "exited", "written-off"].includes(String(value.status)))
				return invalidDashboardContract();
			return {
				type: value.type,
				company: text(value.company, 200),
				amountMinor: amount(value.amountMinor),
				currency: currency(value.currency),
				investedAt: timestamp(value.investedAt),
				status: value.status as InvestmentDashboardInput["status"],
				...optionalField("note", optionalText(value.note, 1_000)),
			} as InvestmentDashboardInput;
		}
		case "competition":
			onlyKeys(value, ["type", "name", "occurredAt", "role", "result", "note"]);
			return {
				type: value.type,
				name: text(value.name, 200),
				occurredAt: timestamp(value.occurredAt),
				...optionalField("role", optionalText(value.role, 120)),
				...optionalField("result", optionalText(value.result, 200)),
				...optionalField("note", optionalText(value.note, 1_000)),
			} as CompetitionDashboardInput;
		case "skill": {
			onlyKeys(value, [
				"type",
				"name",
				"category",
				"level",
				"assessedAt",
				"evidence",
			]);
			if (
				typeof value.level !== "number" ||
				!Number.isInteger(value.level) ||
				value.level < 1 ||
				value.level > 5
			)
				return invalidDashboardContract();
			return {
				type: value.type,
				name: text(value.name, 120),
				category: text(value.category, 120),
				level: value.level as SkillDashboardInput["level"],
				assessedAt: timestamp(value.assessedAt),
				...optionalField("evidence", optionalText(value.evidence, 1_000)),
			} as SkillDashboardInput;
		}
		default:
			return invalidDashboardContract();
	}
}

export function parsePersonalDashboardEntry(
	input: unknown,
): PersonalDashboardEntry {
	const value = record(input);
	const { id, createdAt, updatedAt, ...entryInput } = value;
	return {
		...parsePersonalDashboardEntryInput(entryInput),
		id: identifier(id),
		createdAt: timestamp(createdAt),
		updatedAt: timestamp(updatedAt),
	};
}

export function parsePersonalDashboardDocument(
	input: unknown,
): PersonalDashboardDocument {
	const value = record(input);
	onlyKeys(value, [
		"schemaVersion",
		"purpose",
		"retention",
		"updatedAt",
		"entries",
	]);
	if (
		value.schemaVersion !== 1 ||
		value.purpose !== "owner-personal-dashboard" ||
		value.retention !== "until-owner-deletes" ||
		!Array.isArray(value.entries) ||
		value.entries.length > maximumEntries
	)
		return invalidDashboardContract();
	const entries = value.entries.map(parsePersonalDashboardEntry);
	if (new Set(entries.map(({ id }) => id)).size !== entries.length)
		return invalidDashboardContract();
	return {
		schemaVersion: value.schemaVersion,
		purpose: value.purpose,
		retention: value.retention,
		updatedAt: timestamp(value.updatedAt),
		entries,
	};
}
