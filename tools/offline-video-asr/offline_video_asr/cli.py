"""Stage-0 entry. The Mac app Process-launches this same module.

Input convention (one path): `--input` is a video file or an audio file.
`extract_to_wav` normalizes it to 16 kHz mono PCM, then `transcribe_wav`
is the only inference call. There is no second model stack.
"""
from __future__ import annotations

import argparse
import json
import shutil
import signal
import sys
from pathlib import Path

from offline_video_asr.cues import (
    cues_ok,
    normalize_cues,
    offset_items,
    pack_items,
    render_srt,
    render_vtt,
    segment_bounds,
)
from offline_video_asr.engines import canonical_language, transcribe_wav
from offline_video_asr.errors import Cancelled, Fail, TimedOut, emit
from offline_video_asr.extract import extract_to_wav
from offline_video_asr.models import assert_disk, ensure_models
from offline_video_asr.pin import load_pin
from offline_video_asr.wavutil import duration_s, slice_wav


def _progress(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _default_support() -> Path:
    return Path.home() / "Library" / "Application Support" / "com.belliedmonkeytranslator" / "models" / "qwen3-asr"


def _parser() -> argparse.ArgumentParser:
    pin = load_pin()
    parser = argparse.ArgumentParser(prog="offline-video-asr")
    parser.add_argument("--input", required=True, help="video or audio file; the only media argument")
    parser.add_argument("--out", required=True, help="directory for srt, vtt, hyp, align")
    parser.add_argument("--support-dir", default=str(_default_support()))
    parser.add_argument("--lang", default=None)
    parser.add_argument("--timeout", type=float, default=float(pin["timeout_s"]))
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--engine", choices=("mlx", "fixture"), default="mlx")
    parser.add_argument("--profile", choices=("0.6b", "1.7b"), default="0.6b")
    parser.add_argument("--segment-s", type=float, default=float(pin["fa_segment_s"]))
    parser.add_argument("--min-free-bytes", type=int, default=int(pin["min_free_bytes"]))
    parser.add_argument("--keep-temp", action="store_true")
    return parser


def _arm_signals(timeout_s: float) -> None:
    def _cancel(signum, _frame):
        raise Cancelled()

    signal.signal(signal.SIGTERM, _cancel)
    signal.signal(signal.SIGINT, _cancel)
    if timeout_s and timeout_s > 0 and hasattr(signal, "SIGALRM"):
        def _timeout(_signum, _frame):
            raise TimedOut()

        signal.signal(signal.SIGALRM, _timeout)
        signal.alarm(max(1, int(timeout_s)))


def _cleanup_outputs(out_dir: Path) -> None:
    for name in ("out.srt", "out.vtt", "hyp.txt", "align.json", "result.json"):
        path = out_dir / name
        if path.exists():
            path.unlink()


def run(argv: list[str] | None = None) -> int:
    pin = load_pin()
    try:
        args = _parser().parse_args(argv)
    except SystemExit as exc:
        code = exc.code
        if code in (None, 0):
            return 0
        return emit(Fail("usage", "args"))

    cap = float(pin["fa_segment_s"])
    if args.segment_s <= 0 or args.segment_s > cap:
        return emit(Fail("usage", "segment"))
    if args.timeout < 0:
        return emit(Fail("usage", "timeout"))
    try:
        language = canonical_language(args.lang)
    except Fail as exc:
        return emit(exc)

    out_dir = Path(args.out).expanduser()
    support = Path(args.support_dir).expanduser()
    work = out_dir / ".work"
    try:
        _arm_signals(args.timeout if args.timeout else 0)
        out_dir.mkdir(parents=True, exist_ok=True)
        _cleanup_outputs(out_dir)
        assert_disk(out_dir, args.min_free_bytes)
        dirs = None
        if args.engine == "mlx":
            dirs = ensure_models(
                support,
                args.profile,
                offline=args.offline,
                min_free=args.min_free_bytes,
            )
        _progress({"progress": "extract"})
        work.mkdir(parents=True, exist_ok=True)
        wav_path = work / "audio.wav"
        step = extract_to_wav(Path(args.input), wav_path)
        total = duration_s(wav_path)
        if total <= 0:
            raise Fail("no_audio_track", "duration")
        bounds = segment_bounds(total, args.segment_s)
        texts: list[str] = []
        stitched: list[dict] = []
        per_segment = []
        max_chars = 42 if language == "English" else 24
        for index, (start, end) in enumerate(bounds, 1):
            _progress({"progress": "asr", "segment": index, "segments": len(bounds)})
            chunk = work / f"seg-{index}.wav"
            slice_len = slice_wav(wav_path, chunk, start, end)
            text, items = transcribe_wav(
                chunk,
                engine=args.engine,
                duration_s=slice_len,
                language=language,
                asr_dir=None if dirs is None else dirs["asr_dir"],
                fa_dir=None if dirs is None else dirs["fa_dir"],
            )
            if text.strip():
                texts.append(text.strip())
            shifted = offset_items(items, start)
            stitched.extend(shifted)
            per_segment.append({"offset": start, "end": end, "hyp": text, "items": shifted})
        hyp = "\n".join(texts).strip()
        if not hyp:
            raise Fail("empty_hyp")
        cues = normalize_cues(pack_items(stitched, max_chars=max_chars), total)
        if not cues or not cues_ok(cues, total):
            raise Fail("empty_hyp" if not cues else "sidecar_crash", "cues")
        (out_dir / "hyp.txt").write_text(hyp + "\n", encoding="utf-8")
        (out_dir / "align.json").write_text(json.dumps({
            "segments": per_segment,
            "items": stitched,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        (out_dir / "out.srt").write_text(render_srt(cues), encoding="utf-8")
        (out_dir / "out.vtt").write_text(render_vtt(cues), encoding="utf-8")
        result = {
            "ok": True,
            "cues": len(cues),
            "duration_s": round(total, 3),
            "segments": len(bounds),
            "extract": step,
            "profile": args.profile,
            "package": pin["package"],
            "srt": "out.srt",
            "vtt": "out.vtt",
            "hyp": "hyp.txt",
            "align": "align.json",
        }
        (out_dir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        _progress(result)
        return 0
    except Fail as exc:
        _cleanup_outputs(out_dir)
        return emit(exc)
    except MemoryError:
        _cleanup_outputs(out_dir)
        return emit(Fail("oom"))
    except Exception as exc:
        _cleanup_outputs(out_dir)
        return emit(Fail("sidecar_crash", type(exc).__name__))
    finally:
        if hasattr(signal, "alarm"):
            signal.alarm(0)
        if "args" in locals() and not args.keep_temp and work.exists():
            shutil.rmtree(work, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    return run(argv)
