export type DesktopApplicationId = "wechat";
export type DesktopActionId = "open.wechat";

export interface DesktopApplicationLauncher {
	launch(
		applicationId: DesktopApplicationId,
		signal: AbortSignal,
	): Promise<void>;
}

export interface DesktopActionCompleted {
	readonly type: "desktop-action.completed";
	readonly actionId: DesktopActionId;
	readonly acknowledgement: string;
}

export interface DesktopActionRuntime {
	tryExecute(
		message: string,
		signal: AbortSignal,
	): Promise<DesktopActionCompleted | undefined>;
}

const openWechat =
	/^(?:请|麻烦)?(?:帮我)?(?:打开|启动|运行)(?:一下)?(?:微信|wechat|weixin)[。.!！ ]*$/iu;

export class AllowlistedDesktopActionRuntime implements DesktopActionRuntime {
	readonly #launcher: DesktopApplicationLauncher;

	constructor(launcher: DesktopApplicationLauncher) {
		this.#launcher = launcher;
	}

	async tryExecute(
		message: string,
		signal: AbortSignal,
	): Promise<DesktopActionCompleted | undefined> {
		if (!openWechat.test(message.trim())) return undefined;
		signal.throwIfAborted();
		await this.#launcher.launch("wechat", signal);
		return {
			type: "desktop-action.completed",
			actionId: "open.wechat",
			acknowledgement: "已打开微信。",
		};
	}
}
