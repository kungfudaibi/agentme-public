import {
	buildCodingPermissionActivation,
	type CodingPermissionCatalog,
	type CodingPermissionProfile,
	parseCodingPermissionCatalog,
} from "./coding-permission-state.js";
import {
	buildProviderConfiguration,
	type ProviderCatalog,
	type ProviderProfile,
	parseProviderCatalog,
} from "./provider-state.js";

export interface ProviderPanelDependencies {
	readonly document: Document;
	readonly request: (path: string, init?: RequestInit) => Promise<Response>;
	readonly notify: (message: string) => void;
}

export interface ProviderPanel {
	load(): Promise<void>;
	open(): Promise<void>;
	close(): void;
}

function requiredElement<T extends Element>(
	document: Document,
	selector: string,
): T {
	const value = document.querySelector<T>(selector);
	if (value === null) throw new Error(`Missing provider element: ${selector}`);
	return value;
}

function textNode(
	document: Document,
	tag: string,
	text: string,
	className?: string,
): HTMLElement {
	const node = document.createElement(tag);
	node.textContent = text;
	if (className !== undefined) node.className = className;
	return node;
}

export function createProviderPanel(
	dependencies: ProviderPanelDependencies,
): ProviderPanel {
	const { document, request, notify } = dependencies;
	const button = requiredElement<HTMLButtonElement>(document, "#providers");
	const summary = requiredElement<HTMLElement>(document, "#provider-summary");
	const dialog = requiredElement<HTMLDialogElement>(
		document,
		"#provider-dialog",
	);
	const list = requiredElement<HTMLElement>(document, "#provider-list");
	const permissionList = requiredElement<HTMLElement>(
		document,
		"#coding-permission-list",
	);
	const permissionSummary = requiredElement<HTMLElement>(
		document,
		"#coding-permission-summary",
	);

	function field(labelText: string, input: HTMLInputElement): HTMLElement {
		const label = document.createElement("label");
		label.append(textNode(document, "span", labelText), input);
		return label;
	}

	function renderCard(profile: ProviderProfile): HTMLElement {
		const card = document.createElement("form");
		card.className = `provider-card${profile.isActive ? " active" : ""}`;
		const heading = document.createElement("div");
		heading.className = "provider-card-heading";
		const identity = document.createElement("div");
		identity.append(
			textNode(document, "strong", profile.name),
			textNode(document, "small", profile.id),
		);
		heading.append(
			identity,
			textNode(
				document,
				"span",
				profile.isActive
					? "当前启用"
					: profile.isConfigured
						? "已配置"
						: "缺少密钥",
				`provider-health ${profile.health}`,
			),
		);
		const endpoint = document.createElement("input");
		endpoint.type = "url";
		endpoint.name = "endpoint";
		endpoint.required = true;
		endpoint.maxLength = 2_048;
		endpoint.value = profile.endpoint;
		endpoint.autocomplete = "off";
		const model = document.createElement("input");
		model.type = "text";
		model.name = "model";
		model.required = true;
		model.maxLength = 128;
		model.value = profile.model;
		model.autocomplete = "off";
		const apiKey = document.createElement("input");
		apiKey.type = "password";
		apiKey.name = "apiKey";
		apiKey.placeholder = profile.isConfigured
			? "留空以保留当前密钥"
			: "输入 API Key";
		apiKey.autocomplete = "new-password";
		const actions = document.createElement("div");
		actions.className = "provider-actions";
		const save = textNode(document, "button", "保存配置", "provider-save");
		save.setAttribute("type", "submit");
		const activate = textNode(
			document,
			"button",
			profile.isActive ? "正在使用" : "切换到此 API",
			"provider-activate",
		);
		activate.setAttribute("type", "button");
		if (profile.isActive) activate.setAttribute("disabled", "");
		actions.append(save, activate);
		card.append(
			heading,
			field("API 端点", endpoint),
			field("模型", model),
			field("API Key", apiKey),
			actions,
		);
		card.addEventListener("submit", async (event) => {
			event.preventDefault();
			save.setAttribute("disabled", "");
			try {
				const response = await request(
					`/assistant/providers/${profile.id}/configure`,
					{
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(
							buildProviderConfiguration({
								endpoint: endpoint.value,
								model: model.value,
								apiKey: apiKey.value,
							}),
						),
					},
				);
				render(parseProviderCatalog(await response.json()));
				notify(`${profile.name} 配置已保存`);
			} catch (error) {
				notify(error instanceof Error ? error.message : "API 配置保存失败");
			} finally {
				save.removeAttribute("disabled");
			}
		});
		activate.addEventListener("click", async () => {
			activate.setAttribute("disabled", "");
			try {
				const response = await request(
					`/assistant/providers/${profile.id}/activate`,
					{ method: "POST" },
				);
				render(parseProviderCatalog(await response.json()));
				notify(`主 Agent 已切换到 ${profile.name}`);
			} catch (error) {
				notify(error instanceof Error ? error.message : "API 切换失败");
			} finally {
				activate.removeAttribute("disabled");
			}
		});
		return card;
	}

	function render(catalog: ProviderCatalog): void {
		list.replaceChildren(...catalog.profiles.map(renderCard));
		const active = catalog.profiles.find(({ isActive }) => isActive);
		summary.textContent = active?.name ?? catalog.activeProfileId;
		button.classList.toggle("configured", active?.isConfigured === true);
	}

	function renderPermissionCard(profile: CodingPermissionProfile): HTMLElement {
		const card = document.createElement("section");
		card.className = `provider-card permission-card${profile.isActive ? " active" : ""}`;
		const heading = document.createElement("div");
		heading.className = "provider-card-heading";
		const identity = document.createElement("div");
		identity.append(
			textNode(document, "strong", profile.name),
			textNode(
				document,
				"small",
				`--sandbox ${profile.sandboxMode} · --ask-for-approval ${profile.approvalPolicy}`,
			),
		);
		heading.append(
			identity,
			textNode(
				document,
				"span",
				profile.isActive ? "当前启用" : "可切换",
				`provider-health ${profile.isActive ? "ready" : ""}`,
			),
		);
		const warning = textNode(
			document,
			"p",
			profile.warning,
			profile.requiresExplicitApproval
				? "permission-warning danger"
				: "permission-warning",
		);
		const actions = document.createElement("div");
		actions.className = "provider-actions permission-actions";
		let acknowledgement: HTMLInputElement | undefined;
		if (profile.requiresExplicitApproval) {
			const label = document.createElement("label");
			label.className = "permission-acknowledgement";
			acknowledgement = document.createElement("input");
			acknowledgement.type = "checkbox";
			label.append(
				acknowledgement,
				textNode(document, "span", "我确认允许访问工作树之外的文件和网络"),
			);
			actions.append(label);
		}
		const activate = textNode(
			document,
			"button",
			profile.isActive ? "正在使用" : "切换到此权限",
			"provider-activate",
		);
		activate.setAttribute("type", "button");
		if (profile.isActive) activate.setAttribute("disabled", "");
		actions.append(activate);
		activate.addEventListener("click", async () => {
			activate.setAttribute("disabled", "");
			try {
				const response = await request("/coding/permissions/activate", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(
						buildCodingPermissionActivation(
							profile.id,
							acknowledgement?.checked ?? false,
						),
					),
				});
				renderPermissions(parseCodingPermissionCatalog(await response.json()));
				notify(`编码 Agent 已切换到${profile.name}`);
			} catch (error) {
				notify(error instanceof Error ? error.message : "编码权限切换失败");
			} finally {
				activate.removeAttribute("disabled");
			}
		});
		card.append(heading, warning, actions);
		return card;
	}

	function renderPermissions(catalog: CodingPermissionCatalog): void {
		permissionList.replaceChildren(
			...catalog.profiles.map(renderPermissionCard),
		);
		const active = catalog.profiles.find(({ isActive }) => isActive);
		permissionSummary.textContent = active?.name ?? catalog.activeProfileId;
	}

	async function load(): Promise<void> {
		try {
			const [providerResponse, permissionResponse] = await Promise.all([
				request("/assistant/providers"),
				request("/coding/permissions"),
			]);
			render(parseProviderCatalog(await providerResponse.json()));
			renderPermissions(
				parseCodingPermissionCatalog(await permissionResponse.json()),
			);
		} catch (error) {
			summary.textContent = "不可用";
			throw error;
		}
	}

	return {
		load,
		open: async () => {
			await load();
			dialog.showModal();
		},
		close: () => dialog.close(),
	};
}
