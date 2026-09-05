# AgentMe

AgentMe is licensed under [MIT](LICENSE). Third-party tools and dependencies
retain their own licenses. See [security guidance](SECURITY.md) before sharing
diagnostic output or configuring coding backends.

## Personal agent office preview

The desktop now opens a five-assistant personal office: coordinator, schedule,
research, finance and coding. Ordinary tasks need no repository. Each assistant
has independent context and owner preferences, with durable tasks, scheduled AI
work, cancellation, handoff and exportable results.

Run `corepack pnpm office:build` then `corepack pnpm office:preview` and open
`http://127.0.0.1:3215`. This starts an isolated local preview and can reuse the
installed Windows app's protected model credentials. See
[office usage and actual connection limits](docs/operations/agent-office.md).
Verification is recorded in [office acceptance](docs/office-acceptance.md).
Coding tasks now support selectable Codex, Claude Code and Pi backends; see
[backend setup and continuation behavior](docs/operations/coding-backends.md).

For everyday changes use `corepack pnpm test:office` or a focused suite. Before
delivery run `corepack pnpm check`; integration and E2E are already included in
its aggregate test stage. Native packaging remains a separate check.

## Existing 0.1 release baseline

AgentMe is a local-first personal programming assistant. Its desktop supervisor
keeps the conversation, task graph, provider status, voice controls and personal
dashboard visible while bounded worker agents perform repository work in
isolated Git worktrees.

Version 0.1.0 is a Windows x64 release candidate. macOS arm64 and Linux x64
packages build and pass the same contracts in native CI, but remain provisional
until their interactive hardware and installer lifecycle checks are complete.

## What it does

- Routes conversation and desktop actions directly, and decomposes project work
  into visible parent/child tasks.
- Delegates coding to Codex, Claude Code or Pi through capability plugins.
- Creates one allowlisted Git worktree per automatic repository change and
  records changed files, verification output and task history.
- Supports local wake, Chinese STT/TTS and Alibaba cloud speech with an explicit
  route/fallback selector.
- Stores provider secrets with the operating-system credential facility.
- Accepts paired-owner QQ Bot create/status/cancel commands through Tencent's
  maintained SDK.
- Records memories and personal dashboard entries separately, with inspect,
  edit, export and delete controls.
- Retains operational conversations for seven days by default and lets the user
  delete the current conversation independently from task and dashboard data.
- Keeps learned capabilities in a propose, scan, evaluate, approve, activate and
  rollback workflow that cannot rewrite core policy or credentials.
- Runs durable scheduled jobs and bounded task-event automations with visible
  expiry, cooldown, fire count and cancellation state.

## Install on Windows

Download the 0.1.0 NSIS installer from the private GitHub release once it is
published, verify its SHA-256 against `docs/release-evidence.md`, and install it
for the current user. The packaged app includes its host runtime; Node and pnpm
are needed only for development.

Launch **AgentMe** from the Start menu or desktop shortcut. No local access token
is pasted: the native shell creates a fresh in-memory loopback token and owns the
host lifecycle. Closing the main window hides it to the tray; use **退出** from
the tray to stop it.

Configure repositories, coding/model providers, voice and QQ inside the desktop
workspace. API keys are sent directly to the protected credential store and are
not written to the repository, SQLite or the UI's local storage.

**新对话** only starts a separate conversation. **删除当前对话** removes the
current conversation and its voice transcripts after confirmation while keeping
task evidence and personal-dashboard records. Operational conversations older
than seven days are purged when the host starts.

See [Windows operations](docs/operations/windows.md) for local voice setup,
upgrade, retained data and snapshot-backed rollback.

## Run from source

Requirements: Windows 11, Node 24.10+, Corepack/pnpm 11, Git for Windows, Rust
1.89 plus Tauri prerequisites, and at least one installed coding CLI for real
repository work.

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm desktop:dev
```

For a host-only development session:

```powershell
corepack pnpm build
$env:AGENTME_AUTH_TOKEN = 'replace-with-at-least-32-random-characters'
corepack pnpm start:host
```

Open `http://127.0.0.1:3210/`. The browser console is a diagnostic surface; the
native desktop workspace is the primary product.

## Real coding repositories

Copy [repositories.example.json](docs/repositories.example.json), replace the
paths and verification commands, then configure these development variables:

```powershell
$env:AGENTME_REPOSITORIES_CONFIG = 'D:\path\to\repositories.json'
$env:AGENTME_TASK_ROOT = 'D:\agentme-worktrees'
$env:AGENTME_CODEX_EXECUTABLE = 'codex'
$env:AGENTME_CODEX_WINDOWS_SANDBOX = 'unelevated'
$env:AGENTME_CODEX_RESOURCE_DIRECTORY = 'C:\path\to\codex-resources'
corepack pnpm desktop:dev
```

Only registered repository IDs are accepted. The supervisor cannot execute
processes or edit repositories directly; policy-approved worker runtimes receive
the bounded worktree and repository-owned verification commands.

Use provider settings in the app to switch APIs without restarting. The default
Codex profile uses `workspace-write` with approval prompts disabled. The optional
full-access profile uses `danger-full-access` with approval prompts disabled and
requires an explicit owner acknowledgement in the desktop UI. It removes the
Codex sandbox for that worker, so use it only for repositories and instructions
you trust. AgentMe still binds the task to its registered repository/worktree,
denies protected supervisor operations and records the profile activation.

The **自动化** page creates and cancels durable scheduled work and task-event
conditions. Conditions are owner-scoped, expire, enforce cooldown and fire
budgets, and can only create another policy-checked task. Selecting a fired
condition opens the actual dispatched task and its worker conversation.

## Verification and release status

```powershell
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:integration
corepack pnpm test:e2e
corepack pnpm desktop:check
```

The [release checklist](docs/release-checklist.md) and
[release evidence](docs/release-evidence.md) distinguish automated contracts,
physical-host evidence and explicit release exceptions. Native platform details
are in [cross-platform operations](docs/operations/cross-platform.md), QQ
constraints in [channel evidence](docs/channel-spike.md), and voice evidence in
[voice benchmark](docs/voice-benchmark.md).
