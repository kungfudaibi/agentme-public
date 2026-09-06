import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
	FreeModelService,
	parseFreeModels,
	verifyVoiceOffers,
	voiceOffers,
} from "../src/free-models.js";

it("refreshes voice trial evidence only when current official rows still support it", () => {
	const pricing =
		"<table>免费额度 90天 北京 <tr><td>qwen-audio-3.0-asr-flash</td><td>0.1元</td><td>36,000秒（10小时）</td></tr><tr><td>qwen-audio-3.0-tts-flash</td><td>1元</td><td>1万字符</td></tr></table>";
	const quota =
		"仅华北2（北京）地域模型享有免费额度，90 天，ASR 类模型需开通权限，免费额度用完即停";
	expect(
		verifyVoiceOffers(pricing, quota, "2026-09-07T00:00:00Z").every(
			(v) =>
				v.checkedAt === "2026-09-07T00:00:00Z" && v.verification === "verified",
		),
	).toBe(true);
	expect(
		verifyVoiceOffers(
			pricing.replace("1万字符", "无免费额度"),
			quota,
			"2026-09-07T00:00:00Z",
		)[1]?.verification,
	).toBe("needs-review");
});

const catalog = {
	data: [
		{
			id: "test/small:free",
			name: "Small",
			pricing: { prompt: "0", completion: "0", request: "0" },
			architecture: { input_modalities: ["text"], output_modalities: ["text"] },
			supported_parameters: [],
			context_length: 8192,
		},
		{
			id: "paid/model",
			name: "Paid",
			pricing: { prompt: "0.01", completion: "0" },
			architecture: { input_modalities: ["text"], output_modalities: ["text"] },
		},
	],
};
it("discovers zero-price text capabilities without calling a paid or incompatible model", () => {
	expect(parseFreeModels(catalog, "2026-09-06T00:00:00Z")).toMatchObject([
		{
			id: "test/small:free",
			offer: "zero-price",
			capabilities: ["text"],
			remaining: null,
		},
	]);
	expect(
		parseFreeModels(
			{
				data: [
					{
						...catalog.data[0],
						pricing: { prompt: "0", completion: "0", request: "1" },
					},
				],
			},
			"2026-09-06T00:00:00Z",
		),
	).toEqual([]);
});
it("keeps voice trial eligibility separate from unknown account balances", () => {
	expect(voiceOffers.map((v) => v.capabilities[0])).toEqual(["stt", "tts"]);
	expect(
		voiceOffers.every(
			(v) =>
				v.offer === "trial" &&
				v.remaining === null &&
				v.region.includes("北京") &&
				v.conditions.includes("90"),
		),
	).toBe(true);
});
it("does not activate on refresh, stores only references and enforces zero-price inference", async () => {
	const path = join(
		mkdtempSync(join(tmpdir(), "free-models-")),
		"settings.json",
	);
	const secrets = new Map<string, string>();
	const bodies: unknown[] = [];
	const service = new FreeModelService(path, {
		secrets: {
			get: async (r) => secrets.get(r.id) ?? "",
			set: async (r, v) => {
				secrets.set(r.id, v);
			},
			delete: async (r) => {
				secrets.delete(r.id);
			},
		},
		fetch: async (url, init) => {
			if (String(url).endsWith("/models")) return Response.json(catalog);
			if (String(url).endsWith(".md"))
				return new Response("未提供官方文档测试样本");
			bodies.push(JSON.parse(String(init?.body)));
			return Response.json({ choices: [{ message: { content: "hello" } }] });
		},
	});
	await service.refresh(new AbortController().signal);
	expect(service.view().enabled).toBe(false);
	await service.configure(
		{
			enabled: true,
			modelId: "test/small:free",
			apiKey: "private-test-key",
			automatic: false,
			actions: "chat-only",
		},
		new AbortController().signal,
	);
	expect(readFileSync(path, "utf8")).not.toContain("private-test-key");
	expect(
		await service.respond(
			[{ role: "user", content: "hi" }],
			new AbortController().signal,
		),
	).toBe("hello");
	expect(bodies[0]).toMatchObject({
		model: "test/small:free",
		provider: { max_price: { prompt: 0, completion: 0, request: 0 } },
		max_tokens: 2048,
	});
	await expect(
		service.configure(
			{
				enabled: true,
				modelId: "paid/model",
				automatic: false,
				actions: "structured",
			},
			new AbortController().signal,
		),
	).rejects.toThrow();
});
