import { expect, it } from "vitest";
import { renderOfficeMarkdown } from "../ui/office-markdown.js";

it("renders useful result formatting without executing model-supplied markup", () => {
	const html = renderOfficeMarkdown(
		"## Plan\n\n**Important**\n- First\n- <img src=x onerror=alert(1)>\n\n`<script>`",
	);
	expect(html).toContain("<h3>Plan</h3>");
	expect(html).toContain("<strong>Important</strong>");
	expect(html).toContain("<li>First</li>");
	expect(html).not.toContain("<img");
	expect(html).not.toContain("<script>");
	expect(html).toContain("&lt;img");
});
