import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { AgentOffice } from "../../../packages/agent-office/src/office.js";
import {
	AssistantSessionStore,
	AssistantSupervisor,
	executePersonalDashboardCommand,
	type InspectableMemoryAuditEvent,
	type InspectableMemoryPort,
	matchPersonalDashboardCommand,
	OrchestratorWorkerDispatcher,
	type PersonalDashboardAuditEvent,
	type PersonalDashboardPort,
} from "../../../packages/assistant-supervisor/src/index.js";
import {
	DurableScheduler,
	type StandingIntentStore,
} from "../../../packages/automation-runtime/src/index.js";
import {
	AgentMeError,
	parsePersonalDashboardEntryInput,
	type TaskEvent,
} from "../../../packages/contracts/src/index.js";
import { ConversationHub } from "../../../packages/conversation-hub/src/hub.js";
import {
	object as conversationObject,
	invalid as invalidConversation,
} from "../../../packages/conversation-hub/src/storage.js";
import type {
	ExecutionResult,
	HubTask,
} from "../../../packages/conversation-hub/src/types.js";
import type {
	DesktopActionCompleted,
	DesktopActionRuntime,
} from "../../../packages/platform-runtime/src/index.js";
import { PluginRegistry } from "../../../packages/plugin-system/src/index.js";
import type {
	SkillEvaluator,
	SkillWorkshop,
} from "../../../packages/skill-workshop/src/index.js";
import {
	SupervisorGraphStore,
	TaskOrchestrator,
	type TaskRunner,
	TaskStore,
	VerifiedCodingTaskRunner,
} from "../../../packages/task-orchestrator/src/index.js";
import type {
	SpokenAudioInput,
	SpokenVoiceRuntime,
	VoiceRouteSelection,
} from "../../../packages/voice-runtime/src/index.js";
import {
	type RegisterRepositoryInput,
	RepositoryRegistry,
	WorktreeManager,
} from "../../../packages/workspace-manager/src/index.js";
import {
	ClaudeCliRuntime,
	type ClaudeRuntimeConfig,
} from "../../../plugins/runtime-claude/src/index.js";
import {
	CodexCliRuntime,
	type CodexRuntimeConfig,
} from "../../../plugins/runtime-codex/src/index.js";
import {
	PiRpcRuntime,
	type PiRuntimeConfig,
} from "../../../plugins/runtime-pi/src/index.js";
import {
	type DirectAssistantResponse,
	tryRespondToAssistantMessage,
} from "./assistant-message-response.js";
import {
	executeAssistantProviderRoute,
	matchAssistantProviderRoute,
} from "./assistant-provider-api.js";
import type { AssistantProviderService } from "./assistant-provider-manager.js";
import {
	type AutomationAuditEvent,
	executeAutomationRoute,
	matchAutomationRoute,
	parseScheduledAssistantPayload,
} from "./automation-api.js";
import { CodingBackendRouter } from "./coding-backend-router.js";
import {
	type CodingPermissionAuditEvent,
	executeCodingPermissionRoute,
	matchCodingPermissionRoute,
} from "./coding-permission-api.js";
import type { CodingPermissionService } from "./coding-permission-manager.js";
import {
	executeConversationOffice,
	taskInstructions,
} from "./conversation-office.js";
import { executeConversationVoice } from "./conversation-voice.js";
import type { FreeModelService } from "./free-models.js";
import { executeMemoryRoute, matchMemoryRoute } from "./memory-api.js";
import { executeOfficeRoute } from "./office-api.js";
import {
	executeSkillWorkshopRoute,
	matchSkillWorkshopRoute,
	type SkillWorkshopAuditEvent,
} from "./skill-workshop-api.js";
import {
	executeStandingIntentRoute,
	matchStandingIntentRoute,
	parseStandingIntentPayload,
	type StandingIntentAuditEvent,
} from "./standing-intent-api.js";
import { recordTaskExperience } from "./task-experience-recorder.js";
import {
	TaskWorkerSessionService,
	type WorkerConversationRuntime,
} from "./task-worker-session.js";
import {
	executeTencentChannelRoute,
	matchTencentChannelRoute,
} from "./tencent-channel-api.js";
import type { TencentChannelService } from "./tencent-channel-manager.js";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_VOICE_BODY_BYTES = 14 * 1024 * 1024;
const terminalStates = new Set([
	"completed",
	"cancelled",
	"failed",
	"rejected",
	"timed_out",
]);

const desktopOrigins = new Set([
	"http://127.0.0.1:1420",
	"http://tauri.localhost",
	"tauri://localhost",
]);

export interface AgentMeHostOptions {
	readonly freeModels?: FreeModelService;
	readonly databasePath: string;
	readonly authToken: string;
	readonly fakeRuntimeDelayMs?: number;
	readonly repositories?: readonly RegisterRepositoryInput[];
	readonly taskRoot?: string;
	readonly codex?: CodexRuntimeConfig;
	readonly claude?: ClaudeRuntimeConfig;
	readonly pi?: PiRuntimeConfig;
	readonly voice?: SpokenVoiceRuntime;
	readonly wake?: {
		detectWake(
			input: Omit<SpokenAudioInput, "route">,
			signal: AbortSignal,
		): Promise<{
			readonly awake: boolean;
			readonly phrase: string;
			readonly confidence: number;
		}>;
	};
	readonly desktopActions?: DesktopActionRuntime;
	readonly assistantProviders?: AssistantProviderService;
	readonly codingPermissions?: CodingPermissionService;
	readonly codingPermissionAudit?: (
		event: CodingPermissionAuditEvent,
	) => void | Promise<void>;
	readonly personalDashboard?: PersonalDashboardPort;
	readonly personalDashboardAudit?: (
		event: PersonalDashboardAuditEvent,
	) => void | Promise<void>;
	readonly memory?: InspectableMemoryPort;
	readonly memoryAudit?: (
		event: InspectableMemoryAuditEvent,
	) => void | Promise<void>;
	readonly skillWorkshop?: SkillWorkshop;
	readonly skillEvaluator?: SkillEvaluator;
	readonly skillWorkshopAudit?: (
		event: SkillWorkshopAuditEvent,
	) => void | Promise<void>;
	readonly automationAudit?: (
		event: AutomationAuditEvent,
	) => void | Promise<void>;
	readonly standingIntents?: StandingIntentStore;
	readonly standingIntentAudit?: (
		event: StandingIntentAuditEvent,
	) => void | Promise<void>;
	readonly tencentChannel?: TencentChannelService;
}

type AssistantSubmission =
	| (DesktopActionCompleted & { readonly sessionId: string })
	| {
			readonly type: "supervisor.delegated";
			readonly sessionId: string;
			readonly parentId: string;
	  }
	| DirectAssistantResponse
	| {
			readonly type: "assistant.responded";
			readonly responseKind: "personal-dashboard";
			readonly sessionId: string;
			readonly message: string;
			readonly entries?: Awaited<ReturnType<PersonalDashboardPort["list"]>>;
	  };

function isTaskRunner(value: unknown): value is TaskRunner {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Record<string, unknown>).execute === "function"
	);
}

export class AgentMeHost {
	readonly #office: AgentOffice;
	readonly #conversations: ConversationHub;
	#officeTimer: ReturnType<typeof setInterval> | undefined;
	readonly #options: AgentMeHostOptions;
	readonly #store: TaskStore;
	readonly #graphStore: SupervisorGraphStore;
	readonly #sessionStore: AssistantSessionStore;
	readonly #scheduler: DurableScheduler;
	readonly #registry: PluginRegistry;
	readonly #shutdown = new AbortController();
	readonly #voiceOperations = new Set<AbortController>();
	readonly #assistantOperations = new Set<AbortController>();
	#orchestrator: TaskOrchestrator | undefined;
	#supervisor: AssistantSupervisor | undefined;
	#server: Server | undefined;
	#url: string | undefined;
	#repositories: RepositoryRegistry | undefined;
	#workerSessions: TaskWorkerSessionService | undefined;
	#usingFakeRuntime = false;
	#runtimeIds: string[] = [];
	#automationTimer: ReturnType<typeof setInterval> | undefined;
	#automationDrain: Promise<void> | undefined;
	#standingIntentEvents: Promise<void> = Promise.resolve();
	#unsubscribeStandingIntentEvents: (() => void) | undefined;

	constructor(options: AgentMeHostOptions) {
		if (Buffer.byteLength(options.authToken) < 32)
			throw new TypeError("Host auth token must be at least 32 bytes");
		this.#options = options;
		this.#office = new AgentOffice(
			`${options.databasePath}.office.json`,
			options.assistantProviders === undefined
				? undefined
				: async (request, signal) => {
						const result = await options.assistantProviders?.respond(
							{ ...request, allowedRepositoryIds: [], allowedRuntimeIds: [] },
							signal,
						);
						return result?.message ?? "";
					},
		);
		this.#conversations = new ConversationHub(
			`${options.databasePath}.conversations.json`,
			{
				model: (messages, signal) => this.#conversationModel(messages, signal),
				getModelPolicy: () =>
					options.freeModels?.enabled
						? options.freeModels.policy()
						: { actions: "structured", contextCharacters: 10000 },
				execute: (task, signal, link) =>
					this.#executeConversationTask(task, signal, link),
				continue: (task, input, signal) =>
					this.#continueConversationTask(task, input, signal),
				validateTarget: (repositoryId, runtimeId) =>
					this.#runtimeIds.includes(runtimeId) &&
					!this.#usingFakeRuntime &&
					(this.#repositories?.list().some((r) => r.id === repositoryId) ??
						false),
			},
		);
		this.#store = new TaskStore(options.databasePath);
		this.#graphStore = new SupervisorGraphStore(options.databasePath);
		this.#sessionStore = new AssistantSessionStore(options.databasePath);
		this.#scheduler = new DurableScheduler(options.databasePath);
		this.#registry = new PluginRegistry({ agentmeVersion: "0.0.0" });
	}

	get url(): string {
		if (this.#url === undefined) throw new Error("Host has not started");
		return this.#url;
	}

	getTaskEvents(taskId: string) {
		return this.#store.getTaskEvents(taskId);
	}

	remoteTaskPorts(): {
		readonly taskSubmission: Pick<TaskOrchestrator, "submit" | "cancel">;
		readonly taskEvidence: Pick<TaskStore, "getTask" | "getTaskEvents">;
	} {
		return {
			taskSubmission: this.#requireOrchestrator(),
			taskEvidence: this.#store,
		};
	}

	async start(port = 0): Promise<void> {
		if (this.#server !== undefined) return;
		this.#officeTimer = setInterval(() => {
			void this.#office.drain();
		}, 1000);
		this.#officeTimer.unref();
		let runner: TaskRunner;
		const workerRuntimes: WorkerConversationRuntime[] = [];
		if ((this.#options.repositories?.length ?? 0) > 0) {
			if (!this.#options.taskRoot || !this.#options.codex)
				throw new TypeError(
					"Coding host requires taskRoot and Codex configuration",
				);
			this.#repositories = await RepositoryRegistry.create(
				this.#options.repositories?.map((repository) => repository.path) ?? [],
			);
			for (const repository of this.#options.repositories ?? [])
				await this.#repositories.register(repository);
			const worktrees = await WorktreeManager.create(
				this.#options.taskRoot,
				this.#repositories.list().map((repository) => repository.canonicalPath),
			);
			const codex = new CodexCliRuntime(this.#options.codex);
			this.#options.codingPermissions?.attachRuntime(codex);
			const backends = [
				{ id: "runtime-codex", runtime: codex },
				...(this.#options.claude
					? [
							{
								id: "runtime-claude",
								runtime: new ClaudeCliRuntime(this.#options.claude),
							},
						]
					: []),
				...(this.#options.pi
					? [{ id: "runtime-pi", runtime: new PiRpcRuntime(this.#options.pi) }]
					: []),
			];
			const runners = new Map<string, TaskRunner>();
			for (const { id, runtime } of backends) {
				runners.set(
					id,
					new VerifiedCodingTaskRunner(
						this.#repositories,
						worktrees,
						runtime,
						id,
					),
				);
				workerRuntimes.push({
					id,
					resume: (input, signal) =>
						runtime.resumeInWorktree(
							input.threadId,
							input.worktreePath,
							input.input,
							input.runId,
							signal,
						),
				});
			}
			this.#runtimeIds = [...runners.keys()];
			runner = new CodingBackendRouter(runners);
		} else {
			this.#usingFakeRuntime = true;
			this.#runtimeIds = ["runtime-fake"];
			const fakeManifest = fileURLToPath(
				new URL(
					"../../../plugins/runtime-fake/agentme.plugin.json",
					import.meta.url,
				),
			);
			await this.#registry.discover(fakeManifest);
			await this.#registry.enable("runtime-fake");
			await this.#registry.start(
				"runtime-fake",
				{
					taskId: "host-startup",
					actor: { type: "system", id: "agentme-host" },
					providerId: "runtime-fake",
					signal: this.#shutdown.signal,
					emit: () => undefined,
				},
				{ "runtime-fake": { delayMs: this.#options.fakeRuntimeDelayMs ?? 30 } },
			);
			const fakeRunner = this.#registry.getInstance(
				"runtime-fake",
				"runtime-fake",
			);
			if (!isTaskRunner(fakeRunner))
				throw new Error("Fake runtime did not provide a task runner");
			runner = fakeRunner;
		}
		this.#orchestrator = new TaskOrchestrator(this.#store, runner);
		if (this.#options.standingIntents !== undefined)
			this.#unsubscribeStandingIntentEvents = this.#orchestrator.subscribeAll(
				(event) => this.#queueStandingIntentEvent(event),
			);
		this.#workerSessions = new TaskWorkerSessionService({
			store: this.#store,
			graph: this.#graphStore,
			...(this.#repositories === undefined
				? {}
				: { repositories: this.#repositories }),
			...(this.#options.taskRoot === undefined
				? {}
				: { taskRoot: this.#options.taskRoot }),
			runtimes: workerRuntimes,
		});
		this.#supervisor = new AssistantSupervisor({
			store: this.#graphStore,
			dispatcher: new OrchestratorWorkerDispatcher(
				this.#orchestrator,
				this.#store,
			),
			scope: {
				hasRepository: (repositoryId) =>
					this.#usingFakeRuntime
						? repositoryId === "fake"
						: (this.#repositories
								?.list()
								.some(({ id }) => id === repositoryId) ?? false),
				hasRuntime: (runtimeId) => this.#runtimeIds.includes(runtimeId),
			},
			maxConcurrency: 2,
		});
		this.#automationTimer = setInterval(
			() => this.#scheduleAutomationDrain(),
			50,
		);
		this.#automationTimer.unref();
		await this.#options.tencentChannel?.bind(
			this.remoteTaskPorts(),
			this.#shutdown.signal,
		);
		this.#server = createServer(
			(request, response) => void this.#handle(request, response),
		);
		await new Promise<void>((resolveListen, reject) => {
			this.#server?.once("error", reject);
			this.#server?.listen(port, "127.0.0.1", () => resolveListen());
		});
		const address = this.#server.address();
		if (address === null || typeof address === "string")
			throw new Error("Host did not bind a TCP port");
		this.#url = `http://127.0.0.1:${address.port}`;
	}

	async stop(): Promise<void> {
		if (this.#server === undefined) return;
		if (this.#officeTimer !== undefined) clearInterval(this.#officeTimer);
		this.#conversations.shutdown();
		this.#office.shutdown();
		const server = this.#server;
		this.#server = undefined;
		this.#orchestrator?.stop();
		this.#unsubscribeStandingIntentEvents?.();
		this.#unsubscribeStandingIntentEvents = undefined;
		if (this.#automationTimer !== undefined) {
			clearInterval(this.#automationTimer);
			this.#automationTimer = undefined;
		}
		this.#shutdown.abort();
		await this.#automationDrain;
		await this.#standingIntentEvents;
		for (const operation of this.#voiceOperations) operation.abort();
		for (const operation of this.#assistantOperations) operation.abort();
		await new Promise<void>((resolveClose, reject) => {
			server.close((error) =>
				error === undefined ? resolveClose() : reject(error),
			);
		});
		await this.#options.tencentChannel?.close();
		await this.#options.memory?.close?.();
		this.#options.skillWorkshop?.close();
		this.#options.codingPermissions?.close();
		if (this.#usingFakeRuntime) await this.#registry.stop("runtime-fake");
		this.#sessionStore.close();
		this.#scheduler.close();
		this.#options.standingIntents?.close();
		await this.#conversations.stopped();
		this.#graphStore.close();
		this.#store.close();
		this.#url = undefined;
	}

	async #handle(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		try {
			const origin =
				typeof request.headers.origin === "string"
					? request.headers.origin
					: undefined;
			if (origin !== undefined && desktopOrigins.has(origin)) {
				response.setHeader("access-control-allow-origin", origin);
				response.setHeader("vary", "Origin");
			}
			if (request.method === "OPTIONS") {
				if (origin === undefined || !desktopOrigins.has(origin)) {
					this.#json(response, 403, {
						error: { code: "FORBIDDEN", message: "Origin is not allowed" },
					});
					return;
				}
				response.writeHead(204, {
					"access-control-allow-headers": "authorization, content-type",
					"access-control-allow-methods": "GET, POST, PUT, OPTIONS",
					"access-control-max-age": "600",
				});
				response.end();
				return;
			}
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (request.method === "GET" && url.pathname === "/health") {
				this.#json(response, 200, {
					status: "healthy",
					service: "agentme-host",
				});
				return;
			}
			if (
				request.method === "GET" &&
				(url.pathname === "/" || url.pathname.startsWith("/ui/"))
			) {
				await this.#serveOperatorUi(url.pathname, response);
				return;
			}
			if (!this.#isAuthorized(request)) {
				this.#json(response, 401, {
					error: { code: "UNAUTHORIZED", message: "Authentication required" },
				});
				return;
			}
			if (request.method === "POST" && url.pathname === "/shutdown") {
				this.#json(response, 202, { status: "stopping" });
				setImmediate(() => void this.stop());
				return;
			}
			if (url.pathname.startsWith("/conversation-voice/")) {
				if (
					request.method !== "POST" ||
					!(request.headers["content-type"] ?? "")
						.toLowerCase()
						.startsWith("application/json")
				) {
					this.#json(response, 415, {
						error: { message: "JSON POST required" },
					});
					return;
				}
				const body = await this.#readJson(request, 6 * 1024 * 1024);
				const result = await this.#runAssistantOperation(request, (signal) =>
					executeConversationVoice(
						this.#options.voice,
						url.pathname.slice("/conversation-voice/".length),
						body,
						AbortSignal.any([signal, AbortSignal.timeout(60000)]),
					),
				);
				this.#json(response, 200, result);
				return;
			}
			if (
				url.pathname === "/model-offers" ||
				url.pathname === "/model-offers/refresh" ||
				url.pathname === "/model-offers/settings"
			) {
				response.setHeader("cache-control", "no-store");
				const service = this.#options.freeModels;
				if (!service) {
					this.#json(response, 503, {
						error: { message: "官方模型目录未配置" },
					});
					return;
				}
				if (request.method === "GET" && url.pathname === "/model-offers") {
					await this.#runAssistantOperation(request, (signal) =>
						service.refreshIfEnabled(signal),
					);
					this.#json(response, 200, service.view());
					return;
				}
				if (
					request.method === "POST" &&
					(request.headers["content-type"] ?? "")
						.toLowerCase()
						.startsWith("application/json")
				) {
					const body = conversationObject(await this.#readJson(request));
					if (url.pathname === "/model-offers/refresh") {
						if (Object.keys(body).length) invalidConversation();
						await this.#runAssistantOperation(request, (signal) =>
							service.refresh(signal),
						);
					} else if (url.pathname === "/model-offers/settings")
						await this.#runAssistantOperation(request, (signal) =>
							service.configure(body, signal),
						);
					else invalidConversation();
					this.#json(response, 200, service.view());
					return;
				}
				this.#json(response, 415, {
					error: { message: "JSON POST or GET required" },
				});
				return;
			}
			if (
				url.pathname === "/conversations" ||
				url.pathname.startsWith("/conversations/")
			) {
				response.setHeader("cache-control", "no-store");
				const mutation = request.method === "POST";
				if (
					mutation &&
					!(request.headers["content-type"] ?? "")
						.toLowerCase()
						.startsWith("application/json")
				) {
					this.#json(response, 415, {
						error: { message: "JSON content required" },
					});
					return;
				}
				if (url.pathname === "/conversations" && request.method === "GET") {
					this.#json(response, 200, {
						conversations: this.#conversations.list(),
					});
					return;
				}
				if (url.pathname === "/conversations" && mutation) {
					const body = conversationObject(await this.#readJson(request));
					if (Object.keys(body).length) invalidConversation();
					this.#json(response, 201, this.#conversations.createConversation());
					return;
				}
				const match = /^\/conversations\/([a-f0-9-]{36})(\/messages)?$/u.exec(
					url.pathname,
				);
				if (match && request.method === "GET" && !match[2]) {
					this.#json(
						response,
						200,
						this.#conversations.snapshot(match[1] ?? ""),
					);
					return;
				}
				if (match && mutation && match[2]) {
					const body = conversationObject(await this.#readJson(request));
					if ("conversationId" in body) invalidConversation();
					const result = await this.#runAssistantOperation(request, (signal) =>
						this.#conversations.send(
							{ ...body, conversationId: match[1] },
							signal,
						),
					);
					this.#json(response, 200, result);
					return;
				}
				this.#json(response, 404, {
					error: { message: "Conversation route not found" },
				});
				return;
			}
			if (url.pathname === "/office" || url.pathname.startsWith("/office/")) {
				response.setHeader("cache-control", "no-store");
				const mutation = request.method === "POST" || request.method === "PUT";
				if (
					mutation &&
					!(request.headers["content-type"] ?? "")
						.toLowerCase()
						.startsWith("application/json")
				) {
					this.#json(response, 415, {
						error: {
							code: "UNSUPPORTED_MEDIA_TYPE",
							message: "JSON content required",
						},
					});
					return;
				}
				const body = mutation ? await this.#readJson(request) : undefined;
				const result = await executeOfficeRoute(
					this.#office,
					request.method ?? "GET",
					url.pathname,
					body,
					this.#options.assistantProviders,
					this.#shutdown.signal,
				);
				this.#json(response, result.status, result.body);
				return;
			}
			const codingPermissionRoute = matchCodingPermissionRoute(
				request.method,
				url.pathname,
			);
			if (codingPermissionRoute !== undefined) {
				response.setHeader("cache-control", "no-store");
				const contentType = request.headers["content-type"];
				const body =
					codingPermissionRoute.type === "coding-permissions.activate" &&
					contentType?.toLowerCase().startsWith("application/json")
						? await this.#readJson(request)
						: undefined;
				const catalog = await this.#runAssistantOperation(request, (signal) =>
					executeCodingPermissionRoute(
						this.#requireCodingPermissions(),
						codingPermissionRoute,
						{
							...(contentType === undefined ? {} : { contentType }),
							...(body === undefined ? {} : { body }),
							...(this.#options.codingPermissionAudit === undefined
								? {}
								: { audit: this.#options.codingPermissionAudit }),
						},
						signal,
					),
				);
				this.#json(response, 200, catalog);
				return;
			}
			const standingIntentRoute = matchStandingIntentRoute(
				request.method,
				url.pathname,
			);
			if (standingIntentRoute !== undefined) {
				response.setHeader("cache-control", "no-store");
				const contentType = request.headers["content-type"];
				const body =
					standingIntentRoute.type === "standing-intent.create" &&
					contentType?.toLowerCase().startsWith("application/json")
						? await this.#readJson(request)
						: undefined;
				const result = await executeStandingIntentRoute(
					this.#requireStandingIntents(),
					standingIntentRoute,
					{
						...(contentType === undefined ? {} : { contentType }),
						...(body === undefined ? {} : { body }),
						...(this.#options.standingIntentAudit === undefined
							? {}
							: { audit: this.#options.standingIntentAudit }),
					},
				);
				this.#json(
					response,
					standingIntentRoute.type === "standing-intent.create" ? 201 : 200,
					result,
				);
				return;
			}
			const automationRoute = matchAutomationRoute(
				request.method,
				url.pathname,
			);
			if (automationRoute !== undefined) {
				response.setHeader("cache-control", "no-store");
				const contentType = request.headers["content-type"];
				const body =
					automationRoute.type === "automation.create" &&
					contentType?.toLowerCase().startsWith("application/json")
						? await this.#readJson(request)
						: undefined;
				const result = await executeAutomationRoute(
					this.#scheduler,
					automationRoute,
					{
						...(contentType === undefined ? {} : { contentType }),
						...(body === undefined ? {} : { body }),
						...(this.#options.automationAudit === undefined
							? {}
							: { audit: this.#options.automationAudit }),
					},
				);
				this.#json(
					response,
					automationRoute.type === "automation.create" ? 201 : 200,
					result,
				);
				return;
			}
			const memoryRoute = matchMemoryRoute(request.method, url.pathname);
			if (memoryRoute !== undefined) {
				response.setHeader("cache-control", "no-store");
				const contentType = request.headers["content-type"];
				const body =
					request.method === "POST" &&
					contentType?.toLowerCase().startsWith("application/json")
						? await this.#readJson(request)
						: undefined;
				const result = await this.#runAssistantOperation(request, (signal) =>
					executeMemoryRoute(
						this.#requireMemory(),
						memoryRoute,
						{
							query: url.searchParams,
							...(contentType === undefined ? {} : { contentType }),
							...(body === undefined ? {} : { body }),
							...(this.#options.memoryAudit === undefined
								? {}
								: { audit: this.#options.memoryAudit }),
						},
						signal,
					),
				);
				this.#json(
					response,
					memoryRoute.type === "memory.create" ? 201 : 200,
					result,
				);
				return;
			}
			const skillRoute = matchSkillWorkshopRoute(request.method, url.pathname);
			if (skillRoute !== undefined) {
				response.setHeader("cache-control", "no-store");
				const contentType = request.headers["content-type"];
				const body =
					request.method === "POST" &&
					contentType?.toLowerCase().startsWith("application/json")
						? await this.#readJson(request)
						: undefined;
				const result = await this.#runAssistantOperation(request, (signal) =>
					executeSkillWorkshopRoute(
						this.#requireSkillWorkshop(),
						this.#requireSkillEvaluator(),
						skillRoute,
						{
							query: url.searchParams,
							...(contentType === undefined ? {} : { contentType }),
							...(body === undefined ? {} : { body }),
							...(this.#options.skillWorkshopAudit === undefined
								? {}
								: { audit: this.#options.skillWorkshopAudit }),
						},
						signal,
					),
				);
				this.#json(
					response,
					skillRoute.type === "skill-proposal.create" ? 201 : 200,
					result,
				);
				return;
			}
			if (url.pathname.startsWith("/personal-dashboard")) {
				await this.#handlePersonalDashboard(request, response, url);
				return;
			}
			const tencentChannelRoute = matchTencentChannelRoute(
				request.method,
				url.pathname,
			);
			if (tencentChannelRoute !== undefined) {
				response.setHeader("cache-control", "no-store");
				const contentType = request.headers["content-type"];
				const body =
					tencentChannelRoute.type === "tencent-channel.replace" &&
					contentType?.toLowerCase().startsWith("application/json")
						? await this.#readJson(request)
						: undefined;
				const view = await this.#runAssistantOperation(request, (signal) =>
					executeTencentChannelRoute(
						this.#requireTencentChannel(),
						tencentChannelRoute,
						{
							...(contentType === undefined ? {} : { contentType }),
							...(body === undefined ? {} : { body }),
						},
						signal,
					),
				);
				this.#json(response, 200, view);
				return;
			}
			if (request.method === "POST" && url.pathname === "/tasks") {
				await this.#createTask(request, response);
				return;
			}
			if (request.method === "POST" && url.pathname === "/assistant/messages") {
				await this.#createAssistantMessage(request, response);
				return;
			}
			if (request.method === "GET" && url.pathname === "/assistant/parents") {
				const limitValue = url.searchParams.get("limit");
				const limit = limitValue === null ? 20 : Number(limitValue);
				const cursor = url.searchParams.get("cursor") ?? undefined;
				const page = this.#graphStore.listParentPage("local-owner", {
					limit,
					...(cursor === undefined ? {} : { cursor }),
				});
				const items = await Promise.all(
					page.parents.map(({ parentId }) =>
						this.#refreshSupervisorParent(parentId),
					),
				);
				this.#json(response, 200, {
					items,
					...(page.nextCursor === undefined
						? {}
						: { nextCursor: page.nextCursor }),
				});
				return;
			}
			const providerRoute = matchAssistantProviderRoute(
				request.method,
				url.pathname,
			);
			if (providerRoute !== undefined) {
				const contentType = request.headers["content-type"];
				const body =
					providerRoute.type === "provider.configure" &&
					contentType?.toLowerCase().startsWith("application/json")
						? await this.#readJson(request)
						: undefined;
				const catalog = await this.#runAssistantOperation(request, (signal) =>
					executeAssistantProviderRoute(
						this.#requireAssistantProviders(),
						providerRoute,
						{
							...(contentType === undefined ? {} : { contentType }),
							...(body === undefined ? {} : { body }),
						},
						signal,
					),
				);
				this.#json(response, 200, catalog);
				return;
			}
			if (
				request.method === "POST" &&
				url.pathname === "/assistant/voice/wake"
			) {
				await this.#detectVoiceWake(request, response);
				return;
			}
			if (
				request.method === "POST" &&
				url.pathname === "/assistant/voice/messages"
			) {
				await this.#createSpokenAssistantMessage(request, response);
				return;
			}
			const sessionMatch =
				/^\/assistant\/sessions\/([0-9a-f-]+)\/messages$/.exec(url.pathname);
			if (sessionMatch !== null) {
				const matchedSessionId = sessionMatch[1] ?? "";
				if (request.method === "GET") {
					this.#json(response, 200, {
						sessionId: matchedSessionId,
						messages: this.#sessionStore.listMessages(matchedSessionId),
					});
					return;
				}
				if (request.method === "DELETE") {
					this.#json(response, 200, {
						deleted: this.#sessionStore.deleteSession(matchedSessionId),
					});
					return;
				}
			}
			const parentMatch =
				/^\/assistant\/parents\/([0-9a-f-]+)(?:\/(events)|\/children\/([0-9a-f-]+)\/cancel)?$/.exec(
					url.pathname,
				);
			if (parentMatch !== null) {
				const parentId = parentMatch[1] ?? "";
				if (
					request.method === "GET" &&
					parentMatch[2] === undefined &&
					parentMatch[3] === undefined
				) {
					this.#json(
						response,
						200,
						await this.#refreshSupervisorParent(parentId),
					);
					return;
				}
				if (request.method === "GET" && parentMatch[2] === "events") {
					this.#streamSupervisorEvents(parentId, response);
					return;
				}
				if (request.method === "POST" && parentMatch[3] !== undefined) {
					await this.#requireSupervisor().cancelChild(parentId, parentMatch[3]);
					this.#json(response, 202, {
						parent: this.#graphStore.getParent(parentId),
						children: this.#graphStore.listChildren(parentId),
					});
					return;
				}
			}
			const workerMatch =
				/^\/assistant\/parents\/([0-9a-f-]+)\/children\/([0-9a-f-]+)\/(activity|turns)$/.exec(
					url.pathname,
				);
			if (workerMatch !== null) {
				const parentId = workerMatch[1] ?? "";
				const childId = workerMatch[2] ?? "";
				if (request.method === "GET" && workerMatch[3] === "activity") {
					const afterValue = url.searchParams.get("afterId");
					const afterId = afterValue === null ? 0 : Number(afterValue);
					this.#json(
						response,
						200,
						this.#requireWorkerSessions().activity(parentId, childId, afterId),
					);
					return;
				}
				if (request.method === "POST" && workerMatch[3] === "turns") {
					if (
						!(request.headers["content-type"] ?? "")
							.toLowerCase()
							.startsWith("application/json")
					) {
						this.#json(response, 415, {
							error: {
								code: "UNSUPPORTED_MEDIA_TYPE",
								message: "JSON content required",
							},
						});
						return;
					}
					const body = await this.#readJson(request);
					if (
						typeof body !== "object" ||
						body === null ||
						Array.isArray(body) ||
						typeof (body as Record<string, unknown>).message !== "string" ||
						Object.keys(body).some((key) => key !== "message")
					) {
						this.#json(response, 422, {
							error: {
								code: "INVALID_REQUEST",
								message: "Invalid worker turn",
							},
						});
						return;
					}
					const result = await this.#runAssistantOperation(request, (signal) =>
						this.#requireWorkerSessions().continue(
							parentId,
							childId,
							(body as { message: string }).message,
							signal,
						),
					);
					this.#json(response, 200, result);
					return;
				}
			}
			if (request.method === "GET" && url.pathname === "/repositories") {
				this.#json(response, 200, {
					runtimes: this.#runtimeIds.map((id) => ({
						id,
						name:
							(
								{
									"runtime-codex": "Codex",
									"runtime-claude": "Claude Code",
									"runtime-pi": "Pi",
									"runtime-fake": "演示后端",
								} as Record<string, string>
							)[id] ?? id,
					})),
					repositories: this.#repositories
						?.list()
						.map(({ id }) => ({ id })) ?? [{ id: "fake" }],
				});
				return;
			}
			const match = /^\/tasks\/([0-9a-f-]+)(?:\/(events|cancel))?$/.exec(
				url.pathname,
			);
			if (match === null) {
				this.#json(response, 404, {
					error: { code: "NOT_FOUND", message: "Route not found" },
				});
				return;
			}
			const taskId = match[1] ?? "";
			if (request.method === "GET" && match[2] === undefined) {
				this.#json(response, 200, this.#store.getTask(taskId));
				return;
			}
			if (request.method === "GET" && match[2] === "events") {
				this.#streamEvents(taskId, response);
				return;
			}
			if (request.method === "POST" && match[2] === "cancel") {
				this.#orchestrator?.cancel(taskId);
				this.#json(response, 202, this.#store.getTask(taskId));
				return;
			}
			this.#json(response, 405, {
				error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
			});
		} catch (error) {
			if (error instanceof AgentMeError) {
				const status =
					error.code === "TASK_NOT_FOUND"
						? 404
						: error.code === "PERMISSION_DENIED"
							? 403
							: error.code === "INVALID_CONTRACT"
								? 422
								: 409;
				this.#json(response, status, {
					error: error.toJSON(),
				});
				return;
			}
			this.#json(response, 500, {
				error: { code: "INTERNAL_ERROR", message: "Request failed" },
			});
		}
	}

	async #handlePersonalDashboard(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
	): Promise<void> {
		try {
			response.setHeader("cache-control", "no-store");
			const dashboard = this.#requirePersonalDashboard();
			if (request.method === "GET" && url.pathname === "/personal-dashboard") {
				const allowedTypes = new Set([
					"balance",
					"income",
					"expense",
					"investment",
					"competition",
					"skill",
				]);
				const type = url.searchParams.get("type");
				const limit = Number(url.searchParams.get("limit") ?? "50");
				const offset = Number(url.searchParams.get("offset") ?? "0");
				if (
					[...url.searchParams.keys()].some(
						(key) => !["type", "limit", "offset"].includes(key),
					) ||
					(type !== null && !allowedTypes.has(type)) ||
					!Number.isSafeInteger(limit) ||
					limit < 1 ||
					limit > 100 ||
					!Number.isSafeInteger(offset) ||
					offset < 0 ||
					offset > 512
				) {
					this.#invalidDashboardRequest(response);
					return;
				}
				const entries = await this.#runAssistantOperation(request, (signal) =>
					dashboard.list(signal),
				);
				const filtered =
					type === null
						? entries
						: entries.filter((entry) => entry.type === type);
				this.#json(response, 200, {
					data: filtered.slice(offset, offset + limit),
					pagination: { offset, limit, totalItems: filtered.length },
				});
				return;
			}
			if (
				request.method === "GET" &&
				url.pathname === "/personal-dashboard/export" &&
				url.search === ""
			) {
				const serialized = await this.#runAssistantOperation(
					request,
					(signal) => dashboard.export(signal),
				);
				this.#json(response, 200, JSON.parse(serialized));
				return;
			}
			if (
				request.method === "POST" &&
				url.pathname === "/personal-dashboard/entries"
			) {
				const body = await this.#readDashboardJson(request, response);
				if (body === undefined) return;
				const input = parsePersonalDashboardEntryInput(body);
				const entry = await this.#runAssistantOperation(request, (signal) =>
					dashboard.create(input, signal),
				);
				await this.#auditDashboard({
					type: "personal-dashboard.mutated",
					operation: "created",
					entryId: entry.id,
					entryType: entry.type,
					at: new Date().toISOString(),
				});
				this.#json(response, 201, { entry });
				return;
			}
			const updateMatch =
				/^\/personal-dashboard\/entries\/([a-z0-9][a-z0-9._-]{0,127})$/iu.exec(
					url.pathname,
				);
			if (request.method === "POST" && updateMatch !== null) {
				const body = await this.#readDashboardJson(request, response);
				if (body === undefined) return;
				const input = parsePersonalDashboardEntryInput(body);
				const entry = await this.#runAssistantOperation(request, (signal) =>
					dashboard.update(updateMatch[1] ?? "", input, signal),
				);
				await this.#auditDashboard({
					type: "personal-dashboard.mutated",
					operation: "updated",
					entryId: entry.id,
					entryType: entry.type,
					at: new Date().toISOString(),
				});
				this.#json(response, 200, { entry });
				return;
			}
			if (
				request.method === "POST" &&
				url.pathname === "/personal-dashboard/removals"
			) {
				const body = await this.#readDashboardJson(request, response);
				if (body === undefined) return;
				if (
					typeof body !== "object" ||
					body === null ||
					Array.isArray(body) ||
					Object.keys(body).length !== 1 ||
					typeof (body as Record<string, unknown>).id !== "string" ||
					!/^[-a-z0-9._]{1,128}$/iu.test((body as { id: string }).id) ||
					!/^[a-z0-9]/iu.test((body as { id: string }).id)
				) {
					this.#invalidDashboardRequest(response);
					return;
				}
				const id = (body as { id: string }).id;
				const deleted = await this.#runAssistantOperation(request, (signal) =>
					dashboard.delete(id, signal),
				);
				if (deleted)
					await this.#auditDashboard({
						type: "personal-dashboard.mutated",
						operation: "deleted",
						entryId: id,
						at: new Date().toISOString(),
					});
				this.#json(response, 200, { deleted });
				return;
			}
			this.#json(response, 404, {
				error: { code: "NOT_FOUND", message: "Route not found" },
			});
		} catch (error) {
			if (error instanceof AgentMeError && error.code === "INVALID_CONTRACT") {
				this.#invalidDashboardRequest(response);
				return;
			}
			throw error;
		}
	}

	async #serveOperatorUi(
		pathname: string,
		response: ServerResponse,
	): Promise<void> {
		const file =
			pathname === "/" || pathname === "/ui/"
				? "index.html"
				: pathname.slice(4);
		if (
			!["index.html", "styles.css", "app.js", "token-connection.js"].includes(
				file,
			)
		) {
			this.#json(response, 404, {
				error: { code: "NOT_FOUND", message: "Asset not found" },
			});
			return;
		}
		const content = await readFile(
			new URL(`../../operator-ui/${file}`, import.meta.url),
		);
		const type = file.endsWith(".css")
			? "text/css"
			: file.endsWith(".js")
				? "text/javascript"
				: "text/html";
		response.writeHead(200, {
			"content-type": `${type}; charset=utf-8`,
			"cache-control": "no-store",
		});
		response.end(content);
	}

	async #runAssistantOperation<T>(
		request: IncomingMessage,
		operation: (signal: AbortSignal) => Promise<T>,
	): Promise<T> {
		const controller = new AbortController();
		this.#assistantOperations.add(controller);
		const abort = () => controller.abort();
		request.once("aborted", abort);
		try {
			return await operation(controller.signal);
		} finally {
			request.removeListener("aborted", abort);
			this.#assistantOperations.delete(controller);
		}
	}

	async #createTask(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		if (
			!(request.headers["content-type"] ?? "")
				.toLowerCase()
				.startsWith("application/json")
		) {
			this.#json(response, 415, {
				error: {
					code: "UNSUPPORTED_MEDIA_TYPE",
					message: "JSON content required",
				},
			});
			return;
		}
		const input = await this.#readJson(request);
		const instructionValue =
			typeof input === "object" && input !== null && !Array.isArray(input)
				? (input as Record<string, unknown>).instruction
				: undefined;
		const repositoryIdValue =
			typeof input === "object" && input !== null && !Array.isArray(input)
				? (input as Record<string, unknown>).repositoryId
				: undefined;
		if (
			typeof instructionValue !== "string" ||
			instructionValue.trim().length < 1 ||
			instructionValue.length > 4_000 ||
			(repositoryIdValue !== undefined &&
				typeof repositoryIdValue !== "string") ||
			Object.keys(input as object).some(
				(key) => key !== "instruction" && key !== "repositoryId",
			)
		) {
			this.#json(response, 422, {
				error: { code: "INVALID_REQUEST", message: "Invalid task request" },
			});
			return;
		}
		const instruction = instructionValue.trim();
		const taskId = this.#requireOrchestrator().submit({
			instruction,
			actorId: "local-owner",
			...(typeof repositoryIdValue === "string"
				? { repositoryId: repositoryIdValue }
				: {}),
		});
		this.#json(response, 202, { taskId });
	}

	async #createAssistantMessage(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		if (
			!(request.headers["content-type"] ?? "")
				.toLowerCase()
				.startsWith("application/json")
		) {
			this.#json(response, 415, {
				error: {
					code: "UNSUPPORTED_MEDIA_TYPE",
					message: "JSON content required",
				},
			});
			return;
		}
		const input = await this.#readJson(request);
		if (typeof input !== "object" || input === null || Array.isArray(input)) {
			this.#json(response, 422, {
				error: {
					code: "INVALID_REQUEST",
					message: "Invalid assistant request",
				},
			});
			return;
		}
		const value = input as Record<string, unknown>;
		if (
			typeof value.message !== "string" ||
			typeof value.repositoryId !== "string" ||
			typeof value.runtimeId !== "string" ||
			(value.sessionId !== undefined && typeof value.sessionId !== "string") ||
			Object.keys(value).some(
				(key) =>
					!["message", "repositoryId", "runtimeId", "sessionId"].includes(key),
			)
		) {
			this.#json(response, 422, {
				error: {
					code: "INVALID_REQUEST",
					message: "Invalid assistant request",
				},
			});
			return;
		}
		const operation = new AbortController();
		this.#assistantOperations.add(operation);
		const abort = () => operation.abort();
		request.once("aborted", abort);
		try {
			const submission = await this.#submitAssistantMessage(
				{
					message: value.message,
					repositoryId: value.repositoryId,
					runtimeId: value.runtimeId,
					...(typeof value.sessionId === "string"
						? { sessionId: value.sessionId }
						: {}),
				},
				operation.signal,
			);
			this.#json(
				response,
				submission.type === "supervisor.delegated" ? 202 : 200,
				submission,
			);
		} finally {
			request.removeListener("aborted", abort);
			this.#assistantOperations.delete(operation);
		}
	}

	async #createSpokenAssistantMessage(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		if (
			!(request.headers["content-type"] ?? "")
				.toLowerCase()
				.startsWith("application/json")
		) {
			this.#json(response, 415, {
				error: {
					code: "UNSUPPORTED_MEDIA_TYPE",
					message: "JSON content required",
				},
			});
			return;
		}
		const input = await this.#readJson(request, MAX_VOICE_BODY_BYTES);
		if (typeof input !== "object" || input === null || Array.isArray(input)) {
			this.#json(response, 422, {
				error: { code: "INVALID_REQUEST", message: "Invalid voice request" },
			});
			return;
		}
		const value = input as Record<string, unknown>;
		const mimeTypes = new Set([
			"audio/wav",
			"audio/webm",
			"audio/ogg",
			"audio/mp3",
		]);
		const routes = new Set<VoiceRouteSelection>(["local", "aliyun", "auto"]);
		if (
			typeof value.audioBase64 !== "string" ||
			value.audioBase64.length < 8 ||
			value.audioBase64.length > 13_981_016 ||
			!/^[A-Za-z0-9+/]+={0,2}$/u.test(value.audioBase64) ||
			typeof value.mimeType !== "string" ||
			!mimeTypes.has(value.mimeType) ||
			typeof value.route !== "string" ||
			!routes.has(value.route as VoiceRouteSelection) ||
			typeof value.repositoryId !== "string" ||
			typeof value.runtimeId !== "string" ||
			(value.sessionId !== undefined && typeof value.sessionId !== "string") ||
			Object.keys(value).some(
				(key) =>
					![
						"audioBase64",
						"mimeType",
						"route",
						"repositoryId",
						"runtimeId",
						"sessionId",
					].includes(key),
			)
		) {
			this.#json(response, 422, {
				error: { code: "INVALID_REQUEST", message: "Invalid voice request" },
			});
			return;
		}
		if (this.#options.voice === undefined)
			throw new AgentMeError({
				code: "PROVIDER_UNAVAILABLE",
				message: "Voice providers are not configured",
				isRetryable: true,
			});
		const operation = new AbortController();
		this.#voiceOperations.add(operation);
		response.once("close", () => {
			operation.abort();
			this.#voiceOperations.delete(operation);
		});
		const route = value.route as VoiceRouteSelection;
		const transcription = await this.#options.voice.transcribe(
			{
				audio: Buffer.from(value.audioBase64, "base64"),
				mimeType: value.mimeType as
					| "audio/wav"
					| "audio/webm"
					| "audio/ogg"
					| "audio/mp3",
				route,
			},
			operation.signal,
		);
		if (
			/^(?:停止|取消|停下|stop|cancel)[。.!！ ]*$/iu.test(transcription.value)
		) {
			this.#json(response, 200, {
				control: "stop",
				transcript: transcription.value,
				voice: {
					providerId: transcription.providerId,
					fallbackUsed: transcription.fallbackUsed,
				},
			});
			return;
		}
		const submission = await this.#submitAssistantMessage(
			{
				message: transcription.value,
				repositoryId: value.repositoryId,
				runtimeId: value.runtimeId,
				...(typeof value.sessionId === "string"
					? { sessionId: value.sessionId }
					: {}),
			},
			operation.signal,
		);
		const acknowledgement =
			submission.type === "desktop-action.completed"
				? submission.acknowledgement
				: submission.type === "assistant.responded"
					? submission.message
					: "已收到语音目标，任务已交给执行 Agent。";
		let speech:
			| Awaited<ReturnType<SpokenVoiceRuntime["synthesize"]>>
			| undefined;
		try {
			speech = await this.#options.voice.synthesize(
				acknowledgement,
				route,
				operation.signal,
			);
		} catch {
			// Acknowledgement audio is best-effort after the durable task exists.
		}
		this.#json(
			response,
			submission.type === "supervisor.delegated" ? 202 : 200,
			{
				...submission,
				transcript: transcription.value,
				voice: {
					providerId: transcription.providerId,
					fallbackUsed: transcription.fallbackUsed,
				},
				acknowledgement,
				...(speech === undefined
					? {}
					: {
							speech: speech.value,
							speechRoute: {
								providerId: speech.providerId,
								fallbackUsed: speech.fallbackUsed,
							},
						}),
			},
		);
	}

	async #detectVoiceWake(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		if (
			!(request.headers["content-type"] ?? "")
				.toLowerCase()
				.startsWith("application/json")
		) {
			this.#json(response, 415, {
				error: {
					code: "UNSUPPORTED_MEDIA_TYPE",
					message: "JSON content required",
				},
			});
			return;
		}
		const input = await this.#readJson(request, MAX_VOICE_BODY_BYTES);
		if (typeof input !== "object" || input === null || Array.isArray(input)) {
			this.#json(response, 422, {
				error: { code: "INVALID_REQUEST", message: "Invalid wake request" },
			});
			return;
		}
		const value = input as Record<string, unknown>;
		if (
			typeof value.audioBase64 !== "string" ||
			value.audioBase64.length < 8 ||
			value.audioBase64.length > 13_981_016 ||
			!/^[A-Za-z0-9+/]+={0,2}$/u.test(value.audioBase64) ||
			value.mimeType !== "audio/wav" ||
			Object.keys(value).some(
				(key) => !["audioBase64", "mimeType"].includes(key),
			)
		) {
			this.#json(response, 422, {
				error: { code: "INVALID_REQUEST", message: "Invalid wake request" },
			});
			return;
		}
		if (this.#options.voice === undefined && this.#options.wake === undefined)
			throw new AgentMeError({
				code: "PROVIDER_UNAVAILABLE",
				message: "Local voice provider is not configured",
				isRetryable: true,
			});
		const operation = new AbortController();
		this.#voiceOperations.add(operation);
		response.once("close", () => {
			operation.abort();
			this.#voiceOperations.delete(operation);
		});
		const phrase = "你好小麦";
		if (this.#options.wake !== undefined) {
			const detection = await this.#options.wake.detectWake(
				{
					audio: Buffer.from(value.audioBase64, "base64"),
					mimeType: "audio/wav",
				},
				operation.signal,
			);
			this.#json(response, 200, detection);
			return;
		}
		const transcription = await this.#options.voice?.transcribe(
			{
				audio: Buffer.from(value.audioBase64, "base64"),
				mimeType: "audio/wav",
				route: "local",
			},
			operation.signal,
		);
		if (transcription === undefined) throw new TypeError("Voice unavailable");
		const normalized = transcription.value.replace(/[\s，。！？,.!?]/gu, "");
		this.#json(response, 200, {
			awake: normalized.includes(phrase),
			phrase,
		});
	}

	async #submitAssistantMessage(
		value: {
			readonly message: string;
			readonly repositoryId: string;
			readonly runtimeId: string;
			readonly sessionId?: string;
		},
		signal: AbortSignal,
	): Promise<AssistantSubmission> {
		const dashboardCommand =
			this.#options.personalDashboard === undefined
				? undefined
				: matchPersonalDashboardCommand(value.message);
		const sessionId = this.#sessionStore.appendUserMessage(
			dashboardCommand?.redactedMessage ?? value.message,
			value.sessionId,
		);
		if (dashboardCommand !== undefined) {
			const result = await executePersonalDashboardCommand(
				dashboardCommand,
				this.#options.personalDashboard as PersonalDashboardPort,
				signal,
				this.#options.personalDashboardAudit,
			);
			this.#sessionStore.appendAssistantMessage(sessionId, result.message);
			return {
				type: "assistant.responded",
				responseKind: "personal-dashboard",
				sessionId,
				message: result.message,
				...(result.entries === undefined ? {} : { entries: result.entries }),
			};
		}
		const action = await this.#options.desktopActions?.tryExecute(
			value.message,
			signal,
		);
		if (action !== undefined) {
			this.#sessionStore.appendAssistantMessage(
				sessionId,
				action.acknowledgement,
			);
			return { ...action, sessionId };
		}
		const directResponse = await tryRespondToAssistantMessage(
			{
				sessionId,
				message: value.message,
				messages: this.#sessionStore
					.listMessages(sessionId)
					.map(({ role, content }) => ({ role, content })),
				allowedRepositoryIds: this.#repositories
					?.list()
					.map(({ id }) => id) ?? ["fake"],
				allowedRuntimeIds: this.#runtimeIds.filter(
					(id) => id === value.runtimeId,
				),
			},
			{
				...(this.#options.assistantProviders === undefined
					? {}
					: { providers: this.#options.assistantProviders }),
				recentParentIds: () =>
					this.#graphStore
						.listRecentParents("local-owner", 5)
						.map(({ parentId }) => parentId),
				refreshTask: (parentId) => this.#refreshSupervisorParent(parentId),
			},
			signal,
		);
		if (directResponse !== undefined) {
			this.#sessionStore.appendAssistantMessage(
				sessionId,
				directResponse.message,
			);
			return directResponse;
		}
		const parentId = randomUUID();
		await this.#requireSupervisor().createPlan({
			parentId,
			actorId: "local-owner",
			tasks: [
				{
					repositoryId: value.repositoryId,
					runtimeId: value.runtimeId,
					instruction: value.message,
					acceptanceCriteria: ["Worker reports verification evidence"],
				},
			],
		});
		return { type: "supervisor.delegated", sessionId, parentId };
	}

	#streamSupervisorEvents(parentId: string, response: ServerResponse): void {
		this.#graphStore.getParent(parentId);
		response.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
		});
		let afterId = 0;
		let flushing = false;
		const flush = async () => {
			if (flushing || response.destroyed) return;
			flushing = true;
			try {
				await this.#refreshSupervisorParent(parentId);
				for (const item of this.#graphStore.listEvents(parentId, afterId)) {
					afterId = item.id;
					response.write(
						`id: ${item.id}\ndata: ${JSON.stringify(item.event)}\n\n`,
					);
				}
				const terminal = this.#graphStore
					.listChildren(parentId)
					.every(({ state }) =>
						["completed", "failed", "cancelled"].includes(state),
					);
				if (terminal) response.end();
			} catch {
				if (!response.headersSent)
					this.#json(response, 500, {
						error: { code: "INTERNAL_ERROR", message: "Stream failed" },
					});
				else response.end();
			} finally {
				flushing = false;
			}
		};
		const timer = setInterval(() => void flush(), 20);
		timer.unref();
		response.once("close", () => clearInterval(timer));
		void flush();
	}

	#streamEvents(taskId: string, response: ServerResponse): void {
		this.#store.getTask(taskId);
		response.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
		});
		let afterId = 0;
		let unsubscribe: () => void = () => {};
		const flush = () => {
			for (const item of this.#store.getTaskEvents(taskId, afterId)) {
				afterId = item.id;
				response.write(
					`id: ${item.id}\ndata: ${JSON.stringify(item.event)}\n\n`,
				);
			}
			if (terminalStates.has(this.#store.getTask(taskId).state)) {
				unsubscribe();
				response.end();
			}
		};
		unsubscribe = this.#requireOrchestrator().subscribe(taskId, flush);
		response.once("close", unsubscribe);
		flush();
	}

	async #readJson(
		request: IncomingMessage,
		maxBytes = MAX_BODY_BYTES,
	): Promise<unknown> {
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of request) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			size += buffer.length;
			if (size > maxBytes)
				throw new AgentMeError({
					code: "INVALID_CONTRACT",
					message: "Request body is too large",
					isRetryable: false,
				});
			chunks.push(buffer);
		}
		try {
			return JSON.parse(Buffer.concat(chunks).toString("utf8"));
		} catch (cause) {
			throw new AgentMeError({
				code: "INVALID_CONTRACT",
				message: "Invalid JSON request",
				isRetryable: false,
				cause,
			});
		}
	}

	async #readDashboardJson(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<unknown | undefined> {
		if (
			!(request.headers["content-type"] ?? "")
				.toLowerCase()
				.startsWith("application/json")
		) {
			this.#json(response, 415, {
				error: {
					code: "UNSUPPORTED_MEDIA_TYPE",
					message: "JSON content required",
				},
			});
			return undefined;
		}
		return this.#readJson(request);
	}

	#invalidDashboardRequest(response: ServerResponse): void {
		this.#json(response, 422, {
			error: {
				code: "INVALID_REQUEST",
				message: "Invalid personal dashboard request",
			},
		});
	}

	async #auditDashboard(event: PersonalDashboardAuditEvent): Promise<void> {
		await this.#options.personalDashboardAudit?.(event);
	}

	#isAuthorized(request: IncomingMessage): boolean {
		const expected = Buffer.from(`Bearer ${this.#options.authToken}`);
		const received = Buffer.from(request.headers.authorization ?? "");
		return (
			expected.length === received.length && timingSafeEqual(expected, received)
		);
	}

	#requireOrchestrator(): TaskOrchestrator {
		if (this.#orchestrator === undefined) throw new Error("Host is not ready");
		return this.#orchestrator;
	}

	#requireSupervisor(): AssistantSupervisor {
		if (this.#supervisor === undefined)
			throw new Error("Supervisor is not ready");
		return this.#supervisor;
	}

	#requireWorkerSessions(): TaskWorkerSessionService {
		if (this.#workerSessions === undefined)
			throw new Error("Worker sessions are not ready");
		return this.#workerSessions;
	}

	#requireAssistantProviders(): AssistantProviderService {
		if (this.#options.assistantProviders === undefined)
			throw new AgentMeError({
				code: "PROVIDER_UNAVAILABLE",
				message: "Assistant provider profiles are unavailable",
				isRetryable: false,
			});
		return this.#options.assistantProviders;
	}

	#requireCodingPermissions(): CodingPermissionService {
		if (this.#options.codingPermissions === undefined)
			throw new AgentMeError({
				code: "PROVIDER_UNAVAILABLE",
				message: "Coding permission profiles are unavailable",
				isRetryable: false,
			});
		return this.#options.codingPermissions;
	}

	#requireStandingIntents(): StandingIntentStore {
		if (this.#options.standingIntents === undefined)
			throw new AgentMeError({
				code: "PROVIDER_UNAVAILABLE",
				message: "Standing intents are unavailable",
				isRetryable: false,
			});
		return this.#options.standingIntents;
	}

	#requireTencentChannel(): TencentChannelService {
		if (this.#options.tencentChannel === undefined)
			throw new AgentMeError({
				code: "PROVIDER_UNAVAILABLE",
				message: "Tencent channel is unavailable",
				isRetryable: false,
			});
		return this.#options.tencentChannel;
	}

	#requirePersonalDashboard(): PersonalDashboardPort {
		if (this.#options.personalDashboard === undefined)
			throw new AgentMeError({
				code: "PROVIDER_UNAVAILABLE",
				message: "Personal dashboard is unavailable",
				isRetryable: false,
			});
		return this.#options.personalDashboard;
	}

	#requireMemory(): InspectableMemoryPort {
		if (this.#options.memory === undefined)
			throw new AgentMeError({
				code: "PROVIDER_UNAVAILABLE",
				message: "Inspectable memory is unavailable",
				isRetryable: false,
			});
		return this.#options.memory;
	}

	#requireSkillWorkshop(): SkillWorkshop {
		if (this.#options.skillWorkshop === undefined)
			throw new AgentMeError({
				code: "PROVIDER_UNAVAILABLE",
				message: "Skill workshop is unavailable",
				isRetryable: false,
			});
		return this.#options.skillWorkshop;
	}

	#requireSkillEvaluator(): SkillEvaluator {
		if (this.#options.skillEvaluator === undefined)
			throw new AgentMeError({
				code: "PROVIDER_UNAVAILABLE",
				message: "Skill evaluator is unavailable",
				isRetryable: false,
			});
		return this.#options.skillEvaluator;
	}

	#scheduleAutomationDrain(): void {
		if (this.#automationDrain !== undefined || this.#shutdown.signal.aborted)
			return;
		this.#automationDrain = this.#drainScheduledJobs().finally(() => {
			this.#automationDrain = undefined;
		});
	}

	#queueStandingIntentEvent(event: TaskEvent): void {
		if (event.type !== "task.completed" && event.type !== "task.failed") return;
		this.#standingIntentEvents = this.#standingIntentEvents
			.then(() => this.#handleStandingIntentEvent(event))
			.catch(() => undefined);
	}

	async #handleStandingIntentEvent(event: TaskEvent): Promise<void> {
		const store = this.#options.standingIntents;
		if (store === undefined || this.#shutdown.signal.aborted) return;
		const actorId = this.#store.getTask(event.taskId).actorId;
		const now = new Date().toISOString();
		const intents = store.matchAndClaim(
			{
				type: event.type,
				actorId,
				authenticated: actorId === "local-owner",
			},
			now,
			["task.create"],
		);
		for (const intent of intents) {
			try {
				const payload = parseStandingIntentPayload(intent.payload);
				const parentId = randomUUID();
				await this.#requireSupervisor().createPlan({
					parentId,
					actorId: intent.ownerId,
					tasks: [
						{
							repositoryId: payload.repositoryId,
							runtimeId: payload.runtimeId,
							instruction: payload.instruction,
							acceptanceCriteria: ["Worker reports verification evidence"],
						},
					],
				});
				store.recordDispatch(intent.id, parentId);
				await this.#auditStandingIntent({
					type: "standing-intent.mutated",
					operation: "dispatched",
					intentId: intent.id,
					parentId,
					at: new Date().toISOString(),
				});
			} catch {
				store.recordFailure(intent.id, "Standing intent dispatch failed");
				await this.#auditStandingIntent({
					type: "standing-intent.mutated",
					operation: "failed",
					intentId: intent.id,
					at: new Date().toISOString(),
				});
			}
		}
	}

	async #drainScheduledJobs(): Promise<void> {
		const now = new Date().toISOString();
		for (const job of this.#scheduler.due(now).slice(0, 10)) {
			if (this.#shutdown.signal.aborted) return;
			if (!this.#scheduler.claim(job.id, now)) continue;
			try {
				const payload = parseScheduledAssistantPayload(job.payload);
				const parentId = randomUUID();
				await this.#requireSupervisor().createPlan({
					parentId,
					actorId: job.ownerId,
					tasks: [
						{
							repositoryId: payload.repositoryId,
							runtimeId: payload.runtimeId,
							instruction: payload.instruction,
							acceptanceCriteria: ["Worker reports verification evidence"],
						},
					],
				});
				this.#scheduler.recordDispatch(job.id, parentId);
				await this.#auditAutomation({
					type: "automation.mutated",
					operation: "dispatched",
					jobId: job.id,
					parentId,
					at: new Date().toISOString(),
				});
			} catch {
				this.#scheduler.recordFailure(
					job.id,
					"Scheduled assistant dispatch failed",
				);
				await this.#auditAutomation({
					type: "automation.mutated",
					operation: "failed",
					jobId: job.id,
					at: new Date().toISOString(),
				});
			}
		}
	}

	async #auditAutomation(event: AutomationAuditEvent): Promise<void> {
		try {
			await this.#options.automationAudit?.(event);
		} catch {
			// A diagnostic sink cannot change an already committed scheduler state.
		}
	}

	async #auditStandingIntent(event: StandingIntentAuditEvent): Promise<void> {
		try {
			await this.#options.standingIntentAudit?.(event);
		} catch {
			// A diagnostic sink cannot change an already committed intent state.
		}
	}

	async #conversationModel(
		messages: readonly {
			role: "system" | "user" | "assistant";
			content: string;
		}[],
		signal: AbortSignal,
	): Promise<string> {
		if (this.#options.freeModels?.enabled)
			return this.#options.freeModels.respond(messages, signal);
		const result = await this.#requireAssistantProviders().respond(
			{
				sessionId: "conversation-hub",
				messages,
				allowedRepositoryIds: [],
				allowedRuntimeIds: [],
			},
			signal,
		);
		return result.message;
	}
	async #executeConversationTask(
		task: HubTask,
		signal: AbortSignal,
		link: (id: string) => void,
	): Promise<ExecutionResult> {
		if (task.kind === "office")
			return executeConversationOffice(
				task,
				(messages, s) => this.#conversationModel(messages, s),
				signal,
			);
		if (!task.repositoryId || !task.runtimeId) invalidConversation();
		const parentId = randomUUID();
		await this.#requireSupervisor().createPlan({
			parentId,
			actorId: "local-owner",
			tasks: [
				{
					repositoryId: task.repositoryId,
					runtimeId: task.runtimeId,
					instruction: taskInstructions(task),
					acceptanceCriteria: ["满足用户目标和约束，提供改动及验证证据"],
				},
			],
		});
		link(parentId);
		try {
			while (true) {
				signal.throwIfAborted();
				const { children } = await this.#refreshSupervisorParent(parentId);
				if (
					children.length &&
					children.every((c) =>
						["completed", "failed", "cancelled"].includes(c.state),
					)
				) {
					const success = children.every((c) => c.state === "completed");
					return {
						state: success ? "completed" : "failed",
						result: children
							.map((c) => c.report?.summary ?? `任务${c.childId}：${c.state}`)
							.join("\n"),
						evidence: children.flatMap((c) => [
							`task:${c.workerTaskId ?? c.childId}`,
							`worktree:${c.worktreeId ?? "未创建"}`,
							JSON.stringify(c.report ?? { state: c.state }),
						]),
					};
				}
				await delay(300, undefined, { signal });
			}
		} finally {
			if (signal.aborted)
				for (const child of this.#graphStore.listChildren(parentId)) {
					if (child.state === "dispatched")
						await this.#requireSupervisor()
							.cancelChild(parentId, child.childId)
							.catch(() => undefined);
				}
		}
	}
	async #continueConversationTask(
		task: HubTask,
		_input: string,
		signal: AbortSignal,
	): Promise<ExecutionResult> {
		if (task.kind === "office")
			return executeConversationOffice(
				task,
				(messages, s) => this.#conversationModel(messages, s),
				signal,
			);
		if (!task.executionId) invalidConversation();
		const children = this.#graphStore.listChildren(task.executionId);
		const child = children[0];
		if (children.length !== 1 || !child)
			invalidConversation("原编码任务不可恢复");
		const message = `继续原工作区中的任务。以下为完整目标、约束和用户决定（后者按时间追加，较新的决定优先）：${taskInstructions(task)}`;
		if (message.length > 4000)
			invalidConversation("补充超过编码后端单次上限，请缩短后重试");
		const turn = await this.#requireWorkerSessions().continue(
			task.executionId,
			child.childId,
			message,
			signal,
		);
		return {
			state:
				turn.verification === "passed"
					? "completed"
					: turn.verification === "cancelled"
						? "cancelled"
						: "failed",
			result: turn.message,
			evidence: [
				`turn:${turn.turnId}`,
				`verification:${turn.verification}`,
				`worktree:${child.worktreeId}`,
			],
		};
	}
	async #refreshSupervisorParent(parentId: string): Promise<{
		readonly parent: ReturnType<SupervisorGraphStore["getParent"]>;
		readonly children: ReturnType<SupervisorGraphStore["listChildren"]>;
	}> {
		const supervisor = this.#requireSupervisor();
		await supervisor.refresh(parentId);
		let parent = this.#graphStore.getParent(parentId);
		const children = this.#graphStore.listChildren(parentId);
		if (
			parent.state === "active" &&
			children.length > 0 &&
			children.every(({ state }) => state === "completed")
		) {
			await supervisor.synthesize(parentId);
			parent = this.#graphStore.getParent(parentId);
			if (this.#options.memory !== undefined) {
				const result = await recordTaskExperience(
					this.#options.memory,
					parentId,
					children,
				);
				if (result.created)
					await this.#options.memoryAudit?.({
						type: "memory.mutated",
						operation: "created",
						memoryId: result.record.id,
						kind: "experience",
						at: new Date().toISOString(),
					});
			}
		}
		return { parent, children };
	}

	#json(response: ServerResponse, status: number, body: unknown): void {
		if (response.headersSent) return;
		response.writeHead(status, {
			"content-type": "application/json; charset=utf-8",
		});
		response.end(JSON.stringify(body));
	}
}
