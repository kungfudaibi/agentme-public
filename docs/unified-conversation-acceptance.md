# Unified conversation acceptance — 2026-09-06

Implementation is in `codex/unified-conversation-20260906`, based on the complete
office/backend increment. The public branch retains the public repository's
independent snapshot history. This change does not replace the previously
distributed native installer or deploy a service.

## Delivered behavior

- One default conversation for office and coding work. Intent proposals select a
  specialist from an allowlist; explicit task modes work without model tools.
  Broad words such as “检查” and “项目” do not themselves dispatch coding work.
- Task goals, constraints, owner decisions, status, results, source evidence and
  repository/backend/execution links live in a validated JSON sidecar. Retrieval
  uses bounded recent messages and task facts, without recursive summaries.
- Referencing a task keeps its identity. Subsequent UI repository/backend choices
  cannot redirect it. Unrelated chat does not cancel background work. Ambiguous
  references ask the user to select a task. At most two hub tasks execute at once.
- Updates during execution are recorded and processed after the current run.
  A failed run's queued updates are consumed once on a later retry.
- Claude Code and Pi reuse the original persisted session and worktree for
  supported continuations. Original repositories stay outside the worker writes.
  Cancellation propagates to the execution signal; host shutdown waits for hub
  operations before closing execution storage.
- Office execution uses only its own task facts, selected role and supplied
  sources. Up to three public HTTPS pages can be read; DNS addresses are pinned
  to public IPv4, redirects are revalidated, and responses/time are bounded.
  This is source collection, not a general web search engine. Source excerpts
  are limited to 3,500 characters each, and failures are explicitly recorded.
- Task cards expand inline to show decisions and evidence. Results can be
  exported as Markdown. Legacy tools load only when opened; provider settings
  open directly without waiting for the legacy workbench to initialize.
- Dictation uses the existing `auto` / `local` / `aliyun` voice router and puts
  the transcript into the main composer for review. It never dispatches a coding
  task merely because a spoken phrase contains a coding keyword. Reading a reply
  is an explicit TTS action, limited to 2,000 characters.

## Official model discovery

The catalog separates `text`, vendor-advertised `tools`/`structured`, `stt` and
`tts`. It records offer type, authentication, regional conditions, source URL and
checked time. Account quota remaining is always unknown unless a future account
usage integration supplies it; no unlimited-free claim is made.

OpenRouter discovery reads its public models endpoint and admits only `:free`
text variants with explicit zero pricing. Enabling requires the owner's key in
the existing protected secret store. Inference uses a zero prompt/completion/
request price ceiling and no provider fallback. There is no paid model fallback,
registration, key collection or purchase. The catalog can refresh automatically
when opened after 24 hours; inference checks freshness separately.

Free text models default to plain conversation. Structured intent mode is opt-in
and requires compatible catalog metadata; all proposed actions are validated
locally. Invalid structured output gets at most one repair attempt. Otherwise
the user can select the task mode manually. No extra summarization call is made.

The existing Aliyun ASR/TTS models have separate official trial entries. Refresh
also checks the official pricing rows and quota conditions; changed/missing rows
are marked for review instead of silently refreshing an old entitlement claim.
Discovery does not replace the current speech provider, configure new keys or
claim to know the user's balance or expiry date.

Official sources checked on 2026-09-06:

- [OpenRouter models API](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)
- [Free variants](https://openrouter.ai/docs/guides/routing/model-variants/free)
- [Provider price ceilings](https://openrouter.ai/docs/guides/routing/provider-selection)
- [OpenRouter limits](https://openrouter.ai/docs/faq)
- [Aliyun model pricing](https://help.aliyun.com/zh/model-studio/model-pricing)
- [Aliyun free quota conditions](https://help.aliyun.com/zh/model-studio/new-free-quota)

## Verification evidence

- Red/green tests reproduced incorrect task association, permissive action
  types, stale busy state, late replies after shutdown, accidental task splitting,
  oversized backend instructions, repeated pending updates and specialist routing.
- Host integration covers authentication, office follow-ups and facts surviving
  a restart. Process fixtures for both Claude Code and Pi verify writes in a real
  Git worktree, unchanged original files, evidence returned to the conversation,
  restart and continuation in the same backend/worktree. These are protocol
  fixtures, not live paid model calls.
- Browser exercised office creation, unrelated chat, task reference, adjustment,
  inline decisions/evidence, model catalog refresh and provider settings. The
  390px viewport had document width 390px, with no horizontal overflow. A title
  wrapping problem and a first-click settings race found here were corrected and
  rechecked. The final normal conversation load had no console errors/warnings.
- Live, read-only OpenRouter discovery returned 19 eligible free text models;
  enablement remained off. Aliyun STT/TTS entries were checked against official
  documentation. Public HTTPS source reading was verified against example.com.
- Browser test service used isolated fixture data and no user's model key. The
  temporary 3216 service and browser tab were closed afterward; the user's 3215
  preview was not restarted.
- `corepack pnpm lint`, `corepack pnpm typecheck`, and
  `corepack pnpm office:build` passed. Focused feature tests passed.
- The final default-environment aggregate run took 94.54 seconds: 359 tests
  passed, one failed and five existing tests were skipped (365 total). The
  unchanged memory export/reindex test exceeded its five-second timeout; its
  entire nine-test file passed in isolation (3.87 seconds total).
- A diagnostic aggregate run with TEMP/TMP inside the worktree took 97.79 seconds
  and also finished with 359 passed, one failed and five existing skips. Memory
  passed, but the existing Pi process fixture failed. Its CommonJS `pi-stub.js`
  inherited the repository's `type: module` scope from that temporary location;
  this is the identified explanation for the diagnostic environment failure.
  The full suite is therefore not green. No timeout, skip or assertion was
  weakened, and no further aggregate runs are active.
- A redacted Gitleaks scan of the review diff found zero leaks. Initial backend
  verification used local process protocol fixtures; the separately authorized
  real Pi verification below adds supplier inference evidence.

## Additional real Pi verification (2026-09-06)

The existing official `@earendil-works/pi-coding-agent` installation at
`D:/agentme-tools/pi` reported version 0.84.3. It was not reinstalled or upgraded.
The official repository now documents the `@earendil-works` package name:
https://github.com/earendil-works/pi/tree/main/packages/coding-agent.

An isolated AgentMeHost used the existing protected DeepSeek credential through
the adapter's credential resolver, without saving it in Pi configuration. Pi
health returned healthy. A real `/conversations` coding task used `runtime-pi`
and `deepseek-v4-flash` to change only `value.txt` from `before` to `after` in
its disposable Git worktree. AgentMe's registered verification command exited
zero, the task completed, and the source repository remained unchanged.

After stopping and recreating the host, continuation changed the same file to
`continued`. Verification passed again, retaining the original execution,
worktree and Pi session. The Pi session contains actual provider/model usage
and tool-call records; this run did not use a process fixture. It does not
establish that every Pi model/provider or permission profile works.

Local evidence remains in the operator's temporary test directory, alongside
the disposable repository, worktree and session. Runtime evidence is not part
of the source change. The test command exited zero and its host/Pi processes
were stopped. Preview ports 3215/3216 remain closed. No installed AgentMe app,
provider configuration or production dependency was changed.

This additional real inference result did not resolve or replace the aggregate
test failures documented above. Subsequent CI fixes are recorded below.

## CI failure diagnosis and fixes

The public repository's [first native build attempt](https://github.com/kungfudaibi/agentme-public/actions/runs/33964154601/attempts/1)
passed workspace checks and compilation. Linux AppImage bundling then failed
while downloading Tauri's `AppRun-x86_64` with `Connection reset by peer`.
The second attempt succeeded without a source change; this evidence establishes
an interrupted download, not a failure on every commit.

Native packaging now retries up to three times only when its log identifies
that class of Tauri tool download interruption. Compiler/test failures are not
retried. All original verification and artifact steps remain enabled. Separate
Node tests cover recovery, terminal failure and the attempt bound.

Local memory reindexing now validates documents before replacing the index and
performs the rebuild in one SQLite transaction. A regression test proves a bad
document preserves the prior searchable index. The transaction also avoids a
disk commit per row during the 101-record rebuild. Pi's CommonJS process
fixtures now use `.cjs` explicitly, independent of the temporary directory's
parent package format. Neither change weakens timeouts or assertions.

After these fixes, the final default-environment aggregate run passed: 361 tests
passed and five existing opt-in tests were skipped across 96 files, in 108.34
seconds. The three standalone packaging-retry tests, lint, typecheck and host/web
build also passed. The earlier failed runs remain above as diagnostic history.

## Operating limits

The sidecar bounds storage at 24 MiB, 100 conversations, 500 tasks and 5,000
messages. It stops accepting new turns near capacity; export/administrative
archiving is needed to continue. Office facts have a 16,000-character budget;
coding requests retain the existing 4,000-character backend contract. Updates
are rejected explicitly when they exceed a budget; constraints are not silently
summarized away.

Existing office/task history stays in its original stores; there is no destructive
migration. New unified conversations use the new sidecar. A stopped/crashed host
retains interrupted facts and does not automatically replay work. Coding session
continuation depends on the original session being resumable by the existing
worker service; no fresh worktree is silently substituted when it is unavailable.

No native installer or microphone hardware was exercised in this increment.
The additional Pi check used the owner's existing DeepSeek account.
No production dependencies, plugin ABI or released SQLite schema
were changed. Model keys and runtime sidecars are not source artifacts.

## Running the result

From this worktree, run `corepack pnpm office:build`, then
`corepack pnpm office:preview` when a local preview is wanted. Configure the usual
model and repository/backend settings; the coding selector only enables registered
real backends. Stop the preview when finished. Source and build output are ready;
the preview is intentionally not left running.
