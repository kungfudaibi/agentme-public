# ADR-0005: Cross-platform Tauri shell and supervisor/worker separation

## Status

Accepted

## Date

2026-08-22

## Context

The loopback operator page proves the safe coding path but does not feel like an always-available personal assistant. The user needs a desktop application with tray and voice state, continuous conversation, visible running work and a main agent that delegates repository changes to coding agents. Windows remains the primary host, while the architecture must also run on macOS and Linux.

## Decision

Use Tauri 2 as a thin cross-platform desktop shell. Package the existing Node host as a target-specific sidecar and keep product semantics in portable TypeScript modules. Add an `assistant-supervisor` that consumes `assistant.model` providers and a restricted delegation port. The supervisor has no repository-write or process tools; Codex, Claude Code and Pi remain replaceable `coding.runtime` workers operating in isolated worktrees.

Use platform ports for OS-protected secrets, paths, process-tree termination, tray/autostart and audio devices. Windows is the first runtime release gate. macOS and Linux require native CI builds and later hardware voice smoke tests; cross-compilation alone is not release evidence.

## Alternatives Considered

### Keep the loopback browser page

Avoids a Rust shell but cannot reliably provide tray lifecycle, background microphone ownership, secure token handoff or an application-like experience.

### Electron

Would keep the implementation entirely in TypeScript, but duplicates a browser runtime and produces a larger always-running footprint. AgentMe already needs native platform hooks, so the smaller system-webview shell is preferred.

### Rewrite the host in Rust

Would simplify native distribution eventually, but discards the verified TypeScript plugin, task and runtime implementation. A sidecar preserves those contracts and allows incremental migration later.

### Let the main model operate coding tools directly

Reduces orchestration code but makes conversational context a high-privilege execution boundary and hides worker progress. Explicit delegation provides enforceable policy, cancellation, provenance and task-tree visibility.

## Consequences

- Tauri/Rust and platform build toolchains become production dependencies.
- Each desktop artifact must be built and tested on its target operating system.
- Sidecar naming and lifecycle must follow Tauri target-triple rules.
- The webview no longer needs a pasted local access token in packaged mode.
- Supervisor and worker failures can be displayed and recovered independently.

## References

- Tauri prerequisites: https://v2.tauri.app/start/prerequisites/
- Node sidecars and target-specific external binaries: https://v2.tauri.app/learn/sidecar-nodejs/
- Tauri autostart platform support and permission model: https://v2.tauri.app/plugin/autostart/
