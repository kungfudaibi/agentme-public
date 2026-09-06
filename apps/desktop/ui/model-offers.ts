import type {
	FreeModelService,
	ModelOffer,
} from "../../host/src/free-models.js";
import { officeRequest } from "./office-connection.js";
import { escapeOfficeText as esc } from "./office-markdown.js";

type View = ReturnType<FreeModelService["view"]>;
let dialog: HTMLDialogElement | undefined;
function offerCard(offer: ModelOffer) {
	return `<article class="c-offer"><header><strong>${esc(offer.name)}</strong><span>${offer.offer === "zero-price" ? "零单价" : offer.offer === "trial" ? "限期试用" : "免费层"}</span></header><code>${esc(offer.id)}</code><p>${esc(offer.capabilities.join(" · "))}</p><p>${esc(offer.region)}</p><p>${esc(offer.auth)}</p><p>${esc(offer.conditions)}</p><footer>${offer.verification === "needs-review" ? "官方条件有变化或未能刷新，须重新核实 · " : ""}账户余量：未知 · 核实日期 ${esc(offer.checkedAt.slice(0, 10))} · <a href="${esc(offer.source)}" target="_blank" rel="noopener noreferrer">官方来源 ↗</a></footer></article>`;
}
async function request(path: string, body?: unknown): Promise<View> {
	return (
		await officeRequest(
			path,
			body === undefined
				? {}
				: {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					},
		)
	).json() as Promise<View>;
}
export async function openModelOffers() {
	if (!dialog) {
		dialog = document.createElement("dialog");
		dialog.id = "c-model-dialog";
		dialog.setAttribute("aria-label", "模型与免费额度");
		document.body.append(dialog);
	}
	const panel = dialog;
	panel.innerHTML = "<p>正在读取模型设置…</p>";
	panel.showModal();
	const render = (view: View) => {
		panel.innerHTML = `<header class="c-dialog-header"><div><small>CAPABILITIES & MODELS</small><h2>按能力选择模型</h2><p>发现新选项不会改变正在使用的服务。</p></div><button type="button" id="c-model-close" aria-label="关闭模型设置">×</button></header><section><h3>文本对话 · 结构化操作</h3><p>使用现有 DeepSeek / 阿里云配置，或用自己的 Key 启用免费文本模型。工具能力只是供应商声明，操作仍经过本机校验。</p><form id="c-model-form"><label><input type="checkbox" id="c-free-enabled" ${view.enabled ? "checked" : ""}> 为主对话和办公任务启用下列免费文本模型</label><label>模型<select id="c-free-model"><option value="">先刷新官方目录</option>${view.models.map((m) => `<option value="${esc(m.id)}" ${m.id === view.modelId ? "selected" : ""}>${esc(m.name)} · ${m.capabilities.includes("structured") ? "结构化输出" : "普通文本"}</option>`).join("")}</select></label><label>OpenRouter API Key<input id="c-free-key" type="password" autocomplete="off" placeholder="留空保留已保存的 Key"></label><label>操作适配<select id="c-free-actions"><option value="chat-only" ${view.actions === "chat-only" ? "selected" : ""}>稳妥模式：普通对话，手动选择任务</option><option value="structured" ${view.actions === "structured" ? "selected" : ""}>尝试结构化理解（不支持时自动降级）</option></select></label><label><input id="c-free-auto" type="checkbox" ${view.automatic ? "checked" : ""}> 打开目录时自动检查更新（24 小时缓存）</label><div class="c-dialog-actions"><button type="button" id="c-refresh-offers">刷新官方目录</button><button type="submit">保存选择</button></div></form><p id="c-offer-notice" role="status">目录更新时间：${view.checkedAt ? esc(view.checkedAt) : "尚未刷新"}；剩余额度未知。</p><details><summary>查看免费文本候选（${view.models.length}）</summary>${view.models.map(offerCard).join("")}</details></section><section><h3>语音识别 STT · 语音合成 TTS</h3><p>继续使用现有阿里云 / 本地语音路由。以下为已核实的官方试用条件，不代表你的账号仍有额度；这里不会自动更换语音模型。</p>${view.voiceOffers.map(offerCard).join("")}<p><a href="https://help.aliyun.com/zh/model-studio/new-free-quota" target="_blank" rel="noopener noreferrer">核对资格、到期日与用完即停 ↗</a></p><details><summary>现有语音配置方式</summary><p>原有语音面板仍可选择 auto、local、aliyun。阿里云使用当前业务空间地址和 aliyun-api-key；ASR 与 TTS 模型分别由 AGENTME_ALIYUN_ASR_MODEL / AGENTME_ALIYUN_TTS_MODEL 配置，修改后重启后台生效。</p><p>目录中的 90 天起算点是开通百炼、模型发布或申请通过中较晚者。当前没有接入账户额度查询，不能显示“无限免费”。</p></details></section>`;
		panel
			.querySelector("#c-model-close")
			?.addEventListener("click", () => panel.close());
		const message = (value: string) => {
			const notice = panel.querySelector("#c-offer-notice");
			if (notice) notice.textContent = value;
		};
		panel.querySelector("#c-refresh-offers")?.addEventListener("click", () => {
			message("正在向官方目录核实…");
			void request("/model-offers/refresh", {})
				.then(render)
				.catch((error) =>
					message(error instanceof Error ? error.message : "刷新失败"),
				);
		});
		panel
			.querySelector("#c-model-form")
			?.addEventListener("submit", (event) => {
				event.preventDefault();
				const field = <T extends HTMLInputElement | HTMLSelectElement>(
					id: string,
				) => {
					const node = panel.querySelector<T>(`#${id}`);
					if (!node) throw new Error("设置控件不可用");
					return node;
				};
				const apiKey = field<HTMLInputElement>("c-free-key").value;
				message("正在保存…");
				void request("/model-offers/settings", {
					enabled: field<HTMLInputElement>("c-free-enabled").checked,
					automatic: field<HTMLInputElement>("c-free-auto").checked,
					modelId: field<HTMLSelectElement>("c-free-model").value,
					actions: field<HTMLSelectElement>("c-free-actions").value,
					...(apiKey ? { apiKey } : {}),
				})
					.then((view) => {
						render(view);
						message("已保存。语音供应商保持原配置。");
					})
					.catch((error) =>
						message(error instanceof Error ? error.message : "保存失败"),
					);
			});
	};
	try {
		render(await request("/model-offers"));
	} catch (error) {
		panel.innerHTML = `<h2>模型目录暂不可用</h2><p>${esc(error instanceof Error ? error.message : "请检查本地服务")}</p><button id="c-model-close">关闭</button>`;
		panel
			.querySelector("button")
			?.addEventListener("click", () => panel.close());
	}
}
