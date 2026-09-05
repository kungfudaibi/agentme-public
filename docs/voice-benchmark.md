# Voice runtime evidence

Evidence was refreshed on 2026-08-25 on Windows x64, Intel Core i5-13500H, 16 logical cores and 16 GiB RAM. Reports omit user and device names, credentials, filesystem paths, raw audio and model weights.

## Routes and privacy boundary

- Local wake uses `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20`, chunk-8 INT8, one inference thread, score `1.0` and threshold `0.35`. The default phrase is `小麦助手`; its token file and phrase remain configuration inputs.
- Local STT uses SenseVoiceSmall INT8. Local TTS uses Piper `zh_CN-xiao_ya-medium`. Each operation is a cancellable, shell-free JSON-stdio sidecar call.
- The Python sidecar installs an audit hook before loading inference libraries. DNS resolution and socket connections are rejected unless the destination is loopback. `health` actively attempts a TEST-NET connection and only reports `loopback-only` when the hook blocks it.
- Cloud STT/TTS remains selectable through Alibaba. Pre-wake audio only uses the local KWS provider and cannot enter a network-capable provider.
- Mute, Escape, explicit stop and window shutdown release microphone tracks and the audio graph, stop the wake loop, abort inference HTTP/child-process work, pause playback, remove its source and force media release.

The KWS model and example procedure come from the official [sherpa-onnx keyword-spotting documentation](https://github.com/k2-fsa/sherpa/blob/master/docs/source/onnx/kws/pretrained_models/index.rst). The documentation identifies 160 ms model latency for chunk-8 and states that inference is local. The pinned archive is 32,885,699 bytes with SHA-256 `68447f4fbc67e70eee3a93961f36e81e98f47aef73ce7e7ca00885c6cd3616a6` and is stored only in ignored runtime state.

## Reproducible wake qualification

Run after local installation:

```powershell
corepack pnpm build
$env:AGENTME_SETTINGS_PATH = "<AgentMe data directory>/settings.json"
corepack pnpm voice:benchmark
```

The diagnostic generates WAV data in memory with the installed Piper voice, hashes it, evaluates it, then releases it. It never writes a recording. The 10 positive fixtures vary synthesis speed from `0.82` through `1.18`; the 20 negative fixtures include near phrases such as `小麦帮手`, `小爱助手`, `小麦助理`, the previous wake phrase and unrelated work commands. Piper's bundled `MODEL_CARD` identifies the source DataBaker dataset as non-commercial. These generated fixtures therefore qualify this personal/non-commercial installation but must not be treated as assets approved for commercial redistribution.

Configured gates and the 2026-08-25 result:

| Metric | Gate | Measured |
| --- | ---: | ---: |
| Positive fixtures | at least 10 | 10 |
| Negative fixtures | at least 20 | 20 |
| False-accept rate | at most 1% | 0/20, 0% |
| False-reject rate | at most 20% | 0/10, 0% |
| End-to-result p95 | at most 1,500 ms | 1,005.877 ms |
| Average KWS CPU | below 5% | 1.324% |

CPU is process CPU time divided by the actual desktop listening cycle (2,500 ms capture, 500 ms inter-window delay and sidecar response time), then normalized across 16 logical cores. This is a KWS-process measurement, not whole-system CPU.

The result is evidence for the deterministic single-speaker generated corpus, not a claim about 24-hour ambient false alarms or a diverse human-speaker corpus. Human tuning remains available through phrase/score/threshold configuration.

## Offline chain and lifecycle evidence

With `AGENTME_REAL_LOCAL_VOICE_SETTINGS` pointing to the installed redacted settings, the opt-in integration test completed:

1. sidecar `health` proved the non-loopback socket guard;
2. Piper generated `小麦助手` only in memory;
3. dedicated KWS woke the authenticated loopback host;
4. SenseVoice returned a non-empty transcript;
5. the supervisor persisted that exact transcript as the child task instruction;
6. Piper returned a bounded WAV acknowledgement.

The focused test completed in 7.31 seconds. A cancellation smoke aborted an active synthesis operation and returned `CANCELLED`; Windows process enumeration was `0` sidecars before and `0` after (`orphanDelta=0`). Unit coverage independently verifies one cancellation releases capture, wake, inference and playback, and host shutdown aborts in-flight speech inference.

The owner previously exercised two utterances through the Windows desktop microphone on 2026-08-22. One conversation, two parent tasks and two completed child tasks were persisted, with no host application error. No raw microphone audio was retained. This is a manual device-path smoke, not a statistically meaningful human-speech accuracy corpus.

`voice:doctor` now inspects the installed settings without printing paths and performs the same network health probe. On the reference host it reports KWS, SenseVoice and Piper configured, optional CosyVoice absent, and `networkPolicy: loopback-only`.
