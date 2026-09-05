# Windows desktop operations

AgentMe is a native Tauri desktop application. It starts the loopback host with a
fresh in-memory access token, so the user never pastes a local token. Closing the
window hides it to the tray; **退出** in the tray menu stops the host and exits.

## Build and install

Requirements for a source build are Node 24.10+, Corepack/pnpm 11, Rust 1.89
MSVC, WebView2, and the Tauri Windows prerequisites.

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm desktop:build -- --bundles nsis,msi
```

Install either artifact under
`apps/desktop/src-tauri/target/release/bundle/`. The NSIS installer is the
recommended per-user path. The application carries its pinned Node host runtime;
a separate system Node installation is not required after installation.

## Durable voice and cloud credentials

Install the optional local SenseVoice and Piper services into AgentMe's durable
application-data directory:

```powershell
$env:AGENTME_DATA_DIRECTORY = Join-Path $env:APPDATA "com.agentme.desktop"
corepack pnpm voice:install-local
Remove-Item Env:AGENTME_DATA_DIRECTORY
```

Model archives are hash-verified. Model weights, the Python virtual environment,
SQLite state, worktrees, settings, and encrypted provider references stay under
the OS application-data directory and are not bundled into the installer.
Windows provider values are encrypted with DPAPI and are never written to logs or
the repository in plaintext.

The current user can enable or disable login startup from the top-right **开机启动**
button. It is opt-in and is never enabled merely by installing or launching the
application.

## Coding permissions and automations

The desktop provider panel defaults Codex workers to `workspace-write` with
approval prompts disabled. Switching to `danger-full-access` also disables
approval prompts and removes the Codex sandbox; AgentMe therefore requires a
separate owner acknowledgement, persists the exact approved profile, audits the
change and rejects profile changes while coding work is active. Return to the
default profile when unrestricted host access is unnecessary.

The **自动化** page exposes durable schedules and task-event conditions.
Conditions are limited to authenticated local-owner task completion/failure
events, have an expiry, cooldown and maximum fire count, and can request only a
new policy-checked task. Their last dispatched task opens directly from the
condition list. Schedule and standing-intent state is retained across host
restart in the application-data directory.

## Upgrade, recovery, and removal

Exit from the tray before upgrading, then run the newer installer. Upgrades and
normal uninstall preserve `%APPDATA%\com.agentme.desktop`; reinstalling reconnects
to the same conversations, settings, models, and encrypted credentials. Back up
that directory only while AgentMe is stopped. Delete it manually only when the
user explicitly wants all personal assistant state removed.

Treat the installer and the stopped application-data snapshot as one rollback
unit. Before an upgrade, retain both the currently installed package with its
SHA-256 and a version-labelled copy of `%APPDATA%\com.agentme.desktop`. To roll
back:

1. stop AgentMe from the tray and verify its bundled Node process has exited;
2. uninstall the newer package without deleting application data;
3. move the newer data directory aside and restore the snapshot paired with the
   previous package;
4. verify the previous installer's SHA-256, install it, and launch a smoke test;
5. keep the newer data copy until the rollback has been accepted.

Do not install an older binary directly over newer state. Database and settings
changes can make that combination fail even when both installers are valid. The
Task 43 release gate reproduced clean install, upgrade, snapshot-backed rollback,
uninstall-preserve-data and final candidate reinstall on Windows 11.

Host startup diagnostics are in `host.stderr.log` in the application-data
directory. A healthy Node 24 launch may contain the expected experimental SQLite
warning, but must not contain an exception, panic, or provider secret.
