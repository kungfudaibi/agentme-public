import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("desktop personal dashboard", () => {
	it("exposes an accessible Host-backed dashboard workspace", async () => {
		const html = await readFile(
			new URL("../../apps/desktop/ui/index.html", import.meta.url),
			"utf8",
		);
		const app = await readFile(
			new URL("../../apps/desktop/ui/app.ts", import.meta.url),
			"utf8",
		);
		const panel = await readFile(
			new URL(
				"../../apps/desktop/ui/personal-dashboard-panel.ts",
				import.meta.url,
			),
			"utf8",
		);

		expect(html).toContain('id="personal-dashboard-nav"');
		expect(html).toContain('id="personal-dashboard"');
		expect(html).toContain('aria-labelledby="personal-dashboard-title"');
		expect(html).toContain('id="dashboard-status"');
		expect(html).toContain('aria-live="polite"');
		expect(html).toContain('id="dashboard-entry-form"');
		expect(html).toContain('id="dashboard-type"');
		expect(html).toContain('aria-label="开始或结束语音录制"');
		expect(html).toContain("存款");
		expect(html).toContain("收入");
		expect(html).toContain("支出");
		expect(html).toContain("投资");
		expect(html).toContain("比赛");
		expect(html).toContain("技能");
		expect(panel).toContain(
			'request("/personal-dashboard?limit=100&offset=0")',
		);
		expect(panel).toContain('request("/personal-dashboard/removals"');
		expect(`${app}\n${panel}`).not.toMatch(
			/localStorage\.(?:setItem|getItem)\([^\n]*dashboard/iu,
		);
	});
});
