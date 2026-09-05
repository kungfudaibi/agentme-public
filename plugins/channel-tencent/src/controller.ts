import type { TencentMessageIdentity } from "./identity.js";
import { permissionsFor } from "./identity.js";
import type { TencentPairingPort } from "./pairing.js";
import type { TencentInboundMessage } from "./qq-transport.js";

export type RemoteTaskState =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export interface RemoteTaskControlPort {
	create(
		input: {
			readonly requestId: string;
			readonly actorId: string;
			readonly repositoryId: string;
			readonly instruction: string;
		},
		signal: AbortSignal,
	): Promise<{ readonly taskId: string }>;
	status(
		taskId: string,
		signal: AbortSignal,
	): Promise<{
		readonly taskId: string;
		readonly state: RemoteTaskState;
		readonly evidence?: string;
	}>;
	cancel(
		taskId: string,
		signal: AbortSignal,
	): Promise<{ readonly taskId: string; readonly state: RemoteTaskState }>;
}

function safeId(value: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function taskId(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
		value,
	);
}

function remoteState(value: string): value is RemoteTaskState {
	return ["queued", "running", "completed", "failed", "cancelled"].includes(
		value,
	);
}

function assertTaskResult(value: {
	readonly taskId: string;
	readonly state?: string;
}): void {
	if (
		!taskId(value.taskId) ||
		(value.state !== undefined && !remoteState(value.state))
	)
		throw new TypeError("Remote task result is invalid");
}

function redactEvidence(value: string): string {
	return value
		.replace(/sk-[A-Za-z0-9._-]{12,}/gu, "[secret]")
		.replace(/[A-Za-z]:\\[^\s]+/gu, "[path]")
		.replace(/\/(?:home|Users|root)\/[^\s]+/gu, "[path]")
		.slice(0, 2_000);
}

export class TencentTaskController {
	readonly #ownerIds: ReadonlySet<string>;
	readonly #pairing: TencentPairingPort;
	readonly #tasks: RemoteTaskControlPort;

	constructor(
		config: {
			readonly ownerIds: ReadonlySet<string>;
			readonly pairing: TencentPairingPort;
		},
		tasks: RemoteTaskControlPort,
	) {
		if (
			config.ownerIds.size < 1 ||
			config.ownerIds.size > 16 ||
			[...config.ownerIds].some((value) => !safeId(value))
		)
			throw new TypeError("Tencent owner allowlist is invalid");
		this.#ownerIds = new Set(config.ownerIds);
		this.#pairing = config.pairing;
		this.#tasks = tasks;
	}

	async handle(
		message: TencentInboundMessage,
		signal: AbortSignal = new AbortController().signal,
	): Promise<string> {
		if (message.conversation === "group")
			return "群聊只提供安全提示，不执行任务、文件、看板或密钥操作。";
		const identity: TencentMessageIdentity = {
			senderId: message.senderId,
			conversation: message.conversation,
			paired: this.#pairing.isPaired(message.senderId),
		};
		const permissions = permissionsFor(identity, this.#ownerIds);
		if (!permissions.has("task.read"))
			return "当前 QQ 身份未配对，不能访问任务或本机能力。";

		const create =
			/^\/task\s+([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\s+([\s\S]{1,4000})$/u.exec(
				message.content,
			);
		if (create !== null && permissions.has("task.create")) {
			const result = await this.#tasks.create(
				{
					requestId: `qq:${message.messageId}`,
					actorId: `qq:${message.senderId}`,
					repositoryId: create[1] ?? "",
					instruction: (create[2] ?? "").trim(),
				},
				signal,
			);
			assertTaskResult(result);
			return `任务已创建：${result.taskId}`;
		}
		const status = /^\/status\s+([^\s]+)$/u.exec(message.content);
		if (status !== null && taskId(status[1] ?? "")) {
			const result = await this.#tasks.status(status[1] ?? "", signal);
			assertTaskResult(result);
			if (result.evidence !== undefined && typeof result.evidence !== "string")
				throw new TypeError("Remote task evidence is invalid");
			return `任务 ${result.taskId}：${result.state}${
				result.evidence === undefined
					? ""
					: `\n证据：${redactEvidence(result.evidence)}`
			}`;
		}
		const cancel = /^\/cancel\s+([^\s]+)$/u.exec(message.content);
		if (
			cancel !== null &&
			taskId(cancel[1] ?? "") &&
			permissions.has("task.cancel")
		) {
			const result = await this.#tasks.cancel(cancel[1] ?? "", signal);
			assertTaskResult(result);
			return `任务 ${result.taskId}：${result.state}`;
		}
		return "命令格式：/task <仓库ID> <任务>、/status <任务ID>、/cancel <任务ID>。";
	}
}
