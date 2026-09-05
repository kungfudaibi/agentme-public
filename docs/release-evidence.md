# Native release evidence

Evidence date: 2026-08-29. Source tasks: Tasks 43-44. The earlier native
candidate was commit `cb84a5b656593ff1dacb8f46794a4c098ecdf2ca`.

## Native CI

GitHub Actions run
[`33134976717`](https://github.com/kungfudaibi/agentme/actions/runs/33134976717)
completed successfully from pull request 1. Its pinned Windows 2025, macOS 15
arm64 and Ubuntu 22.04 jobs each installed with lifecycle scripts disabled, ran
the high-severity dependency audit and npm signature audit, ran every workspace
and native desktop quality gate, built on the target OS, generated
`artifacts.sha256`, and uploaded the native bundle.

| Target | Package | SHA-256 |
| --- | --- | --- |
| Windows x64 | `AgentMe_0.1.0_x64-setup.exe` | `2e4044f2b5c16fcfd825a16bd33b951a057cc30ba8b2aac3973036579257438a` |
| Windows x64 | `AgentMe_0.1.0_x64_en-US.msi` | `38a8e2f845eacc451b926c0a6bdcc78e61ef5e1a0cbc2f6dd6213b6fb070d624` |
| macOS arm64 | `AgentMe_0.1.0_aarch64.dmg` | `e717a73a780c73adadc3c29d60616a0652d9aba7d42fe6933b9c0c8912901081` |
| Linux x64 | `AgentMe_0.1.0_amd64.AppImage` | `d74b596e97f0a324269cf90e70045af37aa420c3063a50af56ff8194553d0f15` |
| Linux x64 | `AgentMe_0.1.0_amd64.deb` | `379d4c7a2ac5e3cb1631dad343ece92413117d34eeb94aea8d6fc87b0d70879e` |

The downloaded manifests were independently replayed on the Windows evidence
host: 2 Windows files, 1,148 macOS bundle files and 2,529 Linux bundle files all
matched. GitHub's archive digests were
`cebc750c8ad5674b1f7bfaa29b9a4981f6b97ed8373628f7514ed48bbb3d1b7e`
for Linux, `9e6c38b2ab6d9194167865d5fe5a646dd9c46db228d594cdabce6271e82046db`
for Windows and
`49180cbf1de0b31b5371f7bd358789771a10873a8bda93e79b28f131dbabfced`
for macOS.

## Windows 11 x64 packaged smoke

The locally reproduced candidate from the same commit had these hashes. Native
installer metadata is not reproducible byte-for-byte across separate builds, so
these hashes are intentionally distinct from the CI artifacts above.

| Package | Bytes | SHA-256 |
| --- | ---: | --- |
| `AgentMe_0.1.0_x64-setup.exe` | 25,039,063 | `596C73DB9AB0C087D4031784212B575BE532764FBC872032DAED54BA04A12505` |
| `AgentMe_0.1.0_x64_en-US.msi` | 37,637,654 | `32485C4DAD163EEF9965DE946C82B955D5999DB9C218359C0EBCA0CAFC1B0D9F` |

The native Windows host reproduced:

- a clean NSIS installation with the packaged Node host and graceful smoke exit;
- an upgrade from the previous accepted package to this candidate;
- opt-in autostart enable, verification and restoration to its prior state;
- uninstall with an unchanged durable-data inventory;
- rollback after restoring the data snapshot paired with the previous package;
- a final reinstall of this candidate with the real user data restored;
- no retained AgentMe or bundled Node process after each smoke exit.

Before the exercise, 8,532 durable files totaling 1,220,117,777 bytes were
copied to a task-specific local backup and inventory-checked. The only files
absent after graceful database shutdown were SQLite's transient `-shm` and
`-wal` files. The final installed version is 0.1.0 and AgentMe is stopped.

Installing an older binary over newer data is not a supported rollback. The
exercise first demonstrated that this can fail, then proved the documented
rollback by restoring the matching pre-upgrade data snapshot before installing
the previous package.

## Platform claim boundaries

The green macOS and Linux jobs prove target-native compilation, the full
automated contract suite, package creation and artifact integrity. GitHub-hosted
runners did not exercise an interactive tray session, microphone hardware,
Keychain/Secret Service round trip, autostart or installer upgrade. Those two
targets therefore remain provisional. Windows is the only target with current
interactive packaged lifecycle evidence.

## Final Task 44 local sign-off gates

The Windows sign-off worktree completed the frozen install and all current
release gates at commit `6603cd24bfa2077270b2e81cfb65866039d097f5` after
the product-capability closure:

- Biome lint and strict TypeScript typecheck passed;
- 322 workspace tests passed with five credential/hardware-gated tests
  skipped;
- 42 integration tests passed with three credential/hardware-gated tests
  skipped;
- ten desktop E2E tests passed;
- 51 desktop JavaScript tests and eight Rust host tests passed;
- pnpm reported no known vulnerability and verified all 117
  installed registry signatures;
- production-tracked content and the installed runtime's logs, settings and
  SQLite files had no secret-bearing finding; the only production source match
  was the sanitizer's own detection pattern, and dedicated tests use synthetic
  placeholder values.

The first full parallel unit run exposed the 5-second default timeout in the
existing 1,005-event worker-history stress test. The focused behavior passed in
2.382 seconds; its explicit budget is now 10 seconds, and the repeated full unit
suite passed. No production timing or worker behavior changed.

The same commit produced both Windows bundles locally and the optimized native
application completed a controlled host-start/graceful-exit smoke with exit code
zero:

| Package | Bytes | SHA-256 |
| --- | ---: | --- |
| `AgentMe_0.1.0_x64-setup.exe` | 25,091,555 | `7BD8C1D2350EFFB3830E077BADAB0C2209CFD30DA72F9E6734EFCDA7FD1AD685` |
| `AgentMe_0.1.0_x64_en-US.msi` | 37,810,216 | `F36C05FB92C456CF400B8754790F464F8C1C1F42E0443158A7960E0572B4E1BD` |

## Final Task 44 pull-request candidate

GitHub Actions run
[`33247596939`](https://github.com/kungfudaibi/agentme/actions/runs/33247596939)
completed successfully for commit
`6603cd24bfa2077270b2e81cfb65866039d097f5`. Windows 2025, macOS 15
arm64 and Ubuntu 22.04 each repeated the frozen install, supply-chain checks,
workspace/native gates and target-native packaging.

| Target | Package | SHA-256 |
| --- | --- | --- |
| Windows x64 | `AgentMe_0.1.0_x64-setup.exe` | `9fb19f2ac5dbdca2d25a9121b6845b798821b43ce18fbf6119f48163d34b88b8` |
| Windows x64 | `AgentMe_0.1.0_x64_en-US.msi` | `c254ef0b6eeb0280b21f53a1878763341ed9cc41759c6768d6b3da6cd1f690eb` |
| macOS arm64 | `AgentMe_0.1.0_aarch64.dmg` | `018cd2f84eac572786139edcd1d9d49ae800e9853363677950637bd77d0330e6` |
| Linux x64 | `AgentMe_0.1.0_amd64.AppImage` | `1b3125ea81167ae67678def6777adb8415dd042919bd6315a1699f2d5bae2cfd` |
| Linux x64 | `AgentMe_0.1.0_amd64.deb` | `9c2759020ab3747de73952e4291dc709accadb79afd38ed78e5f3367e588a854` |

The downloaded manifests were independently replayed with zero mismatch across
2 Windows, 1,308 macOS and 2,849 Linux files. GitHub's archive digests were
`c4f124d542a307a84094f19b33841a8dc66012148746262d23ca22d603c31b06`
for Windows,
`6491bb0a889361e7ab442e8758fd1aaedc336b31d04a272f77971b64b584dcdc`
for macOS and
`4a77e9daa61fdca85ced9fe1ef2b240a2765d49f959779cb7d4dc0f677f632ca`
for Linux.

## Superseded Task 44 native candidate

GitHub Actions run
[`33137316859`](https://github.com/kungfudaibi/agentme/actions/runs/33137316859)
completed successfully for release-signoff commit
`9e3863a323c0fc27d46080fd80c5f1df0a998fb8`. All three jobs ran the
clean-checkout quality and supply-chain gates before packaging. The downloaded
CI manifests were independently replayed for the five distributable packages:

| Target | Package | SHA-256 |
| --- | --- | --- |
| Windows x64 | `AgentMe_0.1.0_x64-setup.exe` | `1fccf1ecaf6e002ee85f54bdae83d9cd0af04a542aba29c60c80d812cdf840e3` |
| Windows x64 | `AgentMe_0.1.0_x64_en-US.msi` | `8f5af3244d8eb80b9a98db0c22915a0adc2ad4a2f3b858d387789f42f2c7585b` |
| macOS arm64 | `AgentMe_0.1.0_aarch64.dmg` | `a63498b8e4a490e674c2150a784eadec49b70ca32affdc00454e89f23eaff4c8` |
| Linux x64 | `AgentMe_0.1.0_amd64.AppImage` | `d30fa93dc298182a71c1b2d224ac432e102603d6c6f846908ea3349439905cec` |
| Linux x64 | `AgentMe_0.1.0_amd64.deb` | `19c67fbc73a907163283c4f503d55747ea1202a26f3358086ec7e654c8d68087` |

These hashes identify an earlier Task 44 pull-request candidate. It was
superseded by the product-capability closure that added durable automations,
governed coding permission profiles, experience distillation and the skill
workshop surface. They are retained as historical evidence only. The final
GitHub release must attach artifacts and manifests produced from the final
tagged main commit; release-asset hashes remain authoritative for those files.

## Specification success criteria

`SC-n` refers to the numbered criteria in `SPEC-agentme-mvp.md`. **Verified**
means current executable or physical-host evidence supports the criterion.
**Owner-approved exception** means the implementation and automated boundary
are present and the owner accepted release without reproducing the literal
external-duration/account condition. It must not be described as verified.

| Criterion | Status | Current evidence |
| --- | --- | --- |
| SC-1 | Verified | The three-platform native workflow runs the same workspace/contracts before target-native packaging; platform behavior is injected through `packages/platform-runtime`. |
| SC-2 | Owner-approved exception | The UI exposes microphone state; local sidecars reject non-loopback networking; benchmark CPU averaged 1.324%; the owner exercised two microphone utterances. A continuous 24-hour ambient run has not occurred. The owner accepted this bounded Windows 0.1.0 exception on 2026-08-29. |
| SC-3 | Verified | Installed local wake/STT/TTS completed the supervisor route; spoken stop and cancellation tests abort work; mute/Escape release the audio graph. See `docs/voice-benchmark.md`, `tests/integration/local-voice-task.test.ts` and `tests/integration/spoken-supervisor.test.ts`. |
| SC-4 | Verified | `SpokenConversationRouter` selects local/cloud routes, the installed local route completed end to end, Alibaba ASR/TTS contracts validate the production request/response shapes, and explicit cloud-to-local fallback is tested. |
| SC-5 | Verified | `tests/integration/supervisor-delegation.test.ts`, `tests/integration/verified-coding-task.test.ts` and `tests/e2e/desktop-assistant-workspace.test.ts` cover visible parent/child work, worktree allocation, file/test evidence and worker conversation. |
| SC-6 | Verified | Supervisor tests inject bounded dispatcher ports; policy tests deny direct process/repository capability, path traversal and unauthorized tools. |
| SC-7 | Verified | Codex has the production worktree/event/cancellation adapter; Codex, Claude Code and Pi plugin contract suites pass. Alternate installed-CLI smoke suites remain opt-in because authentication is external. |
| SC-8 | Owner-approved exception | The official Tencent SDK transport, owner pairing, create/query/cancel, group/untrusted denial, reconnect and durable delivery all pass offline integration/adversarial tests. No approved QQ App ID/secret/owner OpenID is available for a live authenticated smoke. The owner accepted this bounded Windows 0.1.0 exception on 2026-08-29. |
| SC-9 | Verified | `packages/task-orchestrator/test/restart.test.ts`, supervisor graph-store tests, approval-store tests and memory integration exercise restart recovery without duplicate active work. |
| SC-10 | Verified | Assistant sessions purge after the default seven-day operational window; the authenticated session API and confirmed desktop action delete the current conversation/voice transcripts while retaining task evidence and dashboard records. `MemoryStore` keeps provenance-bearing Markdown user-inspectable/editable and supports search/reindex/forget independently; dashboard records have separate edit/export/delete controls. |
| SC-11 | Verified | `packages/skill-workshop/test/workshop.test.ts` covers propose, scan, isolated evaluation, explicit approval, activation and rollback while rejecting protected targets. |
| SC-12 | Verified | Plugin, policy, workspace, host and channel adversarial suites reject traversal, symlink escape, unregistered repositories, remote tool escalation and secret-bearing logs. |

The SC-2 and SC-8 exceptions are bounded to the Windows 0.1.0 release candidate.
The owner explicitly accepted both on 2026-08-29. They do not turn the missing
evidence into a success claim or extend to later releases.

## User requirement reconciliation

| Requested capability | Evidence or boundary |
| --- | --- |
| Native desktop personal assistant rather than a pasted-token sandbox | Tauri owns a tokenless loopback host, tray lifecycle and the primary conversation workspace; packaged Windows lifecycle was reproduced. |
| Main agent plans and delegates to worker agents | Durable parent/child supervisor graph, bounded dispatcher and task timeline are covered by supervisor integration and desktop E2E tests. |
| Enter a task and continue talking to its current agent | The task workbench and `/assistant/parents/:parentId/children/:childId/turns` worker-session route preserve and display task-local turns. |
| Codex/Claude Code/Pi workers and permission management | Capability adapters share contracts; policy intersects the requested runtime profile with the registered repository/worktree boundary and records auditable decisions. The desktop can switch between the default Codex `workspace-write`/`never` profile and an explicitly acknowledged `danger-full-access`/`never` profile. The latter approval is exact, durable, owner-only and cannot be changed while work is active. |
| Easy model/API switching | Desktop provider panel persists non-secret configuration and resolves protected credentials at call time without host restart. |
| Scheduled and event-triggered assistant work | The automation page creates, lists and cancels durable schedules and owner-scoped standing intents. Standing intents accept only normalized task completion/failure events, apply expiry/cooldown/fire budgets, request only `task.create`, and open the real dispatched task from the sidebar. |
| Always-available local/cloud voice | Local wake, SenseVoice and Piper sidecars plus Alibaba route/fallback are implemented; login wake remains owner opt-in and the 24-hour exception is explicit. |
| QQ/Weixin access | Official QQ Bot integration is implemented; personal Weixin automation is intentionally excluded because no equivalent general official bot surface exists. The live QQ exception is explicit. |
| Personal board for assets, income, expenses, investments, competitions and skills | Typed personal-dashboard entries, UI/API persistence, search/edit/delete and restart E2E coverage are present. Conversation deletion is independent from this encrypted store. This is a personal ledger, not regulated accounting or investment advice. |
| Extensible, self-iterating plugin architecture | Metadata-first capability plugins and governed skill workshop preserve ABI/policy/credential boundaries and provide evaluation plus rollback. |
| Multiple operating systems | Windows is supported; macOS/Linux build native packages against the same contracts and are visibly provisional pending physical-host release evidence. |
