import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("desktop governed skill workshop", () => {
	it("exposes propose, evaluate, hash approve, apply and rollback controls", async () => {
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
				new URL(
					"../../apps/desktop/ui/skill-workshop-panel.ts",
					import.meta.url,
				),
				"utf8",
			),
		]);
		expect(html).toContain('id="skill-workshop-nav"');
		expect(html).toContain('id="skill-proposal-dialog"');
		expect(html).toContain("由你按内容哈希批准");
		expect(app).toContain("createSkillWorkshopPanel");
		expect(panel).toContain('action === "approve" || action === "apply"');
		expect(panel).toContain("再次点击确认批准");
		expect(panel).toContain("再次点击确认回滚");
		expect(panel).toContain("textContent");
		expect(panel).not.toContain("innerHTML");
	});
});
