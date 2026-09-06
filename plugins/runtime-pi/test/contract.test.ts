import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { CodingEvent } from "../../../packages/contracts/src/index.js";
import {
	buildPiInvocation,
	PiEventAdapter,
	PiRpcRuntime,
	piWorktreePolicySource,
	probePiHealth,
	runPiProcess,
} from "../src/index.js";

const execFileAsync = promisify(execFile);

describe("Pi RPC event adapter", () => {
	it("normalizes lifecycle, messages, tools, tests and completion", () => {
		const adapter = new PiEventAdapter("run-1", "session-1");
		expect(adapter.adapt({ type: "agent_start" })).toEqual([
			{ type: "run.started", runId: "run-1", threadId: "session-1" },
			{ type: "run.progress", runId: "run-1", message: "Pi agent started" },
		]);
		expect(
			adapter.adapt({
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", delta: "Done" },
			}),
		).toEqual([{ type: "message.delta", runId: "run-1", text: "Done" }]);
		expect(
			adapter.adapt({
				type: "tool_execution_start",
				toolCallId: "tool-1",
				toolName: "powershell",
				args: { command: "pnpm test" },
			}),
		).toEqual([
			{
				type: "tool.requested",
				runId: "run-1",
				toolCallId: "tool-1",
				tool: "powershell",
				input: { command: "pnpm test" },
			},
		]);
		expect(
			adapter.adapt({
				type: "tool_execution_end",
				toolCallId: "tool-1",
				toolName: "powershell",
				isError: false,
				result: { details: { command: "pnpm test", exitCode: 0 } },
			}),
		).toEqual([
			{
				type: "test.result",
				runId: "run-1",
				command: "pnpm test",
				exitCode: 0,
			},
		]);
		expect(adapter.adapt({ type: "agent_settled" })).toEqual([
			{ type: "run.completed", runId: "run-1", summary: "Done" },
		]);
	});

	it("maps rejected prompts and extension failures to stable failures", () => {
		const rejected = new PiEventAdapter("run-1", "session-1");
		expect(
			rejected.adapt({
				type: "response",
				command: "prompt",
				success: false,
				error: "No API key",
			}),
		).toMatchObject([
			{ type: "run.failed", error: { code: "PROVIDER_UNAVAILABLE" } },
		]);
		const extension = new PiEventAdapter("run-2", "session-2");
		expect(
			extension.adapt({ type: "extension_error", message: "failed" }),
		).toMatchObject([
			{ type: "run.failed", error: { code: "EXECUTION_FAILED" } },
		]);
		const modelFailure = new PiEventAdapter("run-3", "session-3");
		expect(
			modelFailure.adapt({
				type: "message_end",
				message: { role: "assistant", stopReason: "error" },
			}),
		).toMatchObject([
			{ type: "run.failed", error: { code: "EXECUTION_FAILED" } },
		]);
	});

	it("rejects malformed or oversized RPC events", () => {
		const adapter = new PiEventAdapter("run-1", "session-1");
		expect(() => adapter.adapt({ type: "message_update" })).toThrowError(
			expect.objectContaining({ code: "INVALID_CONTRACT" }),
		);
		expect(() =>
			adapter.adapt({
				type: "message_update",
				assistantMessageEvent: {
					type: "text_delta",
					delta: "x".repeat(64_001),
				},
			}),
		).toThrowError(expect.objectContaining({ code: "INVALID_CONTRACT" }));
	});
});

describe("Pi invocation", () => {
	it("isolates project resources, environment and worktree policy", () => {
		expect(
			buildPiInvocation({
				executable: "pi",
				worktreePath: "D:\\tasks\\task-1",
				sessionDirectory: "D:\\state\\pi",
				sessionId: "session-1",
				prompt: "Fix it",
				policyExtensionPath: "D:\\resources\\pi-policy.mjs",
				provider: "deepseek",
				permissionProfile: "worktree-write",
				hostEnvironment: {
					APPDATA: "D:\\profile\\appdata",
					PATH: "safe-path",
					DEEPSEEK_API_KEY: "provider-secret",
					AGENTME_AUTH_TOKEN: "host-secret",
					NODE_OPTIONS: "--require malicious-module",
				},
			}),
		).toEqual({
			executable: "pi",
			args: [
				"--mode",
				"rpc",
				"--session-id",
				"session-1",
				"--session-dir",
				"D:\\state\\pi",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--no-themes",
				"--no-context-files",
				"--no-approve",
				"--extension",
				"D:\\resources\\pi-policy.mjs",
				"--tools",
				"read,edit,write,grep,find,ls",
				"--provider",
				"deepseek",
			],
			cwd: "D:\\tasks\\task-1",
			stdin: '{"id":"session-1","type":"prompt","message":"Fix it"}\n',
			env: {
				AGENTME_PI_WORKTREE_ROOT: "D:\\tasks\\task-1",
				APPDATA: "D:\\profile\\appdata",
				PATH: "safe-path",
			},
		});
	});

	it("enables shell tools only for the explicit danger profile", () => {
		const invocation = buildPiInvocation({
			executable: "pi",
			worktreePath: "D:\\tasks\\task-1",
			sessionDirectory: "D:\\state\\pi",
			sessionId: "session-1",
			prompt: "Fix it",
			permissionProfile: "danger-full-access",
		});
		expect(invocation.args).toContain(
			"read,bash,powershell,edit,write,grep,find,ls",
		);
	});

	it("passes only explicit provider credentials to a shell-free worker", () => {
		const invocation = buildPiInvocation({
			executable: "pi",
			worktreePath: "D:\\tasks\\task-1",
			sessionDirectory: "D:\\state\\pi",
			sessionId: "session-1",
			prompt: "Fix it",
			policyExtensionPath: "D:\\resources\\pi-policy.mjs",
			providerEnvironment: {
				DEEPSEEK_API_KEY: "provider-secret",
				AGENTME_AUTH_TOKEN: "host-secret",
			},
		});
		expect(invocation.env).toMatchObject({
			DEEPSEEK_API_KEY: "provider-secret",
		});
		expect(invocation.env).not.toHaveProperty("AGENTME_AUTH_TOKEN");
		expect(() =>
			buildPiInvocation({
				executable: "pi",
				worktreePath: "D:\\tasks\\task-1",
				sessionDirectory: "D:\\state\\pi",
				sessionId: "session-1",
				prompt: "Fix it",
				permissionProfile: "danger-full-access",
				providerEnvironment: { DEEPSEEK_API_KEY: "provider-secret" },
			}),
		).toThrowError(
			"Provider credentials require the shell-free worktree profile",
		);
	});

	it("blocks file tools that resolve outside the assigned worktree", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agentme-pi-policy-"));
		const policyPath = join(cwd, "policy.mjs");
		const previousRoot = process.env.AGENTME_PI_WORKTREE_ROOT;
		try {
			await writeFile(policyPath, piWorktreePolicySource);
			process.env.AGENTME_PI_WORKTREE_ROOT = cwd;
			const loaded = (await import(
				`${pathToFileURL(policyPath).href}?test=1`
			)) as {
				default: (pi: {
					on: (name: string, candidate: (event: unknown) => unknown) => void;
				}) => void;
			};
			let handler: ((event: unknown) => unknown) | undefined;
			loaded.default({
				on(name, candidate) {
					if (name === "tool_call") handler = candidate;
				},
			});
			if (handler === undefined) throw new Error("policy handler missing");
			await expect(
				handler({ toolName: "write", input: { path: "../outside.txt" } }),
			).resolves.toMatchObject({ block: true, terminate: true });
			await expect(
				handler({ toolName: "write", input: { path: "inside.txt" } }),
			).resolves.toBeUndefined();
		} finally {
			if (previousRoot === undefined)
				delete process.env.AGENTME_PI_WORKTREE_ROOT;
			else process.env.AGENTME_PI_WORKTREE_ROOT = previousRoot;
			await removeTemp(cwd);
		}
	});
});

describe("Pi process controller", () => {
	it("reports files changed before the settled completion", async () => {
		const cwd = await createGitFixture("agentme-pi-process-");
		try {
			const script = join(cwd, "pi-stub.cjs");
			await writeFile(
				script,
				`const fs=require("node:fs");process.stdin.once("data",()=>{console.log(JSON.stringify({type:"agent_start"}));fs.writeFileSync("tracked.txt","after\\n");console.log(JSON.stringify({type:"message_update",assistantMessageEvent:{type:"text_delta",delta:"Done"}}));console.log(JSON.stringify({type:"agent_settled"}));process.stdin.end();});\n`,
			);
			const events = await collectProcess(cwd, script);
			expect(events.map((event) => event.type)).toEqual([
				"run.started",
				"run.progress",
				"message.delta",
				"file.changed",
				"run.completed",
			]);
			expect(events.at(-2)).toEqual({
				type: "file.changed",
				runId: "run-1",
				paths: ["tracked.txt"],
			});
		} finally {
			await removeTemp(cwd);
		}
	});

	it("terminates a process that rejects the prompt", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agentme-pi-reject-"));
		try {
			const script = join(cwd, "pi-stub.cjs");
			await writeFile(
				script,
				`process.stdin.once("data",()=>{console.log(JSON.stringify({type:"response",command:"prompt",success:false}));setInterval(()=>{},1000);});\n`,
			);
			const events = await collectProcess(cwd, script);
			expect(events.at(-1)).toMatchObject({
				type: "run.failed",
				error: { code: "PROVIDER_UNAVAILABLE" },
			});
		} finally {
			await removeTemp(cwd);
		}
	}, 3_000);

	it("sends abort and emits cancellation", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agentme-pi-cancel-"));
		try {
			const script = join(cwd, "pi-stub.cjs");
			await writeFile(
				script,
				`let b="";process.stdin.on("data",c=>{b+=c;for(const l of b.split("\\n").filter(Boolean)){const m=JSON.parse(l);if(m.type==="prompt")console.log(JSON.stringify({type:"agent_start"}));if(m.type==="abort")console.log(JSON.stringify({type:"agent_settled"}));}});\n`,
			);
			const controller = new AbortController();
			setTimeout(() => controller.abort(), 100);
			const events: CodingEvent[] = [];
			for await (const event of runPiProcess(
				"run-1",
				"session-1",
				stubInvocation(cwd, script),
				controller.signal,
			))
				events.push(event);
			expect(events.at(-1)).toEqual({ type: "run.cancelled", runId: "run-1" });
		} finally {
			await removeTemp(cwd);
		}
	});

	it("maps a missing executable to provider unavailable", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agentme-pi-missing-"));
		try {
			const events: CodingEvent[] = [];
			for await (const event of runPiProcess(
				"run-1",
				"session-1",
				{
					executable: join(cwd, "missing-pi"),
					args: [],
					cwd,
					stdin: "",
				},
				new AbortController().signal,
			))
				events.push(event);
			expect(events.at(-1)).toMatchObject({
				type: "run.failed",
				error: { code: "PROVIDER_UNAVAILABLE" },
			});
		} finally {
			await removeTemp(cwd);
		}
	});
});

describe("Pi runtime and health", () => {
	it("retains the worktree and session for resume", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agentme-pi-runtime-"));
		try {
			const script = join(cwd, "pi-stub.cjs");
			await writeFile(
				script,
				`process.stdin.once("data",()=>{console.log(JSON.stringify({type:"agent_start"}));console.log(JSON.stringify({type:"agent_settled"}));process.stdin.end();});\n`,
			);
			const runtime = new PiRpcRuntime({
				executable: process.execPath,
				executableArgs: [script],
				sessionDirectory: join(cwd, "sessions"),
				policyExtensionPath: join(cwd, "policy.mjs"),
				hostEnvironment: { PATH: process.env.PATH },
			});
			const startEvents: CodingEvent[] = [];
			for await (const event of runtime.start(
				{
					runId: "run-start",
					taskId: "task-1",
					worktreePath: cwd,
					instruction: "Fix it",
				},
				new AbortController().signal,
			))
				startEvents.push(event);
			const threadId = startEvents.find(
				(event) => event.type === "run.started",
			);
			expect(threadId?.type).toBe("run.started");
			if (threadId?.type !== "run.started") throw new Error("missing thread");
			const resumed: CodingEvent[] = [];
			for await (const event of runtime.resume(
				threadId.threadId,
				"Continue",
				new AbortController().signal,
			))
				resumed.push(event);
			expect(resumed.at(-1)?.type).toBe("run.completed");
			expect(await runtime.capabilities()).toEqual({
				canResume: true,
				canRequestApproval: false,
				canStreamFileChanges: true,
			});
		} finally {
			await removeTemp(cwd);
		}
	});

	it("reports unavailable credentials without exposing command output", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agentme-pi-health-"));
		try {
			const script = join(cwd, "health.js");
			await writeFile(script, "process.exit(1);\n");
			expect(
				await probePiHealth(process.execPath, "deepseek", {
					executableArgs: [script],
					environment: { PATH: process.env.PATH },
				}),
			).toEqual({ status: "unhealthy", reason: "authentication-required" });
		} finally {
			await removeTemp(cwd);
		}
	});

	it("uses an explicit provider credential for health without inheriting host secrets", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agentme-pi-health-ready-"));
		try {
			const script = join(cwd, "health.js");
			await writeFile(
				script,
				`if(process.env.DEEPSEEK_API_KEY!=="provider-secret"||process.env.AGENTME_AUTH_TOKEN)process.exit(1);console.log(JSON.stringify({status:"ready",provider:"deepseek"}));\n`,
			);
			expect(
				await probePiHealth(process.execPath, "deepseek", {
					executableArgs: [script],
					environment: {
						PATH: process.env.PATH,
						AGENTME_AUTH_TOKEN: "host-secret",
					},
					providerEnvironment: { DEEPSEEK_API_KEY: "provider-secret" },
				}),
			).toEqual({ status: "healthy", provider: "deepseek" });
		} finally {
			await removeTemp(cwd);
		}
	});
});

async function collectProcess(
	cwd: string,
	script: string,
): Promise<CodingEvent[]> {
	const events: CodingEvent[] = [];
	for await (const event of runPiProcess(
		"run-1",
		"session-1",
		stubInvocation(cwd, script),
		new AbortController().signal,
	))
		events.push(event);
	return events;
}

function stubInvocation(cwd: string, script: string) {
	return {
		executable: process.execPath,
		args: [script],
		cwd,
		stdin: '{"id":"session-1","type":"prompt","message":"Fix"}\n',
		env: { PATH: process.env.PATH },
	};
}

async function createGitFixture(prefix: string): Promise<string> {
	const cwd = await mkdtemp(join(tmpdir(), prefix));
	await writeFile(join(cwd, "tracked.txt"), "before\n");
	await execFileAsync("git", ["init"], { cwd });
	await execFileAsync("git", ["add", "tracked.txt"], { cwd });
	await execFileAsync(
		"git",
		[
			"-c",
			"user.name=AgentMe Test",
			"-c",
			"user.email=agentme@example.invalid",
			"commit",
			"-m",
			"fixture",
		],
		{ cwd },
	);
	return cwd;
}

async function removeTemp(path: string): Promise<void> {
	await rm(path, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	});
}
