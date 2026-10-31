"""Locked revisions. pin.json is the only copy of the hashes."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

PIN_PATH = Path(__file__).resolve().parents[1] / "pin.json"


@lru_cache(maxsize=1)
def load_pin() -> dict:
    return json.loads(PIN_PATH.read_text(encoding="utf-8"))


def profile_model(name: str) -> dict:
    pin = load_pin()
    if name not in ("0.6b", "1.7b"):
        raise KeyError(name)
    return pin["models"][name]


def aligner_model() -> dict:
    return load_pin()["models"]["aligner"]


def snapshot_dir(support: Path, model: dict) -> Path:
    return support / model["repo_id"] / model["revision"]
