import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
	invalid,
	object,
	text,
} from "../../../packages/conversation-hub/src/storage.js";
import type { ModelPolicy } from "../../../packages/conversation-hub/src/types.js";
import type { SecretStore } from "../../../packages/platform-runtime/src/index.js";

export interface ModelOffer {
	id: string;
	name: string;
	provider: "openrouter" | "aliyun";
	capabilities: ("text" | "tools" | "structured" | "stt" | "tts")[];
	offer: "zero-price" | "free-tier" | "trial";
	source: string;
	checkedAt: string;
	auth: string;
	region: string;
	conditions: string;
	remaining: null;
	contextCharacters?: number;
	verification?: "verified" | "needs-review";
}
const quotaSource = "https://help.aliyun.com/zh/model-studio/new-free-quota";
export const voiceOffers: readonly ModelOffer[] = [
	{
		id: "qwen-audio-3.0-asr-flash",
		name: "阿里云语音识别",
		provider: "aliyun",
		capabilities: ["stt"],
		offer: "trial",
		source: "https://help.aliyun.com/zh/model-studio/model-pricing",
		checkedAt: "2026-09-06T00:00:00Z",
		auth: "自己的百炼通用 API Key；业务空间中开通 ASR 权限",
		region: "华北2（北京）；新加坡无此新人额度",
		conditions: `新人额度 36,000 秒，90 天有效。实际资格/剩余额度/到期日以账户为准。${quotaSource}`,
		remaining: null,
	},
	{
		id: "qwen-audio-3.0-tts-flash",
		name: "阿里云语音合成",
		provider: "aliyun",
		capabilities: ["tts"],
		offer: "trial",
		source: "https://help.aliyun.com/zh/model-studio/model-pricing",
		checkedAt: "2026-09-06T00:00:00Z",
		auth: "自己的百炼通用 API Key；匹配地域的业务空间",
		region: "华北2（北京）；新加坡无此新人额度",
		conditions: `新人额度 10,000 字符，90 天有效。已认证账户须在官方控制台核实“免费额度用完即停”；不会替你修改语音配置。${quotaSource}`,
		remaining: null,
	},
];
export function verifyVoiceOffers(
	pricing: string,
	quota: string,
	checkedAt: string,
): ModelOffer[] {
	const rules = quota.replace(/<[^>]*>/gu, " ");
	const scope =
		/仅[^\n]{0,50}北京[^\n]{0,50}免费额度/u.test(rules) &&
		/90\s*天/u.test(rules) &&
		rules.includes("免费额度用完即停") &&
		rules.includes("ASR");
	const rows = [...pricing.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].map(
		(match) =>
			[...(match[1] ?? "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/giu)].map(
				(cell) => (cell[1] ?? "").replace(/<[^>]*>/gu, "").trim(),
			),
	);
	return voiceOffers.map((offer) => {
		const amount = offer.capabilities[0] === "stt" ? "36,000秒" : "1万字符";
		const verified =
			scope &&
			rows.some((row) => row[0] === offer.id && row.at(-1)?.includes(amount));
		return {
			...offer,
			checkedAt: verified ? checkedAt : offer.checkedAt,
			verification: verified ? "verified" : "needs-review",
		};
	});
}
const modelsUrl = "https://openrouter.ai/api/v1/models";
const secret = { type: "secret-reference" as const, id: "openrouter-api-key" };
const ttl = 24 * 60 * 60 * 1000;
function zero(value: unknown) {
	return (
		(typeof value === "number" ||
			(typeof value === "string" && /^0(?:\.0+)?$/u.test(value))) &&
		Number(value) === 0
	);
}
export function parseFreeModels(
	value: unknown,
	checkedAt: string,
): ModelOffer[] {
	const raw = object(value);
	if (!Array.isArray(raw.data) || raw.data.length > 5000)
		invalid("官方模型目录格式不符");
	const result: ModelOffer[] = [];
	for (const item of raw.data) {
		try {
			const v = object(item);
			const id = text(v.id, 200);
			const pricing = object(v.pricing);
			const architecture = object(v.architecture);
			if (
				!id.endsWith(":free") ||
				!zero(pricing.prompt) ||
				!zero(pricing.completion) ||
				Object.values(pricing).some((p) => !zero(p)) ||
				!Array.isArray(architecture.input_modalities) ||
				!architecture.input_modalities.includes("text") ||
				!Array.isArray(architecture.output_modalities) ||
				!architecture.output_modalities.includes("text")
			)
				continue;
			const params = Array.isArray(v.supported_parameters)
				? v.supported_parameters
				: [];
			result.push({
				id,
				name: text(v.name, 200),
				provider: "openrouter",
				capabilities: [
					"text",
					...(params.includes("tools") ? ["tools" as const] : []),
					...(params.includes("structured_outputs") ||
					params.includes("response_format")
						? ["structured" as const]
						: []),
				],
				offer: "zero-price",
				source: modelsUrl,
				checkedAt,
				auth: "自己的 OpenRouter API Key；目录读取无需 Key",
				region: "依账户及上游地区可用性",
				conditions:
					"免费变体可能限流/下线；免费账户通常共50次/天、20次/分钟。不会回退付费模型。规则：https://openrouter.ai/docs/faq",
				remaining: null,
				contextCharacters: Math.max(
					4000,
					Math.min(
						10000,
						typeof v.context_length === "number"
							? Math.floor(v.context_length / 2)
							: 4000,
					),
				),
			});
		} catch {
			/* Invalid entries never become executable offers. */
		}
	}
	return result.slice(0, 200);
}
async function boundedResponse(
	response: Response,
	maximum = 2 * 1024 * 1024,
): Promise<string> {
	if (!response.ok || !response.body)
		throw new Error(`官方服务请求失败 (${response.status})`);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > maximum) throw new Error("官方响应超过大小限制");
			chunks.push(value);
		}
		return Buffer.concat(chunks).toString("utf8");
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}
interface Preferences {
	enabled: boolean;
	automatic: boolean;
	modelId: string;
	actions: ModelPolicy["actions"];
}
export class FreeModelService {
	#preferences: Preferences = {
		enabled: false,
		automatic: false,
		modelId: "",
		actions: "chat-only",
	};
	#models: ModelOffer[] = [];
	#voice: ModelOffer[] = voiceOffers.map((v) => ({
		...v,
		verification: "verified",
	}));
	#checkedAt = "";
	#refreshing: Promise<void> | undefined;
	constructor(
		readonly path: string,
		readonly dependencies: { secrets: SecretStore; fetch?: typeof fetch },
	) {
		try {
			if (statSync(path).size > 1024 * 1024) invalid("模型设置过大");
			const saved = object(JSON.parse(readFileSync(path, "utf8")));
			this.#preferences = this.#parsePreferences(
				saved.preferences,
			); /* Saved metadata is not authority for inference; refresh before use. */
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	#parsePreferences(value: unknown): Preferences {
		const p = object(value);
		if (
			Object.keys(p).some(
				(k) => !["enabled", "automatic", "modelId", "actions"].includes(k),
			) ||
			typeof p.enabled !== "boolean" ||
			typeof p.automatic !== "boolean" ||
			!["chat-only", "structured"].includes(text(p.actions, 20)) ||
			typeof p.modelId !== "string" ||
			p.modelId.length > 200
		)
			invalid();
		return p as unknown as Preferences;
	}
	view() {
		return {
			...this.#preferences,
			checkedAt: this.#checkedAt,
			models: structuredClone(this.#models),
			voiceOffers: structuredClone(this.#voice),
			quotaRemaining: null,
		};
	}
	get enabled() {
		return this.#preferences.enabled;
	}
	policy(): ModelPolicy {
		const model = this.#models.find((m) => m.id === this.#preferences.modelId);
		return {
			actions:
				this.#preferences.actions === "structured" &&
				model?.capabilities.includes("structured")
					? "structured"
					: "chat-only",
			contextCharacters: model?.contextCharacters ?? 4000,
		};
	}
	#save() {
		mkdirSync(dirname(this.path), { recursive: true });
		const temp = `${this.path}.${randomUUID()}.tmp`;
		try {
			writeFileSync(
				temp,
				JSON.stringify({ version: 1, preferences: this.#preferences }),
				{ mode: 0o600 },
			);
			renameSync(temp, this.path);
		} finally {
			rmSync(temp, { force: true });
		}
	}
	async refresh(signal: AbortSignal): Promise<void> {
		if (this.#refreshing) return this.#refreshing;
		this.#refreshing = (async () => {
			const response = await (this.dependencies.fetch ?? fetch)(modelsUrl, {
				signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
				redirect: "error",
			});
			const models = parseFreeModels(
				JSON.parse(await boundedResponse(response)),
				new Date().toISOString(),
			);
			signal.throwIfAborted();
			try {
				const docs = await Promise.all(
					[
						"https://help.aliyun.com/zh/model-studio/model-pricing.md",
						"https://help.aliyun.com/zh/model-studio/new-free-quota.md",
					].map(async (url) =>
						boundedResponse(
							await (this.dependencies.fetch ?? fetch)(url, {
								signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
								redirect: "error",
							}),
						),
					),
				);
				this.#voice = verifyVoiceOffers(
					docs[0] ?? "",
					docs[1] ?? "",
					new Date().toISOString(),
				);
			} catch {
				this.#voice = this.#voice.map((v) => ({
					...v,
					verification: "needs-review",
				}));
			}
			signal.throwIfAborted();
			this.#models = models;
			this.#checkedAt = new Date().toISOString();
		})();
		try {
			await this.#refreshing;
		} finally {
			this.#refreshing = undefined;
		}
	}
	async refreshIfEnabled(signal: AbortSignal) {
		if (
			this.#preferences.automatic &&
			(!this.#checkedAt || Date.now() - Date.parse(this.#checkedAt) > ttl)
		)
			await this.refresh(signal);
	}
	async configure(value: unknown, signal: AbortSignal) {
		const input = object(value);
		if (
			Object.keys(input).some(
				(k) =>
					!["enabled", "automatic", "modelId", "actions", "apiKey"].includes(k),
			)
		)
			invalid();
		const { apiKey, ...raw } = input;
		const preferences = this.#parsePreferences(raw);
		if (preferences.enabled) {
			if (!this.#checkedAt || Date.now() - Date.parse(this.#checkedAt) > ttl)
				await this.refresh(signal);
			if (!this.#models.some((m) => m.id === preferences.modelId))
				invalid("仅可启用官方目录中的免费文本变体");
		}
		if (apiKey !== undefined)
			await this.dependencies.secrets.set(secret, text(apiKey, 4096), signal);
		if (
			preferences.enabled &&
			!(await this.dependencies.secrets.get(secret, signal))
		)
			invalid("请配置自己的 API Key");
		signal.throwIfAborted();
		this.#preferences = preferences;
		this.#save();
	}
	async respond(
		messages: readonly {
			role: "system" | "user" | "assistant";
			content: string;
		}[],
		signal: AbortSignal,
	): Promise<string> {
		if (!this.enabled) invalid("免费模型尚未启用");
		if (!this.#checkedAt || Date.now() - Date.parse(this.#checkedAt) > ttl)
			await this.refresh(signal);
		const id = this.#preferences.modelId;
		if (!this.#models.some((m) => m.id === id))
			invalid("所选免费模型已不可用，请重新选择");
		if (JSON.stringify(messages).length > 32000)
			invalid("免费模型上下文超过本次上限，请缩短材料");
		const key = await this.dependencies.secrets.get(secret, signal);
		const response = await (this.dependencies.fetch ?? fetch)(
			"https://openrouter.ai/api/v1/chat/completions",
			{
				method: "POST",
				redirect: "error",
				signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
				headers: {
					authorization: `Bearer ${key}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					model: id,
					messages,
					stream: false,
					max_tokens: 2048,
					provider: {
						max_price: { prompt: 0, completion: 0, request: 0 },
						allow_fallbacks: false,
					},
				}),
			},
		);
		const body = object(JSON.parse(await boundedResponse(response)));
		if (!Array.isArray(body.choices)) invalid("模型未返回文本");
		const choice = object(body.choices[0]);
		return text(object(choice.message).content, 24000);
	}
}
