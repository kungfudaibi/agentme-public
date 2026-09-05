import { describe, expect, it } from "vitest";

import {
	AllowlistedDesktopActionRuntime,
	type DesktopApplicationId,
	type DesktopApplicationLauncher,
	resolveDesktopApplicationCommand,
} from "../src/index.js";

class RecordingLauncher implements DesktopApplicationLauncher {
	readonly launched: DesktopApplicationId[] = [];

	async launch(applicationId: DesktopApplicationId): Promise<void> {
		this.launched.push(applicationId);
	}
}

describe("allowlisted desktop actions", () => {
	it("opens WeChat without forwarding natural language to a command", async () => {
		const launcher = new RecordingLauncher();
		const runtime = new AllowlistedDesktopActionRuntime(launcher);

		await expect(
			runtime.tryExecute("帮我打开微信", new AbortController().signal),
		).resolves.toEqual({
			type: "desktop-action.completed",
			actionId: "open.wechat",
			acknowledgement: "已打开微信。",
		});
		expect(launcher.launched).toEqual(["wechat"]);
	});

	it.each(["微信没有被打开", "修改微信相关代码", "卸载微信", "打开计算器"])(
		"does not reinterpret %s as an allowlisted action",
		async (message) => {
			const launcher = new RecordingLauncher();
			const runtime = new AllowlistedDesktopActionRuntime(launcher);

			await expect(
				runtime.tryExecute(message, new AbortController().signal),
			).resolves.toBeUndefined();
			expect(launcher.launched).toEqual([]);
		},
	);
});

describe("desktop application resolution", () => {
	it("resolves the installed Windows WeChat executable without a shell", async () => {
		const executable = "C:\\Program Files\\Tencent\\WeChat\\WeChat.exe";

		await expect(
			resolveDesktopApplicationCommand("wechat", {
				platform: "win32",
				environment: { ProgramFiles: "C:\\Program Files" },
				fileExists: async (candidate) => candidate === executable,
			}),
		).resolves.toEqual({ executable, args: [] });
	});

	it("fails closed when WeChat is not installed at an allowlisted path", async () => {
		await expect(
			resolveDesktopApplicationCommand("wechat", {
				platform: "win32",
				environment: {},
				fileExists: async () => false,
			}),
		).rejects.toThrow("WeChat is not installed");
	});

	it("uses the fixed macOS application launcher arguments", async () => {
		await expect(
			resolveDesktopApplicationCommand("wechat", {
				platform: "darwin",
				environment: {},
				fileExists: async (candidate) => candidate === "/usr/bin/open",
			}),
		).resolves.toEqual({
			executable: "/usr/bin/open",
			args: ["-a", "WeChat"],
		});
	});
});
