import type {
	QQBotClient,
	QQBotClientFactory,
	QQBotInboundHandler,
	QQBotLifecycleEvent,
	QQReplyTarget,
} from "./qq-transport.js";

interface OfficialQQBotInstance {
	on(event: string, handler: (...args: unknown[]) => unknown): unknown;
	start(signal?: AbortSignal): Promise<void>;
	stop(): void;
	sendText(target: QQReplyTarget, text: string): Promise<unknown>;
}

export interface OfficialQQBotConstructor {
	new (options: {
		readonly appId: string;
		readonly appSecret: string;
		readonly accountId: string;
	}): OfficialQQBotInstance;
}

class OfficialQQBotClient implements QQBotClient {
	readonly #bot: OfficialQQBotInstance;

	constructor(bot: OfficialQQBotInstance) {
		this.#bot = bot;
	}

	onMessage(handler: QQBotInboundHandler): void {
		this.#bot.on("message", (_context: unknown, message: unknown) =>
			handler(message),
		);
	}

	onLifecycle(
		event: QQBotLifecycleEvent,
		handler: () => void | Promise<void>,
	): void {
		this.#bot.on(event, () => handler());
	}

	start(signal: AbortSignal): Promise<void> {
		return this.#bot.start(signal);
	}

	stop(): void {
		this.#bot.stop();
	}

	async sendText(target: QQReplyTarget, text: string): Promise<void> {
		await this.#bot.sendText(target, text);
	}
}

export function createOfficialQQBotClientFactory(
	QQBot: OfficialQQBotConstructor,
): QQBotClientFactory {
	return (options) => new OfficialQQBotClient(new QQBot(options));
}
