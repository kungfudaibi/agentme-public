import {
	buildScheduledTaskInput,
	buildStandingIntentInput,
	type DesktopScheduledTask,
	type DesktopStandingIntent,
	parseScheduledTaskPage,
	parseStandingIntentPage,
} from "./automation-state.js";

export interface AutomationPanel {
	open(): Promise<void>;
	close(): void;
}

interface Dependencies {
	readonly document: Document;
	readonly request: (path: string, init?: RequestInit) => Promise<Response>;
	readonly notify: (message: string) => void;
	readonly setWorkspaceVisible: (visible: boolean) => void;
	readonly getTarget: () => {
		readonly repositoryId: string;
		readonly runtimeId: string;
	};
	readonly openTask: (parentId: string) => Promise<void>;
}

function required<T extends Element>(document: Document, selector: string): T {
	const value = document.querySelector<T>(selector);
	if (value === null)
		throw new Error(`Missing automation element: ${selector}`);
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

const stateLabels: Record<DesktopScheduledTask["state"], string> = {
	scheduled: "等待执行",
	claimed: "正在调度",
	dispatched: "已交给主 Agent",
	cancelled: "已取消",
	failed: "调度失败",
};

const intentStateLabels: Record<DesktopStandingIntent["state"], string> = {
	active: "等待条件",
	exhausted: "次数已用完",
	expired: "已过期",
	cancelled: "已取消",
};

const eventLabels: Record<DesktopStandingIntent["eventType"], string> = {
	"task.completed": "任一任务完成时",
	"task.failed": "任一任务失败时",
};

function localDateTimeValue(date: Date): string {
	return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
		.toISOString()
		.slice(0, 16);
}

export function createAutomationPanel(
	dependencies: Dependencies,
): AutomationPanel {
	const {
		document,
		request,
		notify,
		setWorkspaceVisible,
		getTarget,
		openTask,
	} = dependencies;
	const section = required<HTMLElement>(document, "#automation-workspace");
	const navigation = required<HTMLButtonElement>(document, "#automation-nav");
	const mobileNavigation = required<HTMLButtonElement>(
		document,
		"#automation-top",
	);
	const list = required<HTMLElement>(document, "#automation-list");
	const intentList = required<HTMLElement>(document, "#standing-intent-list");
	const status = required<HTMLElement>(document, "#automation-status");
	const dialog = required<HTMLDialogElement>(document, "#automation-dialog");
	const form = required<HTMLFormElement>(document, "#automation-form");
	const runAt = required<HTMLInputElement>(document, "#automation-run-at");
	const instruction = required<HTMLTextAreaElement>(
		document,
		"#automation-instruction",
	);
	const intentDialog = required<HTMLDialogElement>(
		document,
		"#standing-intent-dialog",
	);
	const intentForm = required<HTMLFormElement>(
		document,
		"#standing-intent-form",
	);
	const intentEvent = required<HTMLSelectElement>(
		document,
		"#standing-intent-event",
	);
	const intentExpiresAt = required<HTMLInputElement>(
		document,
		"#standing-intent-expires-at",
	);
	const intentCooldown = required<HTMLInputElement>(
		document,
		"#standing-intent-cooldown",
	);
	const intentMaxFires = required<HTMLInputElement>(
		document,
		"#standing-intent-max-fires",
	);
	const intentInstruction = required<HTMLTextAreaElement>(
		document,
		"#standing-intent-instruction",
	);
	let refreshTimer: number | undefined;
	let renderedSignature: string | undefined;
	let renderedIntentSignature: string | undefined;

	function render(tasks: readonly DesktopScheduledTask[]): void {
		if (tasks.length === 0) {
			list.replaceChildren(
				node(
					document,
					"li",
					"还没有自动任务。你可以设定时间，到点后由主 Agent 选择并观察子 Agent。",
					"dashboard-empty",
				),
			);
			return;
		}
		list.replaceChildren(
			...tasks.map((task) => {
				const item = document.createElement("li");
				item.className = "memory-entry automation-entry";
				const header = document.createElement("header");
				header.append(
					node(document, "h2", task.instruction),
					node(
						document,
						"span",
						stateLabels[task.state],
						"dashboard-type-label",
					),
				);
				const metadata = node(
					document,
					"p",
					`${new Date(task.runAt).toLocaleString()} · ${task.repositoryId} · ${task.runtimeId}`,
					"memory-metadata",
				);
				const actions = document.createElement("div");
				actions.className = "dashboard-entry-actions";
				if (task.state === "scheduled") {
					const cancel = node(
						document,
						"button",
						"取消任务",
					) as HTMLButtonElement;
					cancel.type = "button";
					let confirmed = false;
					cancel.addEventListener("click", () => {
						if (!confirmed) {
							confirmed = true;
							cancel.textContent = "再次点击确认取消";
							return;
						}
						cancel.disabled = true;
						void request(
							`/automations/jobs/${encodeURIComponent(task.id)}/cancel`,
							{
								method: "POST",
							},
						)
							.then(reload)
							.then(() => notify("自动任务已取消"))
							.catch((error) => {
								cancel.disabled = false;
								notify(
									error instanceof Error ? error.message : "取消自动任务失败",
								);
							});
					});
					actions.append(cancel);
				}
				if (task.parentId !== undefined) {
					const enter = node(
						document,
						"button",
						"进入任务",
					) as HTMLButtonElement;
					enter.type = "button";
					enter.addEventListener("click", () => {
						void openTask(task.parentId as string).catch((error) =>
							notify(
								error instanceof Error ? error.message : "无法进入自动任务",
							),
						);
					});
					actions.append(enter);
				}
				if (task.failureMessage !== undefined)
					item.append(
						header,
						metadata,
						node(document, "p", task.failureMessage, "dashboard-error"),
						actions,
					);
				else item.append(header, metadata, actions);
				return item;
			}),
		);
	}

	function renderIntents(intents: readonly DesktopStandingIntent[]): void {
		if (intents.length === 0) {
			intentList.replaceChildren(
				node(
					document,
					"li",
					"还没有条件任务。条件只来自已认证的本机任务事件，并受过期时间、冷却和触发次数限制。",
					"dashboard-empty",
				),
			);
			return;
		}
		intentList.replaceChildren(
			...intents.map((intent) => {
				const item = document.createElement("li");
				item.className = "memory-entry automation-entry";
				const header = document.createElement("header");
				header.append(
					node(document, "h2", intent.instruction),
					node(
						document,
						"span",
						intentStateLabels[intent.state],
						"dashboard-type-label",
					),
				);
				const metadata = node(
					document,
					"p",
					`${eventLabels[intent.eventType]} · ${intent.firedCount}/${intent.maxFires} 次 · 冷却 ${intent.cooldownMinutes} 分钟 · ${new Date(intent.expiresAt).toLocaleString()} 到期`,
					"memory-metadata",
				);
				const actions = document.createElement("div");
				actions.className = "dashboard-entry-actions";
				if (intent.state === "active") {
					const cancel = node(
						document,
						"button",
						"取消条件",
					) as HTMLButtonElement;
					cancel.type = "button";
					let confirmed = false;
					cancel.addEventListener("click", () => {
						if (!confirmed) {
							confirmed = true;
							cancel.textContent = "再次点击确认取消";
							return;
						}
						cancel.disabled = true;
						void request(
							`/automations/intents/${encodeURIComponent(intent.id)}/cancel`,
							{ method: "POST" },
						)
							.then(reload)
							.then(() => notify("条件任务已取消"))
							.catch((error) => {
								cancel.disabled = false;
								notify(
									error instanceof Error ? error.message : "取消条件任务失败",
								);
							});
					});
					actions.append(cancel);
				}
				if (intent.lastParentId !== undefined) {
					const enter = node(
						document,
						"button",
						"进入最近任务",
					) as HTMLButtonElement;
					enter.type = "button";
					enter.addEventListener("click", () => {
						void openTask(intent.lastParentId as string).catch((error) =>
							notify(
								error instanceof Error ? error.message : "无法进入条件任务",
							),
						);
					});
					actions.append(enter);
				}
				item.append(header, metadata);
				if (intent.lastFailureMessage !== undefined)
					item.append(
						node(document, "p", intent.lastFailureMessage, "dashboard-error"),
					);
				item.append(actions);
				return item;
			}),
		);
	}

	async function reload(): Promise<void> {
		status.textContent = "正在刷新自动任务…";
		list.setAttribute("aria-busy", "true");
		try {
			const [jobResponse, intentResponse] = await Promise.all([
				request("/automations/jobs"),
				request("/automations/intents"),
			]);
			const page = parseScheduledTaskPage(await jobResponse.json());
			const intentPage = parseStandingIntentPage(await intentResponse.json());
			const signature = JSON.stringify(page.data);
			if (signature !== renderedSignature) {
				render(page.data);
				renderedSignature = signature;
			}
			const intentSignature = JSON.stringify(intentPage.data);
			if (intentSignature !== renderedIntentSignature) {
				renderIntents(intentPage.data);
				renderedIntentSignature = intentSignature;
			}
			status.textContent = `共 ${page.data.length} 个定时任务、${intentPage.data.length} 个条件任务；指令只会进入主 Agent，不会直接作为 Shell 命令执行。`;
		} catch (error) {
			list.replaceChildren(
				node(
					document,
					"li",
					error instanceof Error ? error.message : "自动任务加载失败",
					"dashboard-empty dashboard-error",
				),
			);
			status.textContent = "自动任务当前不可用，可稍后刷新重试。";
		} finally {
			list.setAttribute("aria-busy", "false");
		}
	}

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		void (async () => {
			const target = getTarget();
			const input = buildScheduledTaskInput(
				runAt.value,
				instruction.value,
				target.repositoryId,
				target.runtimeId,
			);
			await request("/automations/jobs", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(input),
			});
			dialog.close();
			await reload();
			notify("自动任务已安排，将由主 Agent 调度执行");
		})().catch((error) =>
			notify(error instanceof Error ? error.message : "安排自动任务失败"),
		);
	});
	intentForm.addEventListener("submit", (event) => {
		event.preventDefault();
		void (async () => {
			const target = getTarget();
			const input = buildStandingIntentInput(
				intentEvent.value as "task.completed" | "task.failed",
				intentExpiresAt.value,
				Number(intentCooldown.value),
				Number(intentMaxFires.value),
				intentInstruction.value,
				target.repositoryId,
				target.runtimeId,
			);
			await request("/automations/intents", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(input),
			});
			intentDialog.close();
			await reload();
			notify("条件任务已创建，将由真实任务事件触发");
		})().catch((error) =>
			notify(error instanceof Error ? error.message : "创建条件任务失败"),
		);
	});
	required<HTMLButtonElement>(document, "#automation-add").addEventListener(
		"click",
		() => {
			form.reset();
			runAt.value = localDateTimeValue(new Date(Date.now() + 5 * 60_000));
			dialog.showModal();
			runAt.focus();
		},
	);
	required<HTMLButtonElement>(
		document,
		"#standing-intent-add",
	).addEventListener("click", () => {
		intentForm.reset();
		intentExpiresAt.value = localDateTimeValue(
			new Date(Date.now() + 7 * 86_400_000),
		);
		intentCooldown.value = "60";
		intentMaxFires.value = "3";
		intentDialog.showModal();
		intentEvent.focus();
	});
	required<HTMLButtonElement>(
		document,
		"#automation-dialog-close",
	).addEventListener("click", () => dialog.close());
	required<HTMLButtonElement>(
		document,
		"#standing-intent-dialog-close",
	).addEventListener("click", () => intentDialog.close());
	required<HTMLButtonElement>(document, "#automation-refresh").addEventListener(
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
			if (refreshTimer === undefined)
				refreshTimer = window.setInterval(() => void reload(), 2_000);
			required<HTMLElement>(document, "#automation-title").focus();
		},
		close: () => {
			if (section.hidden) return;
			section.hidden = true;
			navigation.setAttribute("aria-expanded", "false");
			mobileNavigation.setAttribute("aria-expanded", "false");
			if (refreshTimer !== undefined) {
				window.clearInterval(refreshTimer);
				refreshTimer = undefined;
			}
			setWorkspaceVisible(false);
			(window.matchMedia("(max-width: 620px)").matches
				? mobileNavigation
				: navigation
			).focus();
		},
	};
}
