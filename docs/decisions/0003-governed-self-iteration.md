# ADR-0003: Governed self-iteration through proposals

## Status

Proposed

## Date

2026-08-20

## Context

The agent should improve from successful work and corrections. Allowing it to rewrite its live runtime or arbitrary plugins would create unreproducible behavior, supply-chain risk and difficult rollback.

OpenClaw's Skill Workshop provides a useful model: proposal-first writes, hash binding, security scanning, limited ownership, provenance and rollback.

## Decision

Self-iteration produces versioned proposals for workshop-owned skills or plugins. A proposal is scanned, evaluated in isolation and reviewed before activation. The default policy is `propose`. Core code, policy configuration, credentials, manually authored capabilities and external plugins are never autonomous write targets.

## Alternatives Considered

### Let the agent directly edit its repository

Maximally flexible but can corrupt the running system or weaken safeguards without a reliable recovery point.

### Never allow learned changes

Safest static behavior, but loses the user's central goal of accumulating reusable workflows and correcting recurring mistakes.

### Store every lesson only as memory

Memory is useful evidence but does not provide an executable, testable procedure or compatibility boundary.

## Consequences

- Improvements are observable, reviewable and reversible.
- A separate evaluation harness and ownership ledger are required.
- Automatic application can be enabled later for narrowly scoped, well-tested workshop-owned changes.
- Runtime updates remain conventional signed/versioned software releases.

