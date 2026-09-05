import { describe, expect, it } from "vitest";
import {
	buildClaudeInvocation,
	claudeHealth,
} from "../../plugins/runtime-claude/src/index.js";
import {
	buildPiInvocation,
	piHealth,
	piPromptCommand,
} from "../../plugins/runtime-pi/src/index.js";

describe("alternate runtime contracts", () => {
	it("scopes Claude streaming mode to the assigned cwd", () => {
		expect(buildClaudeInvocation("claude", "D:\\task", "fix it")).toMatchObject(
			{
				cwd: "D:\\task",
				stdin: "fix it",
				args: expect.arrayContaining(["stream-json", "acceptEdits"]),
			},
		);
	});
	it("uses Pi's strict JSONL RPC mode", () => {
		expect(buildPiInvocation("pi", "D:\\task")).toEqual({
			executable: "pi",
			args: ["--mode", "rpc", "--no-session"],
			cwd: "D:\\task",
		});
		expect(piPromptCommand("修复").endsWith("\n")).toBe(true);
	});
	it("reports missing authentication without throwing", () => {
		expect(claudeHealth({})).toBe("unhealthy");
		expect(piHealth({})).toBe("unhealthy");
	});
});
