# AgentMe MVP Task List

## Active track

Task 48 is approved: select Codex, Claude Code or Pi per coding task; route
execution and persisted-session continuation to that backend. No new plugin ABI
or database schema. Preserve isolation, cancellation and verification.

## Task 48: Switchable coding backends
- [x] Pass the selected backend through dispatch and execution.
- [x] Resume using the persisted backend and worktree after host restart.
- [x] Expose backend selection and configuration guidance in the desktop.
- [x] Verify routing, cancellation, continuation and unavailable-backend behavior.

Tasks 45-47 deliver the owner-approved personal agent office and are complete;
verification is recorded in `docs/office-acceptance.md`. Existing unchecked
hardware, provider and channel evidence remains unchecked until it is actually
reproduced or recorded as an explicit owner-approved release exception.

## Phase 1: Executable Foundation

## Task 1: Scaffold the verified monorepo

**Description:** Initialize the project repository and a minimal pnpm/TypeScript workspace with host, contracts and test packages. Resolve and record actual supported tool versions on Windows rather than copying provisional versions from the spec.

**Acceptance criteria:**
- [x] `pnpm install`, build, lint, typecheck and unit-test commands execute on the target Windows host.
- [x] Exact Node, pnpm, TypeScript and test-runner versions are pinned.
- [x] Generated output, secrets, local state and `references/` internals are excluded appropriately.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [x] Fresh-install smoke test succeeds without cloud credentials.

**Dependencies:** None

**Files likely touched:**
- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.json`
- `.gitignore`
- `README.md`

**Estimated scope:** Medium

## Task 2: Define provider and event contracts

**Description:** Implement the stable capability provider, health, cancellation, task-event and error contracts from the spec without vendor dependencies.

**Acceptance criteria:**
- [x] Capability kinds, provider lifecycle and normalized task events are discriminated and serializable.
- [x] Public errors have stable codes, safe messages and retryability.
- [x] Contract serialization round-trips through JSON fixtures.

**Verification:**
- [x] `pnpm exec vitest run packages/contracts/test/contracts.test.ts`
- [x] `pnpm typecheck`

**Dependencies:** Task 1

**Files likely touched:**
- `packages/contracts/src/capabilities.ts`
- `packages/contracts/src/events.ts`
- `packages/contracts/src/errors.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/test/contracts.test.ts`

**Estimated scope:** Medium

## Task 3: Load metadata-first plugins

**Description:** Discover and validate plugin manifests, then explicitly activate a built-in fake coding runtime. Discovery must not execute the entry module.

**Acceptance criteria:**
- [x] Invalid manifests and incompatible versions fail with stable diagnostics before activation.
- [x] Entry code is not evaluated during discovery/config validation.
- [x] Enable/start/stop are observable and idempotent, including concurrent duplicate calls.

**Verification:**
- [x] `pnpm exec vitest run packages/plugin-system/test/plugin-system.test.ts`
- [x] A malicious fixture proves discovery has no code-execution side effect.

**Dependencies:** Task 2

**Files likely touched:**
- `packages/plugin-system/src/manifest.ts`
- `packages/plugin-system/src/registry.ts`
- `packages/plugin-system/src/lifecycle.ts`
- `packages/plugin-system/test/plugin-system.test.ts`
- `plugins/runtime-fake/agentme.plugin.json`

**Estimated scope:** Medium

## Task 4: Persist task state and event outbox

**Description:** Add SQLite migrations and a repository that commits task transitions and outgoing events atomically with a single-writer lease.

**Acceptance criteria:**
- [x] Only legal state-machine transitions commit.
- [x] A stale writer lease cannot append events or complete a task.
- [x] Committed undelivered events replay once after restart.

**Verification:**
- [x] `pnpm exec vitest run ./packages/task-orchestrator/test/task-store.test.ts ./packages/task-orchestrator/test/restart.test.ts`
- [x] Crash/reopen integration test passes against a temporary SQLite database.

**Dependencies:** Task 2

**Files likely touched:**
- `packages/task-orchestrator/src/migrations.ts`
- `packages/task-orchestrator/src/task-store.ts`
- `packages/task-orchestrator/src/state-machine.ts`
- `packages/task-orchestrator/test/task-store.test.ts`
- `packages/task-orchestrator/test/restart.test.ts`

**Estimated scope:** Medium

## Task 5: Deliver the fake task vertical slice

**Description:** Expose loopback task create/status/cancel endpoints, run the fake provider and stream committed events to a test client.

**Acceptance criteria:**
- [x] A client can create, observe, complete and cancel fake tasks.
- [x] API input is schema-validated and binds an authenticated local actor.
- [x] Restart does not duplicate completed or cancelled work.

**Verification:**
- [x] `pnpm exec vitest run ./tests/integration/fake-task-flow.test.ts`
- [x] Manual PowerShell client completes one task and cancels another.

**Dependencies:** Tasks 3 and 4

**Files likely touched:**
- `apps/host/src/server.ts`
- `apps/host/src/task-api.ts`
- `packages/task-orchestrator/src/orchestrator.ts`
- `plugins/runtime-fake/src/index.ts`
- `tests/integration/fake-task-flow.test.ts`

**Estimated scope:** Medium

## Checkpoint A: Executable foundation

- [x] Clean install, lint, typecheck, unit and integration tests pass.
- [x] Fake task create/stream/cancel/restart flow works end to end.
- [x] Plugin discovery is proven metadata-only.
- [x] Human approved the specification and implementation plan before real runtime dependencies are added.

## Phase 2: Safe Real Coding Task

## Task 6: Register repositories and execution profiles

**Description:** Add canonical repository registration with execution target, verification commands and permission profile.

**Acceptance criteria:**
- [x] Remote/user input can reference only registered repository ids, never arbitrary paths.
- [x] Canonical path and symlink escape checks reject targets outside approved roots.
- [x] Registration validates Git state and verification commands.

**Verification:**
- [x] `pnpm exec vitest run ./packages/workspace-manager/test/repository-registry.test.ts`
- [x] Windows junction traversal fixture is rejected.

**Dependencies:** Task 4

**Files likely touched:**
- `packages/workspace-manager/src/repository-registry.ts`
- `packages/workspace-manager/src/path-policy.ts`
- `packages/workspace-manager/src/types.ts`
- `packages/workspace-manager/test/repository-registry.test.ts`
- `packages/task-orchestrator/src/migrations.ts`

**Estimated scope:** Medium

## Task 7: Implement policy decisions and approvals

**Description:** Evaluate actor, channel, repository, tool and execution-target policy with deny precedence and durable approval records.

**Acceptance criteria:**
- [x] Policy produces an allow, deny or approval-required decision with traceable reasons.
- [x] Group/untrusted actors have no coding or filesystem tools by default.
- [x] Approval decisions bind task, action, canonical target and expiry.

**Verification:**
- [x] `pnpm exec vitest run ./packages/policy-engine/test/evaluator.test.ts`
- [x] Policy matrix tests cover every row in the spec permission table.

**Dependencies:** Tasks 4 and 6

**Files likely touched:**
- `packages/policy-engine/src/evaluator.ts`
- `packages/policy-engine/src/policy.ts`
- `packages/policy-engine/src/approval-store.ts`
- `packages/policy-engine/test/evaluator.test.ts`
- `packages/task-orchestrator/src/migrations.ts`

**Estimated scope:** Medium

## Task 8: Create isolated task worktrees

**Description:** Create, inspect and retain task-specific Git worktrees without modifying or cleaning the user's source checkout.

**Acceptance criteria:**
- [x] Each task receives a unique branch and canonical worktree under the configured task root.
- [x] Dirty source checkouts remain untouched.
- [x] Cancellation or failure retains the worktree and reports its location.

**Verification:**
- [x] `pnpm exec vitest run ./packages/workspace-manager/test/worktree-manager.test.ts`
- [x] Fixture asserts only the worktree changes.

**Dependencies:** Tasks 6 and 7

**Files likely touched:**
- `packages/workspace-manager/src/git-client.ts`
- `packages/workspace-manager/src/worktree-manager.ts`
- `packages/workspace-manager/src/workspace-report.ts`
- `packages/workspace-manager/test/worktree-manager.test.ts`
- `tests/fixtures/repository/README.md`

**Estimated scope:** Medium

## Task 9: Normalize and cancel Codex runs

**Description:** Add the Codex provider using its current documented app-server/SDK or JSON event interface and translate output into common coding events.

**Acceptance criteria:**
- [x] Start, progress, approval, completion, failure and cancellation map to stable events.
- [x] Prompts are scoped to the assigned worktree and repository instructions.
- [x] Cancellation terminates the full Windows process tree and records a terminal task state.

**Verification:**
- [x] `pnpm exec vitest run plugins/runtime-codex/test/contract.test.ts`
- [x] Opt-in real Codex smoke test edits a disposable fixture; process-tree cancellation is exercised by the contract test.

**Dependencies:** Tasks 2, 7 and 8

**Files likely touched:**
- `plugins/runtime-codex/agentme.plugin.json`
- `plugins/runtime-codex/src/index.ts`
- `plugins/runtime-codex/src/event-adapter.ts`
- `plugins/runtime-codex/src/process-controller.ts`
- `plugins/runtime-codex/test/contract.test.ts`

**Estimated scope:** Medium

## Task 10: Verify changes and produce task reports

**Description:** Run registered verification commands and generate a structured report from Git diff, test results and runtime outcomes.

**Acceptance criteria:**
- [x] Completion is impossible until verification reaches a terminal result.
- [x] Reports include worktree, branch, changed files, commands, exit codes and unresolved risks.
- [x] Failed tests produce a failed or explicitly partial result, never success.

**Verification:**
- [x] `pnpm exec vitest run packages/task-orchestrator/test/report-builder.test.ts`
- [x] Passing and failing fixture repositories produce correct reports.

**Dependencies:** Tasks 8 and 9

**Files likely touched:**
- `packages/task-orchestrator/src/verifier.ts`
- `packages/task-orchestrator/src/report-builder.ts`
- `packages/task-orchestrator/src/orchestrator.ts`
- `packages/task-orchestrator/test/report-builder.test.ts`
- `tests/integration/verified-coding-task.test.ts`

**Estimated scope:** Medium

## Task 11: Add the operator task timeline

**Description:** Build a minimal loopback operator UI for task creation, progress, cancellation, approvals and final report review using the fake or Codex runtime.

**Acceptance criteria:**
- [x] User submits a task from a repository selector without entering a filesystem path.
- [x] Timeline survives reconnect by replaying persisted events.
- [x] Cancellation actions show their final outcome; approval events render in the same timeline.

**Verification:**
- [x] `pnpm test:e2e`
- [x] Native form controls, labels, focus indicators and live regions support keyboard-only operation.

**Dependencies:** Tasks 5, 7 and 10

**Files likely touched:**
- `apps/operator-ui/src/App.tsx`
- `apps/operator-ui/src/task-client.ts`
- `apps/operator-ui/src/TaskTimeline.tsx`
- `apps/operator-ui/src/styles.css`
- `tests/e2e/operator-task-flow.spec.ts`

**Estimated scope:** Medium

## Checkpoint B: Safe coding loop

- [x] Fixture task creates a worktree, changes code, verifies and reports evidence.
- [x] Cancellation kills descendant processes on Windows.
- [x] Path traversal and unregistered repository tests pass.
- [x] Source checkout remains untouched.
- [ ] Human reviews whether automatic task-branch commits should be enabled.

## Phase 3: Smart-Speaker Voice Loop

## Task 12: Own microphone and playback lifecycle

**Description:** Implement audio-device selection, microphone ownership states, mute/stop, bounded pre-roll and half-duplex playback suppression behind testable audio interfaces.

**Acceptance criteria:**
- [x] Only one audio session owns conversation capture state at a time.
- [x] Mute/stop cancels capture, inference and playback promptly.
- [x] Pre-wake frames cannot reach network-capable providers.

**Verification:**
- [x] `pnpm exec vitest run packages/voice-runtime/test/audio-session.test.ts`
- [x] Network-spy test sees zero pre-wake audio bytes.

**Dependencies:** Tasks 2 and 5

**Files likely touched:**
- `packages/voice-runtime/src/audio-session.ts`
- `packages/voice-runtime/src/audio-device.ts`
- `packages/voice-runtime/src/audio-router.ts`
- `packages/voice-runtime/test/audio-session.test.ts`
- `packages/voice-runtime/test/privacy-boundary.test.ts`

**Estimated scope:** Medium

## Task 13: Benchmark hardware and local voice candidates

**Description:** Add a reproducible diagnostic that records CPU, RAM, GPU/VRAM and benchmarks wake, STT and TTS fixtures without selecting models silently.

**Acceptance criteria:**
- [x] Diagnostic emits a redacted machine profile and readiness report.
- [x] SenseVoiceSmall, Piper and optional CosyVoice readiness are reported independently.
- [x] Default local route selection is recorded with rationale.

**Verification:**
- [x] `pnpm build && pnpm voice:doctor`
- [x] Output contains no username, API key or unrelated filesystem paths.

**Dependencies:** Task 12

**Files likely touched:**
- `apps/host/src/commands/voice-doctor.ts`
- `packages/voice-runtime/src/hardware-profile.ts`
- `packages/voice-runtime/src/benchmark.ts`
- `packages/voice-runtime/test/hardware-profile.test.ts`
- `docs/voice-benchmark.md`

**Estimated scope:** Medium

## Task 14: Wake locally with sherpa-onnx

**Description:** Implement a local Chinese keyword-spotting sidecar/provider with configurable phrase, threshold, debounce and health reporting.

**Acceptance criteria:**
- [x] Wake inference interface requires no network and produces timestamped confidence events.
- [x] Phrase/threshold changes validate and take effect after controlled reconfiguration.
- [x] Audio fixtures measure false accepts and rejects against configured limits.

**Verification:**
- [x] `pnpm exec vitest run plugins/voice-sherpa/test`
- [ ] Manual wake/mute/stop smoke test on the selected microphone.

**Dependencies:** Tasks 12 and 13

**Files likely touched:**
- `plugins/voice-sherpa/agentme.plugin.json`
- `plugins/voice-sherpa/src/index.ts`
- `services/voice-python/sherpa_service.py`
- `plugins/voice-sherpa/test/contract.test.ts`
- `tests/fixtures/audio/wake/README.md`

**Estimated scope:** Medium

## Task 15: Complete a fully local spoken task intake

**Description:** Add SenseVoiceSmall STT and Piper TTS providers, then route wake → transcription → task confirmation → spoken/visual acknowledgement.

**Acceptance criteria:**
- [x] The full intake path works with network disabled after initial model installation.
- [x] Partial/final transcript events and cancellable local process calls follow common contracts.
- [x] Ambiguous repository or destructive intent requests clarification instead of guessing.

**Verification:**
- [x] `pnpm test:integration --filter local-voice-task`
- [ ] Manual Chinese task-intake smoke test reaches the fake and Codex task flows.

**Dependencies:** Tasks 11 and 14

**Files likely touched:**
- `plugins/voice-sensevoice/src/index.ts`
- `plugins/voice-piper/src/index.ts`
- `services/voice-python/asr_service.py`
- `services/voice-python/tts_service.py`
- `tests/integration/local-voice-task.test.ts`

**Estimated scope:** Medium

## Task 16: Add Alibaba voice and fallback routing

**Description:** Implement Alibaba Qwen Audio/ASR/TTS capabilities with call-time secret resolution, provider health and explicit local/cloud fallback.

**Acceptance criteria:**
- [x] API keys are resolved only at call time and never appear in config, prompts, task events or logs.
- [x] Cloud failure falls back only according to configured policy and returns the selected route.
- [x] The shared privacy router prevents pre-wake audio reaching Alibaba endpoints.

**Verification:**
- [x] `pnpm exec vitest run plugins/voice-aliyun/test/contract.test.ts`
- [x] Opt-in Alibaba smoke test records model/region/version and fallback behavior.

**Dependencies:** Tasks 12 and 15

**Files likely touched:**
- `plugins/voice-aliyun/agentme.plugin.json`
- `plugins/voice-aliyun/src/index.ts`
- `plugins/voice-aliyun/src/realtime-client.ts`
- `plugins/voice-aliyun/src/fallback.ts`
- `plugins/voice-aliyun/test/contract.test.ts`

**Estimated scope:** Medium

## Checkpoint C: Voice privacy and usability

- [x] Local wake listener meets the recorded CPU target on reference hardware.
- [x] Pre-wake audio network test passes.
- [x] Local and Alibaba configurations complete the same task-intake scenario.
- [x] Mute, stop and spoken interruption terminate playback and active conversational work.
- [ ] Human approves enabling wake listening at Windows login.

## Phase 4: Remote Channel and Memory

## Task 17: Validate Tencent channel onboarding

**Description:** Perform a credential and capability spike for official QQ Bot and Weixin plugins/APIs, record supported message/media/group behavior and select one first channel.

**Acceptance criteria:**
- [ ] At least one channel receives and replies to a private test message using official maintained integration paths.
- [x] Required credentials, review constraints and unavailable capabilities are documented without storing secrets.
- [x] The selected channel decision and fallback are recorded in an ADR.

**Verification:**
- [ ] Manual channel smoke test with redacted evidence.
- [x] No credential appears in repository or logs.

**Dependencies:** Tasks 2 and 7

**Files likely touched:**
- `docs/channel-spike.md`
- `docs/decisions/0004-first-tencent-channel.md`
- `tests/fixtures/channels/inbound-private.json`
- `tests/fixtures/channels/inbound-untrusted.json`

**Estimated scope:** Medium

## Task 18: Deliver authenticated remote task control

**Description:** Implement the selected Tencent channel adapter with pairing, owner allowlist, private task commands, group-safe defaults and durable result delivery.

**Acceptance criteria:**
- [x] Paired private owners receive create, query and cancel permissions.
- [x] Unauthorized and group senders cannot expose coding/filesystem tools.
- [x] Restart resumes delivery of committed but unsent progress/final events once.

**Verification:**
- [x] `pnpm exec vitest run tests/integration/tencent-channel-task.test.ts`
- [ ] Manual owner/untrusted/group smoke tests pass.

**Dependencies:** Tasks 5, 7, 10 and 17

**Files likely touched:**
- `plugins/channel-tencent/agentme.plugin.json`
- `plugins/channel-tencent/src/index.ts`
- `plugins/channel-tencent/src/identity.ts`
- `plugins/channel-tencent/src/delivery.ts`
- `plugins/channel-tencent/test/contract.test.ts`

**Estimated scope:** Medium

## Task 19: Store inspectable project memory and daily notes

**Description:** Add Markdown/YAML memory with provenance, SQLite FTS indexing, seven-day transcript retention and inspect/edit/forget operations.

**Acceptance criteria:**
- [x] Profile, project, decision, experience and daily memories preserve source and verification metadata.
- [x] Raw transcript retention and durable memory deletion operate independently.
- [x] Memory search works without embeddings and Markdown remains the source of truth.

**Verification:**
- [x] `pnpm exec vitest run plugins/memory-core/test/memory-store.test.ts`
- [x] Export/forget/reindex round-trip test passes.

**Dependencies:** Tasks 4 and 10

**Files likely touched:**
- `plugins/memory-core/src/memory-store.ts`
- `plugins/memory-core/src/indexer.ts`
- `plugins/memory-core/src/retention.ts`
- `plugins/memory-core/test/memory-store.test.ts`
- `packages/task-orchestrator/src/migrations.ts`

**Estimated scope:** Medium

## Checkpoint D: Remote and durable

- [x] Authorized private channel completes a coding task and receives evidence.
- [x] Untrusted/group policies pass adversarial tests.
- [x] Restart-safe delivery passes.
- [x] Memory is human-readable, searchable, editable and forgettable.

## Phase 5: Extensibility and Governed Iteration

## Task 20: Prove Claude Code and Pi runtime adapters

**Description:** Implement minimal Claude Code and Pi providers using their official programmatic/streaming surfaces and pass the same coding runtime contract suite.

**Acceptance criteria:**
- [x] Both adapters pass lifecycle, event, cancellation and error contract tests.
- [x] Runtime invocation selection remains in plugins rather than core branching.
- [x] Missing authentication fails health checks without destabilizing the host.

**Verification:**
- [x] `pnpm exec vitest run tests/runtime-contracts`
- [ ] Opt-in disposable-repository smoke test for each available runtime.

**Dependencies:** Tasks 9 and 10

**Files likely touched:**
- `plugins/runtime-claude/src/index.ts`
- `plugins/runtime-claude/test/contract.test.ts`
- `plugins/runtime-pi/src/index.ts`
- `plugins/runtime-pi/test/contract.test.ts`

**Estimated scope:** Medium

## Task 21: Run scheduled tasks and bounded standing intents

**Description:** Add durable time-based jobs and deterministic event-conditioned intents with owner scope, expiry, cooldown and fire budgets.

**Acceptance criteria:**
- [x] Scheduled jobs are durable, idempotent and observable after restart.
- [x] Event intents match only authenticated scoped events and respect cooldown/fire limits.
- [x] Automation cannot expand the underlying actor/tool policy.

**Verification:**
- [x] `pnpm exec vitest run packages/automation-runtime/test`
- [x] Clock-controlled restart and duplicate-fire tests pass.

**Dependencies:** Tasks 7, 18 and 19

**Files likely touched:**
- `packages/automation-runtime/src/scheduler.ts`
- `packages/automation-runtime/src/intent-matcher.ts`
- `packages/automation-runtime/src/intent-store.ts`
- `packages/automation-runtime/test/scheduler.test.ts`
- `packages/automation-runtime/test/intent-matcher.test.ts`

**Estimated scope:** Medium

## Task 22: Govern learned skill proposals

**Description:** Create proposal storage, hash binding, static scanning, isolated evaluation, explicit apply and rollback for workshop-owned skills.

**Acceptance criteria:**
- [x] Evidence creates a pending proposal without modifying a live skill.
- [x] Stale hashes, critical scan findings and non-workshop targets block apply.
- [x] Approved apply and rollback are atomic and reproducible.

**Verification:**
- [x] `pnpm exec vitest run packages/skill-workshop/test`
- [x] Adversarial prompt/skill fixtures cannot modify core, policy or user-authored skills.

**Dependencies:** Tasks 3, 7, 19 and 21

**Files likely touched:**
- `packages/skill-workshop/src/proposal-store.ts`
- `packages/skill-workshop/src/scanner.ts`
- `packages/skill-workshop/src/evaluator.ts`
- `packages/skill-workshop/src/apply.ts`
- `packages/skill-workshop/test/workshop.test.ts`

**Estimated scope:** Medium

## Task 23: Package and validate the Windows MVP

**Description:** Add Windows startup packaging, health diagnostics, backup/export guidance and execute the complete acceptance suite against a clean installation.

**Acceptance criteria:**
- [x] Package/install/start/stop/uninstall preserve user data according to documented choices.
- [x] Wake listening is opt-in at login and the local UI provides a visible stop/status surface.
- [ ] All 12 success criteria in the MVP spec have linked evidence or an explicit approved exception.

**Verification:**
- [ ] Clean Windows VM installation and upgrade smoke tests pass.
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e`

**Dependencies:** Tasks 11, 16, 18, 19, 20, 21 and 22

**Files likely touched:**
- `apps/host/src/windows-service.ts`
- `apps/operator-ui/src/TrayStatus.tsx`
- `scripts/package-windows.ps1`
- `docs/operations/windows.md`
- `tests/e2e/windows-acceptance.spec.ts`

**Estimated scope:** Medium

## Checkpoint E: MVP complete

- [ ] All spec success criteria have verifiable evidence.
- [x] Security, privacy and cancellation regression suites pass.
- [x] Local and cloud voice routes are documented and selectable.
- [x] Codex is production-ready; Claude Code and Pi pass adapter contracts.
- [x] Remote channel authorization/delivery core and memory retention controls work.
- [x] Learned skill proposal apply/rollback works with default mode `propose`.
- [x] Documentation and ADRs reflect the shipped behavior and external prerequisites.

## Phase 6: Cross-Platform Desktop Supervisor

## Task 24: Define assistant model and platform contracts

**Description:** Extend the additive plugin ABI with `assistant.model`, supervisor events, delegation inputs and portable platform status contracts without importing vendor or Tauri types.

**Acceptance criteria:**
- [x] Assistant model lifecycle, stream events and supervisor actions are discriminated and JSON-serializable.
- [x] Delegation inputs require a registered repository id, bounded acceptance criteria and a coding runtime id.
- [x] Platform status and secret references contain no OS or vendor SDK types.

**Verification:**
- [x] `corepack pnpm exec vitest run packages/contracts/test/assistant-contracts.test.ts`
- [x] `corepack pnpm typecheck`

**Dependencies:** Tasks 2, 7 and 9

**Files likely touched:**
- `packages/contracts/src/capabilities.ts`
- `packages/contracts/src/assistant.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/test/assistant-contracts.test.ts`

**Estimated scope:** Medium

## Task 25: Resolve provider secrets portably and call DeepSeek

**Description:** Add a platform secret-store port plus a DeepSeek assistant-model provider that resolves its key only at call time and validates all compatible API responses.

**Acceptance criteria:**
- [x] Persistent secret material never enters SQLite, browser storage, task events, prompts or logs.
- [x] DeepSeek streams normalized assistant events and propagates cancellation, timeouts and safe provider errors.
- [x] Windows DPAPI works locally; macOS Keychain and Linux Secret Service adapters have target-gated contract tests.

**Verification:**
- [x] `corepack pnpm exec vitest run packages/platform-runtime/test plugins/model-deepseek/test`
- [x] Opt-in DeepSeek smoke records only provider/model/status/token counts.

**Dependencies:** Task 24

**Files likely touched:**
- `packages/platform-runtime/src/secret-store.ts`
- `packages/platform-runtime/test/secret-store.test.ts`
- `plugins/model-deepseek/src/index.ts`
- `plugins/model-deepseek/test/contract.test.ts`
- `plugins/model-deepseek/agentme.plugin.json`

**Estimated scope:** Medium

## Task 26: Delegate a durable supervisor task graph

**Description:** Implement a restricted supervisor that creates, observes, cancels and synthesizes bounded child coding tasks while holding no filesystem or process interfaces.

**Acceptance criteria:**
- [x] Parent and child relationships survive restart and do not duplicate active workers.
- [x] Configured concurrency and one-writer-per-worktree rules are enforced.
- [x] A supervisor cannot construct or receive a repository-write or process capability.

**Verification:**
- [x] `corepack pnpm exec vitest run packages/assistant-supervisor/test tests/integration/supervisor-delegation.test.ts`
- [x] Adversarial prompt test cannot expand repository, runtime or tool policy.

**Dependencies:** Tasks 10, 24 and 25

**Files likely touched:**
- `packages/assistant-supervisor/src/supervisor.ts`
- `packages/assistant-supervisor/src/action-validator.ts`
- `packages/assistant-supervisor/test/supervisor.test.ts`
- `packages/task-orchestrator/src/orchestrator.ts`
- `tests/integration/supervisor-delegation.test.ts`

**Estimated scope:** Medium

## Task 27: Expose conversation and task-tree streams

**Description:** Add authenticated host endpoints for owner conversation, parent/child task queries and replayable supervisor/worker event streams.

**Acceptance criteria:**
- [x] Conversation submissions return a session and parent-task identity with consistent error shapes.
- [x] Reconnecting clients replay committed task-tree events before live updates.
- [x] Cancellation targets a child or parent and visibly reaches a terminal outcome.

**Verification:**
- [x] `corepack pnpm exec vitest run tests/integration/supervisor-api.test.ts`
- [x] Existing task API and token regression tests remain green.

**Dependencies:** Task 26

**Files likely touched:**
- `apps/host/src/server.ts`
- `packages/assistant-supervisor/src/session-store.ts`
- `packages/contracts/src/assistant.ts`
- `tests/integration/supervisor-api.test.ts`

**Estimated scope:** Medium

## Task 28: Launch the portable Tauri tray shell

**Description:** Add a Tauri 2 desktop shell that owns one host sidecar, tray/window lifecycle and ephemeral loopback authentication on Windows, macOS and Linux.

**Acceptance criteria:**
- [x] Opening the packaged UI requires no pasted local token and exposes no provider secret to the webview.
- [x] Closing hides to tray; explicit Quit cancels and reaps the host sidecar.
- [x] Capabilities allowlist only the exact sidecar and desktop commands in use.

**Verification:**
- [x] `corepack pnpm desktop:check`
- [x] Windows launch/hide/show/quit smoke leaves no orphan host process.

**Dependencies:** Tasks 24 and 27

**Files likely touched:**
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/capabilities/default.json`
- `package.json`

**Estimated scope:** Medium

## Task 29: Present the personal-assistant workspace

**Description:** Replace the form-first page with a desktop conversation workspace showing voice state, parent task, child agents, worktrees, tests, approvals and reports.

**Acceptance criteria:**
- [x] The primary action is conversation/voice, not token or repository configuration.
- [x] Running workers and their current phases remain visible, cancellable and reconnect-safe.
- [x] Loading, empty, degraded and error states are keyboard and screen-reader accessible at desktop and narrow widths.

**Verification:**
- [x] `corepack pnpm test:e2e`
- [x] Runtime screenshot and keyboard pass at 320, 768, 1024 and 1440 CSS pixels.

**Dependencies:** Tasks 27 and 28

**Files likely touched:**
- `apps/operator-ui/index.html`
- `apps/operator-ui/app.js`
- `apps/operator-ui/styles.css`
- `apps/operator-ui/assistant-state.ts`
- `tests/e2e/operator-task-flow.test.ts`

**Estimated scope:** Medium

## Task 30: Connect spoken conversation to the supervisor

**Description:** Route local wake and selectable local/Alibaba STT/TTS through the same conversation endpoint, with visible mute, interruption and fallback state.

**Acceptance criteria:**
- [x] Post-wake speech creates the same supervisor request as typed input; pre-wake audio remains local.
- [x] Local/cloud provider selection and fallback are visible and change no task semantics.
- [x] Mute, Escape or spoken stop cancels capture, model work and playback promptly.

**Verification:**
- [x] `corepack pnpm exec vitest run tests/integration/spoken-supervisor.test.ts`
- [x] Windows microphone smoke succeeds with Alibaba and local routes independently.

**Dependencies:** Tasks 14-16, 27 and 29

**Files likely touched:**
- `packages/voice-runtime/src/conversation-route.ts`
- `apps/host/src/server.ts`
- `apps/operator-ui/app.js`
- `tests/integration/spoken-supervisor.test.ts`
- `docs/voice-benchmark.md`

**Estimated scope:** Medium

## Task 31: Build and validate native desktop packages

**Description:** Add a native Windows/macOS/Linux build matrix, target-specific host sidecars and release evidence without treating cross-compilation as native validation.

**Acceptance criteria:**
- [x] Each target builds its own desktop artifact and sidecar using pinned toolchains.
- [x] Windows clean-install, upgrade, autostart opt-in and uninstall-preserve-data flows pass.
- [x] macOS/Linux release status remains provisional until native tray, secret-store and microphone smoke evidence is attached.

**Verification:**
- [x] Native CI matrix passes build, contract and packaging smoke jobs.
- [x] `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test && corepack pnpm test:integration && corepack pnpm test:e2e`

**Dependencies:** Tasks 25, 28-30

**Files likely touched:**
- `.github/workflows/desktop.yml`
- `scripts/desktop/prepare-sidecar.mjs`
- `apps/desktop/src-tauri/tauri.conf.json`
- `docs/operations/windows.md`
- `docs/operations/cross-platform.md`

**Estimated scope:** Medium

## Checkpoint F: Desktop personal assistant

- [x] Packaged desktop app opens to conversation with no pasted token.
- [x] Main supervisor delegates fixture work to visible isolated coding workers.
- [x] Typed and spoken requests share task semantics and produce verification evidence.
- [x] Provider keys remain behind OS-protected secret stores and redact from logs/events.
- [x] Windows runtime acceptance passes; macOS/Linux native support claims match available evidence.

## Task 32: Make the supervisor contextual and provider-switchable

**Description:** Turn the desktop supervisor into a useful personal-assistant control plane: route allowlisted desktop actions without fake tasks, answer recent-task status questions from durable state, and manage active API/model profiles through a CC Switch-inspired desktop surface.

**Acceptance criteria:**
- [x] Typed and spoken requests such as opening WeChat execute through an injected application allowlist and return a direct result without creating a coding task.
- [x] Questions about the latest or recent tasks refresh durable worker state and answer in the conversation without creating another task.
- [x] Provider profiles show endpoint, model, secret readiness, health and active status; switching takes effect without exposing keys to the webview or storing them in SQLite.
- [x] A configured coding repository uses a real coding runtime; the UI clearly labels demo/fake mode and never reports fake output as real work.

**Verification:**
- [x] Focused assistant routing, provider profile and desktop UI tests pass.
- [x] Full lint, typecheck, unit, integration, E2E and native desktop checks pass.
- [x] Windows installed-app smoke opens WeChat, recalls a prior task and switches between configured profiles.

**Dependencies:** Tasks 6, 9, 19, 27-31

**Files likely touched:**
- `apps/host/src/main.ts`
- `apps/host/src/server.ts`
- `apps/desktop/ui/app.ts`
- `apps/desktop/ui/index.html`
- `apps/desktop/ui/styles.css`
- `packages/assistant-supervisor/src/`
- `packages/platform-runtime/src/`
- `tests/integration/`

**Estimated scope:** Large

## Task 33: Enter and continue a delegated worker session

**Description:** Turn the desktop activity rail into durable task navigation and a central worker workbench where the owner can inspect execution and continue the same resumable coding-agent thread.

**Acceptance criteria:**
- [x] Reloading the desktop discovers recent parent/child tasks from the host instead of relying only on local storage.
- [x] Clicking a child opens a task workbench with honest runtime identity, normalized execution history, worktree and verification evidence.
- [x] A completed Codex task with a persisted thread accepts one serialized follow-up turn in the same worktree and re-runs registered verification.
- [x] Running, fake and legacy non-resumable tasks remain observable but cannot be misrepresented as the same resumable Agent.

**Verification:**
- [x] Focused contracts, orchestrator, host API and desktop state tests pass.
- [x] Full lint, typecheck, unit, integration, E2E and native desktop checks pass.
- [x] Windows installed-app smoke enters and continues a real Codex task without creating a new parent task.

**Dependencies:** Task 32

**Files likely touched:**
- `packages/contracts/src/events.ts`
- `packages/task-orchestrator/src/`
- `plugins/runtime-codex/src/`
- `apps/host/src/`
- `apps/desktop/ui/`
- `tests/integration/`
- `tests/e2e/`

**Estimated scope:** Large

## Task 34: Isolate coding-worker process environments

**Description:** Stop real Codex worker processes from implicitly inheriting the Host environment. Construct a minimal cross-platform allowlist for required process, path and Codex configuration locations, and fail closed when an invocation omits an environment.

**Acceptance criteria:**
- [x] Codex start and resume invocations always carry an explicit allowlisted environment.
- [x] AgentMe tokens, provider API keys and process-injection variables are excluded from the worker environment.
- [x] A direct process-controller caller that omits `env` inherits no Host variables.
- [x] Resource-directory PATH prefixing remains portable across Windows, macOS and Linux.

**Verification:**
- [x] `corepack pnpm exec vitest run plugins/runtime-codex/test/contract.test.ts`
- [x] `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test && corepack pnpm build`

**Dependencies:** Tasks 9 and 33

**Files likely touched:**
- `plugins/runtime-codex/src/invocation.ts`
- `plugins/runtime-codex/src/process-controller.ts`
- `plugins/runtime-codex/test/contract.test.ts`

**Estimated scope:** Small

## Phase 7: Project Completion Closure

## Task 35: Rebaseline the complete product contract

**Description:** Reconcile the implemented MVP with the owner's omitted personal-dashboard requirements and all outstanding runtime, voice, channel and native release evidence. Record a dependency-ordered closure plan without claiming unavailable external evidence.

**Acceptance criteria:**
- [x] Every known gap maps to a small follow-up task with explicit acceptance criteria and verification.
- [x] Sensitive dashboard data, external credentials and native-runner limitations have explicit boundaries.
- [x] Automatic commits remain an explicit owner decision rather than an inferred default.

**Verification:**
- [x] `tasks/plan.md` and this task list agree on order, dependencies and completion constraints.
- [x] Existing unchecked acceptance evidence remains unchecked.

**Dependencies:** Task 34

**Files likely touched:**
- `tasks/plan.md`
- `tasks/todo.md`

**Estimated scope:** Small

## Task 36: Store the personal dashboard securely

**Description:** Define and persist the owner's balances, income/expenses, company investments, competitions and skill evidence as one versioned, OS-protected document outside SQLite.

**Acceptance criteria:**
- [x] Public data contracts are versioned, bounded and provide strict boundary parsers for Host integration.
- [x] Dashboard values are encrypted with a random data key protected through the platform secret-store port and never enter logs, task events or model prompts implicitly.
- [x] Create, update, list, export and delete operations are deterministic and covered by tests.

**Verification:**
- [x] `corepack pnpm exec vitest run packages/contracts/test/contracts.test.ts plugins/memory-core/test/memory-store.test.ts`
- [x] A persisted fixture contains no plaintext financial or biographical values.
- [x] Full lint, typecheck, unit tests and build pass.

**Dependencies:** Tasks 19, 25 and 35

**Files likely touched:**
- `packages/contracts/src/personal-dashboard.ts`
- `packages/contracts/src/index.ts`
- `plugins/memory-core/src/personal-dashboard-store.ts`
- `plugins/memory-core/test/memory-store.test.ts`

**Estimated scope:** Medium

## Task 37: Control the dashboard through conversation and API

**Description:** Add authenticated dashboard endpoints and bounded supervisor actions so the owner can record, correct, inspect and delete dashboard entries without giving the supervisor filesystem or secret-store access.

**Acceptance criteria:**
- [x] Authenticated API calls validate all dashboard inputs and return stable error shapes.
- [x] Explicit owner instructions can query or mutate dashboard data; unrelated conversation never injects the document into model context.
- [x] Every mutation emits a redacted audit event and supports cancellation where work can block.

**Verification:**
- [x] Focused supervisor and Host integration tests pass.
- [x] Unauthorized and prompt-injection fixtures cannot read or modify dashboard data.

**Dependencies:** Task 36

**Files likely touched:**
- `packages/assistant-supervisor/src/personal-dashboard.ts`
- `packages/assistant-supervisor/test/personal-dashboard.test.ts`
- `apps/host/src/server.ts`
- `tests/integration/personal-dashboard-api.test.ts`

**Estimated scope:** Medium

## Task 38: Present the personal dashboard in the desktop app

**Description:** Add an accessible desktop dashboard for balances, transactions, investments, competitions and skills with clear privacy, loading, empty and error states.

**Acceptance criteria:**
- [x] The owner can inspect and edit every dashboard category without exposing values to browser storage.
- [x] Totals and timelines are derived deterministically from authenticated Host responses.
- [x] Keyboard, narrow-width and screen-reader flows pass existing desktop accessibility conventions.

**Verification:**
- [x] Focused desktop state and E2E tests pass.
- [x] Runtime desktop smoke confirms values disappear after deletion and after window reload remain Host-backed.

**Dependencies:** Task 37

**Files likely touched:**
- `apps/desktop/ui/personal-dashboard-state.ts`
- `apps/desktop/ui/app.ts`
- `apps/desktop/ui/index.html`
- `apps/desktop/ui/styles.css`
- `tests/e2e/personal-dashboard.test.ts`

**Estimated scope:** Medium

## Task 39: Make Claude Code a real coding worker

**Description:** Replace the Claude invocation placeholder with a cancellable runtime, normalized events, health checks and disposable-worktree verification using the installed official CLI.

**Acceptance criteria:**
- [x] Claude start, progress, file change, completion, failure and cancellation map to common coding events.
- [x] The worker receives one worktree, an isolated environment and the configured permission profile.
- [x] Missing authentication or malformed stream output fails safely without destabilizing the Host.

**Verification:**
- [x] Claude runtime contract tests pass.
- [x] Opt-in installed-CLI smoke changes and verifies only a disposable worktree.

**Dependencies:** Tasks 10, 34 and 35

**Files likely touched:**
- `plugins/runtime-claude/src/index.ts`
- `plugins/runtime-claude/src/runtime.ts`
- `plugins/runtime-claude/src/process-controller.ts`
- `plugins/runtime-claude/test/contract.test.ts`

**Estimated scope:** Medium

## Task 40: Make Pi a real coding worker

**Description:** Replace the Pi RPC placeholder with a cancellable runtime, normalized events, isolated environment and disposable-worktree verification using the official maintained distribution.

**Acceptance criteria:**
- [x] Pi lifecycle, progress, file change, completion, failure and cancellation pass the common runtime contract.
- [x] RPC messages are schema-validated and cannot escape the assigned worktree or policy profile.
- [x] Missing executable/authentication is reported as provider unavailable, never as fake success.

**Verification:**
- [x] Pi runtime contract tests pass.
- [x] Opt-in official-runtime smoke changes and verifies only a disposable worktree.

**Dependencies:** Tasks 10, 34 and 35

**Files likely touched:**
- `plugins/runtime-pi/src/index.ts`
- `plugins/runtime-pi/src/runtime.ts`
- `plugins/runtime-pi/src/process-controller.ts`
- `plugins/runtime-pi/test/contract.test.ts`

**Estimated scope:** Medium

## Checkpoint G: Complete local assistant surface

- [x] Personal dashboard storage, conversation/API control and desktop UI pass end to end.
- [x] Codex, Claude Code and Pi report honest runtime readiness and pass common contracts.
- [x] Full lint, typecheck, unit, integration, E2E and desktop checks pass.

## Task 41: Close local voice acceptance evidence

**Description:** Add licensed reproducible wake fixtures and metrics, execute the installed local STT/TTS route without network, and record CPU, latency, mute and cancellation evidence on the Windows reference host.

**Acceptance criteria:**
- [x] False-accept/false-reject and latency thresholds are explicit and measured from non-user recordings.
- [x] Local wake → STT → supervisor → TTS succeeds with outbound network disabled after installation.
- [x] Mute, stop and playback suppression cancel every active voice resource without orphan processes.

**Verification:**
- [x] Focused voice integration tests and `voice:doctor` pass.
- [x] Redacted Windows microphone/CPU smoke evidence is recorded without raw audio.

**Dependencies:** Tasks 14-16 and 35

**Files likely touched:**
- `packages/voice-runtime/src/benchmark.ts`
- `packages/voice-runtime/test/voice-acceptance.test.ts`
- `tests/integration/local-voice-task.test.ts`
- `docs/voice-benchmark.md`

**Estimated scope:** Medium

## Task 42: Connect the official Tencent channel

**Description:** Add the selected maintained QQ Bot transport to the existing owner pairing, group-deny and durable delivery core, with secrets resolved at call time.

**Acceptance criteria:**
- [x] Official private inbound messages can create, query and cancel tasks and receive evidence.
- [x] Untrusted and group messages cannot expose coding, filesystem, dashboard or secret tools.
- [x] Reconnect and restart deliver each committed outbound result once.

**Verification:**
- [x] Offline transport integration and adversarial policy tests pass.
- [ ] Live redacted QQ smoke passes when an approved App ID/secret are available.

**Dependencies:** Tasks 17-19, 35 and 37

**Files likely touched:**
- `plugins/channel-tencent/src/qq-transport.ts`
- `plugins/channel-tencent/src/index.ts`
- `plugins/channel-tencent/test/qq-transport.test.ts`
- `tests/integration/tencent-channel-task.test.ts`

**Estimated scope:** Medium

## Task 43: Run native CI and release gates

**Description:** Execute the pinned Windows/macOS/Linux build matrix on a real remote, reproduce clean Windows install/upgrade/uninstall behavior, and attach hashes and target-native limitations.

**Acceptance criteria:**
- [x] A configured Git remote runs all three native packaging jobs from the committed workflow.
- [x] Clean Windows install, upgrade, autostart opt-in, rollback and uninstall-preserve-data pass.
- [x] macOS/Linux claims match their actual native tray, secret-store and package smoke evidence.

**Verification:**
- [x] Native workflow run links and artifact hashes are recorded.
- [x] Local Windows packaged critical-flow smoke passes against the release candidate.

**Dependencies:** Tasks 38-42

**Files likely touched:**
- `.github/workflows/desktop.yml`
- `docs/release-evidence.md`
- `docs/operations/windows.md`
- `docs/operations/cross-platform.md`

**Estimated scope:** Medium

## Task 44: Sign off the complete AgentMe release

**Description:** Run every quality, security, privacy, accessibility and critical-flow gate, reconcile all specification success criteria to evidence or owner-approved exceptions, and produce a reversible release candidate.

**Acceptance criteria:**
- [x] Every user requirement and specification success criterion links to current evidence or an explicit owner-approved exception.
- [x] No known critical/high dependency or secret-leak finding remains unmitigated.
- [x] The installed desktop critical flow, rollback steps and retained-data behavior are documented and reproduced.

**Verification:**
- [x] All workspace and native desktop quality commands pass from a clean checkout.
- [x] Release checklist, changelog, artifact hashes and rollback plan are complete.

**Dependencies:** Tasks 36-43

**Files likely touched:**
- `README.md`
- `CHANGELOG.md`
- `docs/release-evidence.md`
- `tasks/todo.md`

**Estimated scope:** Medium

## Task 45: Personal agent office core (owner approved 2026-09-05)
- [x] Ordinary tasks do not need a repository; five roles have isolated context.
- [x] Durable scheduling, cancellation, retry, explicit handoff and restart recovery.
- [x] Authenticated API and focused behavior/integration tests pass.

## Task 46: Personal agent desktop (owner approved 2026-09-05)
- [x] Complete office landing page, team conversations, tasks, results and preferences.
- [x] Real browser verification of create, complete, handoff and reload.

## Task 47: Delivery and verification workflow (owner approved 2026-09-05)
- [x] Add one-command preview and document actual connector limitations.
- [x] Remove duplicate test execution from native CI without deleting tests.
- [x] Run all relevant quality gates and provide a working product to the owner.
