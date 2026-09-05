# Spec: AgentMe MVP

## Status

Approved. The original capability boundaries were approved on 2026-08-20; the cross-platform desktop and supervisor/worker revision was approved on 2026-08-22.

## Objective

Build a Windows-first, cross-platform personal programming assistant that can be awakened by voice, receive tasks from the desktop and a remote messaging channel, delegate work to coding agents, safely modify approved repositories, run tests, remember useful project context, and report verifiable results.

The primary user is one developer operating a trusted Windows 11 machine. The defining experience is:

> Say a wake phrase or send a private message, assign a programming task, and later receive a concise report containing the actual diff summary, test evidence, and any unresolved risk.

## MVP Scope

### Included

- A portable background host with a secure local control API.
- A packaged Tauri desktop application for Windows, macOS and Linux, with Windows as the first release gate.
- A conversational supervisor that decomposes work and delegates bounded child tasks without receiving repository-write or shell tools.
- A live task tree showing supervisor activity, child coding agents, worktrees, tests, approvals and completion evidence.
- Always-available local wake-word detection with visible microphone state and a hardware/software mute control.
- Pluggable STT and TTS with local and cloud implementations.
- Repository registration and an explicit per-repository permission profile.
- Durable tasks that invoke Codex by default and can invoke Claude Code or Pi.
- Automatic changes and test execution inside the selected repository/worktree.
- Desktop progress, cancellation and final reports.
- One remote channel in the first usable release: QQ Bot or Weixin, selected after credential smoke tests.
- SQLite operational state plus human-readable Markdown memory and daily notes.
- Skill-change proposals with scan, test, review and rollback metadata.

### Not included in MVP

- Unrestricted control of the operating-system desktop.
- Silent Git push, deployment, purchases, deletions outside a task worktree, or outbound messages to third parties.
- Permanent storage of raw microphone audio by default.
- Autonomous modification of AgentMe core/runtime code.
- Multi-user hosting or enterprise RBAC.
- Simultaneous use of one Git worktree by multiple coding agents.

## Assumptions

1. The primary release host is 64-bit Windows 11 with Git installed; native macOS and Linux runners verify portable builds.
2. The first version targets a single local user and one operating-system login session.
3. Cloud APIs are allowed, but every voice capability must have a local provider option.
4. The machine may be CPU-only; GPU acceleration is optional and detected at runtime.
5. Registered repositories are already under Git, or the user explicitly accepts reduced rollback protection.
6. QQ/Weixin availability is subject to the Tencent plugin/account onboarding available to the user.
7. TypeScript is the preferred host/plugin language because Pi, OpenClaw, Codex SDK and channel ecosystems are strongest there; Python voice services may run out of process.

## Proposed Tech Stack

- Host/runtime: Node.js LTS + TypeScript, exact versions pinned when the project is scaffolded.
- Desktop shell: Tauri 2 with a portable web UI and a per-platform packaged Node host sidecar.
- Supervisor models: vendor-neutral `assistant.model` providers; DeepSeek V4 Flash is the initial low-cost provider, with Alibaba/OpenAI-compatible providers selectable.
- State: SQLite in WAL mode for tasks, events, approvals and plugin metadata.
- Human-readable memory: Markdown with YAML frontmatter, indexed into SQLite FTS5; embeddings are optional.
- Local voice services: Python sidecars or native ONNX processes behind provider contracts.
- Wake word: sherpa-onnx Chinese KWS by default; openWakeWord is an optional provider.
- Local STT: SenseVoiceSmall default, Paraformer streaming optional.
- Local TTS: Piper CPU baseline, CosyVoice optional for capable hardware.
- Cloud voice: Alibaba Model Studio Qwen Audio/ASR/CosyVoice; OpenAI Realtime optional.
- Coding runtimes: Codex app-server/SDK or JSON exec, Claude Agent SDK/print mode, Pi RPC/SDK.
- Isolation: Git worktree always; Docker or WSL2 selectable per repository.

Versions are intentionally not invented in this pre-scaffold spec. The implementation phase must resolve and pin current supported versions from official package metadata.

## Public Capability Contracts

Every provider is identified by a stable id and declares metadata without starting runtime code.

```ts
type CapabilityKind =
  | "assistant.model"
  | "voice.wake"
  | "voice.stt"
  | "voice.tts"
  | "voice.realtime"
  | "channel"
  | "coding.runtime"
  | "memory.engine"
  | "execution.target";

interface CapabilityProvider<TConfig, TInstance> {
  readonly id: string;
  readonly kind: CapabilityKind;
  readonly version: string;
  validate(config: unknown): TConfig;
  start(context: ProviderContext, config: TConfig): Promise<TInstance>;
  stop(): Promise<void>;
  health(): Promise<HealthStatus>;
}
```

The `assistant-supervisor` consumes `assistant.model` and a restricted delegation port. It is not a coding runtime and cannot receive filesystem or process tools. `coding.runtime` providers remain the only model-facing components allowed to operate in task worktrees.

Contract requirements:

- Provider configuration is schema-validated before code activation.
- Start and stop are idempotent.
- Long operations accept cancellation and emit progress.
- Secrets are referenced by secret id and resolved only at call time.
- Provider failures use stable error codes and may declare retryability.
- All observable side effects carry task id, actor identity and provider id.

### Voice contracts

```ts
interface WakeProvider {
  listen(input: PcmStream, signal: AbortSignal): AsyncIterable<WakeEvent>;
}

interface SpeechToTextProvider {
  transcribe(input: PcmStream, options: SttOptions, signal: AbortSignal): AsyncIterable<TranscriptEvent>;
}

interface TextToSpeechProvider {
  synthesize(text: AsyncIterable<string>, options: TtsOptions, signal: AbortSignal): AsyncIterable<PcmChunk>;
}
```

- The microphone stream feeds local wake detection before any cloud connection begins.
- After a wake event, one active conversation owns the microphone.
- TTS playback is cancelled immediately when interruption is detected.
- Provider fallback never uploads pre-wake audio.
- Transcript and audio retention are separate settings.

### Coding runtime contract

```ts
interface CodingRuntime {
  start(request: CodingRunRequest, signal: AbortSignal): AsyncIterable<CodingEvent>;
  resume(threadId: string, input: string, signal: AbortSignal): AsyncIterable<CodingEvent>;
  cancel(runId: string): Promise<void>;
  capabilities(): Promise<CodingRuntimeCapabilities>;
}
```

Normalized events include `run.started`, `message.delta`, `tool.requested`, `approval.required`, `file.changed`, `test.result`, `run.completed`, `run.failed` and `run.cancelled`.

### Supervisor contract

```ts
interface AssistantModel {
  converse(request: AssistantRequest, signal: AbortSignal): AsyncIterable<AssistantEvent>;
}

interface DelegationPort {
  submit(input: DelegatedTaskInput): Promise<DelegatedTask>;
  cancel(taskId: string): Promise<void>;
  observe(taskId: string, signal: AbortSignal): AsyncIterable<TaskEvent>;
}
```

- Supervisor actions are schema-validated data, never executable shell text.
- Each delegated coding task binds a registered repository, acceptance criteria, worker runtime and isolated worktree.
- Concurrency is bounded and configurable; the safe default is two coding workers.
- Parent completion requires terminal child outcomes and synthesized verification evidence.

## Plugin Manifest

Plugins use a metadata-first manifest so discovery and validation do not execute plugin code.

```json
{
  "schemaVersion": 1,
  "id": "aliyun-voice",
  "version": "0.1.0",
  "entry": "dist/index.js",
  "capabilities": ["voice.stt", "voice.tts", "voice.realtime"],
  "permissions": ["network:aliyun", "secret:aliyun-api-key"],
  "configSchema": "config.schema.json",
  "compatibility": { "agentme": ">=0.1.0 <0.2.0" }
}
```

Plugin lifecycle:

```text
discovered → validated → installed → enabled → started
                                      ↓          ↓
                                   disabled ← stopped
```

- Plugin installation is separate from enablement.
- Plugin permissions are shown before enablement.
- Updates are staged and health-checked before activation.
- A failed update rolls back to the previous installed version.
- Third-party install scripts are disabled by default.

## Task State Machine

```text
received
  → clarifying
  → planned
  → queued
  → preparing_workspace
  → running
  → verifying
  → awaiting_approval
  → completed

Terminal alternatives: rejected | cancelled | failed | timed_out
```

Rules:

- State transitions are persisted transactionally before delivery to a channel.
- A task has one active writer lease; stale executors cannot append results.
- Cancellation propagates to model stream, child processes and TTS playback.
- A restart resumes queued tasks but does not silently resume a mutating process whose state cannot be proven.
- Completion requires a final report and verification evidence, not merely a successful model response.

## Workspace and Coding Workflow

1. Resolve the repository from an allowlisted registry; never infer an arbitrary path from a remote message.
2. Record base branch and clean/dirty status.
3. Create a task-specific Git worktree and branch.
4. Assemble instructions, repository rules, acceptance criteria and permission profile.
5. Run the selected coding runtime.
6. Run configured verification commands.
7. Summarize diff, tests, failures and risks.
8. Keep the worktree for review; cleanup is an explicit later action.

Dirty source repositories are not modified or cleaned. If a safe worktree cannot be created, the task stops with a diagnostic.

## Permission Model

Permission is the intersection of actor, channel, repository, tool and execution-target policy. Deny always wins.

| Action | Default |
|---|---|
| Read registered repository | Allow |
| Write task worktree | Allow |
| Run configured build/test commands | Allow |
| Install project dependencies | Ask on first use per repository |
| Access network from tools | Allowlist by provider/domain |
| Read outside registered roots | Deny |
| Modify source checkout instead of task worktree | Deny |
| Git commit in task branch | Configurable, default allow |
| Git push, PR creation, deployment | Always ask |
| Delete persistent data or worktrees | Always ask |
| Send a message to anyone other than requesting identity | Always ask |

Remote channels require an authenticated account identity and owner allowlist. Group conversations default to no filesystem or execution tools.

## Voice Behavior

- The tray icon visibly distinguishes muted, wake-listening, recording, thinking and speaking states.
- Wake detection runs locally while unmuted.
- Initial wake phrase is configurable; the user can retrain/tune thresholds.
- MVP conversation is half-duplex after wake unless echo cancellation passes an explicit hardware test.
- The user can say a stop phrase or press Escape/mute to abort speech and the active conversational turn.
- Cloud failure falls back to configured local STT/TTS without changing task semantics.
- CPU-only baseline target: wake detector under 5% average CPU on the reference machine; exact hardware benchmark is recorded during implementation.

## Memory Model

Memory classes:

- `profile`: stable user preferences.
- `project`: commands, conventions and verified repository knowledge.
- `decision`: durable decisions and their provenance.
- `experience`: task outcome and reusable recovery evidence.
- `daily`: chronological working notes.
- `secret-reference`: identifier only; never secret material.

Every durable memory records source task/session, created time, last verified time, confidence and sensitivity. The user can inspect, edit, export and forget it.

Raw transcript is not durable memory. Automatic capture writes daily/experience candidates; promotion to durable project/profile memory requires either explicit user instruction or governed consolidation.

## Governed Self-Iteration

```text
evidence → proposal → static scan → isolated evaluation → review/apply → health check → rollback point
```

- Default mode is `propose`, not automatic application.
- The reviewer receives bounded evidence and cannot use general system tools.
- A proposal binds to the hash and version of its target.
- Only workshop-owned skills/plugins may be automatically updated later.
- Core runtime, policy engine, credentials and manually installed plugins are never autonomous write targets.
- One proposal may make one logical capability change.
- Evaluation must include replay tests or explicit acceptance checks.
- Applied changes retain provenance and a one-command rollback.

## Data and Privacy

- Raw pre-wake audio is never persisted or transmitted.
- Raw post-wake audio retention defaults to off.
- Transcripts default to seven-day operational retention; durable summaries are separate.
- API keys are stored through the platform secret-store port backed by an OS-protected facility, not SQLite, browser storage or Markdown.
- Logs redact configured secrets and bound transcript fields.
- Export and deletion operate by user, repository, session and task scope.

## Project Structure

```text
apps/
  host/                 Portable background host and local API
  operator-ui/          Tray/control UI
  desktop/              Cross-platform Tauri shell and host lifecycle
packages/
  contracts/            Stable capability and event types
  core-runtime/         Registry, sessions, configuration, audit
  plugin-system/        Discovery, manifests, lifecycle
  task-orchestrator/    Durable task state machine
  assistant-supervisor/ Conversation, planning and bounded child-task delegation
  platform-runtime/     OS ports for secrets, processes, paths, tray and audio devices
  policy-engine/        Authorization and approval decisions
  workspace-manager/    Git worktrees and execution targets
plugins/
  runtime-codex/
  runtime-claude/
  runtime-pi/
  voice-sherpa/
  voice-sensevoice/
  voice-piper/
  voice-aliyun/
  channel-qqbot/
  channel-weixin/
  memory-core/
services/
  voice-python/         Optional local Python inference sidecars
tests/
  contract/
  integration/
  e2e/
docs/
  decisions/
references/             Read-only upstream research checkouts
```

## Commands

Commands are provisional until scaffolding pins the package manager and test runner:

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
```

The scaffold task must replace these with executable verified commands before implementation work begins.

## Code Style

Prefer explicit dependency injection and discriminated event types. Avoid global mutable provider registries.

```ts
export type TaskEvent =
  | { type: "task.started"; taskId: string; at: string }
  | { type: "task.progress"; taskId: string; message: string; at: string }
  | { type: "task.completed"; taskId: string; report: TaskReport; at: string }
  | { type: "task.failed"; taskId: string; error: AgentMeError; at: string };
```

- Kebab-case package/plugin ids; PascalCase types; camelCase values.
- No vendor-specific types cross a capability boundary.
- Public errors include stable machine code plus safe human message.
- Side effects live behind injected interfaces and are observable in tests.

## Testing Strategy

- Unit: state transitions, policy intersections, manifest validation, retention and routing.
- Contract: every provider passes the same cancellation, lifecycle, error and health suite.
- Integration: fake model/channel/voice providers plus real SQLite and Git repositories.
- Runtime smoke: real Codex, Claude Code and Pi adapters behind opt-in credentials.
- Audio fixtures: wake false-positive/false-negative corpus, Chinese ASR fixtures, interruption tests.
- Security: path traversal, symlink escape, prompt injection through channels/plugins, secret redaction.
- E2E: wake phrase → spoken task → worktree edit → tests → spoken/desktop report; remote message → authenticated task → result delivery.

No test may require an always-on paid API. Cloud suites are opt-in and record provider/model/version.

## Boundaries

### Always

- Validate external input and plugin configuration.
- Use a task worktree for automatic code changes.
- Preserve provenance for task, memory, approval and learned capability changes.
- Propagate cancellation to child processes.
- Run configured verification before claiming completion.

### Ask first

- Add a production dependency or change the plugin ABI.
- Change SQLite schema after the first released migration.
- Enable raw audio retention.
- Enable automatic Skill Workshop application.
- Enable a new external-effect tool or channel identity.

### Never

- Commit secrets or place them in model prompts unnecessarily.
- Upload pre-wake audio.
- Execute arbitrary remote-message text as a shell command.
- Modify a repository outside its registered task worktree.
- Let self-learning rewrite core, policy, credentials or user-authored capabilities.
- Report success without verification evidence.

## Success Criteria

1. The packaged Windows application and CI builds for macOS/Linux use the same public contracts; platform-specific behavior stays behind `platform-runtime`.
2. After 24 hours of wake listening, microphone state remains visible, pre-wake audio is not transmitted, and the host remains responsive.
3. A configured Chinese wake phrase starts a conversation and a stop/mute action aborts it.
4. The same voice flow works with one fully local STT/TTS route and one cloud route selected by configuration.
5. A spoken task creates a visible parent task, delegates bounded child work to coding agents, and returns a report containing worktrees, changed files and test results.
6. Security tests prove the supervisor cannot write repositories or execute processes directly.
7. Codex is production-ready in MVP; Claude Code and Pi adapters pass the common contract suite even if marked optional in the UI.
8. One authenticated Tencent channel can create, query and cancel a task; an untrusted sender cannot access coding tools.
9. Restarting the host preserves conversations, parent/child tasks, approvals and memory without duplicating active work.
10. The user can inspect and delete stored transcripts and memories independently.
11. A learned-skill proposal can be created from a completed task, scanned, evaluated, approved, activated and rolled back without modifying core code.
12. Security tests demonstrate rejection of path traversal, symlink escapes, unregistered repositories and secret leakage into logs.

## Open Questions Before Scaffolding

- Reference hardware: CPU, RAM, GPU model and VRAM for selecting the default local TTS.
- Preferred wake phrase and acceptable false activation rate.
- Which Tencent channel credentials can be activated first: QQ Bot, Weixin or WeCom.
- Whether task branches may be committed automatically or should remain as uncommitted worktree changes.
- Default transcript retention: seven days is proposed.
- Which macOS and Linux CI runners or physical machines will provide release-grade microphone, tray and packaging evidence.

