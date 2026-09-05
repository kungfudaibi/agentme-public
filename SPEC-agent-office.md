# Agent office

## Objective
Deliver the owner-approved personal multi-agent workspace: coordinator, schedule,
research, finance and coding assistants with separate context, durable ordinary
tasks, visible execution, cancellation, handoff and exportable results.

## Scope and boundaries
- The office is the desktop landing surface. Existing coding, dashboard, memory,
  provider and voice surfaces remain reachable.
- Ordinary tasks require no repository. AI drafting uses the configured model;
  missing credentials produce a visible blocked task, never a fabricated result.
- Local task planning works without a model. Tasks can be assigned, scheduled,
  completed and cancelled. Scheduled work executes while the host is running;
  overdue queued work is picked up at startup.
- Each assistant has editable owner instructions. Context is scoped to that
  assistant; handoff includes only the explicitly selected task and result.
- Research analyzes supplied material; live web, email and calendar connectors
  are not claimed available. Coding execution retains its existing worktree flow.
- A new versioned office JSON document sits beside the host database. No released
  SQLite schema, production dependency or plugin ABI is changed.
- Running work becomes interrupted after restart and requires explicit retry.

## Structure and dependency order
`packages/agent-office` owns catalog, state, local JSON storage and orchestration
through an injected model port. `apps/host` binds model and authenticated API.
`apps/desktop/ui/office-*` owns presentation. Core does not import UI or vendors.

## Delivery tasks
45. Office task/context behavior and authenticated API, focused failing tests first.
46. Desktop office with team navigation, conversations, task board, result detail,
    handoff, instructions, export and existing feature navigation.
47. Non-overlapping test commands, browser verification, packaging and usage guide.
The user's instruction to deliver the discussed product approves this sequence.

## Code and commands
Named exports, strict TypeScript and discriminated task state. Validate all API
inputs, serialize writes, abort provider streams and bound retained content.
Focused: `corepack pnpm test:office`.
Checks: `corepack pnpm check` and `corepack pnpm --dir apps/desktop build:web`.
Integration/E2E are included in the aggregate test command. On a busy local
Windows disk, use `corepack pnpm test --maxWorkers=1` without changing timeouts.
Use real browser interactions for task creation, context switching, handoff,
reload persistence and mobile layout. Do not replace these with source assertions.
