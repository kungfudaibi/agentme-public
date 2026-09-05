import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { StandingIntentStore } from "../../../packages/automation-runtime/src/index.js";
import {
	AllowlistedDesktopActionRuntime,
	createPlatformSecretStore,
	PlatformDesktopApplicationLauncher,
	type SecretStore,
} from "../../../packages/platform-runtime/src/index.js";
import { ApprovalStore } from "../../../packages/policy-engine/src/index.js";
import {
	ProcessSkillEvaluator,
	SkillWorkshop,
} from "../../../packages/skill-workshop/src/index.js";
import {
	type SpeechProvider,
	SpokenConversationRouter,
} from "../../../packages/voice-runtime/src/index.js";
import type { RegisterRepositoryInput } from "../../../packages/workspace-manager/src/index.js";
import { createOfficialTencentChannel } from "../../../plugins/channel-tencent/src/index.js";
import {
	MemoryStore,
	PersonalDashboardStore,
} from "../../../plugins/memory-core/src/index.js";
import { DeepSeekAssistantModel } from "../../../plugins/model-deepseek/src/index.js";
import { AliyunSpeechProvider } from "../../../plugins/voice-aliyun/src/index.js";
import { SidecarSpeechProvider } from "../../../plugins/voice-sherpa/src/index.js";
import {
	AssistantProviderManager,
	type AssistantProviderSettings,
	defaultAssistantProviderSettings,
	JsonAssistantProviderSettingsStore,
	parseAssistantProviderSettings,
} from "./assistant-provider-manager.js";
import { codingBackendConfig } from "./coding-backend-config.js";
import {
	CodingPermissionManager,
	type CodingPermissionSettings,
	JsonCodingPermissionSettingsStore,
	parseCodingPermissionSettings,
} from "./coding-permission-manager.js";
import { AgentMeHost } from "./server.js";
import {
	JsonTencentChannelSettingsStore,
	parseTencentChannelSettings,
	TencentChannelManager,
	type TencentChannelSettings,
} from "./tencent-channel-manager.js";

interface HostSettings {
	readonly voice?: {
		readonly aliyunWorkspaceBaseUrl?: string;
		readonly localExecutable?: string;
		readonly localArgs?: readonly string[];
	};
	readonly assistant?: AssistantProviderSettings;
	readonly codingPermissions?: CodingPermissionSettings;
	readonly tencent?: TencentChannelSettings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadSettings(path: string): Promise<HostSettings> {
	let value: unknown;
	try {
		value = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
	if (
		!isRecord(value) ||
		Object.keys(value).some(
			(key) =>
				!["voice", "assistant", "codingPermissions", "tencent"].includes(key),
		)
	)
		throw new Error("AgentMe settings are invalid");
	let voice: HostSettings["voice"];
	if (value.voice !== undefined) {
		if (!isRecord(value.voice)) throw new Error("AgentMe settings are invalid");
		const input = value.voice;
		if (
			Object.keys(input).some(
				(key) =>
					!["aliyunWorkspaceBaseUrl", "localExecutable", "localArgs"].includes(
						key,
					),
			) ||
			(input.aliyunWorkspaceBaseUrl !== undefined &&
				typeof input.aliyunWorkspaceBaseUrl !== "string") ||
			(input.localExecutable !== undefined &&
				typeof input.localExecutable !== "string") ||
			(input.localArgs !== undefined &&
				(!Array.isArray(input.localArgs) ||
					input.localArgs.some((item) => typeof item !== "string")))
		)
			throw new Error("AgentMe settings are invalid");
		voice = {
			...(typeof input.aliyunWorkspaceBaseUrl === "string"
				? { aliyunWorkspaceBaseUrl: input.aliyunWorkspaceBaseUrl }
				: {}),
			...(typeof input.localExecutable === "string"
				? { localExecutable: input.localExecutable }
				: {}),
			...(Array.isArray(input.localArgs)
				? { localArgs: input.localArgs as string[] }
				: {}),
		};
	}
	return {
		...(voice === undefined ? {} : { voice }),
		...(value.assistant === undefined
			? {}
			: { assistant: parseAssistantProviderSettings(value.assistant) }),
		...(value.codingPermissions === undefined
			? {}
			: {
					codingPermissions: parseCodingPermissionSettings(
						value.codingPermissions,
					),
				}),
		...(value.tencent === undefined
			? {}
			: { tencent: parseTencentChannelSettings(value.tencent) }),
	};
}

function localVoiceArgs(settings: HostSettings): readonly string[] {
	const value = process.env.AGENTME_LOCAL_VOICE_ARGS;
	if (value === undefined) return settings.voice?.localArgs ?? [];
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string"))
		throw new Error("AGENTME_LOCAL_VOICE_ARGS is invalid");
	return parsed as string[];
}

function voiceRuntime(
	settings: HostSettings,
	store: SecretStore,
):
	| {
			readonly voice: SpokenConversationRouter;
			readonly wake?: SidecarSpeechProvider;
	  }
	| undefined {
	const providers: { local?: SpeechProvider; aliyun?: SpeechProvider } = {};
	let wake: SidecarSpeechProvider | undefined;
	const localExecutable =
		process.env.AGENTME_LOCAL_VOICE_EXECUTABLE ??
		settings.voice?.localExecutable;
	if (localExecutable !== undefined) {
		wake = new SidecarSpeechProvider({
			executable: localExecutable,
			args: localVoiceArgs(settings),
		});
		providers.local = wake;
	}
	const workspaceBaseUrl =
		process.env.AGENTME_ALIYUN_WORKSPACE_BASE_URL ??
		settings.voice?.aliyunWorkspaceBaseUrl;
	if (workspaceBaseUrl !== undefined) {
		providers.aliyun = new AliyunSpeechProvider(
			{
				workspaceBaseUrl,
				asrModel:
					process.env.AGENTME_ALIYUN_ASR_MODEL ?? "qwen-audio-3.0-asr-flash",
				ttsModel:
					process.env.AGENTME_ALIYUN_TTS_MODEL ?? "qwen-audio-3.0-tts-flash",
				voice: process.env.AGENTME_ALIYUN_TTS_VOICE ?? "longanhuan_v3.6",
			},
			{
				resolve: () =>
					store.get({ type: "secret-reference", id: "aliyun-api-key" }),
			},
		);
	}
	return providers.local === undefined && providers.aliyun === undefined
		? undefined
		: {
				voice: new SpokenConversationRouter(providers),
				...(wake === undefined ? {} : { wake }),
			};
}

const authToken = process.env.AGENTME_AUTH_TOKEN;
if (authToken === undefined) throw new Error("AGENTME_AUTH_TOKEN is required");

const databasePath = resolve(
	process.env.AGENTME_DATABASE_PATH ?? ".agentme/agentme.sqlite",
);
await mkdir(dirname(databasePath), { recursive: true });
const port = Number(process.env.AGENTME_PORT ?? "3210");
if (!Number.isInteger(port) || port < 0 || port > 65_535)
	throw new Error("AGENTME_PORT is invalid");
const fakeRuntimeDelayMs = Number(
	process.env.AGENTME_FAKE_RUNTIME_DELAY_MS ?? "30",
);
if (
	!Number.isSafeInteger(fakeRuntimeDelayMs) ||
	fakeRuntimeDelayMs < 0 ||
	fakeRuntimeDelayMs > 60_000
)
	throw new Error("AGENTME_FAKE_RUNTIME_DELAY_MS is invalid");

const repositoryConfigPath = process.env.AGENTME_REPOSITORIES_CONFIG;
const repositories =
	repositoryConfigPath === undefined
		? undefined
		: (JSON.parse(
				await readFile(resolve(repositoryConfigPath), "utf8"),
			) as RegisterRepositoryInput[]);
const codingOptions =
	repositories === undefined
		? {}
		: {
				repositories,
				...(await codingBackendConfig(dirname(databasePath))),
				taskRoot: resolve(
					process.env.AGENTME_TASK_ROOT ?? ".agentme/worktrees",
				),
				codex: {
					executable: process.env.AGENTME_CODEX_EXECUTABLE ?? "codex",
					...(process.env.AGENTME_CODEX_MODEL
						? { model: process.env.AGENTME_CODEX_MODEL }
						: {}),
					...(process.env.AGENTME_CODEX_WINDOWS_SANDBOX === "unelevated" ||
					process.env.AGENTME_CODEX_WINDOWS_SANDBOX === "elevated"
						? {
								windowsSandbox: process.env.AGENTME_CODEX_WINDOWS_SANDBOX as
									| "unelevated"
									| "elevated",
							}
						: {}),
					...(process.env.AGENTME_CODEX_RESOURCE_DIRECTORY
						? {
								resourceDirectory: process.env.AGENTME_CODEX_RESOURCE_DIRECTORY,
							}
						: {}),
				},
			};
const settingsPath = resolve(
	process.env.AGENTME_SETTINGS_PATH ?? ".agentme/settings.json",
);
const settings = await loadSettings(settingsPath);
const secretStore = createPlatformSecretStore({
	dataDirectory: resolve(
		process.env.AGENTME_SECRETS_DIRECTORY ?? ".agentme/secrets",
	),
});
const personalDashboard = new PersonalDashboardStore({
	path: resolve(
		process.env.AGENTME_PERSONAL_DASHBOARD_PATH ??
			join(dirname(databasePath), "personal-dashboard.enc"),
	),
	keys: secretStore,
});
const memory = new MemoryStore(
	resolve(
		process.env.AGENTME_MEMORY_DIRECTORY ??
			join(dirname(databasePath), "memory"),
	),
	resolve(
		process.env.AGENTME_MEMORY_INDEX_PATH ??
			join(dirname(databasePath), "memory-index.sqlite"),
	),
);
const skillWorkshopRoot = resolve(
	process.env.AGENTME_SKILL_WORKSHOP_DIRECTORY ??
		join(dirname(databasePath), "workshop-skills"),
);
const skillWorkshop = new SkillWorkshop(
	skillWorkshopRoot,
	resolve(
		process.env.AGENTME_SKILL_WORKSHOP_DATABASE_PATH ??
			join(dirname(databasePath), "skill-workshop.sqlite"),
	),
);
const skillEvaluator = new ProcessSkillEvaluator({
	isolationRoot: resolve(
		process.env.AGENTME_SKILL_EVALUATION_DIRECTORY ??
			join(dirname(databasePath), "skill-evaluation"),
	),
});
const voice = voiceRuntime(settings, secretStore);
const assistantProviders = new AssistantProviderManager({
	settings:
		settings.assistant ??
		defaultAssistantProviderSettings(settings.voice?.aliyunWorkspaceBaseUrl),
	settingsStore: new JsonAssistantProviderSettingsStore(settingsPath),
	secrets: secretStore,
	createModel: ({ endpoint, model, secret }) =>
		new DeepSeekAssistantModel(
			{ endpoint, model, secret, timeoutMs: 120_000 },
			{ secretStore },
		),
});
const codingPermissions = new CodingPermissionManager({
	settings:
		settings.codingPermissions ??
		parseCodingPermissionSettings({ activeProfileId: "safe-auto" }),
	settingsStore: new JsonCodingPermissionSettingsStore(settingsPath),
	approvals: new ApprovalStore(
		resolve(
			process.env.AGENTME_APPROVAL_DATABASE_PATH ??
				join(dirname(databasePath), "approvals.sqlite"),
		),
	),
	apply: () => undefined,
});
const standingIntents = new StandingIntentStore(
	resolve(
		process.env.AGENTME_STANDING_INTENT_DATABASE_PATH ??
			join(dirname(databasePath), "standing-intents.sqlite"),
	),
);
const tencentDatabasePath = resolve(
	process.env.AGENTME_TENCENT_DATABASE_PATH ??
		join(dirname(databasePath), "tencent-channel.sqlite"),
);
await mkdir(dirname(tencentDatabasePath), { recursive: true });
const tencentChannel = new TencentChannelManager({
	settings:
		settings.tencent ??
		parseTencentChannelSettings({
			isEnabled: false,
			ownerId: "",
			accountId: "agentme",
		}),
	settingsStore: new JsonTencentChannelSettingsStore(settingsPath),
	secrets: secretStore,
	databasePath: tencentDatabasePath,
	createChannel: createOfficialTencentChannel,
});
const host = new AgentMeHost({
	databasePath,
	authToken,
	fakeRuntimeDelayMs,
	desktopActions: new AllowlistedDesktopActionRuntime(
		new PlatformDesktopApplicationLauncher(),
	),
	assistantProviders,
	codingPermissions,
	codingPermissionAudit: (event) => {
		process.stderr.write(`${JSON.stringify(event)}\n`);
	},
	standingIntents,
	standingIntentAudit: (event) => {
		process.stderr.write(`${JSON.stringify(event)}\n`);
	},
	tencentChannel,
	personalDashboard,
	memory,
	skillWorkshop,
	skillEvaluator,
	skillWorkshopAudit: (event) => {
		process.stderr.write(`${JSON.stringify(event)}\n`);
	},
	automationAudit: (event) => {
		process.stderr.write(`${JSON.stringify(event)}\n`);
	},
	memoryAudit: (event) => {
		process.stderr.write(`${JSON.stringify(event)}\n`);
	},
	personalDashboardAudit: (event) => {
		process.stderr.write(`${JSON.stringify(event)}\n`);
	},
	...codingOptions,
	...(voice ?? {}),
});
await host.start(port);
process.stdout.write(`AgentMe host listening at ${host.url}\n`);

let isStopping = false;
async function stop(): Promise<void> {
	if (isStopping) return;
	isStopping = true;
	await host.stop();
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
