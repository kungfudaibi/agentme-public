import type { PersonalDashboardEntry } from "../../../packages/contracts/src/index.js";
import { createPersonalDashboardEditor } from "./personal-dashboard-editor.js";
import {
	renderDashboardEntries,
	renderDashboardSummary,
} from "./personal-dashboard-render.js";
import { parsePersonalDashboardPage } from "./personal-dashboard-state.js";

export interface PersonalDashboardPanelDependencies {
	readonly document: Document;
	readonly request: (path: string, init?: RequestInit) => Promise<Response>;
	readonly notify: (message: string) => void;
	readonly setWorkspaceVisible: (visible: boolean) => void;
}

export interface PersonalDashboardPanel {
	open(): Promise<void>;
	close(): void;
	reload(): Promise<void>;
}

function required<T extends Element>(document: Document, selector: string): T {
	const value = document.querySelector<T>(selector);
	if (value === null) throw new Error(`Missing dashboard element: ${selector}`);
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

export function createPersonalDashboardPanel(
	dependencies: PersonalDashboardPanelDependencies,
): PersonalDashboardPanel {
	const { document, request, notify, setWorkspaceVisible } = dependencies;
	const section = required<HTMLElement>(document, "#personal-dashboard");
	const navigation = required<HTMLButtonElement>(
		document,
		"#personal-dashboard-nav",
	);
	const mobileNavigation = required<HTMLButtonElement>(
		document,
		"#personal-dashboard-top",
	);
	const status = required<HTMLElement>(document, "#dashboard-status");
	const summary = required<HTMLElement>(document, "#dashboard-summary");
	const list = required<HTMLElement>(document, "#dashboard-entry-list");
	const filter = required<HTMLSelectElement>(document, "#dashboard-filter");
	let entries: readonly PersonalDashboardEntry[] = [];

	function renderEntries(): void {
		renderDashboardEntries({
			document,
			container: list,
			entries,
			filter: filter.value,
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
			await request("/personal-dashboard/removals", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ id: entryId }),
			});
			await reload();
			notify("看板记录已删除");
		} catch (error) {
			button.disabled = false;
			notify(error instanceof Error ? error.message : "删除失败");
		}
	}

	async function reload(): Promise<void> {
		status.textContent = "正在从本机 Host 加载加密看板…";
		list.setAttribute("aria-busy", "true");
		try {
			const response = await request("/personal-dashboard?limit=100&offset=0");
			const page = parsePersonalDashboardPage(await response.json());
			entries = page.data;
			renderDashboardSummary(document, summary, entries);
			renderEntries();
			status.textContent = `已从本机 Host 加载 ${page.pagination.totalItems} 条记录。`;
		} catch (error) {
			entries = [];
			summary.replaceChildren();
			const retry = text(document, "button", "重试加载") as HTMLButtonElement;
			retry.type = "button";
			retry.addEventListener("click", () => void reload());
			const errorState = document.createElement("li");
			errorState.className = "dashboard-empty";
			errorState.append(text(document, "p", "个人看板加载失败。"), retry);
			list.replaceChildren(errorState);
			status.textContent =
				error instanceof Error ? error.message : "个人看板加载失败。";
		} finally {
			list.setAttribute("aria-busy", "false");
		}
	}

	const editor = createPersonalDashboardEditor({
		document,
		request,
		notify,
		reload,
	});
	filter.addEventListener("change", renderEntries);
	required<HTMLButtonElement>(document, "#dashboard-add").addEventListener(
		"click",
		() => editor.open(),
	);
	required<HTMLButtonElement>(document, "#dashboard-refresh").addEventListener(
		"click",
		() => void reload(),
	);

	return {
		open: async () => {
			setWorkspaceVisible(true);
			section.hidden = false;
			navigation.setAttribute("aria-expanded", "true");
			mobileNavigation.setAttribute("aria-expanded", "true");
			await reload();
			required<HTMLElement>(document, "#personal-dashboard-title").focus();
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
