import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("local voice installer", () => {
	it("can install durable voice state outside the source checkout", async () => {
		const installer = await readFile(
			new URL("../../../scripts/voice/install-local.mjs", import.meta.url),
			"utf8",
		);

		expect(installer).toContain("AGENTME_DATA_DIRECTORY");
		expect(installer).toContain("AGENTME_VOICE_SERVICE_DIRECTORY");
	});
});
