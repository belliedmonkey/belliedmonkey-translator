"""Cue packing. Forced alignment stays at or under fa_segment_s, then offsets add up."""
from __future__ import annotations

import re

from offline_video_asr.pin import load_pin


def segment_bounds(duration_s: float, segment_s: float | None = None) -> list[tuple[float, float]]:
    cap = float(load_pin()["fa_segment_s"] if segment_s is None else segment_s)
    if cap <= 0:
        raise ValueError("segment")
    if duration_s <= 0:
        return []
    bounds = []
    start = 0.0
    while start < duration_s - 1e-6:
        end = min(duration_s, start + cap)
        bounds.append((start, end))
        if end >= duration_s:
            break
        start = end
    return bounds


def _latin(token: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9'’-]+", token or ""))


def pack_items(items: list[dict], *, max_chars: int = 24, max_gap: float = 0.6) -> list[dict]:
    """Pack word/char stamps into subtitle cues. Same shape as the BEL-102 demo."""
    cues: list[dict] = []
    buf: list[str] = []
    buf_s = None
    buf_e = None
    prev_e = None
    for item in items:
        token = (item.get("text") or "").strip()
        if not token:
            continue
        start = float(item["start"])
        end = float(item["end"])
        gap = 0.0 if prev_e is None else start - prev_e
        if _latin(token):
            would = (" ".join(buf) + " " + token).strip()
        else:
            would = "".join(buf) + token
        if buf and (gap > max_gap or len(would) >= max_chars):
            text = " ".join(buf) if any(_latin(part) for part in buf) else "".join(buf)
            cues.append({"start": buf_s, "end": buf_e, "text": text})
            buf, buf_s, buf_e = [], None, None
        if not buf:
            buf_s = start
        buf.append(token)
        buf_e = end
        prev_e = end
    if buf:
        text = " ".join(buf) if any(_latin(part) for part in buf) else "".join(buf)
        cues.append({"start": buf_s, "end": buf_e, "text": text})
    return cues


def offset_items(items: list[dict], offset_s: float) -> list[dict]:
    shifted = []
    for item in items:
        shifted.append({
            "text": item.get("text") or "",
            "start": float(item["start"]) + offset_s,
            "end": float(item["end"]) + offset_s,
        })
    return shifted


def normalize_cues(cues: list[dict], duration_s: float) -> list[dict]:
    """Monotonic stamps inside [0, duration]. Drops empty text."""
    out = []
    prev_end = 0.0
    limit = max(0.0, float(duration_s))
    for cue in cues:
        text = (cue.get("text") or "").strip()
        if not text:
            continue
        start = max(0.0, float(cue["start"]))
        end = max(0.0, float(cue["end"]))
        if start < prev_end:
            start = prev_end
        if end < start:
            end = start
        if start > limit:
            start = limit
        if end > limit:
            end = limit
        if end < start:
            end = start
        out.append({"start": start, "end": end, "text": text})
        prev_end = end
    return out


def cues_ok(cues: list[dict], duration_s: float) -> bool:
    prev = -1.0
    for cue in cues:
        if not (cue.get("text") or "").strip():
            return False
        start = float(cue["start"])
        end = float(cue["end"])
        if start < 0 or end < start or end > duration_s + 1e-3:
            return False
        if start < prev:
            return False
        prev = start
    return True


def _stamp(seconds: float, comma: bool) -> str:
    if seconds < 0:
        seconds = 0.0
    whole = int(seconds)
    millis = int(round((seconds - whole) * 1000))
    if millis == 1000:
        whole += 1
        millis = 0
    hours, rem = divmod(whole, 3600)
    minutes, secs = divmod(rem, 60)
    sep = "," if comma else "."
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{sep}{millis:03d}"


def render_srt(cues: list[dict]) -> str:
    lines = []
    for index, cue in enumerate(cues, 1):
        lines.append(str(index))
        lines.append(f"{_stamp(cue['start'], True)} --> {_stamp(cue['end'], True)}")
        lines.append(cue["text"])
        lines.append("")
    return "\n".join(lines)


def render_vtt(cues: list[dict]) -> str:
    lines = ["WEBVTT", ""]
    for index, cue in enumerate(cues, 1):
        lines.append(str(index))
        lines.append(f"{_stamp(cue['start'], False)} --> {_stamp(cue['end'], False)}")
        lines.append(cue["text"])
        lines.append("")
    return "\n".join(lines)
