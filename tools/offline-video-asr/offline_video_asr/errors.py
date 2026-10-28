"""Observable failure codes. Non-zero means do not keep a partial subtitle."""
from __future__ import annotations

import json
import sys

# Stable exits. `drm` is its own code; protected media from AVFoundation
# reports `media_encrypted` and also carries `"drm": true` in the payload.
EXIT = {
    "usage": 2,
    "no_audio_track": 10,
    "codec_unsupported": 11,
    "media_encrypted": 12,
    "drm": 13,
    "model_missing": 14,
    "model_hash_mismatch": 15,
    "download_failed": 16,
    "disk_low": 17,
    "oom": 18,
    "sidecar_crash": 19,
    "cancelled": 20,
    "timeout": 21,
    "empty_hyp": 22,
    "pin_mismatch": 23,
}

KNOWN = frozenset(EXIT)


class Fail(Exception):
    def __init__(self, code: str, detail: str = ""):
        if code not in KNOWN:
            detail = (detail or code)[:240]
            code = "sidecar_crash"
        super().__init__(code)
        self.code = code
        self.detail = (detail or "")[:240]


class Cancelled(Fail):
    def __init__(self):
        super().__init__("cancelled")


class TimedOut(Fail):
    def __init__(self):
        super().__init__("timeout")


def emit(fail: Fail) -> int:
    payload = {"ok": False, "code": fail.code}
    if fail.code == "media_encrypted":
        payload["drm"] = True
        payload["codes"] = ["media_encrypted", "drm"]
    if fail.detail:
        payload["detail"] = fail.detail
    sys.stderr.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stderr.flush()
    return EXIT[fail.code]
