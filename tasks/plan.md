# Implementation Plan: AgentMe MVP

## Overview

Implement AgentMe as a Windows-first, cross-platform TypeScript/Rust product with a small capability-driven core and optional provider plugins. Delivery proceeds through end-to-end vertical slices: durable coding tasks, a restricted conversational supervisor, a packaged desktop shell, local/cloud voice, a Tencent channel, memory, and governed skill learning. Every phase leaves a runnable system and has an explicit review checkpoint.

Source of truth: [`SPEC-agentme-mvp.md`](../SPEC-agentme-mvp.md). Module boundaries: [`CAPABILITY-MAP.md`](../CAPABILITY-MAP.md).

## Planning Assumptions

1. Use pnpm workspaces, Node.js LTS and strict TypeScript unless the scaffold smoke test finds a current incompatibility.
2. Use Vitest for unit/contract tests and Playwright only when the operator UI exists.
3. Preserve the verified loopback host API and package it behind a Tauri 2 desktop shell; the packaged webview receives ephemeral authentication without a pasted token.
4. Codex is the first production coding runtime. Claude Code and Pi initially prove only the shared adapter contract.
5. Local voice services are out-of-process providers so their Python/ONNX dependencies do not enter the host process.
6. QQ Bot is the preferred first remote channel, with Weixin selected instead if QQ credentials cannot pass the onboarding spike.
7. Windows is the first runtime acceptance target. macOS and Linux are native build/contract targets until their microphone and tray flows have hardware smoke evidence.
8. No implementation task may make third-party reference directories part of the product or build.

## Dependency Graph

```text
scaffold
  └─ contracts + config
       ├─ plugin registry
       ├─ durable task store
       │    └─ fake task vertical slice
       │         ├─ policy engine
       │         ├─ workspace manager
       │         │    └─ Codex runtime slice
       │         │         ├─ assistant model + supervisor
       │         │         │    └─ delegated task graph
       │         │         ├─ Claude/Pi workers
       │         │         └─ Tencent channel slice
       │         └─ operator UI → Tauri desktop shell
       ├─ voice provider contracts
       │    └─ microphone + wake slice
       │         ├─ local STT/TTS slice
       │         └─ cloud voice fallback
       └─ memory store
            └─ task/daily memory slice
                 ├─ automation
                 └─ governed skill workshop
```

Shared contracts are defined before provider implementations. Provider implementations may proceed independently only after their contract tests are stable.

## Architecture Decisions

- Metadata-first plugins: manifests are parsed and permission-checked before entry code loads.
- Durable event log: task state and externally visible events commit to SQLite before delivery.
- Single-writer tasks: each active task owns a lease; stale executors cannot mutate task state.
- Worktree isolation: automatic code changes occur only inside task-specific Git worktrees.
- Local-first wake: the wake detector owns the pre-wake audio path and never forwards it to cloud providers.
- Provider-neutral events: vendor output is translated at adapter boundaries.
- Supervisor/worker separation: the conversation model only uses a restricted delegation port; coding runtimes own worktree tools.
- Portable shell boundary: Tauri and OS adapters own tray, secrets, autostart, audio devices and sidecar lifecycle without changing task semantics.
- Governed learning: learned changes use proposal, evaluation, approval and rollback records.

## Delivery Phases

### Phase 1: Executable foundation

Goal: run a durable fake programming task through the real host API and event stream.

- Scaffold the monorepo and quality commands.
- Define capability, event and error contracts.
- Load one metadata-first fake runtime plugin.
- Persist task transitions and stream them to a small control client.

Checkpoint evidence: one command starts the host; a test client submits, observes and cancels a fake task; restart does not duplicate it.

### Phase 2: Safe real coding task

Goal: submit a task against a registered fixture repository and receive verified Codex results from an isolated worktree.

- Add repository registry, policy decisions and approval records.
- Create and retain task worktrees.
- Normalize Codex streaming events and cancellation.
- Run configured tests and generate a structured final report.
- Expose the flow in the operator UI.

Checkpoint evidence: an end-to-end fixture task changes only its worktree, passes tests, and reports diff/test evidence.

### Phase 3: Smart-speaker voice loop

Goal: wake locally, dictate a coding task, and hear/see progress and the result.

- Establish microphone ownership, mute/stop behavior and audio fixtures.
- Add sherpa-onnx wake provider.
- Add SenseVoice/Piper local route.
- Add Alibaba cloud voice provider and explicit fallback routing.

Checkpoint evidence: pre-wake audio remains local; local and cloud configurations both complete the same task-intake scenario.

### Phase 3A: Desktop supervisor convergence

Goal: replace the token-driven control page with an installable personal-assistant application whose main agent delegates work to visible coding workers.

- Add assistant-model and portable-platform contracts.
- Add DeepSeek as the first supervisor model with call-time OS-protected secret resolution.
- Persist parent/child task graphs and enforce that the supervisor cannot write repositories or spawn processes.
- Package the host behind a Tauri tray application and show conversation, voice state, workers, worktrees, tests and approvals.
- Build native artifacts on Windows, macOS and Linux; run the full desktop/voice smoke on Windows first.

Checkpoint evidence: the desktop app starts without a pasted token, a conversation delegates a fixture change to a coding worker, and the task tree displays verified completion.

### Phase 4: Remote channel and durable memory

Goal: create/query/cancel tasks remotely and retain useful project knowledge.

- Complete Tencent credential/onboarding spike.
- Implement one official channel adapter with owner pairing and group-deny defaults.
- Add Markdown memory with SQLite FTS/provenance.
- Generate daily task notes and allow inspection/forgetting.

Checkpoint evidence: an authorized private message triggers a task and receives its report; an unauthorized sender cannot expose coding tools.

### Phase 5: Extensibility and governed iteration

Goal: prove alternate runtimes, automation and reversible learned capabilities.

- Pass common adapter tests for Claude Code and Pi.
- Add scheduled tasks and bounded event-conditioned intents.
- Implement proposal/scan/evaluate/apply/rollback for workshop-owned skills.
- Package and run the complete Windows acceptance suite.

Checkpoint evidence: a completed task produces a skill proposal that can be approved, activated and rolled back without changing core code.

## Verification Strategy

Every task runs the narrowest relevant tests plus `pnpm typecheck`. Phase checkpoints run:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
```

Once the UI exists:

```powershell
pnpm test:e2e
pnpm desktop:check
pnpm desktop:build
```

Hardware/API tests are opt-in and must report provider, model, runtime version and machine profile. CI must remain green without paid credentials, microphone hardware or a GPU.

## Parallelization Opportunities

After Task 4 stabilizes the contracts:

- Voice fixtures/provider prototypes can proceed independently from coding runtime work.
- Operator UI can use the fake runtime while Codex integration is developed.
- Claude Code and Pi adapters can proceed independently after the Codex adapter establishes normalized event conventions.
- Native desktop packaging can run independently per operating system after the desktop-shell contract stabilizes.
- QQ/Weixin onboarding research can proceed without changing channel contracts.

Sequential constraints:

- SQLite task schema precedes task orchestration.
- Policy decisions and repository registry precede automatic worktree mutation.
- Wake/microphone ownership precedes STT/TTS integration.
- Memory provenance precedes automatic capture.
- Skill proposal storage precedes any apply or rollback behavior.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Windows child process cancellation leaves Codex/tests running | High | Process-tree integration tests; job objects or verified tree termination; restart reconciliation |
| Coding agent modifies the wrong checkout | High | Registry-issued paths, mandatory worktrees, canonical-path/symlink checks |
| Always-on microphone leaks audio | High | Local wake boundary, explicit audio ownership state, network-spy tests |
| Speaker output retriggers wake/ASR | High | MVP half-duplex, playback suppression, device-specific echo test before duplex |
| Tencent credentials or API eligibility unavailable | High | Early onboarding spike; interchangeable QQ/Weixin channel contract; desktop remains functional |
| Local model latency is unacceptable on user hardware | Medium | Benchmark provider health; selectable provider/fallback; Piper/SenseVoice CPU baseline |
| Plugin installation executes hostile code | High | Metadata-only discovery, disabled lifecycle scripts, permission display, staged activation |
| Self-learning weakens safeguards | High | Workshop ownership, immutable core boundary, scanner, isolated evaluation, proposal default |
| SQLite/event stream divergence after crash | Medium | Commit-before-publish outbox pattern and restart replay tests |
| Supervisor gains coding privileges through prompt output | High | No filesystem/process port; schema-validated delegation actions; policy intersection on every child task |
| Platform packaging behaves differently by OS | High | Platform ports, native CI matrix and no release claim without target-native evidence |
| Node/voice sidecars outlive the desktop app | High | Shell-owned process groups, cancellation propagation and orphan-process E2E tests |

## Review Gates

1. Plan approval before scaffolding.
2. Foundation checkpoint before installing real coding/voice dependencies.
3. Coding checkpoint before enabling remote channels.
4. Voice privacy checkpoint before enabling always-on startup.
5. Desktop supervisor checkpoint before replacing the loopback control page as the default entry point.
6. Security review before any automatic skill application mode.

## Open Decisions Scheduled Early

- Task 1 records actual Node/pnpm versions and validates native SQLite installation on Windows.
- Task 13 records CPU/GPU/RAM and selects the default local TTS route.
- Task 17 determines whether QQ Bot or Weixin is the first production channel.
- Task 10 confirms whether automatic commits are enabled by default; until decided, the implementation leaves reviewed worktree changes uncommitted.
- Transcript retention remains seven days unless changed before Task 19.

## Task List

Detailed acceptance criteria, dependencies, likely files and verification commands are in [`tasks/todo.md`](todo.md).

## Task worker workbench increment

Build order: additive task activity contracts and persistence → authenticated parent/activity/turn APIs → desktop task workbench → real Codex continuation smoke. This increment reuses the existing SQLite outbox and does not change the released database schema or plugin ABI.

## Project completion closure

The owner's completion directive covers both the MVP contract and the previously stated personal-assistant requirements that were omitted from the MVP specification. Work continues in small vertical slices and does not treat missing external evidence as success.

Build order:

1. Add an OS-protected personal dashboard document and stable contracts for balances, income/expenses, investments, competitions and skills.
2. Expose dashboard operations through the authenticated Host and restricted supervisor, then present them in the desktop workspace.
3. Replace Claude Code and Pi invocation placeholders with cancellable, event-normalizing coding runtimes that pass the common contract.
4. Close local voice fixture/latency/privacy evidence and run available Windows hardware smoke checks.
5. Add the selected official Tencent transport and run live authorization/delivery smoke checks when approved credentials exist.
6. Run native CI/package gates where target-native infrastructure exists, then assemble final release evidence and rollback instructions.

Completion constraints:

- Financial and biographical dashboard values are sensitive. They stay behind the Host and OS-protected storage; the webview receives only authenticated responses and no new released SQLite schema is required.
- A provider adapter is not called production-ready until a real disposable-worktree smoke test succeeds.
- QQ/Weixin and macOS/Linux acceptance remain blocked evidence, not passed checks, until the required approved account or native runner exists.
- Automatic task-branch commits remain disabled until the owner explicitly chooses that policy.

The ordered closure tasks and checkpoints are recorded as Tasks 35-44 in `tasks/todo.md`.


## Owner-approved personal office delivery (2026-09-05)

Tasks 45 → 46 → 47 implement SPEC-agent-office.md sequentially: office domain/API, interactive desktop, then browser/release verification and non-overlapping test stages.

