"""Normalize any media file to the WAV contract.

One function. A WAV that already matches is copied. Everything else is
extracted, in order: AVFoundation helper, afconvert, ffmpeg.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

from offline_video_asr.errors import KNOWN, Fail
from offline_video_asr.wavutil import matches_contract


def _which(name: str) -> str | None:
    return shutil.which(name)


def _json_line(text: str) -> dict | None:
    for line in reversed((text or "").splitlines()):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    return None


def _code_from_payload(payload: dict | None) -> str | None:
    if not payload:
        return None
    code = payload.get("code")
    if code == "drm" or payload.get("drm") is True and code in (None, "media_encrypted", "drm"):
        if code == "drm":
            return "drm"
        if code == "media_encrypted" or payload.get("drm") is True:
            return "media_encrypted"
    if isinstance(code, str) and code in KNOWN:
        return code
    codes = payload.get("codes")
    if isinstance(codes, list):
        if "media_encrypted" in codes:
            return "media_encrypted"
        if "drm" in codes:
            return "drm"
    return None


def _classify_tool(stderr: str) -> str:
    text = (stderr or "").lower()
    if any(token in text for token in ("encrypt", "drm", "protected", "fairplay", "content is protected")):
        return "media_encrypted"
    if any(token in text for token in (
        "does not contain any stream",
        "matches no streams",
        "no audio",
        "output file is empty",
        "stream map",
        "invalid audio",
    )):
        # "stream map" alone is the ffmpeg message when -map 0:a finds nothing.
        if "matches no streams" in text or "does not contain any stream" in text or "no audio" in text:
            return "no_audio_track"
        if "output file is empty" in text:
            return "no_audio_track"
    return "codec_unsupported"


def _run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def _accept(dst: Path) -> None:
    if not matches_contract(dst):
        raise Fail("codec_unsupported", "wav_contract")


def _helper(bin_path: str, src: Path, dst: Path) -> None:
    proc = _run([bin_path, str(src), str(dst)])
    if proc.returncode == 0 and dst.is_file():
        _accept(dst)
        return
    payload = _json_line(proc.stdout) or _json_line(proc.stderr)
    code = _code_from_payload(payload)
    if code:
        raise Fail(code, "extract_helper")
    raise Fail(_classify_tool(proc.stderr + "\n" + proc.stdout), "extract_helper")


def _afconvert(src: Path, dst: Path) -> None:
    bin_path = _which("afconvert")
    if not bin_path:
        raise Fail("codec_unsupported", "afconvert_missing")
    proc = _run([bin_path, "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(src), str(dst)])
    if proc.returncode == 0 and dst.is_file():
        _accept(dst)
        return
    raise Fail(_classify_tool(proc.stderr), "afconvert")


def _ffmpeg(src: Path, dst: Path) -> None:
    bin_path = _which("ffmpeg")
    if not bin_path:
        raise Fail("codec_unsupported", "ffmpeg_missing")
    proc = _run([
        bin_path, "-hide_banner", "-nostdin", "-y",
        "-i", str(src),
        "-map", "0:a:0",
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "pcm_s16le",
        str(dst),
    ])
    if proc.returncode == 0 and dst.is_file():
        _accept(dst)
        return
    raise Fail(_classify_tool(proc.stderr), "ffmpeg")


def extract_to_wav(src: Path, dst: Path) -> str:
    """Return which step produced the contract WAV: passthrough, helper, afconvert, ffmpeg."""
    src = src.expanduser().resolve()
    dst = dst.expanduser()
    if not src.is_file():
        raise Fail("codec_unsupported", "missing_input")
    dst.parent.mkdir(parents=True, exist_ok=True)
    if matches_contract(src):
        if src != dst.resolve():
            shutil.copyfile(src, dst)
        _accept(dst)
        return "passthrough"

    helper = os.environ.get("OFFLINE_VIDEO_ASR_EXTRACT_BIN") or ""
    errors: list[Fail] = []
    if helper:
        try:
            _helper(helper, src, dst)
            return "helper"
        except Fail as exc:
            if exc.code in ("no_audio_track", "media_encrypted", "drm"):
                raise
            errors.append(exc)
            if dst.exists():
                dst.unlink()
        except OSError:
            errors.append(Fail("codec_unsupported", "helper_missing"))

    if _which("afconvert"):
        try:
            _afconvert(src, dst)
            return "afconvert"
        except Fail as exc:
            if exc.code in ("no_audio_track", "media_encrypted", "drm"):
                raise
            errors.append(exc)
            if dst.exists():
                dst.unlink()

    try:
        _ffmpeg(src, dst)
        return "ffmpeg"
    except Fail as exc:
        if exc.code in ("no_audio_track", "media_encrypted", "drm"):
            raise
        errors.append(exc)
        if dst.exists():
            dst.unlink()
        # Prefer a specific code we already saw over a generic last miss.
        for earlier in errors:
            if earlier.code != "codec_unsupported":
                raise earlier
        raise
