import { officeAgents } from "../../../packages/agent-office/src/catalog.js";
import type { AgentOffice } from "../../../packages/agent-office/src/office.js";
import { AgentMeError } from "../../../packages/contracts/src/index.js";
import type { AssistantProviderService } from "./assistant-provider-manager.js";

export async function executeOfficeRoute(
	office: AgentOffice,
	method: string,
	path: string,
	body: unknown,
	providers: AssistantProviderService | undefined,
	signal: AbortSignal,
): Promise<{ status: number; body: unknown }> {
	if (method === "GET" && path === "/office") {
		const catalog = await providers?.list(signal);
		const active = catalog?.profiles.find((profile) => profile.isActive);
		return {
			status: 200,
			body: {
				...office.snapshot(),
				agents: officeAgents,
				model: active
					? {
							name: active.name,
							model: active.model,
							ready: active.isConfigured,
						}
					: { name: "未连接模型", model: "", ready: false },
			},
		};
	}
	if (method === "POST" && path === "/office/tasks") {
		const task = office.create(body);
		void office.drain();
		return { status: 201, body: task };
	}
	if (method === "PUT" && path === "/office/instructions") {
		office.configure(body);
		return { status: 200, body: { saved: true } };
	}
	const match =
		/^\/office\/tasks\/([a-f0-9-]{36})(?:\/(complete|cancel|retry|handoff))?$/u.exec(
			path,
		);
	if (match) {
		const id = match[1] as string;
		const action = match[2];
		if (method === "DELETE" && !action) {
			office.delete(id);
			return { status: 200, body: { deleted: true } };
		}
		if (method === "POST") {
			if (action === "handoff") {
				const task = office.handoff(id, body);
				void office.drain();
				return { status: 201, body: task };
			}
			if (action === "complete") office.complete(id);
			else if (action === "cancel") office.cancel(id);
			else if (action === "retry") office.retry(id);
			else
				throw new AgentMeError({
					code: "INVALID_CONTRACT",
					message: "未知任务操作",
					isRetryable: false,
				});
			void office.drain();
			return { status: 200, body: office.get(id) };
		}
	}
	return {
		status: 404,
		body: { error: { code: "NOT_FOUND", message: "Office route not found" } },
	};
}
