import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("desktop shell configuration", () => {
	it("allows no general shell capability and never asks for a pasted token", async () => {
		const capability = JSON.parse(
			await readFile(
				new URL("../src-tauri/capabilities/desktop.json", import.meta.url),
				"utf8",
			),
		) as { permissions: string[] };
		const html = await readFile(
			new URL("../ui/index.html", import.meta.url),
			"utf8",
		);

		expect(capability.permissions).not.toContain("shell:default");
		expect(
			capability.permissions.some((value) => value.startsWith("shell:")),
		).toBe(false);
		expect(html).not.toContain('type="password"');
	});

	it("bundles the prepared host runtime and exposes opt-in autostart", async () => {
		const config = JSON.parse(
			await readFile(
				new URL("../src-tauri/tauri.conf.json", import.meta.url),
				"utf8",
			),
		) as {
			build: { beforeBuildCommand: string };
			bundle: { resources: Record<string, string>; icon: string[] };
		};
		const html = await readFile(
			new URL("../ui/index.html", import.meta.url),
			"utf8",
		);

		expect(config.build.beforeBuildCommand).toContain("prepare-sidecar.mjs");
		expect(config.bundle.resources["runtime/"]).toBe("runtime/");
		expect(config.bundle.resources["../../../services/voice-python/"]).toBe(
			"services/voice-python/",
		);
		expect(config.bundle.resources["../../../dist/"]).toBe("dist/");
		expect(config.bundle.icon).toContain("icons/icon.ico");
		expect(config.bundle.icon).toContain("icons/icon.icns");
		expect(html).toContain('id="autostart"');
	});
});
