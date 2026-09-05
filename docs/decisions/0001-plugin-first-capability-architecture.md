# ADR-0001: Plugin-first capability architecture

## Status

Proposed

## Date

2026-08-20

## Context

AgentMe must switch among local and cloud voice models, QQ/Weixin channels, Codex/Claude Code/Pi runtimes, and multiple memory or execution backends. Direct vendor dependencies in the core would make each addition a core change and prevent safe independent upgrades.

Pi demonstrates a small event-driven harness with rich extensions. OpenClaw demonstrates metadata-first discovery and typed capability ownership. HarnessX demonstrates capability bundles spanning tools, processors, MCP and skills.

## Decision

Use a small core with typed capability contracts, lifecycle events and a metadata-first plugin manifest. Manifest discovery and configuration validation occur without executing plugin code. Concrete vendors remain outside core packages.

## Alternatives Considered

### Base the entire product on OpenClaw

Fastest feature coverage, but it imports a large and rapidly changing product surface. AgentMe needs a narrower Windows programming-first contract and must be able to replace core behavior deliberately.

### Fork Pi and add product features directly

Pi has the desired extensibility, but messaging, durable tasks, Windows service lifecycle, voice ownership and governed learning would become substantial fork-specific core changes.

### Build one monolithic Windows application

Initially simple, but incompatible provider lifecycles and vendor SDKs would quickly create cross-module coupling and make self-update unsafe.

## Consequences

- More interface and contract-test work is required early.
- Providers can be installed, disabled and upgraded independently.
- Core can validate permissions before plugin activation.
- Plugin ABI changes require deliberate compatibility and migration policy.

