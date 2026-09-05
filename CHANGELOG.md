# Changelog

- Coding tasks can select Codex, Claude Code or Pi; dispatch preserves that
  selection and worker continuation restores its recorded backend after restart.

All notable AgentMe changes are recorded here. The project follows Semantic
Versioning once a public API is released.

## [Unreleased] - Personal agent office preview

- Five role-specific assistants with separate context and saved working preferences.
- A new desktop office with task search, completion, cancellation, schedules,
  explicit handoff, formatted results and Markdown export.
- Ordinary office tasks no longer require a coding repository.
- A local preview launcher reuses configured model credentials without enabling
  the installed app's background channels or repository execution.
- Native CI runs non-overlapping unit, integration, E2E and desktop test stages.
- Live web search, external calendar and email connectors remain unconnected.

## [0.1.0] - 2026-08-29

First Windows release candidate of the local-first personal programming
assistant.

### Added

- Native Tauri desktop workspace with tray lifecycle, visible task activity,
  task conversations, provider switching, QQ configuration and a personal
  dashboard.
- Durable supervisor graph that plans bounded child tasks and delegates coding
  work through isolated Git worktrees to Codex, Claude Code or Pi adapters.
- Local wake/STT/TTS sidecars with an Alibaba cloud route, explicit fallback,
  cancellation and protected credential references.
- Authenticated QQ Bot create/status/cancel flow through Tencent's maintained
  SDK, paired-owner policy, durable deduplication and restart-safe outbox.
- Searchable/editable/forgettable memory, governed learned-skill proposals and
  auditable policy decisions.
- Durable scheduled assistant jobs and bounded owner-scoped standing intents
  for task completion/failure events, with expiry, cooldown and fire budgets.
- A desktop coding-permission selector with a safe `workspace-write` default
  and an explicit, audited `danger-full-access` acknowledgement path.
- Experience distillation from completed work into reviewable memories and a
  desktop skill workshop with proposal, scan, evaluation, approval, activation
  and rollback states.
- Seven-day operational conversation retention plus an explicit desktop action
  that deletes the current conversation and voice transcripts without deleting
  task evidence or personal-dashboard records.
- Native Windows, macOS and Linux CI packages with SHA-256 manifests.

### Security

- Repository allowlisting, path/symlink escape rejection, worktree isolation,
  least-authority supervisor boundaries and redacted logs.
- Windows DPAPI, macOS Keychain and Linux Secret Service credential ports.
- Frozen dependency graph, disabled install scripts in CI, high-severity audit,
  registry signature verification and SHA-pinned GitHub Actions.

### Known limits

- Windows is the supported 0.1 platform. macOS and Linux packages are
  provisional until physical-host tray, microphone, secret-store, autostart and
  installer lifecycle evidence is attached.
- A 24-hour ambient wake-listening run and a live approved QQ Bot account smoke
  are not yet reproduced. The automated privacy/policy evidence is complete;
  the owner accepted both bounded Windows 0.1.0 exceptions on 2026-08-29.
- Wake listening and automatic task-branch commits remain opt-in.
- Rolling back requires the previous installer and its matching stopped data
  snapshot; installing an old binary over newer state is unsupported.
