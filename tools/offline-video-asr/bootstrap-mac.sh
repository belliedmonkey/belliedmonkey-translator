#!/bin/bash
# Install the stage-0 sidecar into Application Support. Apple Silicon only.
# Weights are downloaded later by the CLI, not by this script, and never into the app bundle.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "bootstrap-mac.sh: macOS only" >&2
  exit 1
fi
if [[ "$(uname -m)" != "arm64" ]]; then
  echo "bootstrap-mac.sh: mlx-qwen3-asr needs Apple Silicon (got $(uname -m))" >&2
  exit 1
fi

ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
DEST="${OFFLINE_VIDEO_ASR_HOME:-$HOME/Library/Application Support/com.belliedmonkeytranslator/offline-video-asr}"
mkdir -p "$DEST/bin" "$DEST/pkg"

python3 -m venv "$DEST/venv"
"$DEST/venv/bin/python" -m pip install --upgrade pip
"$DEST/venv/bin/python" -m pip install -r "$ROOT/requirements.txt"
"$DEST/venv/bin/python" - <<'PY'
import importlib.metadata as m
assert m.version("mlx-qwen3-asr") == "0.4.4", m.version("mlx-qwen3-asr")
print("mlx-qwen3-asr", m.version("mlx-qwen3-asr"))
PY

rm -rf "$DEST/pkg/offline_video_asr"
cp -R "$ROOT/offline_video_asr" "$DEST/pkg/offline_video_asr"
cp "$ROOT/pin.json" "$DEST/pkg/pin.json"
cp "$ROOT/NOTICE" "$DEST/pkg/NOTICE"

swiftc -O \
  -framework AVFoundation -framework CoreMedia -framework CoreAudio -framework AudioToolbox \
  "$ROOT/macos/extract.swift" \
  -o "$DEST/bin/offline-video-asr-extract"

echo "sidecar: $DEST"
echo "python:  $DEST/venv/bin/python3"
echo "extract: $DEST/bin/offline-video-asr-extract"
echo "then:    \"$DEST/venv/bin/python3\" -m offline_video_asr --input MOVIE --out OUTDIR"
echo "         PYTHONPATH=\"$DEST/pkg\" OFFLINE_VIDEO_ASR_EXTRACT_BIN=\"$DEST/bin/offline-video-asr-extract\""
