import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { invalid } from "../../../packages/conversation-hub/src/storage.js";

export function isPublicAddress(address: string): boolean {
	if (isIP(address) !== 4) return false; // Conservative: avoid IPv4-mapped and local IPv6 ranges.
	const [a = 0, b = 0] = address.split(".").map(Number);
	return (
		![0, 10, 127].includes(a) &&
		!(a === 169 && b === 254) &&
		!(a === 172 && b >= 16 && b <= 31) &&
		!(a === 192 && (b === 168 || b === 0 || b === 2)) &&
		!(a === 100 && b >= 64 && b <= 127) &&
		!(a === 198 && [18, 19, 51].includes(b)) &&
		!(a === 203 && b === 0) &&
		a < 224
	);
}
export function validateResearchUrl(value: string): URL {
	const url = new URL(value);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		(url.port && url.port !== "443") ||
		url.hostname === "localhost" ||
		url.hostname.endsWith(".localhost") ||
		url.hostname.endsWith(".local") ||
		!url.hostname.includes(".") ||
		value.length > 2000
	)
		invalid("资料来源须为公开 HTTPS 网页");
	return url;
}
export function sourceText(html: string): string {
	return html
		.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
		.replace(/<[^>]*>/gu, " ")
		.replace(
			/&(?:nbsp|amp|lt|gt|quot|#39);/gu,
			(v) =>
				({
					"&nbsp;": " ",
					"&amp;": "&",
					"&lt;": "<",
					"&gt;": ">",
					"&quot;": '"',
					"&#39;": "'",
				})[v] ?? v,
		)
		.replace(/\s+/gu, " ")
		.trim()
		.slice(0, 3500);
}
export async function readResearchSource(
	value: string,
	signal: AbortSignal,
	redirects = 0,
): Promise<{ url: string; text: string; checkedAt: string }> {
	const url = validateResearchUrl(value);
	signal.throwIfAborted();
	const addresses = await lookup(url.hostname, { all: true, family: 4 });
	signal.throwIfAborted();
	if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
		invalid("资料来源不能指向本机或私有网络");
	const address = addresses[0];
	if (!address) invalid();
	const result = await new Promise<{ body: string; redirect?: string }>(
		(resolve, reject) => {
			const req = request(
				url,
				{
					signal,
					family: 4,
					headers: {
						accept: "text/html,text/plain",
						"user-agent": "AgentMe-Research/0.1",
					},
					lookup: (_hostname, _options, callback) =>
						callback(null, address.address, 4),
				},
				(response) => {
					if (
						[301, 302, 303, 307, 308].includes(response.statusCode ?? 0) &&
						response.headers.location
					) {
						response.resume();
						resolve({
							body: "",
							redirect: new URL(response.headers.location, url).href,
						});
						return;
					}
					if (
						response.statusCode !== 200 ||
						!/^text\/(html|plain)/iu.test(
							response.headers["content-type"] ?? "",
						)
					) {
						response.destroy();
						reject(new Error("资料网页不可读取"));
						return;
					}
					const chunks: Buffer[] = [];
					let size = 0;
					response.on("data", (chunk: Buffer) => {
						size += chunk.length;
						if (size > 512 * 1024) {
							response.destroy(new Error("资料网页超过512KB限制"));
							return;
						}
						chunks.push(chunk);
					});
					response.once("error", reject);
					response.once("end", () =>
						resolve({ body: Buffer.concat(chunks).toString("utf8") }),
					);
				},
			);
			req.once("error", reject);
			req.setTimeout(15000, () => req.destroy(new Error("资料读取超时")));
			req.end();
		},
	);
	if (result.redirect) {
		if (redirects >= 2) invalid("资料重定向次数过多");
		return readResearchSource(result.redirect, signal, redirects + 1);
	}
	return {
		url: url.href,
		text: sourceText(result.body),
		checkedAt: new Date().toISOString(),
	};
}
