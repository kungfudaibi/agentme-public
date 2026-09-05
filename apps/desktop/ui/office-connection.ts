import { invoke, isTauri } from "@tauri-apps/api/core";

let connection: { baseUrl: string; authToken: string } | undefined;
export async function officeRequest(
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	if (!connection) {
		if (isTauri()) {
			const value = await invoke<{ baseUrl: string; authToken: string }>(
				"connection_info",
			);
			if (
				!/^http:\/\/127\.0\.0\.1:\d+$/u.test(value.baseUrl) ||
				!/^[a-f0-9]{64}$/iu.test(value.authToken)
			)
				throw new Error("本地连接无效");
			connection = value;
		} else {
			if (location.hostname !== "127.0.0.1")
				throw new Error("请使用本机预览地址");
			connection = { baseUrl: `${location.origin}/api`, authToken: "" };
		}
	}
	const response = await fetch(`${connection.baseUrl}${path}`, {
		...init,
		headers: {
			...(connection.authToken
				? { authorization: `Bearer ${connection.authToken}` }
				: {}),
			...init.headers,
		},
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as {
			error?: { message?: string };
		};
		throw new Error(body.error?.message ?? `请求未成功 (${response.status})`);
	}
	return response;
}
