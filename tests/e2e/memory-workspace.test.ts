import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("desktop inspectable memory workspace", () => {
	it("exposes accessible Host-backed memory CRUD, search and export", async () => {
		const [html, app, panel, editor, render] = await Promise.all([
			readFile(
				new URL("../../apps/desktop/ui/index.html", import.meta.url),
				"utf8",
			),
			readFile(
				new URL("../../apps/desktop/ui/app.ts", import.meta.url),
				"utf8",
			),
			readFile(
				new URL("../../apps/desktop/ui/memory-panel.ts", import.meta.url),
				"utf8",
			),
			readFile(
				new URL("../../apps/desktop/ui/memory-editor.ts", import.meta.url),
				"utf8",
			),
			readFile(
				new URL("../../apps/desktop/ui/memory-render.ts", import.meta.url),
				"utf8",
			),
		]);

		expect(html).toContain('id="memory-nav"');
		expect(html).toContain('id="memory-workspace"');
		expect(html).toContain('aria-labelledby="memory-title"');
		expect(html).toContain('id="memory-status"');
		expect(html).toContain('id="memory-search"');
		expect(html).toContain('id="memory-kind-filter"');
		expect(html).toContain('id="memory-entry-list"');
		expect(html).toContain('aria-live="polite"');
		expect(html).toContain('id="memory-dialog"');
		expect(html).toContain('id="memory-content"');
		expect(html).toContain('maxlength="20000"');
		expect(html).toContain('id="memory-confidence"');
		expect(panel).toMatch(
			/request\(`\/memories\?\$\{params\.toString\(\)\}`\)/u,
		);
		expect(panel).toContain('request("/memories/removals"');
		expect(panel).toContain('request("/memories/export")');
		expect(editor).toContain('isNew ? "/memories"');
		expect(editor).toMatch(
			/`\/memories\/\$\{encodeURIComponent\(id\.value\)\}`/u,
		);
		expect(render).toContain("textContent");
		expect(render).not.toContain("innerHTML");
		expect(app).toContain("createMemoryPanel");
		expect(`${app}\n${panel}`).not.toMatch(
			/localStorage\.(?:setItem|getItem)\([^\n]*memor/iu,
		);
	});

	it("uses a browser-valid memory id pattern", async () => {
		const html = await readFile(
			new URL("../../apps/desktop/ui/index.html", import.meta.url),
			"utf8",
		);
		const pattern = html.match(/id="memory-id"[^>]*pattern="([^"]+)"/u)?.[1];
		expect(pattern).toBeDefined();
		expect(() => new RegExp(pattern as string, "v")).not.toThrow();
	});

	it("keeps visible desktop labels in their accessible names", async () => {
		const [html, app] = await Promise.all([
			readFile(
				new URL("../../apps/desktop/ui/index.html", import.meta.url),
				"utf8",
			),
			readFile(
				new URL("../../apps/desktop/ui/app.ts", import.meta.url),
				"utf8",
			),
		]);
		expect(html).toContain('aria-label="AgentMe 个人 Agent 工作台首页"');
		expect(html).toContain('aria-label="小麦助手：启用本地唤醒监听"');
		expect(app).toContain('"小麦助手：关闭本地唤醒监听"');
	});
});
