# Cross-platform desktop release status

AgentMe builds on the target operating system; release evidence must not be
inferred from cross-compilation. The checked-in workflow pins Node 24.10.0 and
Rust 1.89.0, runs the full workspace gates, creates native packages, and uploads
the resulting artifacts.

| Target | Packages | Secret store | Current evidence |
| --- | --- | --- | --- |
| Windows x64 | NSIS, MSI | DPAPI | Native CI package and local clean install, upgrade, rollback, autostart and uninstall-preserve-data smoke validated on Windows 11 |
| macOS 15 arm64 runner | `.app`, DMG | Keychain | Native CI package and automated contracts pass; tray, microphone, Keychain, autostart and install lifecycle remain provisional |
| Ubuntu 22.04 x64 runner | DEB, AppImage | Secret Service | Native CI package and automated contracts pass; tray, microphone, Secret Service, autostart and install lifecycle remain provisional |

The package contains the compiled host JavaScript, the target's pinned native
Node executable, and the Python voice service scripts. Python/ONNX stays an
optional sidecar. Models and the Python environment are installed per user with
`AGENTME_DATA_DIRECTORY` and are never shipped as application resources.

## Native commands

```text
Windows: corepack pnpm desktop:build -- --bundles nsis,msi
macOS:   corepack pnpm desktop:build -- --bundles app,dmg
Linux:   corepack pnpm desktop:build -- --bundles deb,appimage
```

Each platform requires Tauri's native prerequisites. Linux AppImage production
artifacts should be built on the oldest glibc distribution supported by the
release. macOS distribution additionally requires signing/notarization for a
public release; local CI artifacts use ad-hoc signing only.

## Release claim policy

A green compile/package job proves only that the artifact was created on that
native OS. A platform becomes fully supported only after evidence covers:

1. clean install, launch without a pasted token, and graceful tray exit;
2. opt-in autostart enable/disable;
3. microphone permission, speech request, cancellation, and local/cloud fallback;
4. secret-store round trip without plaintext logs;
5. upgrade and uninstall while preserving user data.

Until those checks run on macOS and Linux, product copy and release notes must
label those targets **provisional**.

The current native package evidence and hashes are recorded in
`docs/release-evidence.md`. A green package job is not interactive hardware or
secret-store evidence.
