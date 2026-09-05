import { QQBot } from "@tencent-connect/qqbot-nodejs";

import {
	createTencentChannel,
	type TencentChannel,
	type TencentChannelConfig,
	type TencentChannelDependencies,
} from "./assembly.js";

export function createOfficialTencentChannel(
	config: TencentChannelConfig,
	dependencies: Omit<TencentChannelDependencies, "QQBot">,
): TencentChannel {
	return createTencentChannel(config, { ...dependencies, QQBot });
}
