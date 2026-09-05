import {
	buildMemoryCreateInput,
	buildMemoryUpdateInput,
	type DesktopMemoryRecord,
} from "./memory-state.js";

export interface MemoryEditor {
	open(entry?: DesktopMemoryRecord): void;
}

interface MemoryEditorDependencies {
	readonly document: Document;
	readonly request: (path: string, init?: RequestInit) => Promise<Response>;
	readonly notify: (message: string) => void;
	readonly reload: () => Promise<void>;
}

function required<T extends Element>(document: Document, selector: string): T {
	const value = document.querySelector<T>(selector);
	if (value === null) throw new Error(`Missing memory editor: ${selector}`);
	return value;
}

function localDateTime(iso: string): string {
	const date = new Date(iso);
	return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
		.toISOString()
		.slice(0, 16);
}

function verifiedIso(value: string): string {
	return value === "" ? "" : new Date(value).toISOString();
}

export function createMemoryEditor(
	dependencies: MemoryEditorDependencies,
): MemoryEditor {
	const { document, request, notify, reload } = dependencies;
	const dialog = required<HTMLDialogElement>(document, "#memory-dialog");
	const form = required<HTMLFormElement>(document, "#memory-entry-form");
	const id = required<HTMLInputElement>(document, "#memory-id");
	const kind = required<HTMLSelectElement>(document, "#memory-kind");
	const content = required<HTMLTextAreaElement>(document, "#memory-content");
	const verifiedAt = required<HTMLInputElement>(
		document,
		"#memory-verified-at",
	);
	const confidence = required<HTMLInputElement>(document, "#memory-confidence");
	const sensitivity = required<HTMLSelectElement>(
		document,
		"#memory-sensitivity",
	);
	const save = required<HTMLButtonElement>(document, "#memory-save");
	let editing: DesktopMemoryRecord | undefined;

	async function submit(): Promise<void> {
		const values = {
			content: content.value,
			verifiedAt: verifiedIso(verifiedAt.value),
			confidence: confidence.value,
			sensitivity: sensitivity.value,
		};
		const isNew = editing === undefined;
		const input = isNew
			? buildMemoryCreateInput({ ...values, id: id.value, kind: kind.value })
			: buildMemoryUpdateInput(values);
		save.disabled = true;
		try {
			await request(
				isNew ? "/memories" : `/memories/${encodeURIComponent(id.value)}`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(input),
				},
			);
			dialog.close();
			await reload();
			notify(isNew ? "长期记忆已添加" : "长期记忆已更新");
		} finally {
			save.disabled = false;
		}
	}

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		void submit().catch((error) =>
			notify(error instanceof Error ? error.message : "记忆保存失败"),
		);
	});
	required<HTMLButtonElement>(
		document,
		"#memory-dialog-close",
	).addEventListener("click", () => dialog.close());

	return {
		open: (entry) => {
			editing = entry;
			form.reset();
			confidence.value = String(entry?.confidence ?? 0.8);
			sensitivity.value = entry?.sensitivity ?? "private";
			id.value = entry?.id ?? "";
			kind.value = entry?.kind ?? "daily";
			content.value = entry?.content ?? "";
			verifiedAt.value =
				entry?.verifiedAt === undefined ? "" : localDateTime(entry.verifiedAt);
			id.disabled = entry !== undefined;
			kind.disabled = entry !== undefined;
			required<HTMLElement>(document, "#memory-dialog-title").textContent =
				entry === undefined ? "添加长期记忆" : "编辑长期记忆";
			dialog.showModal();
			(entry === undefined ? id : content).focus();
		},
	};
}
