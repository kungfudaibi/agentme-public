# Personal office acceptance — 2026-09-05

This records the new office increment, not a replacement for the older platform
release evidence. Source: `codex/multi-agent-office` worktree based on `fba3af7`.

## Verified behavior

Real browser interactions against the local host and configured DeepSeek model:

- Created a schedule-assistant to-do and marked it complete.
- Handed that task to the research assistant with an explicit new instruction;
  a real model response produced a weekly review template in the result library.
- Saved research-assistant preferences. Verified finance conversation drafts
  do not appear in research; restored finance drafts were then cleared.
- Reloaded the page and restarted the host: both completed tasks, the generated
  result, handoff linkage and preferences remained.
- Searched tasks, filtered attention-needed tasks, and opened results/team views.
- Opened the original personal dashboard and model settings, then returned.
- Verified desktop, 390px and 320px layouts: no horizontal overflow; composer
  remains accessible. Browser console was clear during the interaction checks.
- Foreign-origin requests to the preview API return HTTP 403; host authentication
  and restart persistence also pass integration coverage.

The two retained tasks are explicitly labelled “体验任务”. They are test material,
not imported personal records. Preview state is separate from the installed app.

## Automated checks

- `corepack pnpm lint`: 269 files, no diagnostics.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm test --maxWorkers=1`: 83 test files passed, 3 skipped;
  332 tests passed, 5 existing skips, 71.83 seconds.
- `corepack pnpm office:build`: TypeScript host and Vite desktop build passed.
- `corepack pnpm test:office`: 10 tests passed in 1.07 seconds; the focused
  command excludes compiled and native staging copies.
- `node scripts/desktop/run-native.mjs test --release`: 8 native tests passed,
  including starting and reaping a real Node host.
- `corepack pnpm desktop:build -- --bundles nsis`: final Windows x64 package
  built successfully. Bundled office backend matches the final compiled source.

Delivered installer: `AgentMe-Office-20260905-setup.exe`
(25,130,113 bytes).

SHA-256: `E4087FA867E00FDCAC2CF56704E81A0992519A883157AA0E1E66AC2F641F7536`.

The local preview remains available at `http://127.0.0.1:3215` while its process
is running. Changes remain in the dedicated worktree, uncommitted, consistent
with the project's existing automatic-commit policy.

The unchanged 101-entry memory export/reindex test timed out at its existing
5-second limit in two parallel aggregate runs. Its focused rerun and the serial
aggregate passed. Disk contention is the likely cause; no test, assertion or
timeout was weakened. CI now separates unit/integration/E2E/desktop stages so
aggregate tests are not repeated in each category.

## Scope

The five assistants have role-scoped model context and explicit handoff. This
increment does not connect web search, external calendars or email. Scheduled
AI work requires a running host. Existing coding execution remains in its
isolated workbench. Ordinary office content is local JSON, as documented in the
[operations guide](operations/agent-office.md).

Browser interaction acceptance does not establish a fresh native installer
upgrade/uninstall acceptance or macOS/Linux packaging acceptance for this
increment. The original release evidence is historical, not rerun evidence.
