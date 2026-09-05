# Coding backend selection

Open **构建 → 打开编程工作台**. Choose a registered repository and a **编码后端**:
Codex, Claude Code or Pi. The desktop remembers this choice for new tasks,
including voice submissions and new scheduled tasks. Existing tasks and worker
continuations retain their recorded backend; changing the selector does not
convert an existing conversation.

All backends run in the task worktree. AgentMe records their events and runs the
repository's verification commands before reporting completion. A missing or
failed backend fails the task; AgentMe does not silently use another backend.
The backend selector indicates configured adapters, not verified authentication.

## Installation and credentials

Use the separately installed and authenticated CLI. AgentMe does not install
these tools or copy the office chat model settings into them.

| Backend | Optional host environment configuration |
| --- | --- |
| Codex | Existing `AGENTME_CODEX_EXECUTABLE`, `AGENTME_CODEX_MODEL` |
| Claude Code | `AGENTME_CLAUDE_EXECUTABLE` (default `claude`), `AGENTME_CLAUDE_MODEL` |
| Pi | `AGENTME_PI_CLI` (absolute JS CLI entrypoint, run with bundled Node), or `AGENTME_PI_EXECUTABLE`; `AGENTME_PI_PROVIDER`, `AGENTME_PI_MODEL` |

On Windows, standard npm Pi entrypoints under a PATH directory are discovered
without running a command shell. For other installations, set `AGENTME_PI_CLI`
to the installed `@mariozechner/pi-coding-agent/dist/cli.js`. Pi receives only the
provider environment variables allowed by its existing adapter. Its session and
policy files live in `coding-runtime` beside the host database. The default Pi
profile excludes shell tools; AgentMe runs registered verification commands.
The existing Codex permission settings continue to apply to Codex only.

Restart the host after changing environment configuration. A host with no
registered repositories offers only its explicitly labelled demonstration runner.

For browser preview, set `AGENTME_OFFICE_REPOSITORIES_CONFIG` to an existing
repository registry JSON file before `corepack pnpm office:preview`. Preview
worktrees remain under its separate data directory. The current acceptance
preview uses an explicitly labelled disposable `backend-demo` repository.

## Verification (2026-09-05)

- Routing test follows supervisor dispatch through the actual orchestrator,
  verifies the chosen backend, propagates cancellation and rejects unknown IDs.
- Claude and Pi integration fixtures execute real child processes, modify only
  the task worktree, then continue using persisted sessions after a host restart.
- Fresh adapter tests verify persisted worktree/session/run ID restoration.
- Aggregate JS suite: 337 passed, 5 pre-existing skips, 58.61 seconds.
- TypeScript and production web/host builds pass.
- Biome: 274 files, no diagnostics. Dependency audit: no known vulnerabilities.
- Real installed Claude Code: selected from the browser, edited one README line
  in the disposable task worktree, passed host verification, and left the source
  repository clean. After a real host restart, the same session read that line
  correctly and passed continuation verification.
- Browser selected Pi, reloaded and retained Pi; switching back to Claude works.
- Pi was not found as a directly callable command on this machine. Its real
  authenticated model execution was not tested in this increment.

Protocol fixtures do not establish real account authentication or model access.

Windows x64 installer built successfully:
`AgentMe-Office-Backends-20260905-setup.exe`
(25,143,026 bytes).
SHA-256: `5DEA9EE84DD4818FC8A19AA3292BB5E6C06EB2E9A5D81A27B5218455E2DEEE70`.
This supersedes the earlier office preview installer for backend selection.
New installer lifecycle/upgrade acceptance was not rerun; source remains in the
dedicated worktree without automatic commits.
