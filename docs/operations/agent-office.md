# Personal agent office

Start the finished local workspace:

```powershell
corepack pnpm office:build
corepack pnpm office:preview
```

Open http://127.0.0.1:3215. The same office is the native desktop landing page.
The preview owns a separate host and durable directory `.agentme/office-preview`.
`AGENTME_OFFICE_DATA` can set a different absolute data directory.

On Windows the preview reuses the installed app's model selection and protected
credential directory if present. It does not enable QQ, voice or coding execution
from the installed app's settings. Model settings edited in preview affect the
shared credentials, while endpoint/model selection is saved in preview settings.

## What works
- Five assistants with independent task-derived conversation context and saved
  owner preferences. Last four completed AI tasks provide context.
- Ordinary to-dos, model-backed writing/analysis, scheduled AI work, cancellation,
  retry, interruption recovery, results and explicit assistant-to-assistant handoff.
- Task search, state filters, Markdown export and deletion. Up to 500 tasks.
- Existing native coding, voice, memory, personal dashboard and provider controls
  remain accessible through the specialist workspace with a return button.

Model execution needs a configured API. Missing credentials yield a blocked task;
to-dos remain usable. Web search, email and external calendar connectors are not
connected. A scheduled AI task runs while the host is on; overdue queued tasks
are picked up after startup. A to-do date is informational, not a notification.

Office work is stored in a versioned JSON file next to the host SQLite database;
it does not migrate existing tables. Like operational conversation data, office
content is local plaintext under the user's data directory, not the encrypted
financial dashboard. Do not paste secrets. Export/delete controls are per task;
handoff copies remain until their own task is deleted. A running task interrupted
by shutdown requires explicit retry and never silently repeats.

## Daily verification
- During changes: `corepack pnpm test:office` or focused Vitest files.
- Before delivery: `corepack pnpm check` (lint, types, all JS tests, build once).
- If parallel filesystem-heavy tests contend on Windows, run the aggregate as
  `corepack pnpm test --maxWorkers=1`; keep the same assertions and timeouts.
- Native Rust or packaging changes: additionally `corepack pnpm desktop:check`.
- `pnpm test` remains the aggregate JS suite. Integration/E2E commands are focused
  entry points, not extra gates after an aggregate run.
- CI uses `test:unit` + integration + E2E + desktop:check: each JS test belongs to
  exactly one stage. Tests have not been removed or disabled.
