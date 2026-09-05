import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("desktop scheduled automation workspace", () => {
	it("exposes bounded schedule, observation, task entry and cancellation controls", async () => {
		const [html, app, panel] = await Promise.all([
			readFile(
				new URL("../../apps/desktop/ui/index.html", import.meta.url),
				"utf8",
			),
			readFile(
				new URL("../../apps/desktop/ui/app.ts", import.meta.url),
				"utf8",
			),
			readFile(
				new URL("../../apps/desktop/ui/automation-panel.ts", import.meta.url),
				"utf8",
			),
		]);
		expect(html).toContain('id="automation-nav"');
		expect(html).toContain('id="automation-dialog"');
		expect(html).toContain("到点后交给主 Agent 调度");
		expect(app).toContain("createAutomationPanel");
		expect(panel).toContain("再次点击确认取消");
		expect(panel).toContain("进入任务");
		expect(panel).not.toContain("innerHTML");
	});
});
