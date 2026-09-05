import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AgentMeHost } from "../../apps/host/src/server.js";

it.each(["claude", "pi"])(
	"runs %s instead of Codex and continues its persisted session after restart",
	async (backend) => {
		const root = await mkdtemp(join(tmpdir(), "backend-host-"));
		const source = join(root, "source");
		execFileSync("git", ["init", "-q", source]);
		await writeFile(join(source, "value.txt"), "original");
		execFileSync("git", ["-C", source, "add", "."]);
		execFileSync("git", [
			"-C",
			source,
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"-qm",
			"initial",
		]);
		const cli = join(root, "claude.cjs");
		await writeFile(
			cli,
			`const fs=require('node:fs');fs.writeFileSync('value.txt', process.argv.includes('--resume')?'continued':'claude');console.log(JSON.stringify({type:'system',subtype:'init',session_id:'11111111-1111-4111-8111-111111111111'}));console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'done'}));`,
		);
		const piCli = join(root, "pi.cjs");
		await writeFile(
			piCli,
			`process.stdin.once('data',()=>{const fs=require('node:fs');fs.writeFileSync('value.txt',fs.readFileSync('value.txt','utf8')==='original'?'pi':'continued');console.log(JSON.stringify({type:'agent_start'}));console.log(JSON.stringify({type:'agent_settled'}));process.stdin.end();});`,
		);
		const token = "backend-host-test-token-00000000001";
		const config = {
			databasePath: join(root, "db.sqlite"),
			authToken: token,
			taskRoot: join(root, "tasks"),
			codex: { executable: join(root, "missing-codex") },
			claude: { executable: process.execPath, extraArgs: [cli] },
			pi: {
				executable: process.execPath,
				executableArgs: [piCli],
				sessionDirectory: join(root, "sessions"),
				policyExtensionPath: join(root, "policy.mjs"),
			},
			repositories: [
				{
					id: "fixture",
					path: source,
					executionTarget: "windows" as const,
					verificationCommands: [],
					permissionProfile: { canWrite: true, canUseNetwork: false },
				},
			],
		};
		let host = new AgentMeHost(config);
		const request = (path: string, body?: unknown) =>
			fetch(`${host.url}${path}`, {
				method: body === undefined ? "GET" : "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			});
		try {
			await host.start(0);
			expect(await (await request("/repositories")).json()).toMatchObject({
				runtimes: [
					{ id: "runtime-codex" },
					{ id: "runtime-claude" },
					{ id: "runtime-pi" },
				],
			});
			const response = await request("/assistant/messages", {
				message: "修改 value.txt",
				repositoryId: "fixture",
				runtimeId: `runtime-${backend}`,
			});
			expect(response.status).toBe(202);
			const { parentId } = (await response.json()) as { parentId: string };
			let childId = "";
			let worktreeId = "";
			await vi.waitFor(
				async () => {
					const tree = (await (
						await request(`/assistant/parents/${parentId}`)
					).json()) as {
						children: { childId: string; worktreeId: string; state: string }[];
					};
					expect(tree.children[0]?.state).toBe("completed");
					childId = tree.children[0]?.childId ?? "";
					worktreeId = tree.children[0]?.worktreeId ?? "";
				},
				{ timeout: 10000 },
			);
			expect(await readFile(join(source, "value.txt"), "utf8")).toBe(
				"original",
			);
			expect(
				await readFile(join(root, "tasks", worktreeId, "value.txt"), "utf8"),
			).toBe(backend);
			await host.stop();
			host = new AgentMeHost(config);
			await host.start(0);
			expect(
				await (
					await request(
						`/assistant/parents/${parentId}/children/${childId}/activity`,
					)
				).json(),
			).toMatchObject({
				canContinue: true,
				runtime: { id: `runtime-${backend}` },
			});
			const continued = await request(
				`/assistant/parents/${parentId}/children/${childId}/turns`,
				{ message: "继续修改" },
			);
			expect(continued.status).toBe(200);
			expect(await continued.json()).toMatchObject({ verification: "passed" });
			expect(
				await readFile(join(root, "tasks", worktreeId, "value.txt"), "utf8"),
			).toBe("continued");
		} finally {
			await host.stop();
			await rm(root, { recursive: true, force: true });
		}
	},
	20000,
);
