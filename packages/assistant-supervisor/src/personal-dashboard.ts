import type {
	PersonalDashboardEntry,
	PersonalDashboardEntryInput,
} from "../../contracts/src/index.js";

const moneyCommand =
	/^记录(收入|支出|存款|投资) ([0-9]+(?:\.[0-9]{1,2})?) ([A-Z]{3}) (.{1,120})$/u;
const competitionCommand =
	/^记录比赛 ([^|]{1,120}) \| ([^|]{1,120}) \| ([^|]{1,200})$/u;
const skillCommand =
	/^记录技能 ([^|]{1,120}) \| ([^|]{1,120}) \| ([1-5]) \| (.{1,1000})$/u;
const deleteCommand = /^删除看板记录 ([a-z0-9][a-z0-9._-]{0,127})$/iu;

export interface PersonalDashboardPort {
	list(signal?: AbortSignal): Promise<readonly PersonalDashboardEntry[]>;
	create(input: unknown, signal?: AbortSignal): Promise<PersonalDashboardEntry>;
	update(
		id: string,
		input: unknown,
		signal?: AbortSignal,
	): Promise<PersonalDashboardEntry>;
	delete(id: string, signal?: AbortSignal): Promise<boolean>;
	export(signal?: AbortSignal): Promise<string>;
	deleteAll(signal?: AbortSignal): Promise<void>;
}

export type PersonalDashboardAuditEvent =
	| {
			readonly type: "personal-dashboard.mutated";
			readonly operation: "created" | "updated" | "deleted";
			readonly entryId: string;
			readonly entryType?: PersonalDashboardEntry["type"];
			readonly at: string;
	  }
	| {
			readonly type: "personal-dashboard.mutated";
			readonly operation: "deleted-all";
			readonly at: string;
	  };

export type PersonalDashboardCommand =
	| {
			readonly type: "list";
			readonly redactedMessage: string;
	  }
	| {
			readonly type: "create";
			readonly input: PersonalDashboardEntryInput;
			readonly redactedMessage: string;
	  }
	| {
			readonly type: "delete";
			readonly id: string;
			readonly redactedMessage: string;
	  };

export interface PersonalDashboardCommandResult {
	readonly message: string;
	readonly entries?: readonly PersonalDashboardEntry[];
}

export function matchPersonalDashboardCommand(
	message: string,
	now: () => Date = () => new Date(),
): PersonalDashboardCommand | undefined {
	const normalized = message.trim();
	if (normalized === "查看个人看板")
		return { type: "list", redactedMessage: normalized };
	const monetary = moneyCommand.exec(normalized);
	if (monetary !== null) {
		const kind = monetary[1] ?? "";
		const amountMinor = parseAmountMinor(monetary[2] ?? "");
		if (amountMinor === undefined) return undefined;
		const currency = monetary[3] ?? "";
		const subject = (monetary[4] ?? "").trim();
		const at = now().toISOString();
		if (kind === "存款")
			return {
				type: "create",
				input: {
					type: "balance",
					account: subject,
					amountMinor,
					currency,
					recordedAt: at,
				},
				redactedMessage: "记录一条存款记录（敏感值已隐藏）",
			};
		if (kind === "投资")
			return {
				type: "create",
				input: {
					type: "investment",
					company: subject,
					amountMinor,
					currency,
					investedAt: at,
					status: "active",
				},
				redactedMessage: "记录一条投资记录（敏感值已隐藏）",
			};
		const type = kind === "收入" ? "income" : "expense";
		return {
			type: "create",
			input: {
				type,
				category: subject,
				amountMinor,
				currency,
				occurredAt: at,
			},
			redactedMessage: `记录一条${kind}记录（敏感值已隐藏）`,
		};
	}
	const competition = competitionCommand.exec(normalized);
	if (competition !== null) {
		return {
			type: "create",
			input: {
				type: "competition",
				name: (competition[1] ?? "").trim(),
				role: (competition[2] ?? "").trim(),
				result: (competition[3] ?? "").trim(),
				occurredAt: now().toISOString(),
			},
			redactedMessage: "记录一条比赛记录（敏感值已隐藏）",
		};
	}
	const skill = skillCommand.exec(normalized);
	if (skill !== null) {
		return {
			type: "create",
			input: {
				type: "skill",
				name: (skill[1] ?? "").trim(),
				category: (skill[2] ?? "").trim(),
				level: Number(skill[3]) as 1 | 2 | 3 | 4 | 5,
				assessedAt: now().toISOString(),
				evidence: (skill[4] ?? "").trim(),
			},
			redactedMessage: "记录一条技能记录（敏感值已隐藏）",
		};
	}
	const removal = deleteCommand.exec(normalized);
	return removal === null
		? undefined
		: {
				type: "delete",
				id: removal[1] ?? "",
				redactedMessage: "删除一条看板记录（标识已隐藏）",
			};
}

export async function executePersonalDashboardCommand(
	command: PersonalDashboardCommand,
	dashboard: PersonalDashboardPort,
	signal: AbortSignal,
	audit?: (event: PersonalDashboardAuditEvent) => void | Promise<void>,
): Promise<PersonalDashboardCommandResult> {
	if (command.type === "list")
		return {
			message: "这是你明确请求的个人看板记录。",
			entries: await dashboard.list(signal),
		};
	if (command.type === "delete") {
		const deleted = await dashboard.delete(command.id, signal);
		if (deleted)
			await audit?.({
				type: "personal-dashboard.mutated",
				operation: "deleted",
				entryId: command.id,
				at: new Date().toISOString(),
			});
		return { message: deleted ? "已删除该看板记录。" : "未找到该看板记录。" };
	}
	const entry = await dashboard.create(command.input, signal);
	await audit?.({
		type: "personal-dashboard.mutated",
		operation: "created",
		entryId: entry.id,
		entryType: entry.type,
		at: new Date().toISOString(),
	});
	return { message: `已记录一条${entryTypeLabel(entry.type)}记录。` };
}

function parseAmountMinor(value: string): number | undefined {
	const [whole = "", fraction = ""] = value.split(".");
	const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
	return amount > 9_000_000_000_000_000n ? undefined : Number(amount);
}

function entryTypeLabel(type: PersonalDashboardEntry["type"]): string {
	switch (type) {
		case "balance":
			return "存款";
		case "income":
			return "收入";
		case "expense":
			return "支出";
		case "investment":
			return "投资";
		case "competition":
			return "比赛";
		case "skill":
			return "技能";
	}
}
