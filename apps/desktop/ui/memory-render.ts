import type { DesktopMemoryKind, DesktopMemoryRecord } from "./memory-state.js";

interface MemoryRenderOptions {
	readonly document: Document;
	readonly container: HTMLElement;
	readonly entries: readonly DesktopMemoryRecord[];
	readonly edit: (entry: DesktopMemoryRecord) => void;
	readonly remove: (
		entryId: string,
		button: HTMLButtonElement,
	) => Promise<void>;
}

const kindLabels: Record<DesktopMemoryKind, string> = {
	profile: "个人偏好",
	project: "项目知识",
	decision: "决策",
	experience: "任务经验",
	daily: "每日记录",
};

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

export function memoryKindLabel(kind: DesktopMemoryKind): string {
	return kindLabels[kind];
}

export function renderMemoryEntries(options: MemoryRenderOptions): void {
	if (options.entries.length === 0) {
		options.container.replaceChildren(
			text(
				options.document,
				"li",
				"还没有匹配的长期记忆。你可以手动添加，任务完成后也会生成待核验经验。",
				"dashboard-empty",
			),
		);
		return;
	}
	options.container.replaceChildren(
		...options.entries.map((entry) => renderEntry(options, entry)),
	);
}

function renderEntry(
	options: MemoryRenderOptions,
	entry: DesktopMemoryRecord,
): HTMLElement {
	const card = options.document.createElement("li");
	card.className = `memory-entry kind-${entry.kind}`;
	const heading = options.document.createElement("header");
	const identity = options.document.createElement("div");
	identity.append(
		text(
			options.document,
			"span",
			memoryKindLabel(entry.kind),
			"dashboard-type-label",
		),
		text(options.document, "h3", entry.id),
	);
	const created = options.document.createElement("time");
	created.dateTime = entry.createdAt;
	created.textContent = new Date(entry.createdAt).toLocaleString("zh-CN");
	heading.append(identity, created);

	const metadata = text(
		options.document,
		"p",
		`来源 ${entry.source} · 置信度 ${Math.round(entry.confidence * 100)}% · ${
			entry.sensitivity === "sensitive" ? "敏感" : "私有"
		}${
			entry.verifiedAt === undefined
				? " · 尚未核验"
				: ` · 核验于 ${new Date(entry.verifiedAt).toLocaleString("zh-CN")}`
		}`,
		"memory-metadata",
	);
	const actions = options.document.createElement("div");
	actions.className = "dashboard-entry-actions";
	const edit = text(options.document, "button", "编辑") as HTMLButtonElement;
	edit.type = "button";
	edit.addEventListener("click", () => options.edit(entry));
	const remove = text(
		options.document,
		"button",
		"遗忘",
		"danger-action",
	) as HTMLButtonElement;
	remove.type = "button";
	let confirmed = false;
	remove.addEventListener("click", () => {
		if (!confirmed) {
			confirmed = true;
			remove.textContent = "再次点击遗忘";
			remove.setAttribute("aria-label", `确认遗忘记忆 ${entry.id}`);
			return;
		}
		void options.remove(entry.id, remove);
	});
	actions.append(edit, remove);
	card.append(
		heading,
		text(options.document, "p", entry.content, "memory-content"),
		metadata,
		actions,
	);
	return card;
}
