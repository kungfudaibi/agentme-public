# AgentMe 0.1.0 release checklist

Release: 0.1.0. Target: Windows x64 release candidate. Evidence date:
2026-08-29.

## Product and contract

- [x] Root, desktop JavaScript, Tauri and Rust package versions are 0.1.0.
- [x] Public contracts stay vendor-neutral and platform behavior stays behind
  `platform-runtime`.
- [x] Windows product flow is documented from install through rollback.
- [x] macOS and Linux are labelled provisional everywhere release status is
  described.
- [x] All 12 specification success criteria are mapped in
  `docs/release-evidence.md`.

## Quality and supply chain

- [x] Frozen install succeeds with lifecycle scripts disabled in CI.
- [x] Lint, typecheck, unit, integration, E2E and native desktop gates pass.
- [x] Windows, macOS and Linux build their own native packages in pinned CI.
- [x] High/critical dependency audit is clean.
- [x] Installed npm registry signatures verify.
- [x] Repository secret scan has no finding.
- [x] GitHub Actions use reviewed immutable commit SHAs.

## Artifacts and lifecycle

- [x] Each native artifact has a SHA-256 in `docs/release-evidence.md`.
- [x] Downloaded CI manifests replay independently.
- [x] Windows clean install, upgrade, opt-in autostart, graceful exit and final
  reinstall pass.
- [x] Uninstall preserves durable data.
- [x] Snapshot-backed rollback to the previous package passes.
- [ ] macOS/Linux physical-host interactive lifecycle evidence exists.

## Owner decisions

- [x] The owner accepted the bounded 0.1.0 exception for the uncompleted
  24-hour ambient wake run (SC-2) on 2026-08-29.
- [x] The owner accepted the bounded 0.1.0 exception for the unavailable
  approved live QQ Bot account smoke (SC-8) on 2026-08-29.
- [x] Wake listening remains opt-in at login.
- [x] Automatic task-branch commits remain disabled by default.

## Rollback decision

If any installed critical flow fails, stop the application, uninstall 0.1.0
without removing application data, restore the stopped pre-upgrade data snapshot
paired with the previous installer, verify that installer's SHA-256, and install
it. Do not run an older binary against newer data. The complete procedure and
its reproduced evidence are in `docs/operations/windows.md` and
`docs/release-evidence.md`.

Release status: **ready for final tagging**. Pull-request candidate run
[`33247596939`](https://github.com/kungfudaibi/agentme/actions/runs/33247596939)
passed on Windows, macOS and Linux, and its downloaded manifests replayed with
zero mismatch. Release assets from the tagged main commit remain authoritative.
