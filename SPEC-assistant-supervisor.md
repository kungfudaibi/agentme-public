# Spec: Assistant Supervisor

## Objective

Provide one continuous personal-assistant conversation that understands requests, asks for clarification, decomposes approved work into bounded child tasks, delegates those tasks to coding runtimes and synthesizes evidence. The supervisor never edits repositories or executes processes itself.

## Tech Stack and Commands

- Strict TypeScript in `packages/assistant-supervisor`.
- Provider-neutral `assistant.model` contract in `packages/contracts`.
- Durable parent/child state through `packages/task-orchestrator`.
- Verify with `corepack pnpm test`, `corepack pnpm typecheck`, `corepack pnpm lint` and `corepack pnpm build`.

## Project Structure

```text
packages/contracts/              Assistant model events and delegation inputs
packages/assistant-supervisor/   Conversation, planning and result synthesis
packages/task-orchestrator/      Durable parent/child tasks and writer leases
plugins/model-deepseek/          OpenAI-compatible DeepSeek model provider
apps/operator-ui/                Conversation and task-tree presentation
```

## Public Interfaces and Style

Public actions are discriminated unions and external model output is schema-validated before dispatch.

```ts
export type SupervisorAction =
  | { readonly type: "delegate.task"; readonly request: DelegatedTaskInput }
  | { readonly type: "task.cancel"; readonly taskId: string }
  | { readonly type: "clarification.request"; readonly question: string }
  | { readonly type: "user.reply"; readonly message: string };
```

Vendor response types do not cross `plugins/model-*`. Delegated instructions are data and cannot be interpreted directly as shell commands.

## Testing Strategy

- Unit: action validation, task decomposition limits, cancellation and result synthesis.
- Contract: streaming, health, retry and cancellation for every assistant model provider.
- Integration: fake supervisor model delegates to fake/Codex workers and survives restart.
- Security: supervisor has no filesystem/process port; injected prompt text cannot expand repository or tool permissions.

## Boundaries

- Always: bind child tasks to registered repositories, acceptance criteria, policy and a single writer lease.
- Ask first: destructive actions, external effects, new execution targets and concurrency above the configured ceiling.
- Never: expose secrets to model context; give the supervisor shell/filesystem tools; let two workers share a worktree.

## Success Criteria

1. One owner request can produce multiple visible child tasks with bounded concurrency and independent cancellation.
2. Each coding child runs through an existing `coding.runtime` in its own worktree and reports verification evidence.
3. Parent completion is impossible while a required child is non-terminal or lacks a report.
4. Restart restores the conversation and task graph without duplicating worker runs.
5. Tests prove the supervisor cannot directly mutate a repository or spawn a process.

## Open Questions

- Automatic branch commits remain disabled until the existing Checkpoint B decision is approved.
- Cross-repository task dependencies remain sequential until conflict-free coordination is proven.
