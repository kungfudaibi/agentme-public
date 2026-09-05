import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("desktop personal assistant workspace", () => {
	it("makes conversation and voice the primary keyboard actions", async () => {
		const html = await readFile(
			new URL("../../apps/desktop/ui/index.html", import.meta.url),
			"utf8",
		);

		expect(html).toContain('id="composer"');
		expect(html).toContain('id="message"');
		expect(html).toContain('id="voice"');
		expect(html).toContain('id="activity-list"');
		expect(html).toContain('id="providers"');
		expect(html).toContain('id="provider-dialog"');
		expect(html).toContain('id="task-workbench"');
		expect(html).toContain('id="task-turn-form"');
		expect(html).toContain('id="delete-chat"');
		expect(html).toContain("继续和这个执行 Agent 对话");
		expect(html).toContain("API Key 由系统受保护存储保管");
		expect(html).toContain('aria-live="polite"');
		expect(html).not.toContain('type="password"');
		expect(html).not.toContain("本机访问令牌");
	});

	it("requires confirmation before deleting the current conversation", async () => {
		const app = await readFile(
			new URL("../../apps/desktop/ui/app.ts", import.meta.url),
			"utf8",
		);

		expect(app).toContain("window.confirm");
		expect(app).toContain("删除当前对话和其中的语音转写");
		expect(app).toContain('{ method: "DELETE" }');
	});
});
