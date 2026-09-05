import {
	buildSkillProposalInput,
	type DesktopSkillProposal,
	parseSkillProposalPage,
} from "./skill-workshop-state.js";

export interface SkillWorkshopPanel {
	open(): Promise<void>;
	close(): void;
}

interface Dependencies {
	readonly document: Document;
	readonly request: (path: string, init?: RequestInit) => Promise<Response>;
	readonly notify: (message: string) => void;
	readonly setWorkspaceVisible: (visible: boolean) => void;
}

function required<T extends Element>(document: Document, selector: string): T {
	const value = document.querySelector<T>(selector);
	if (value === null)
		throw new Error(`Missing skill workshop element: ${selector}`);
	return value;
}

function node(
	document: Document,
	tag: string,
	content: string,
	className?: string,
): HTMLElement {
	const element = document.createElement(tag);
	element.textContent = content;
	if (className !== undefined) element.className = className;
	return element;
}

const statusLabels: Record<DesktopSkillProposal["status"], string> = {
	pending: "待评估",
	evaluated: "待主人批准",
	approved: "已批准待应用",
	rejected: "已拒绝",
	applied: "已应用",
	rolled_back: "已回滚",
};

export function createSkillWorkshopPanel(
	dependencies: Dependencies,
): SkillWorkshopPanel {
	const { document, request, notify, setWorkspaceVisible } = dependencies;
	const section = required<HTMLElement>(document, "#skill-workshop");
	const navigation = required<HTMLButtonElement>(
		document,
		"#skill-workshop-nav",
	);
	const mobileNavigation = required<HTMLButtonElement>(
		document,
		"#skill-workshop-top",
	);
	const list = required<HTMLElement>(document, "#skill-proposal-list");
	const status = required<HTMLElement>(document, "#skill-workshop-status");
	const dialog = required<HTMLDialogElement>(
		document,
		"#skill-proposal-dialog",
	);
	const form = required<HTMLFormElement>(document, "#skill-proposal-form");
	const skillId = required<HTMLInputElement>(document, "#skill-proposal-id");
	const content = required<HTMLTextAreaElement>(
		document,
		"#skill-proposal-content",
	);

	async function transition(
		proposal: DesktopSkillProposal,
		action: "evaluate" | "approve" | "apply" | "rollback",
	): Promise<void> {
		const needsHash = action === "approve" || action === "apply";
		await request(
			`/skills/proposals/${encodeURIComponent(proposal.id)}/${action}`,
			{
				method: "POST",
				...(needsHash
					? {
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ contentHash: proposal.contentHash }),
						}
					: {}),
			},
		);
		await reload();
		notify(
			(
				{
					evaluate: "隔离评估已完成",
					approve: "技能提案已由主人批准",
					apply: "技能已应用",
					rollback: "技能已回滚",
				} as const
			)[action],
		);
	}

	function actionButton(
		proposal: DesktopSkillProposal,
	): HTMLButtonElement | null {
		const action =
			proposal.status === "pending"
				? "evaluate"
				: proposal.status === "evaluated"
					? "approve"
					: proposal.status === "approved"
						? "apply"
						: proposal.status === "applied"
							? "rollback"
							: undefined;
		if (action === undefined) return null;
		const labels = {
			evaluate: "运行隔离评估",
			approve: `批准 ${proposal.contentHash.slice(0, 8)}`,
			apply: "应用已批准版本",
			rollback: "回滚此版本",
		} as const;
		const button = node(
			document,
			"button",
			labels[action],
		) as HTMLButtonElement;
		button.type = "button";
		let confirmed = action !== "approve" && action !== "rollback";
		button.addEventListener("click", () => {
			if (!confirmed) {
				confirmed = true;
				button.textContent =
					action === "approve" ? "再次点击确认批准" : "再次点击确认回滚";
				return;
			}
			button.disabled = true;
			void transition(proposal, action).catch((error) => {
				button.disabled = false;
				notify(error instanceof Error ? error.message : "技能提案操作失败");
			});
		});
		return button;
	}

	function render(proposals: readonly DesktopSkillProposal[]): void {
		if (proposals.length === 0) {
			list.replaceChildren(
				node(
					document,
					"li",
					"还没有技能提案。主 Agent 只能提出建议，必须由你批准后才能应用。",
					"dashboard-empty",
				),
			);
			return;
		}
		list.replaceChildren(
			...proposals.map((proposal) => {
				const item = document.createElement("li");
				item.className = "memory-entry skill-proposal-entry";
				const header = document.createElement("header");
				header.append(
					node(document, "h2", proposal.skillId),
					node(
						document,
						"span",
						statusLabels[proposal.status],
						"dashboard-type-label",
					),
				);
				const body = node(
					document,
					"pre",
					proposal.content,
					"skill-proposal-content",
				);
				const metadata = node(
					document,
					"p",
					`来源 ${proposal.source} · 哈希 ${proposal.contentHash.slice(0, 12)} · ${proposal.evaluation?.evaluatorId ?? "尚未评估"}`,
					"memory-metadata",
				);
				const actions = document.createElement("div");
				actions.className = "dashboard-entry-actions";
				const action = actionButton(proposal);
				if (action !== null) actions.append(action);
				item.append(header, body, metadata, actions);
				return item;
			}),
		);
	}

	async function reload(): Promise<void> {
		status.textContent = "正在加载技能提案…";
		list.setAttribute("aria-busy", "true");
		try {
			const response = await request("/skills/proposals?limit=100&offset=0");
			const page = parseSkillProposalPage(await response.json());
			render(page.data);
			status.textContent = `共 ${page.pagination.totalItems} 个提案；默认不应用。`;
		} catch (error) {
			list.replaceChildren(
				node(
					document,
					"li",
					error instanceof Error ? error.message : "技能提案加载失败",
					"dashboard-empty dashboard-error",
				),
			);
			status.textContent = "技能工坊当前不可用，可稍后刷新重试。";
		} finally {
			list.setAttribute("aria-busy", "false");
		}
	}

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		void (async () => {
			const input = buildSkillProposalInput(skillId.value, content.value);
			await request("/skills/proposals", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(input),
			});
			dialog.close();
			await reload();
			notify("技能提案已创建，尚未评估或应用");
		})().catch((error) =>
			notify(error instanceof Error ? error.message : "技能提案创建失败"),
		);
	});
	required<HTMLButtonElement>(document, "#skill-proposal-add").addEventListener(
		"click",
		() => {
			form.reset();
			dialog.showModal();
			skillId.focus();
		},
	);
	required<HTMLButtonElement>(
		document,
		"#skill-proposal-close",
	).addEventListener("click", () => dialog.close());
	required<HTMLButtonElement>(
		document,
		"#skill-workshop-refresh",
	).addEventListener("click", () => void reload());

	return {
		open: async () => {
			setWorkspaceVisible(true);
			section.hidden = false;
			navigation.setAttribute("aria-expanded", "true");
			mobileNavigation.setAttribute("aria-expanded", "true");
			await reload();
			required<HTMLElement>(document, "#skill-workshop-title").focus();
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
	};
}
