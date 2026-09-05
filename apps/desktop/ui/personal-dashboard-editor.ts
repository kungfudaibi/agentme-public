import type { PersonalDashboardEntry } from "../../../packages/contracts/src/index.js";
import {
	dashboardEntryDate,
	dashboardEntryName,
	dashboardMinorInput,
	dashboardNameLabel,
} from "./personal-dashboard-entry.js";
import {
	buildPersonalDashboardInput,
	type DashboardEntryType,
} from "./personal-dashboard-state.js";

export interface PersonalDashboardEditor {
	open(entry?: PersonalDashboardEntry): void;
}

interface EditorDependencies {
	readonly document: Document;
	readonly request: (path: string, init?: RequestInit) => Promise<Response>;
	readonly notify: (message: string) => void;
	readonly reload: () => Promise<void>;
}

function required<T extends Element>(document: Document, selector: string): T {
	const value = document.querySelector<T>(selector);
	if (value === null) throw new Error(`Missing dashboard editor: ${selector}`);
	return value;
}

export function createPersonalDashboardEditor(
	dependencies: EditorDependencies,
): PersonalDashboardEditor {
	const { document, request, notify, reload } = dependencies;
	const dialog = required<HTMLDialogElement>(document, "#dashboard-dialog");
	const form = required<HTMLFormElement>(document, "#dashboard-entry-form");
	const save = required<HTMLButtonElement>(document, "#dashboard-save");
	const id = required<HTMLInputElement>(document, "#dashboard-entry-id");
	const type = required<HTMLSelectElement>(document, "#dashboard-type");
	const name = required<HTMLInputElement>(document, "#dashboard-name");
	const date = required<HTMLInputElement>(document, "#dashboard-date");
	const amount = required<HTMLInputElement>(document, "#dashboard-amount");
	const currency = required<HTMLInputElement>(document, "#dashboard-currency");
	const investmentStatus = required<HTMLSelectElement>(
		document,
		"#dashboard-investment-status",
	);
	const category = required<HTMLInputElement>(document, "#dashboard-category");
	const level = required<HTMLSelectElement>(document, "#dashboard-level");
	const role = required<HTMLInputElement>(document, "#dashboard-role");
	const result = required<HTMLInputElement>(document, "#dashboard-result");
	const note = required<HTMLInputElement>(document, "#dashboard-note");
	const evidence = required<HTMLInputElement>(document, "#dashboard-evidence");

	function updateFields(): void {
		const selected = type.value as DashboardEntryType;
		const financial = ["balance", "income", "expense", "investment"].includes(
			selected,
		);
		for (const field of document.querySelectorAll<HTMLElement>(
			"[data-dashboard-fields]",
		)) {
			const group = field.dataset.dashboardFields;
			field.hidden =
				(group === "financial" && !financial) ||
				(group === "investment" && selected !== "investment") ||
				(group === "competition" && selected !== "competition") ||
				(group === "skill" && selected !== "skill") ||
				(group === "note" &&
					!["income", "expense", "investment", "competition"].includes(
						selected,
					));
		}
		amount.required = financial;
		currency.required = financial;
		category.required = selected === "skill";
		required<HTMLElement>(document, "#dashboard-name-label").textContent =
			dashboardNameLabel(selected);
	}

	function fill(entry: PersonalDashboardEntry): void {
		type.value = entry.type;
		name.value = dashboardEntryName(entry);
		date.value = dashboardEntryDate(entry).slice(0, 10);
		if ("amountMinor" in entry) {
			amount.value = dashboardMinorInput(entry.amountMinor);
			currency.value = entry.currency;
		}
		if (entry.type === "investment") investmentStatus.value = entry.status;
		if (entry.type === "skill") {
			category.value = entry.category;
			level.value = String(entry.level);
			evidence.value = entry.evidence ?? "";
		}
		if (entry.type === "competition") {
			role.value = entry.role ?? "";
			result.value = entry.result ?? "";
		}
		if ("note" in entry) note.value = entry.note ?? "";
	}

	async function submit(): Promise<void> {
		const input = buildPersonalDashboardInput({
			type: type.value as DashboardEntryType,
			name: name.value,
			date: date.value,
			amount: amount.value,
			currency: currency.value.toUpperCase(),
			category: category.value,
			status: investmentStatus.value,
			role: role.value,
			result: result.value,
			note: note.value,
			level: level.value,
			evidence: evidence.value,
		});
		const isNew = id.value === "";
		save.disabled = true;
		try {
			await request(
				isNew
					? "/personal-dashboard/entries"
					: `/personal-dashboard/entries/${encodeURIComponent(id.value)}`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(input),
				},
			);
			dialog.close();
			await reload();
			notify(isNew ? "看板记录已添加" : "看板记录已更新");
		} finally {
			save.disabled = false;
		}
	}

	type.addEventListener("change", updateFields);
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		void submit().catch((error) =>
			notify(error instanceof Error ? error.message : "保存失败"),
		);
	});
	required<HTMLButtonElement>(
		document,
		"#dashboard-dialog-close",
	).addEventListener("click", () => dialog.close());

	return {
		open: (entry) => {
			form.reset();
			currency.value = "CNY";
			date.value = new Date().toISOString().slice(0, 10);
			id.value = entry?.id ?? "";
			if (entry !== undefined) fill(entry);
			type.disabled = entry !== undefined;
			required<HTMLElement>(document, "#dashboard-dialog-title").textContent =
				entry === undefined ? "添加看板记录" : "编辑看板记录";
			updateFields();
			dialog.showModal();
			name.focus();
		},
	};
}
