# Spec: Task worker workbench

## Objective

Let the owner enter a durable delegated task from the desktop activity rail, inspect its real execution history, and continue talking to the same coding worker session. The workbench must identify the actual runtime honestly: the current production worker is Codex CLI; Claude Code and Pi remain unavailable until adapters implement the same host contract.

## Product contract

- Clicking a child task opens a central workbench scoped to that `parentId` and `childId`.
- The workbench shows the task instruction, repository, runtime, worktree, state, normalized worker events, file changes and verification evidence.
- A completed Codex child with a persisted `threadId` accepts a follow-up message and resumes that exact Codex thread in the retained task worktree.
- A running child remains observable but does not accept a concurrent turn. The UI explains that the current turn must finish first.
- Old, fake, failed or otherwise non-resumable children remain readable and are never presented as resumable.
- Follow-up turns and normalized runtime events are appended to the existing durable task outbox; no released database schema changes are required.
- Each follow-up turn is single-writer, cancellable, re-runs the repository verification commands, and returns auditable verification evidence.
- External text is never executed directly as a shell command. Only the coding runtime and registered verification command allowlist may create processes.

## Interfaces

- `GET /assistant/parents?limit=&cursor=` returns a bounded, newest-first durable task page.
- `GET /assistant/parents/:parentId/children/:childId/activity?afterId=` returns the child identity, resumability and bounded task events.
- `POST /assistant/parents/:parentId/children/:childId/turns` accepts `{ message }`, resumes the persisted worker thread and returns a completed or failed turn result.
- Task activity uses additive discriminated `TaskEvent` variants for normalized coding events, owner input and continuation completion/failure.
- Runtime-specific thread binding remains behind a host-injected worker conversation interface; webview types contain no Codex SDK structures.

## Commands

- Focused: `corepack pnpm exec vitest run <focused test files>`
- Build: `corepack pnpm build`
- Test: `corepack pnpm test`
- Integration: `corepack pnpm test:integration`
- E2E: `corepack pnpm test:e2e`
- Lint: `corepack pnpm lint`
- Type check: `corepack pnpm typecheck`
- Native: `corepack pnpm desktop:check`

## Project structure

- `packages/contracts` owns additive task activity event types.
- `packages/task-orchestrator` persists normalized activity without changing the released schema.
- `plugins/runtime-codex` rebinds a persisted thread to its retained worktree.
- `apps/host` owns authenticated task pages, continuation orchestration and boundary validation.
- `apps/desktop/ui` owns task navigation, presentation and owner input.

## Code style

Public events remain discriminated unions with named exports. External JSON is parsed at the host and webview boundaries; vendor types do not cross capability boundaries.

## Testing strategy

- Unit tests validate new event parsing, cursor paging, activity parsing and runtime rebinding.
- Integration tests prove durable task discovery and same-thread continuation with a fixture runtime.
- E2E tests prove a task card opens the workbench and exposes an Agent-specific composer.
- Windows installed-app smoke proves an existing Codex task can be entered and continued without creating a new parent task.

## Boundaries

- Always propagate cancellation and serialize turns per child.
- Ask before adding production dependencies, changing the plugin ABI or changing the released SQLite schema.
- Never expose secrets, raw provider payloads or arbitrary terminal execution to the webview.
- Never claim Claude Code or Pi is active before a real adapter and native smoke exist.

## Success criteria

- Durable tasks are available after reload without relying on `localStorage` task IDs.
- Entering a task clearly identifies Codex, its worktree and its normalized execution history.
- A follow-up reaches the same persisted Codex `threadId`, produces visible events and verification evidence, and does not create a new parent task.
- All focused and full quality gates pass; the upgraded Windows application remains responsive.

## Open questions

None for this slice. Multi-window task views and Claude Code/Pi adapters are explicitly deferred.
