import { expect, it } from "vitest";
import {
	isPublicAddress,
	sourceText,
	validateResearchUrl,
} from "../src/research-source.js";

it("rejects local, private and non-HTTPS research destinations before networking", () => {
	for (const address of [
		"127.0.0.1",
		"10.0.0.1",
		"169.254.169.254",
		"192.168.1.1",
		"::1",
		"::ffff:127.0.0.1",
		"fc00::1",
		"198.18.0.1",
	])
		expect(isPublicAddress(address)).toBe(false);
	expect(isPublicAddress("93.184.216.34")).toBe(true);
	for (const url of [
		"http://example.com",
		"https://localhost",
		"https://a:b@example.com",
		"https://example.com:8443",
	])
		expect(() => validateResearchUrl(url)).toThrow();
});
it("extracts bounded readable source material while excluding scripts and styles", () => {
	const text = sourceText(
		"<html><script>evil()</script><style>hidden</style><p>Hello &amp; world</p></html>",
	);
	expect(text).toContain("Hello & world");
	expect(text).not.toContain("evil");
	expect(text).not.toContain("hidden");
	expect(sourceText("a".repeat(20000)).length).toBeLessThanOrEqual(3500);
});
