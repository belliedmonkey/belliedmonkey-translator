"""16 kHz mono s16le WAV contract. The only audio the transcriber sees."""
from __future__ import annotations

import wave
from pathlib import Path

from offline_video_asr.pin import load_pin


def contract() -> dict:
    pin = load_pin()
    return {
        "rate": int(pin["sample_rate"]),
        "channels": int(pin["channels"]),
        "width": int(pin["sample_width"]),
    }


def wav_info(path: Path) -> dict:
    with wave.open(str(path), "rb") as handle:
        return {
            "channels": handle.getnchannels(),
            "rate": handle.getframerate(),
            "width": handle.getsampwidth(),
            "frames": handle.getnframes(),
            "comptype": handle.getcomptype(),
        }


def matches_contract(path: Path) -> bool:
    if path.suffix.lower() != ".wav" or not path.is_file():
        return False
    spec = contract()
    try:
        info = wav_info(path)
    except (wave.Error, EOFError, OSError):
        return False
    return (
        info["channels"] == spec["channels"]
        and info["rate"] == spec["rate"]
        and info["width"] == spec["width"]
        and info["comptype"] == "NONE"
        and info["frames"] > 0
    )


def duration_s(path: Path) -> float:
    info = wav_info(path)
    if info["rate"] <= 0 or info["frames"] <= 0:
        return 0.0
    return info["frames"] / float(info["rate"])


def slice_wav(src: Path, dst: Path, start_s: float, end_s: float) -> float:
    """Write [start_s, end_s) into dst. Returns the slice duration."""
    with wave.open(str(src), "rb") as reader:
        rate = reader.getframerate()
        width = reader.getsampwidth()
        channels = reader.getnchannels()
        total = reader.getnframes()
        start = max(0, int(start_s * rate))
        end = min(total, int(round(end_s * rate)))
        if end <= start:
            end = min(total, start + 1)
        reader.setpos(start)
        frames = reader.readframes(end - start)
    dst.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(dst), "wb") as writer:
        writer.setnchannels(channels)
        writer.setsampwidth(width)
        writer.setframerate(rate)
        writer.writeframes(frames)
    return (end - start) / float(rate) if rate else 0.0
