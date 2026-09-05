# Tencent channel implementation evidence (2026-08-25)

QQ is the first channel target. Tencent's maintained
`@tencent-connect/qqbot-nodejs` SDK supports REST, WebSocket/webhook transport,
C2C and group messages, reconnect/resume, streaming C2C replies and media
upload. The reviewed source was version 1.0.4 at commit
`ca55d9c395b582b7fcfad0ec27209c35dd04e0b3`. It requires an approved QQ Bot
application plus App ID and App Secret. AgentMe stores only validated secret
references and resolves their values when the transport starts.

AgentMe pins the production package at `1.0.4`. On 2026-08-28 the installed
package and its `ws@8.21.3` runtime dependency passed `pnpm audit` at the high
threshold against the npm registry, and all 117 installed package signatures
verified. The desktop sidecar preparation recursively stages this runtime
dependency graph and imports the staged SDK in a packaging test; install
scripts are disabled during the frozen install and the package declares no
install/postinstall hook.

The implemented boundary adapts the SDK's `(context, message)` event without
allowing vendor types into the channel contract. Only C2C and group events with
matching reply targets survive schema validation. An explicitly paired C2C
owner may use `/task`, `/status` and `/cancel`; group and unknown senders receive
static help and never reach task, filesystem, dashboard or credential ports.
Task creation is deduplicated by the QQ message id in a durable request store.
Committed proactive results use a separate SQLite outbox and are retried after
reconnect or restart. A failed send stays pending; an acknowledged send is not
sent again. QQ does not expose an idempotency key for proactive text sends, so a
hard process failure between provider acknowledgement and the local commit is
an unavoidable duplicate window and is not described as transactional
exactly-once delivery.

Offline evidence:

- maintained-SDK facade shape and message/lifecycle adaptation;
- call-time secret resolution and cancellation propagation;
- persisted pairing and duplicate inbound suppression;
- private create/query/cancel with redacted evidence;
- adversarial group/unpaired denial;
- failed-send restart replay and acknowledged-send suppression.
- authenticated Host lifecycle/configuration API with secret-free responses;
- desktop QQ configuration using the platform credential store;
- packaged SDK import with its transitive WebSocket dependency.

Run it with:

```powershell
corepack pnpm exec vitest run plugins/channel-tencent/test tests/integration/tencent-channel-task.test.ts
```

The packaged app exposes the channel under **QQ** in the top bar. Enter the
approved bot App ID, App Secret and the owner's sender OpenID, select **启用**,
then save. App credentials go directly to Windows DPAPI, macOS Keychain or
Linux Secret Service; `.agentme/settings.json` contains only `isEnabled`,
`ownerId` and the non-secret local account label. The same authenticated local
surface is available as `GET/PUT /channels/tencent-qq`. A blank credential
field preserves the existing protected value.

The allowed private commands are `/task <repositoryId> <instruction>`,
`/status <taskId>` and `/cancel <taskId>`. The desktop status `运行中` means the
channel worker is active; only an actual QQ message proves provider-side
connectivity.

Personal Weixin does not expose an equivalent general-purpose official bot API.
Enterprise Weixin intelligent robots and Tencent Cloud's hosted Weixin route
remain possible later alternatives, with different account and review
constraints. AgentMe will not use reverse-engineered personal-account
automation.

A live redacted smoke remains unchecked because this machine does not have an
approved QQ App ID, App Secret and owner OpenID. No credential was invented,
reused from another provider or embedded for this evidence.

Reviewed primary sources:

- <https://github.com/tencent-connect/qqbot-nodejs/tree/ca55d9c395b582b7fcfad0ec27209c35dd04e0b3>
- <https://github.com/tencent-connect/qqbot-nodejs/blob/ca55d9c395b582b7fcfad0ec27209c35dd04e0b3/USAGE.md>
- <https://github.com/tencent-connect/qqbot-nodejs/blob/ca55d9c395b582b7fcfad0ec27209c35dd04e0b3/SECURITY.md>
