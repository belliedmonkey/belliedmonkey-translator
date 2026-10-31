"""The only inference entry. Fixture is for contract tests; mlx is the locked stack."""
from __future__ import annotations

import os
import time
import wave
from pathlib import Path

from offline_video_asr.errors import Fail
from offline_video_asr.pin import load_pin

LANG = {
    "zh": "Chinese",
    "en": "English",
    "yue": "Cantonese",
    "chinese": "Chinese",
    "english": "English",
    "cantonese": "Cantonese",
}


def canonical_language(raw: str | None) -> str | None:
    if raw is None or raw == "":
        return None
    key = raw.strip()
    mapped = LANG.get(key) or LANG.get(key.lower())
    if not mapped:
        raise Fail("usage", "lang")
    return mapped


def _peak(path: Path) -> int:
    with wave.open(str(path), "rb") as handle:
        width = handle.getsampwidth()
        frames = handle.readframes(handle.getnframes())
    if width != 2 or len(frames) < 2:
        return 0
    peak = 0
    for index in range(0, len(frames) - 1, 2):
        sample = int.from_bytes(frames[index:index + 2], "little", signed=True)
        peak = max(peak, abs(sample))
    return peak


def transcribe_fixture(wav_path: Path, duration_s: float) -> tuple[str, list[dict]]:
    delay = os.environ.get("OFFLINE_VIDEO_ASR_FIXTURE_SLEEP")
    if delay:
        time.sleep(float(delay))
    if os.environ.get("OFFLINE_VIDEO_ASR_FIXTURE_EMPTY") == "1" or _peak(wav_path) < 2:
        return "", []
    end = min(max(duration_s, 0.01), 0.4)
    return "fixture", [{"text": "fixture", "start": 0.0, "end": end}]


def _items_from_result(result) -> list[dict]:
    segments = getattr(result, "segments", None) or []
    items = []
    for seg in segments:
        if isinstance(seg, dict):
            text = seg.get("text") or ""
            start = seg.get("start", 0)
            end = seg.get("end", 0)
        else:
            text = getattr(seg, "text", "") or ""
            start = getattr(seg, "start", getattr(seg, "start_time", 0))
            end = getattr(seg, "end", getattr(seg, "end_time", 0))
        items.append({"text": text or "", "start": float(start or 0), "end": float(end or 0)})
    return items


def _serialize_align(raw) -> list[dict]:
    items = []
    for item in raw or []:
        if isinstance(item, dict):
            items.append({
                "text": item.get("text") or item.get("word") or "",
                "start": float(item.get("start") or item.get("start_time") or 0),
                "end": float(item.get("end") or item.get("end_time") or 0),
            })
            continue
        text = getattr(item, "text", None) or getattr(item, "word", None) or ""
        start = getattr(item, "start_time", getattr(item, "start", 0))
        end = getattr(item, "end_time", getattr(item, "end", 0))
        items.append({"text": text or "", "start": float(start or 0), "end": float(end or 0)})
    return items


def transcribe_mlx(wav_path: Path, asr_dir: Path, fa_dir: Path, language: str | None) -> tuple[str, list[dict]]:
    """Local pinned snapshots only. Offline after the hash check so the default hub id is never fetched."""
    pin = load_pin()
    try:
        from importlib.metadata import version
        found = version(pin["package_name"])
    except Exception as exc:
        raise Fail("pin_mismatch", type(exc).__name__) from exc
    if found != pin["package_version"]:
        raise Fail("pin_mismatch", found)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    # Apple Silicon wheels. Importing them at module load breaks the Linux contract tests.
    try:
        import mlx.core as mx
        from mlx_qwen3_asr import ForcedAligner, transcribe
    except Exception as exc:
        raise Fail("sidecar_crash", type(exc).__name__) from exc
    try:
        aligner = ForcedAligner(str(fa_dir), dtype=mx.float16, backend="mlx")
        kwargs = {
            "model": str(asr_dir),
            "return_timestamps": True,
            "forced_aligner": aligner,
            "verbose": False,
        }
        if language:
            kwargs["language"] = language
        result = transcribe(str(wav_path), **kwargs)
    except Fail:
        raise
    except MemoryError as exc:
        raise Fail("oom") from exc
    except Exception as exc:
        raise Fail("sidecar_crash", type(exc).__name__) from exc
    text = (getattr(result, "text", "") or "").strip()
    items = _items_from_result(result)
    if text and not any((item.get("text") or "").strip() for item in items):
        # mlx is imported above only after the pin check. A second import here
        # stays inside this function: the wheel does not install on Linux, and
        # the contract tests import this module.
        lang = language or getattr(result, "language", None)
        if not lang:
            raise Fail("sidecar_crash", "align_empty")
        try:
            from mlx_qwen3_asr.audio import load_audio_np
            audio = load_audio_np(str(wav_path))
            aligned = aligner.align(audio, text=text, language=lang)
            items = _serialize_align(aligned)
        except Fail:
            raise
        except Exception as exc:
            raise Fail("sidecar_crash", "align_empty") from exc
    return text, items


def transcribe_wav(wav_path: Path, *, engine: str, duration_s: float, language: str | None,
                    asr_dir: Path | None, fa_dir: Path | None) -> tuple[str, list[dict]]:
    if engine == "fixture":
        return transcribe_fixture(wav_path, duration_s)
    if engine == "mlx":
        if asr_dir is None or fa_dir is None:
            raise Fail("model_missing", "dirs")
        return transcribe_mlx(wav_path, asr_dir, fa_dir, language)
    raise Fail("usage", "engine")
