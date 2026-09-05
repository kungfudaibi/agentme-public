# ADR-0002: Local-first pluggable voice pipeline

## Status

Proposed

## Date

2026-08-20

## Context

AgentMe should behave like an always-available smart speaker while controlling privacy and cloud cost. The user accepts cloud services but also wants local models. Always streaming room audio to a provider is unnecessary and creates a larger privacy boundary.

## Decision

Keep wake-word detection local. After wake, route audio through independently configurable wake, STT, TTS or realtime-voice providers. Ship a CPU-compatible local route and allow cloud fallback.

Initial candidates:

- Wake: sherpa-onnx Chinese KWS.
- Local STT: SenseVoiceSmall; Paraformer streaming as an alternative.
- Local TTS: Piper CPU baseline; CosyVoice for suitable GPU hardware.
- Cloud: Alibaba Qwen Audio/ASR/CosyVoice and optional OpenAI Realtime.

## Alternatives Considered

### Cloud realtime audio at all times

Simplifies turn handling but continuously expands privacy, availability and cost exposure.

### One end-to-end local audio model

Reduces provider calls but makes CPU-only Windows support and independent quality upgrades harder.

### Push-to-talk only

Simpler and safer, but does not meet the smart-speaker interaction requirement.

## Consequences

- Microphone ownership, echo cancellation and interruption become first-class runtime concerns.
- Local provider quality and hardware requirements must be benchmarked.
- Pre-wake audio can remain entirely on device.
- STT and TTS can evolve independently.

