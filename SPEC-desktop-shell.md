# Spec: Cross-Platform Desktop Shell

## Objective

Deliver AgentMe as an installable Windows, macOS and Linux desktop application with a tray presence, secure local host lifecycle, conversation, voice state and a live supervisor/worker task tree. Windows is the first runtime acceptance platform; the other platforms are build and contract gates until hardware smoke evidence is available.

## Tech Stack and Commands

- Tauri 2 Rust shell in `apps/desktop/src-tauri`.
- Existing portable HTML/CSS/TypeScript UI in `apps/operator-ui`.
- Node 24 host packaged as a target-specific sidecar.
- Development: `corepack pnpm desktop:dev`.
- Build: `corepack pnpm desktop:build`.
- Rust checks: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`.

## Project Structure

```text
apps/desktop/                  Tauri configuration and desktop entry point
apps/desktop/src-tauri/        Tray, sidecar lifecycle and platform commands
apps/operator-ui/              Portable presentation and interaction logic
packages/platform-runtime/     Portable platform ports and TypeScript fakes
scripts/desktop/               Target-specific sidecar preparation
```

## Interface and Style

The webview communicates through least-privilege Tauri commands. It never receives persistent provider keys or stores authentication in browser storage. Desktop status is a discriminated union shared with the UI.

```ts
export type DesktopStatus =
  | { readonly type: "starting" }
  | { readonly type: "listening"; readonly isMuted: boolean }
  | { readonly type: "thinking"; readonly taskId?: string }
  | { readonly type: "speaking" }
  | { readonly type: "degraded"; readonly reason: string };
```

## Testing Strategy

- Unit: platform path/config contracts and UI state reducers.
- Rust: tray commands, single-instance behavior and child-process shutdown.
- E2E: launch desktop app, submit a fake task, observe worker timeline and quit without orphaning the host.
- CI build matrix: Windows, macOS and Linux native runners; packages are built on their target OS.

## Boundaries

- Always: OS-protected persistent secrets, ephemeral loopback authentication and cancellation of child processes on exit.
- Ask first: enable login startup, microphone access, notifications or a new OS permission.
- Never: expose provider keys to the webview; persist raw audio by default; claim release support without native build evidence.

## Success Criteria

1. Closing the window keeps AgentMe in the tray; Quit stops the Node host and voice sidecars.
2. The application opens without asking the user to paste a loopback token.
3. Conversation, microphone state, parent task, child workers, tests and approvals update live and remain keyboard accessible.
4. Windows package passes a local launch smoke; macOS/Linux packages compile in native CI with platform-specific tests.
5. Provider selection switches local/cloud implementations without changing supervisor, task or UI contracts.

## References

- Tauri prerequisites and supported desktop systems: https://v2.tauri.app/start/prerequisites/
- Target-specific sidecars: https://v2.tauri.app/develop/sidecar/
- Cross-platform autostart plugin: https://v2.tauri.app/plugin/autostart/
