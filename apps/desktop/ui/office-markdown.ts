/** A bounded, HTML-free subset for model results; links remain inert text. */
export function escapeOfficeText(value: string): string {
	return value.replace(
		/[&<>"']/gu,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				char
			] ?? char,
	);
}
export function renderOfficeMarkdown(value: string): string {
	const inline = (line: string) =>
		escapeOfficeText(line)
			.replace(/\\_/gu, "_")
			.replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>")
			.replace(/`([^`]+)`/gu, "<code>$1</code>");
	const output: string[] = [];
	let list: "ul" | "ol" | undefined;
	let code = false;
	const closeList = () => {
		if (list) {
			output.push(`</${list}>`);
			list = undefined;
		}
	};
	for (const line of value.split("\n")) {
		if (line.startsWith("```")) {
			closeList();
			output.push(code ? "</code></pre>" : "<pre><code>");
			code = !code;
			continue;
		}
		if (code) {
			output.push(`${escapeOfficeText(line)}\n`);
			continue;
		}
		const heading = /^#{1,6}\s+(.+)$/u.exec(line);
		const bullet = /^\s*([-*]|\d+\.)\s+(.+)$/u.exec(line);
		if (bullet) {
			const next = /^\d/u.test(bullet[1] ?? "") ? "ol" : "ul";
			if (next !== list) {
				closeList();
				list = next;
				output.push(`<${list}>`);
			}
			output.push(`<li>${inline(bullet[2] ?? "")}</li>`);
			continue;
		}
		closeList();
		if (heading) output.push(`<h3>${inline(heading[1] ?? "")}</h3>`);
		else if (/^\s*---+\s*$/u.test(line)) output.push("<hr>");
		else if (line.trim()) output.push(`<p>${inline(line)}</p>`);
	}
	closeList();
	if (code) output.push("</code></pre>");
	return output.join("");
}
