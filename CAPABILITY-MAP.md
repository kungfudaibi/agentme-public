# Capability Map: AgentMe

AgentMe is a Windows-first, cross-platform, voice-addressable personal programming assistant. Its core remains small; conversation models, voice engines, communication channels, coding workers, memory engines, platform integrations, and automation enter through explicit capability contracts.

| Module id | Responsibility | Depends on |
|---|---|---|
| `core-runtime` | Configuration, capability registry, event bus, sessions, identities, secrets, audit events | — |
| `plugin-system` | Manifest discovery, validation, installation, activation, compatibility and lifecycle | `core-runtime` |
| `task-orchestrator` | Durable job state machine, routing, cancellation, progress, result delivery | `core-runtime`, `plugin-system` |
| `policy-engine` | Tool policy, repository scope, approval decisions, sandbox profiles | `core-runtime` |
| `platform-runtime` | Portable paths, OS-protected secrets, process lifecycle, tray/autostart and audio-device ports | `core-runtime` |
| `coding-runtimes` | Codex, Claude Code and Pi adapters; JSON event normalization | `task-orchestrator`, `policy-engine` |
| `workspace-manager` | Repository registry, Git worktrees, Windows/WSL/Docker execution targets | `task-orchestrator`, `policy-engine` |
| `assistant-supervisor` | Owner conversation, task decomposition, bounded delegation and child-task synthesis; never writes repositories directly | `core-runtime`, `plugin-system`, `task-orchestrator`, `policy-engine` |
| `voice-runtime` | Microphone ownership, local wake word, VAD, STT/TTS provider routing, interruption | `core-runtime`, `plugin-system` |
| `channel-runtime` | Desktop, QQ Bot, Weixin and WeCom inbound/outbound adapters | `core-runtime`, `plugin-system`, `task-orchestrator` |
| `memory-runtime` | User/project memory, daily notes, provenance, indexing, retention and forgetting | `core-runtime`, `task-orchestrator` |
| `automation-runtime` | Scheduled jobs and event-conditioned intents | `task-orchestrator`, `policy-engine`, `memory-runtime` |
| `skill-workshop` | Propose, scan, test, apply and roll back learned skills/plugins | `plugin-system`, `task-orchestrator`, `policy-engine`, `memory-runtime` |
| `operator-ui` | Portable conversation, voice status, task tree, worker timeline, approvals, memory and plugin management | all runtime modules through public contracts |
| `desktop-shell` | Tauri lifecycle, system tray, secure host bridge, notifications and platform packaging | `operator-ui`, `platform-runtime` |

Build order:

1. `core-runtime` → `plugin-system` → `task-orchestrator` → `policy-engine` + `platform-runtime`
2. `coding-runtimes` + `workspace-manager` → `assistant-supervisor`
3. `voice-runtime` + `operator-ui` → `desktop-shell`
4. `channel-runtime` + `memory-runtime`
5. `automation-runtime` → `skill-workshop`

Dependency rules:

- Providers depend on public contracts; the core never imports a concrete vendor implementation.
- The supervisor can submit, observe, cancel and summarize child tasks, but it has no repository write or shell capability.
- Coding workers receive one bounded child task and one task-specific worktree; they never share an active writer lease.
- Channels never execute shell commands directly. They submit authenticated tasks to the orchestrator.
- Voice wake detection remains local even when STT/TTS uses a cloud provider.
- Platform-specific code implements portable ports and stays outside task, model, policy and memory semantics.
- Self-improvement may change workshop-owned skills and plugins only; it never rewrites the running core.


## Personal office extension (2026-09-05)

agent-office owns ordinary tasks and assistant-scoped context through injected model/persistence interfaces. Host assembles it; desktop consumes its authenticated API. Coding work remains in task-orchestrator/workspace-manager. See SPEC-agent-office.md.

## Unified conversation extension (2026-09-06)

`conversation-hub` owns the main conversation and durable task facts through a
bounded JSON store and injected model/execution interfaces. The host bridges office
roles and the existing supervisor/worker-session service; it never substitutes a
different backend for a referenced task. The desktop renders task detail inline.
Official model discovery is assembled by the host through injected HTTP and
protected credentials; text and voice offers are distinct, and discovery does not
automatically replace providers. See `SPEC-unified-conversation.md` and
`docs/unified-conversation-acceptance.md`.

