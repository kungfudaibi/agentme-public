import { resolve } from "node:path";

import { expect, it } from "vitest";

import { createPlatformSecretStore } from "../../packages/platform-runtime/src/index.js";
import { DeepSeekAssistantModel } from "../../plugins/model-deepseek/src/index.js";

const smoke = process.env.AGENTME_DEEPSEEK_SMOKE === "1" ? it : it.skip;

smoke(
	"calls DeepSeek without recording prompts, responses or credentials",
	async () => {
		const modelName = "deepseek-v4-flash";
		const model = new DeepSeekAssistantModel(
			{
				endpoint: "https://api.deepseek.com/chat/completions",
				model: modelName,
				secret: { type: "secret-reference", id: "deepseek-api-key" },
				timeoutMs: 60_000,
			},
			{
				secretStore: createPlatformSecretStore({
					dataDirectory: resolve(
						process.env.AGENTME_SECRET_DIRECTORY ??
							resolve(process.cwd(), ".agentme", "secrets"),
					),
				}),
			},
		);
		let summary = {
			provider: "deepseek",
			model: modelName,
			status: "failed",
			inputTokens: 0,
			outputTokens: 0,
		};
		for await (const event of model.converse(
			{
				sessionId: "deepseek-smoke",
				messages: [{ role: "user", content: "只回复 OK" }],
				allowedRepositoryIds: ["agentme"],
				allowedRuntimeIds: ["runtime-codex"],
			},
			new AbortController().signal,
		)) {
			if (event.type === "assistant.response.failed") throw event.error;
			if (event.type === "assistant.response.completed") {
				summary = {
					...summary,
					status: "ok",
					inputTokens: event.usage?.inputTokens ?? 0,
					outputTokens: event.usage?.outputTokens ?? 0,
				};
			}
		}

		process.stdout.write(`${JSON.stringify(summary)}\n`);
		expect(summary).toMatchObject({ provider: "deepseek", status: "ok" });
		expect(summary.inputTokens).toBeGreaterThan(0);
		expect(summary.outputTokens).toBeGreaterThan(0);
	},
);
