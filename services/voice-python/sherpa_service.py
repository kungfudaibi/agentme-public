"""Bounded JSON-stdio adapter for local sherpa-onnx speech models."""

from __future__ import annotations

import argparse
import base64
import ipaddress
import io
import json
import os
import socket
import sys
import time
import wave
from pathlib import Path
from typing import Any

MAX_INPUT_BYTES = 10 * 1024 * 1024
MAX_TEXT_CHARS = 2_000


def _is_loopback_host(host: Any) -> bool:
    if not isinstance(host, str):
        return False
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _enforce_local_only_network() -> None:
    """Deny DNS and socket connections outside the local machine."""

    def audit(event: str, args: tuple[Any, ...]) -> None:
        if event == "socket.getaddrinfo" and args and not _is_loopback_host(args[0]):
            raise PermissionError("Outbound network is disabled for local voice")
        if event == "socket.connect" and len(args) > 1:
            address = args[1]
            host = address[0] if isinstance(address, tuple) and address else None
            if not _is_loopback_host(host):
                raise PermissionError("Outbound network is disabled for local voice")

    sys.addaudithook(audit)


def _existing_file(directory: Path, candidates: tuple[str, ...]) -> str:
    for candidate in candidates:
        path = directory / candidate
        if path.is_file():
            return str(path.resolve())
    raise RuntimeError("Required local voice model file is missing")


def _read_request() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES * 2)
    if not raw or len(raw) >= MAX_INPUT_BYTES * 2:
        raise RuntimeError("Local voice request is empty or too large")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise RuntimeError("Local voice request is invalid")
    return value


def _decode_wav(value: dict[str, Any]) -> tuple[int, Any]:
    if value.get("mimeType") != "audio/wav" or not isinstance(
        value.get("audioBase64"), str
    ):
        raise RuntimeError("Local recognition requires PCM WAV audio")
    try:
        audio = base64.b64decode(value["audioBase64"], validate=True)
    except ValueError as error:
        raise RuntimeError("Local voice audio is invalid") from error
    if len(audio) < 44 or len(audio) > MAX_INPUT_BYTES:
        raise RuntimeError("Local voice audio is empty or too large")
    with wave.open(io.BytesIO(audio), "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2:
            raise RuntimeError("Local recognition requires mono PCM16 WAV audio")
        sample_rate = source.getframerate()
        frames = source.readframes(source.getnframes())
    import numpy as np

    samples = np.frombuffer(frames, dtype="<i2").astype("float32") / 32768.0
    return sample_rate, samples


def _recognize_samples(
    args: argparse.Namespace, sample_rate: int, samples: Any
) -> str:
    import sherpa_onnx

    model_dir = args.asr_model_dir.resolve(strict=True)
    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=_existing_file(model_dir, ("model.int8.onnx", "model.onnx")),
        tokens=_existing_file(model_dir, ("tokens.txt",)),
        num_threads=args.num_threads,
        language="auto",
        use_itn=True,
        debug=False,
    )
    stream = recognizer.create_stream()
    stream.accept_waveform(sample_rate, samples)
    recognizer.decode_stream(stream)
    transcript = stream.result.text.strip()
    if not transcript:
        raise RuntimeError("No speech was recognized")
    return transcript


def _transcribe(args: argparse.Namespace, value: dict[str, Any]) -> dict[str, str]:
    sample_rate, samples = _decode_wav(value)
    transcript = _recognize_samples(args, sample_rate, samples)
    return {"transcript": transcript}


def _wav_base64(samples: Any, sample_rate: int) -> str:
    import numpy as np

    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(sample_rate)
        target.writeframes(pcm)
    return base64.b64encode(output.getvalue()).decode("ascii")


def _synthesize(args: argparse.Namespace, value: dict[str, Any]) -> dict[str, str]:
    import sherpa_onnx

    text = value.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARS:
        raise RuntimeError("Local speech text is invalid")
    speed = value.get("speed", 1.0)
    if not isinstance(speed, (int, float)) or speed < 0.8 or speed > 1.2:
        raise RuntimeError("Local speech speed is invalid")
    model_dir = args.tts_model_dir.resolve(strict=True)
    rule_fsts = [
        str((model_dir / name).resolve())
        for name in ("phone.fst", "date.fst", "number.fst")
        if (model_dir / name).is_file()
    ]
    vits = sherpa_onnx.OfflineTtsVitsModelConfig(
        model=_existing_file(
            model_dir, ("model.onnx", "zh_CN-xiao_ya-medium.onnx")
        ),
        tokens=_existing_file(model_dir, ("tokens.txt",)),
        lexicon=str((model_dir / "lexicon.txt").resolve())
        if (model_dir / "lexicon.txt").is_file()
        else "",
        data_dir=str((model_dir / "espeak-ng-data").resolve())
        if (model_dir / "espeak-ng-data").is_dir()
        else "",
    )
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=vits,
            num_threads=args.num_threads,
            debug=False,
            provider="cpu",
        ),
        rule_fsts=",".join(rule_fsts),
    )
    tts = sherpa_onnx.OfflineTts(config)
    audio = tts.generate(text.strip(), sid=args.speaker_id, speed=float(speed))
    if len(audio.samples) == 0:
        raise RuntimeError("Local speech synthesis returned no audio")
    return {
        "mimeType": "audio/wav",
        "audioBase64": _wav_base64(audio.samples, audio.sample_rate),
    }


def _wake(args: argparse.Namespace, value: dict[str, Any]) -> dict[str, Any]:
    import numpy as np
    import sherpa_onnx

    if args.kws_model_dir is None or args.wake_keywords_file is None:
        raise RuntimeError("Local keyword model is not configured")
    model_dir = args.kws_model_dir.resolve(strict=True)
    keywords_file = args.wake_keywords_file.resolve(strict=True)
    spotter = sherpa_onnx.KeywordSpotter(
        tokens=_existing_file(model_dir, ("tokens.txt",)),
        encoder=_existing_file(
            model_dir,
            (
                "encoder-epoch-13-avg-2-chunk-8-left-64.int8.onnx",
                "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
            ),
        ),
        decoder=_existing_file(
            model_dir,
            (
                "decoder-epoch-13-avg-2-chunk-8-left-64.onnx",
                "decoder-epoch-12-avg-2-chunk-16-left-64.onnx",
            ),
        ),
        joiner=_existing_file(
            model_dir,
            (
                "joiner-epoch-13-avg-2-chunk-8-left-64.int8.onnx",
                "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
            ),
        ),
        keywords_file=str(keywords_file),
        num_threads=args.kws_num_threads,
        keywords_score=args.keywords_score,
        keywords_threshold=args.keywords_threshold,
        provider="cpu",
    )
    sample_rate, samples = _decode_wav(value)
    stream = spotter.create_stream()
    stream.accept_waveform(sample_rate, samples)
    stream.accept_waveform(
        sample_rate, np.zeros(max(1, sample_rate // 2), dtype="float32")
    )
    stream.input_finished()
    awake = False
    while spotter.is_ready(stream):
        spotter.decode_stream(stream)
        result = spotter.get_result(stream)
        if not result:
            continue
        try:
            parsed = json.loads(result)
            keyword = parsed.get("keyword") if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            keyword = result
        if keyword == args.wake_phrase:
            awake = True
            break
        spotter.reset_stream(stream)
    return {
        "awake": awake,
        "phrase": args.wake_phrase,
        # sherpa-onnx exposes the trigger threshold, not a posterior score.
        "confidence": args.keywords_threshold if awake else 0.0,
    }


def _health() -> dict[str, str]:
    try:
        socket.create_connection(("192.0.2.1", 9), timeout=0.01)
    except PermissionError:
        return {"networkPolicy": "loopback-only"}
    except OSError as error:
        raise RuntimeError("Local-only socket guard was not applied") from error
    raise RuntimeError("Local-only socket guard was not applied")


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--asr-model-dir", type=Path, required=True)
    parser.add_argument("--tts-model-dir", type=Path, required=True)
    parser.add_argument("--kws-model-dir", type=Path)
    parser.add_argument("--wake-keywords-file", type=Path)
    parser.add_argument("--wake-phrase", default="小麦助手")
    parser.add_argument("--keywords-score", type=float, default=1.0)
    parser.add_argument("--keywords-threshold", type=float, default=0.35)
    parser.add_argument("--num-threads", type=int, default=2, choices=range(1, 9))
    parser.add_argument(
        "--kws-num-threads", type=int, default=1, choices=range(1, 5)
    )
    parser.add_argument("--speaker-id", type=int, default=0)
    parser.add_argument(
        "operation", choices=("transcribe", "synthesize", "wake", "health")
    )
    return parser.parse_args()


def main() -> int:
    try:
        _enforce_local_only_network()
        wall_started = time.perf_counter()
        cpu_started = time.process_time()
        args = _arguments()
        value = _read_request()
        if args.operation == "transcribe":
            result = _transcribe(args, value)
        elif args.operation == "synthesize":
            result = _synthesize(args, value)
        elif args.operation == "wake":
            result = _wake(args, value)
        else:
            result = _health()
        wall_seconds = max(time.perf_counter() - wall_started, 0.000001)
        cpu_seconds = max(time.process_time() - cpu_started, 0.0)
        result["metrics"] = {
            "elapsedMs": round(wall_seconds * 1000, 3),
            "processCpuMs": round(cpu_seconds * 1000, 3),
            "logicalCores": max(os.cpu_count() or 1, 1),
            "processCpuPercent": round(
                cpu_seconds / wall_seconds / max(os.cpu_count() or 1, 1) * 100, 3
            ),
        }
        sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception as error:  # The host receives a stable non-zero provider failure.
        sys.stderr.write(f"local voice unavailable: {error}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
