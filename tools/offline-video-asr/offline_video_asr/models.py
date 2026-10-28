"""On-demand weights under Application Support. Hash before any inference."""
from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

from offline_video_asr.errors import Fail
from offline_video_asr.pin import aligner_model, load_pin, profile_model, snapshot_dir

try:
    from huggingface_hub import snapshot_download as _snapshot_download
except ImportError:  # optional until the Mac venv is bootstrapped
    _snapshot_download = None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def free_bytes(path: Path) -> int:
    path.mkdir(parents=True, exist_ok=True)
    return shutil.disk_usage(path).free


def assert_disk(path: Path, need: int | None = None) -> None:
    required = int(load_pin()["min_free_bytes"] if need is None else need)
    if free_bytes(path) < required:
        raise Fail("disk_low", str(required))


def hf_download(model: dict, dest: Path) -> None:
    if _snapshot_download is None:
        raise Fail("download_failed", "huggingface_hub")
    dest.mkdir(parents=True, exist_ok=True)
    try:
        _snapshot_download(
            repo_id=model["repo_id"],
            revision=model["revision"],
            local_dir=str(dest),
        )
    except Fail:
        raise
    except Exception as exc:
        raise Fail("download_failed", type(exc).__name__) from exc


def _check_tree(model: dict, dest: Path, *, offline: bool, downloader) -> None:
    weight = dest / model["weight"]
    sidecars = model.get("sidecar_sha256") or {}
    missing = not weight.is_file() or any(not (dest / name).is_file() for name in sidecars)
    if missing:
        if offline:
            raise Fail("model_missing", model["repo_id"])
        try:
            downloader(model, dest)
        except Fail:
            raise
        except Exception as exc:
            raise Fail("download_failed", type(exc).__name__) from exc
    if not weight.is_file():
        raise Fail("model_missing", model["weight"])
    if sha256_file(weight) != model["weight_sha256"]:
        raise Fail("model_hash_mismatch", model["weight"])
    for name, expect in sidecars.items():
        side = dest / name
        if not side.is_file():
            raise Fail("model_missing", name)
        if sha256_file(side) != expect:
            raise Fail("model_hash_mismatch", name)


def ensure_models(support: Path, profile: str, *, offline: bool, min_free: int | None = None, downloader=None) -> dict:
    if profile not in ("0.6b", "1.7b"):
        raise Fail("usage", "profile")
    assert_disk(support, min_free)
    asr = profile_model(profile)
    aligner = aligner_model()
    fetch = downloader or hf_download
    asr_dir = snapshot_dir(support, asr)
    fa_dir = snapshot_dir(support, aligner)
    _check_tree(asr, asr_dir, offline=offline, downloader=fetch)
    _check_tree(aligner, fa_dir, offline=offline, downloader=fetch)
    return {"asr_dir": asr_dir, "fa_dir": fa_dir, "profile": profile, "asr": asr, "aligner": aligner}
