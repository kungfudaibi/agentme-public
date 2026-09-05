import type { PersonalDashboardEntry } from "../../../packages/contracts/src/index.js";
import {
	dashboardEntryDetails,
	dashboardEntryName,
	dashboardTypeLabel,
} from "./personal-dashboard-entry.js";
import {
	derivePersonalDashboardView,
	formatMinorAmount,
} from "./personal-dashboard-state.js";

interface EntryRenderOptions {
	readonly document: Document;
	readonly container: HTMLElement;
	readonly entries: readonly PersonalDashboardEntry[];
	readonly filter: string;
	readonly edit: (entry: PersonalDashboardEntry) => void;
	readonly remove: (
		entryId: string,
		button: HTMLButtonElement,
	) => Promise<void>;
}

function text(
	document: Document,
	tag: string,
	content: string,
	className?: string,
): HTMLElement {
	const node = document.createElement(tag);
	node.textContent = content;
	if (className !== undefined) node.className = className;
	return node;
}

export function renderDashboardSummary(
	document: Document,
	container: HTMLElement,
	entries: readonly PersonalDashboardEntry[],
): void {
	const financial = derivePersonalDashboardView(entries).financial;
	if (financial.length === 0) {
		container.replaceChildren(
			text(
				document,
				"p",
				"还没有财务记录。添加存款、收支或投资后会按币种汇总。",
				"dashboard-empty",
			),
		);
		return;
	}
	container.replaceChildren(
		...financial.map((item) => {
			const card = document.createElement("article");
			card.className = "summary-card";
			card.append(
				text(document, "h3", item.currency),
				metric(document, "存款", item.balanceMinor, item.currency),
				metric(document, "收入", item.incomeMinor, item.currency),
				metric(document, "支出", item.expenseMinor, item.currency),
				metric(document, "投资", item.investmentMinor, item.currency),
				metric(
					document,
					"净现金流",
					item.netCashflowMinor,
					item.currency,
					true,
				),
			);
			return card;
		}),
	);
}

export function renderDashboardEntries(options: EntryRenderOptions): void {
	const timeline = derivePersonalDashboardView(options.entries).timeline.filter(
		({ entry }) => options.filter === "all" || entry.type === options.filter,
	);
	if (timeline.length === 0) {
		options.container.replaceChildren(
			text(
				options.document,
				"li",
				options.filter === "all" ? "还没有看板记录。" : "这个分类还没有记录。",
				"dashboard-empty",
			),
		);
		return;
	}
	options.container.replaceChildren(
		...timeline.map(({ entry, at }) => renderEntry(options, entry, at)),
	);
}

function renderEntry(
	options: EntryRenderOptions,
	entry: PersonalDashboardEntry,
	at: string,
): HTMLElement {
	const { document } = options;
	const card = document.createElement("li");
	card.className = `dashboard-entry type-${entry.type}`;
	const heading = document.createElement("header");
	const identity = document.createElement("div");
	identity.append(
		text(
			document,
			"span",
			dashboardTypeLabel(entry.type),
			"dashboard-type-label",
		),
		text(document, "h3", dashboardEntryName(entry)),
	);
	const time = document.createElement("time");
	time.dateTime = at;
	time.textContent = new Date(at).toLocaleDateString("zh-CN");
	heading.append(identity, time);
	const actions = document.createElement("div");
	actions.className = "dashboard-entry-actions";
	const edit = text(document, "button", "编辑") as HTMLButtonElement;
	edit.type = "button";
	edit.addEventListener("click", () => options.edit(entry));
	const remove = text(
		document,
		"button",
		"删除",
		"danger-action",
	) as HTMLButtonElement;
	remove.type = "button";
	let confirmed = false;
	remove.addEventListener("click", () => {
		if (!confirmed) {
			confirmed = true;
			remove.textContent = "再次点击删除";
			remove.setAttribute("aria-label", `确认删除${dashboardEntryName(entry)}`);
			return;
		}
		void options.remove(entry.id, remove);
	});
	actions.append(edit, remove);
	card.append(
		heading,
		text(document, "p", dashboardEntryDetails(entry), "dashboard-entry-detail"),
		actions,
	);
	return card;
}

function metric(
	document: Document,
	label: string,
	value: number,
	unit: string,
	emphasized = false,
): HTMLElement {
	const row = document.createElement("div");
	if (emphasized) row.className = "summary-emphasis";
	row.append(
		text(document, "span", label),
		text(document, "strong", formatMinorAmount(value, unit)),
	);
	return row;
}
