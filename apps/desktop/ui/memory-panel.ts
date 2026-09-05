import { createMemoryEditor } from "./memory-editor.js";
import { renderMemoryEntries } from "./memory-render.js";
import {
	type DesktopMemoryRecord,
	parseMemoryExport,
	parseMemoryPage,
} from "./memory-state.js";

export interface MemoryPanelDependencies {
	readonly document: Document;
	readonly request: (path: string, init?: RequestInit) => Promise<Response>;
	readonly notify: (message: string) => void;
	readonly setWorkspaceVisible: (visible: boolean) => void;
}

export interface MemoryPanel {
	open(): Promise<void>;
	close(): void;
	reload(): Promise<void>;
}

function required<T extends Element>(document: Document, selector: string): T {
	const value = document.querySelector<T>(selector);
	if (value === null) throw new Error(`Missing memory element: ${selector}`);
	return value;
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

export function createMemoryPanel(
	dependencies: MemoryPanelDependencies,
): MemoryPanel {
	const { document, request, notify, setWorkspaceVisible } = dependencies;
	const section = required<HTMLElement>(document, "#memory-workspace");
	const navigation = required<HTMLButtonElement>(document, "#memory-nav");
	const mobileNavigation = required<HTMLButtonElement>(document, "#memory-top");
	const status = required<HTMLElement>(document, "#memory-status");
	const list = required<HTMLElement>(document, "#memory-entry-list");
	const search = required<HTMLInputElement>(document, "#memory-search");
	const kind = required<HTMLSelectElement>(document, "#memory-kind-filter");
	let entries: readonly DesktopMemoryRecord[] = [];

	function render(): void {
		renderMemoryEntries({
			document,
			container: list,
			entries,
			edit: editor.open,
			remove: removeEntry,
		});
	}

	async function removeEntry(
		entryId: string,
		button: HTMLButtonElement,
	): Promise<void> {
		button.disabled = true;
		try {
			await request("/memories/removals", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ id: entryId }),
			});
			await reload();
			notify("长期记忆已遗忘");
		} catch (error) {
			button.disabled = false;
			notify(error instanceof Error ? error.message : "遗忘失败");
		}
	}

	async function reload(): Promise<void> {
		status.textContent = "正在从本机 Host 加载长期记忆…";
		list.setAttribute("aria-busy", "true");
		try {
			const params = new URLSearchParams({ limit: "100", offset: "0" });
			if (kind.value !== "all") params.set("kind", kind.value);
			if (search.value.trim() !== "") params.set("query", search.value.trim());
			const response = await request(`/memories?${params.toString()}`);
			const page = parseMemoryPage(await response.json());
			entries = page.data;
			render();
			status.textContent = `已加载 ${page.pagination.totalItems} 条匹配记忆。内容只在你主动操作时进入本机界面。`;
		} catch (error) {
			entries = [];
			const retry = text(document, "button", "重试加载") as HTMLButtonElement;
			retry.type = "button";
			retry.addEventListener("click", () => void reload());
			const errorState = text(
				document,
				"li",
				"长期记忆加载失败。",
				"dashboard-empty",
			);
			errorState.append(retry);
			list.replaceChildren(errorState);
			status.textContent =
				error instanceof Error ? error.message : "长期记忆加载失败。";
		} finally {
			list.setAttribute("aria-busy", "false");
		}
	}

	async function exportMemory(): Promise<void> {
		const response = await request("/memories/export");
		const exported = parseMemoryExport(await response.json());
		const blob = new Blob([JSON.stringify(exported, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		try {
			const link = document.createElement("a");
			link.href = url;
			link.download = "agentme-memory-export.json";
			link.click();
			notify(`已导出 ${exported.entries.length} 条长期记忆`);
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	const editor = createMemoryEditor({ document, request, notify, reload });
	required<HTMLButtonElement>(document, "#memory-add").addEventListener(
		"click",
		() => editor.open(),
	);
	required<HTMLButtonElement>(document, "#memory-refresh").addEventListener(
		"click",
		() => void reload(),
	);
	required<HTMLButtonElement>(document, "#memory-export").addEventListener(
		"click",
		() =>
			void exportMemory().catch((error) =>
				notify(error instanceof Error ? error.message : "导出失败"),
			),
	);
	required<HTMLFormElement>(document, "#memory-search-form").addEventListener(
		"submit",
		(event) => {
			event.preventDefault();
			void reload();
		},
	);
	kind.addEventListener("change", () => void reload());

	return {
		open: async () => {
			setWorkspaceVisible(true);
			section.hidden = false;
			navigation.setAttribute("aria-expanded", "true");
			mobileNavigation.setAttribute("aria-expanded", "true");
			await reload();
			required<HTMLElement>(document, "#memory-title").focus();
		},
		close: () => {
			if (section.hidden) return;
			section.hidden = true;
			navigation.setAttribute("aria-expanded", "false");
			mobileNavigation.setAttribute("aria-expanded", "false");
			setWorkspaceVisible(false);
			(window.matchMedia("(max-width: 620px)").matches
				? mobileNavigation
				: navigation
			).focus();
		},
		reload,
	};
}
