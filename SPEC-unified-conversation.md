# Unified conversation and durable task context

Owner-approved implementation, 2026-09-06. Extends the personal office; does not
replace it with a provider-only increment. No automatic push or deployment.

## Capability map and order

| Module | Owns | Depends on |
| --- | --- | --- |
| conversation-hub | Conversations, task facts, focus, action validation, bounded context | contracts; bounded JSON store; injected model/execution ports |
| host conversation bridge | Office/coding execution and evidence reconciliation | conversation-hub, existing office/supervisor |
| unified desktop | One conversation, contextual task references and inline detail | authenticated host API |
| free-model-catalog | Official zero-price catalogue, freshness and capability metadata | injected HTTP and protected credentials |

## Required behavior

- One continuous conversation for office work and coding. Tasks are cards in
  that conversation; detail expands without switching into another assistant.
- Facts persist separately: goal, constraints, owner decisions, progress,
  repository/backend, evidence, originating conversation and linked execution.
  Old chat summaries never overwrite authoritative task state.
- New chat messages do not cancel or replace a running task. Follow-ups use an
  explicit task reference or a single unambiguous recent task; otherwise ask.
- A task's original execution backend/worktree survives UI selection changes.
- The model sees a bounded selection of facts, referenced task context and recent
  turns. No recursive summarization or routine extra model calls. At most one
  repair attempt for invalid structured output; plain chat mode never executes
  model-suggested actions. Explicit UI actions remain usable without tool support.
- Routing does not use broad keywords such as “检查/项目/运行” as execution
  authorization. Task creation has an explicit mode or validated bounded proposal.
- The hub uses an additive JSON sidecar, with validated writes and bounded data;
  existing SQLite tables and plugin ABI remain unchanged.
- Free discovery fetches only official model metadata, shows source and checked
  time, key requirements and changing limits. Zero token price is not a promise
  of permanent free service. No signup, purchase, scraped keys or paid fallback.
- Catalog capabilities distinguish text/structured/tool support, STT and TTS.
  Aliyun speech remains on the existing route. Region, expiry and activation
  conditions are explicit; unknown account balances remain unknown. Refresh is
  not permission to switch providers. Speech input/output stays in the main
  conversation without requiring the coding workbench.

## Acceptance

Tests cover restarts, interrupted turns, ambiguous references, unrelated chat,
bounded contexts, invalid model actions, one retry, chat-only downgrade,
task updates and execution result deduplication. Integration tests verify auth
and both execution bridges. Browser checks verify a single conversation carries
office and coding work, follow-ups and inline results. Official catalogue uses
offline fixtures plus a live read-only metadata check. No live model credentials
are required for automated tests. Focused tests during implementation, then lint,
types, aggregate JS and web/host build. Native packaging is not part of this turn.
