import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { AgentMeHost } from "../../apps/host/src/server.js";
import {
	SpokenConversationRouter,
	type VoiceRouteSelection,
} from "../../packages/voice-runtime/src/index.js";

const token = "voice-route-equivalence-token-000000001";
const directories: string[] = [];
const hosts: AgentMeHost[] = [];

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.stop()));
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("voice route equivalence", () => {
	it.each([
		["local", "voice-local"],
		["aliyun", "voice-aliyun"],
	] as const)(
		"creates the same supervisor task through the %s route",
		async (route: VoiceRouteSelection, expectedProviderId: string) => {
			const directory = await mkdtemp(join(tmpdir(), "agentme-voice-route-"));
			directories.push(directory);
			const provider = (id: string) => ({
				id,
				transcribe: async () => "检查项目测试",
				synthesize: async () => ({
					mimeType: "audio/wav" as const,
					audioBase64: "UklGRg==",
				}),
			});
			const host = new AgentMeHost({
				databasePath: join(directory, "agentme.sqlite"),
				authToken: token,
				voice: new SpokenConversationRouter({
					local: provider("voice-local"),
					aliyun: provider("voice-aliyun"),
				}),
			});
			await host.start(0);
			hosts.push(host);

			const response = await fetch(`${host.url}/assistant/voice/messages`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					audioBase64: "UklGRg==",
					mimeType: "audio/wav",
					route,
					repositoryId: "fake",
					runtimeId: "runtime-fake",
				}),
			});

			expect(response.status).toBe(202);
			const result = (await response.json()) as { parentId: string };
			expect(result).toMatchObject({
				transcript: "检查项目测试",
				voice: { providerId: expectedProviderId, fallbackUsed: false },
			});
			const tree = await fetch(
				`${host.url}/assistant/parents/${result.parentId}`,
				{ headers: { authorization: `Bearer ${token}` } },
			);
			expect(await tree.json()).toMatchObject({
				children: [
					{
						request: {
							instruction: "检查项目测试",
							repositoryId: "fake",
						},
					},
				],
			});
		},
	);
});
