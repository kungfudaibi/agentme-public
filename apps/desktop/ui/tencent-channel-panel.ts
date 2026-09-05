import {
	buildTencentChannelConfiguration,
	parseTencentChannelView,
	type TencentChannelView,
} from "./tencent-channel-state.js";

export interface TencentChannelPanel {
	load(): Promise<void>;
	open(): Promise<void>;
	close(): void;
}

function requiredElement<T extends Element>(
	document: Document,
	selector: string,
): T {
	const value = document.querySelector<T>(selector);
	if (value === null)
		throw new Error(`Missing Tencent channel element: ${selector}`);
	return value;
}

function statusText(view: TencentChannelView): string {
	if (view.status === "running") return "运行中";
	if (view.status === "starting") return "连接中";
	if (view.status === "error") return "连接失败";
	return view.isConfigured ? "已停用" : "待配置";
}

export function createTencentChannelPanel(dependencies: {
	readonly document: Document;
	readonly request: (path: string, init?: RequestInit) => Promise<Response>;
	readonly notify: (message: string) => void;
}): TencentChannelPanel {
	const { document, request, notify } = dependencies;
	const button = requiredElement<HTMLButtonElement>(
		document,
		"#tencent-channel",
	);
	const summary = requiredElement<HTMLElement>(
		document,
		"#tencent-channel-summary",
	);
	const dialog = requiredElement<HTMLDialogElement>(
		document,
		"#tencent-channel-dialog",
	);
	const form = requiredElement<HTMLFormElement>(
		document,
		"#tencent-channel-form",
	);
	const enabled = requiredElement<HTMLInputElement>(
		document,
		"#tencent-channel-enabled",
	);
	const ownerId = requiredElement<HTMLInputElement>(
		document,
		"#tencent-owner-id",
	);
	const accountId = requiredElement<HTMLInputElement>(
		document,
		"#tencent-account-id",
	);
	const appId = requiredElement<HTMLInputElement>(document, "#tencent-app-id");
	const appSecret = requiredElement<HTMLInputElement>(
		document,
		"#tencent-app-secret",
	);
	appId.type = "password";
	appSecret.type = "password";
	const health = requiredElement<HTMLElement>(
		document,
		"#tencent-channel-health",
	);
	const save = requiredElement<HTMLButtonElement>(
		document,
		"#tencent-channel-save",
	);

	function render(view: TencentChannelView): void {
		enabled.checked = view.isEnabled;
		ownerId.value = view.ownerId;
		accountId.value = view.accountId;
		appId.value = "";
		appSecret.value = "";
		appId.placeholder = view.isConfigured
			? "留空以保留当前 App ID"
			: "输入 App ID";
		appSecret.placeholder = view.isConfigured
			? "留空以保留当前 App Secret"
			: "输入 App Secret";
		const status = statusText(view);
		summary.textContent = status;
		health.textContent = `${status} · ${
			view.isConfigured ? "凭据已受保护" : "缺少凭据"
		}`;
		button.classList.toggle("configured", view.status === "running");
		ownerId.required = enabled.checked;
	}

	enabled.addEventListener("change", () => {
		ownerId.required = enabled.checked;
	});
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		save.disabled = true;
		try {
			const response = await request("/channels/tencent-qq", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(
					buildTencentChannelConfiguration({
						isEnabled: enabled.checked,
						ownerId: ownerId.value,
						accountId: accountId.value,
						appId: appId.value,
						appSecret: appSecret.value,
					}),
				),
			});
			render(parseTencentChannelView(await response.json()));
			notify(enabled.checked ? "QQ 通道配置已保存并启动" : "QQ 通道已停用");
		} catch (error) {
			notify(error instanceof Error ? error.message : "QQ 通道配置保存失败");
		} finally {
			save.disabled = false;
		}
	});

	async function load(): Promise<void> {
		const response = await request("/channels/tencent-qq");
		render(parseTencentChannelView(await response.json()));
	}

	return {
		load,
		open: async () => {
			await load();
			dialog.showModal();
			ownerId.focus();
		},
		close: () => dialog.close(),
	};
}
