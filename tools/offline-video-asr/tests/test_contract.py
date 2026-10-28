"""Contract tests for the offline video ASR CLI. No MLX required."""
from __future__ import annotations

import json
import os
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from offline_video_asr.cues import cues_ok, normalize_cues, pack_items, segment_bounds  # noqa: E402
from offline_video_asr.errors import EXIT  # noqa: E402
from offline_video_asr.models import ensure_models  # noqa: E402
from offline_video_asr.pin import load_pin  # noqa: E402

PIN = load_pin()
CLI = [sys.executable, "-m", "offline_video_asr"]

# BEL-103 lock. A silent edit of pin.json fails here.
LOCKED = {
    "package": "mlx-qwen3-asr==0.4.4",
    "asr_repo": "moona3k/mlx-qwen3-asr-0.6b-8bit",
    "asr_rev": "83ce2a8ef9a382d2ba2209aab383bc51fff366f5",
    "asr_sha": "940d73134ef51218d923cce36a58f23e2286b16313a35e3b273937041069f844",
    "fa_repo": "mlx-community/Qwen3-ForcedAligner-0.6B-8bit",
    "fa_rev": "0e1a68e91d815300c7c9754b2a7639378b23db15",
    "fa_sha": "be19ef8ac4326d032e7673342930b14c2df30bd68c1632493b0f563e30829f91",
    "opt_repo": "moona3k/mlx-qwen3-asr-1.7b-8bit",
    "opt_rev": "22c8abe6a6772122dda5905967d7496d1d3e8dd2",
    "opt_sha": "eba2bdb1ec74f5df99345f9f81492ba551f6b072eedfef564b353ef0dde90bb8",
}


def tone_wav(path: Path, seconds: float = 0.4, amplitude: int = 8000) -> None:
    rate = 16000
    frames = int(seconds * rate)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        buf = bytearray()
        for i in range(frames):
            sample = amplitude if (i // 40) % 2 == 0 else -amplitude
            buf += struct.pack("<h", sample)
        handle.writeframes(bytes(buf))


def silent_wav(path: Path, seconds: float = 0.3) -> None:
    tone_wav(path, seconds, amplitude=0)


def run_cli(args, *, env=None, timeout=30):
    merged = os.environ.copy()
    merged["PYTHONPATH"] = str(ROOT) + (":" + merged["PYTHONPATH"] if merged.get("PYTHONPATH") else "")
    if env:
        merged.update(env)
    return subprocess.run(
        CLI + args,
        capture_output=True,
        text=True,
        env=merged,
        timeout=timeout,
        cwd=str(ROOT),
        check=False,
    )


def last_json(text: str) -> dict:
    for line in reversed((text or "").splitlines()):
        line = line.strip()
        if line.startswith("{"):
            return json.loads(line)
    raise AssertionError("no json in:\n" + text)


class PinTests(unittest.TestCase):
    def test_lock(self):
        self.assertEqual(PIN["package"], LOCKED["package"])
        self.assertEqual(PIN["fa_segment_s"], 300)
        self.assertEqual(PIN["timeout_s"], 14400)
        self.assertEqual(PIN["min_free_bytes"], 4 * 1024 ** 3)
        asr = PIN["models"]["0.6b"]
        self.assertEqual(asr["repo_id"], LOCKED["asr_repo"])
        self.assertEqual(asr["revision"], LOCKED["asr_rev"])
        self.assertEqual(asr["weight_sha256"], LOCKED["asr_sha"])
        fa = PIN["models"]["aligner"]
        self.assertEqual(fa["repo_id"], LOCKED["fa_repo"])
        self.assertEqual(fa["revision"], LOCKED["fa_rev"])
        self.assertEqual(fa["weight_sha256"], LOCKED["fa_sha"])
        opt = PIN["models"]["1.7b"]
        self.assertEqual(opt["repo_id"], LOCKED["opt_repo"])
        self.assertEqual(opt["revision"], LOCKED["opt_rev"])
        self.assertEqual(opt["weight_sha256"], LOCKED["opt_sha"])

    def test_mlx_entry_uses_local_snapshot(self):
        src = (ROOT / "offline_video_asr" / "engines.py").read_text(encoding="utf-8")
        self.assertIn('model": str(asr_dir)', src)
        self.assertNotIn("Qwen/Qwen3-ASR", src)
        self.assertIn('HF_HUB_OFFLINE', src)
        import sys as _sys
        self.assertNotIn("mlx", _sys.modules)
        self.assertNotIn("mlx_qwen3_asr", _sys.modules)

    def test_failure_codes_include_drm(self):
        for code in (
            "no_audio_track", "codec_unsupported", "media_encrypted", "drm",
            "model_missing", "model_hash_mismatch", "download_failed", "disk_low",
            "oom", "sidecar_crash", "cancelled", "timeout", "empty_hyp",
        ):
            self.assertIn(code, EXIT)


class CueTests(unittest.TestCase):
    def test_segments_cover_without_passing_the_cap(self):
        bounds = segment_bounds(660, 300)
        self.assertEqual(bounds, [(0.0, 300.0), (300.0, 600.0), (600.0, 660.0)])
        for start, end in bounds:
            self.assertLessEqual(end - start, 300)

    def test_pack_and_normalize_stay_inside_duration(self):
        items = [
            {"text": "hi", "start": 0.0, "end": 0.4},
            {"text": "there", "start": 300.1, "end": 300.5},
        ]
        cues = normalize_cues(pack_items(items, max_chars=42), 660)
        self.assertTrue(cues)
        self.assertTrue(cues_ok(cues, 660))
        self.assertLessEqual(cues[-1]["end"], 660)


class CliTests(unittest.TestCase):
    def test_wav_to_nonempty_subtitles(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = tmp / "tone.wav"
            out = tmp / "out"
            tone_wav(src, 0.6)
            proc = run_cli([
                "--input", str(src), "--out", str(out), "--engine", "fixture",
                "--timeout", "0", "--min-free-bytes", "1", "--segment-s", "0.25",
            ])
            self.assertEqual(proc.returncode, 0, proc.stderr)
            result = json.loads((out / "result.json").read_text(encoding="utf-8"))
            self.assertGreaterEqual(result["segments"], 3)
            self.assertEqual(result["profile"], "0.6b")
            self.assertEqual(result["extract"], "passthrough")
            srt = (out / "out.srt").read_text(encoding="utf-8")
            vtt = (out / "out.vtt").read_text(encoding="utf-8")
            self.assertIn("fixture", srt)
            self.assertTrue(vtt.startswith("WEBVTT"))
            self.assertIn("fixture", vtt)
            self.assertTrue((out / "hyp.txt").read_text(encoding="utf-8").strip())
            self.assertFalse((out / ".work").exists())

    def test_video_through_ffmpeg(self):
        ffmpeg = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True)
        if ffmpeg.returncode != 0:
            self.skipTest("ffmpeg missing")
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            video = tmp / "clip.mp4"
            built = subprocess.run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=0.4",
                "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.4",
                "-shortest", str(video),
            ], capture_output=True, text=True)
            if built.returncode != 0:
                self.skipTest(built.stderr[-400:])
            out = tmp / "out"
            proc = run_cli([
                "--input", str(video), "--out", str(out), "--engine", "fixture",
                "--timeout", "0", "--min-free-bytes", "1",
            ])
            self.assertEqual(proc.returncode, 0, proc.stderr)
            srt = (out / "out.srt").read_text(encoding="utf-8")
            self.assertIn("fixture", srt)
            self.assertGreater(len(srt.strip()), 0)
            result = json.loads((out / "result.json").read_text(encoding="utf-8"))
            self.assertEqual(result["extract"], "ffmpeg")

    def test_empty_hyp_writes_no_subtitle(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = tmp / "silent.wav"
            out = tmp / "out"
            out.mkdir()
            (out / "out.srt").write_text("stale\n", encoding="utf-8")
            silent_wav(src)
            proc = run_cli([
                "--input", str(src), "--out", str(out), "--engine", "fixture",
                "--timeout", "0", "--min-free-bytes", "1",
            ])
            self.assertEqual(proc.returncode, EXIT["empty_hyp"], proc.stderr)
            payload = last_json(proc.stderr)
            self.assertEqual(payload["code"], "empty_hyp")
            self.assertFalse((out / "out.srt").exists())
            self.assertFalse((out / "out.vtt").exists())

    def test_no_audio_track(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            video = tmp / "silent.mp4"
            built = subprocess.run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.2",
                "-an", str(video),
            ], capture_output=True, text=True)
            if built.returncode != 0:
                self.skipTest(built.stderr[-400:])
            proc = run_cli([
                "--input", str(video), "--out", str(tmp / "out"), "--engine", "fixture",
                "--timeout", "0", "--min-free-bytes", "1",
            ])
            self.assertEqual(proc.returncode, EXIT["no_audio_track"], proc.stderr)
            self.assertEqual(last_json(proc.stderr)["code"], "no_audio_track")

    def test_codec_unsupported(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = tmp / "notes.mp4"
            src.write_text("this is not media", encoding="utf-8")
            proc = run_cli([
                "--input", str(src), "--out", str(tmp / "out"), "--engine", "fixture",
                "--timeout", "0", "--min-free-bytes", "1",
            ])
            self.assertEqual(proc.returncode, EXIT["codec_unsupported"], proc.stderr)

    def test_media_encrypted_and_drm(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            for code in ("media_encrypted", "drm"):
                helper = tmp / f"helper-{code}.py"
                extra = ""
                if code == "media_encrypted":
                    extra = "payload['drm']=True\npayload['codes']=['media_encrypted','drm']\n"
                helper.write_text(
                    "import json,sys\n"
                    f"payload={{'ok': False, 'code': '{code}'}}\n"
                    + extra
                    + "print(json.dumps(payload))\nraise SystemExit(1)\n",
                    encoding="utf-8",
                )
                wrapper = tmp / f"run-{code}"
                wrapper.write_text(f"#!/bin/sh\nexec {sys.executable} {helper} \"$@\"\n", encoding="utf-8")
                wrapper.chmod(0o755)
                src = tmp / f"{code}.mp4"
                src.write_bytes(b"not-a-real-movie")
                proc = run_cli([
                    "--input", str(src), "--out", str(tmp / code), "--engine", "fixture",
                    "--timeout", "0", "--min-free-bytes", "1",
                ], env={"OFFLINE_VIDEO_ASR_EXTRACT_BIN": str(wrapper)})
                self.assertEqual(proc.returncode, EXIT[code], proc.stderr + proc.stdout)
                payload = last_json(proc.stderr)
                self.assertEqual(payload["code"], code)
                if code == "media_encrypted":
                    self.assertTrue(payload["drm"])
                    self.assertIn("drm", payload["codes"])
                self.assertFalse((tmp / code / "out.srt").exists())

    def test_model_missing_offline(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = tmp / "tone.wav"
            tone_wav(src, 0.2)
            proc = run_cli([
                "--input", str(src), "--out", str(tmp / "out"), "--engine", "mlx",
                "--offline", "--support-dir", str(tmp / "models"),
                "--timeout", "0", "--min-free-bytes", "1",
            ])
            self.assertEqual(proc.returncode, EXIT["model_missing"], proc.stderr)
            self.assertEqual(last_json(proc.stderr)["code"], "model_missing")

    def test_hash_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            support = Path(tmp)
            asr = PIN["models"]["0.6b"]
            fa = PIN["models"]["aligner"]
            for model in (asr, fa):
                dest = support / model["repo_id"] / model["revision"]
                dest.mkdir(parents=True)
                (dest / model["weight"]).write_bytes(b"not-the-weight")
                for name in model["sidecar_sha256"]:
                    (dest / name).write_text("{}", encoding="utf-8")
            with self.assertRaises(Exception) as caught:
                ensure_models(support, "0.6b", offline=True, min_free=1)
            self.assertEqual(caught.exception.code, "model_hash_mismatch")

    def test_download_failed(self):
        with tempfile.TemporaryDirectory() as tmp:
            def boom(_model, _dest):
                raise RuntimeError("offline-test")
            with self.assertRaises(Exception) as caught:
                ensure_models(Path(tmp), "0.6b", offline=False, min_free=1, downloader=boom)
            self.assertEqual(caught.exception.code, "download_failed")

    def test_disk_low(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = tmp / "tone.wav"
            tone_wav(src, 0.2)
            proc = run_cli([
                "--input", str(src), "--out", str(tmp / "out"), "--engine", "fixture",
                "--timeout", "0", "--min-free-bytes", str(10 ** 18),
            ])
            self.assertEqual(proc.returncode, EXIT["disk_low"], proc.stderr)

    def test_segment_over_cap_is_usage(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = tmp / "tone.wav"
            tone_wav(src, 0.2)
            proc = run_cli([
                "--input", str(src), "--out", str(tmp / "out"), "--engine", "fixture",
                "--timeout", "0", "--min-free-bytes", "1", "--segment-s", "301",
            ])
            self.assertEqual(proc.returncode, EXIT["usage"], proc.stderr)

    def test_timeout(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = tmp / "tone.wav"
            tone_wav(src, 0.2)
            proc = run_cli([
                "--input", str(src), "--out", str(tmp / "out"), "--engine", "fixture",
                "--timeout", "1", "--min-free-bytes", "1",
            ], env={"OFFLINE_VIDEO_ASR_FIXTURE_SLEEP": "5"})
            self.assertEqual(proc.returncode, EXIT["timeout"], proc.stderr)
            self.assertEqual(last_json(proc.stderr)["code"], "timeout")
            self.assertFalse((tmp / "out" / "out.srt").exists())

    def test_cancelled(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = tmp / "tone.wav"
            tone_wav(src, 0.2)
            env = os.environ.copy()
            env["PYTHONPATH"] = str(ROOT)
            env["OFFLINE_VIDEO_ASR_FIXTURE_SLEEP"] = "30"
            proc = subprocess.Popen(
                CLI + ["--input", str(src), "--out", str(tmp / "out"), "--engine", "fixture",
                       "--timeout", "0", "--min-free-bytes", "1"],
                cwd=str(ROOT), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            time.sleep(0.6)
            if proc.poll() is None:
                proc.terminate()
            _, err = proc.communicate(timeout=10)
            self.assertEqual(proc.returncode, EXIT["cancelled"], err)
            self.assertEqual(last_json(err)["code"], "cancelled")


if __name__ == "__main__":
    unittest.main()
