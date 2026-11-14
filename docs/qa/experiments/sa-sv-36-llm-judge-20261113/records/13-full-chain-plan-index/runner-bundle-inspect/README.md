# Reviewed-36 Mac bundle

No audio and no model zip are in this archive. Linux cannot report a SpeechAnalyzer score.
The SenseVoice zip must already hash to the sha256 in MANIFEST.json before a sensevoice run.
Do not use the product relay. A tar.bz2 from elsewhere is a different file.

Prepare caches yourself, then from this directory:

```bash
node run-reviewed-36.js --run --backend sa --out /tmp/r36-sa-smoke \
  --fleurs-cache /ABS/fleurs-cache --ascend-cache /ABS/ascend-cache
node run-reviewed-36.js --pack-existing /tmp/r36-sa-smoke
```

That first command is one smoke. Do not pass `--repeats` until a smoke has exited 0. Fewer than five repeats is exploratory and is not a ranking.
Darwin with `swiftc` stages the 36 files, checks their sha256, compiles `product-asr-mac.swift`, runs `--install-assets`, then recognizes. Linux stays `unavailable`.

SenseVoice stays blocked until the pinned zip is obtained separately. A supplied model directory is checked, not downloaded:

```bash
node run-reviewed-36.js --run --backend sensevoice --out /tmp/r36-sv-smoke \
  --sensevoice-dir /ABS/sherpa-onnx-sense-voice \
  --fleurs-cache /ABS/fleurs-cache --ascend-cache /ABS/ascend-cache
```

No model directory is `model-missing`. A directory whose `model.int8.onnx` and `tokens.txt` hash, but no `sherpa-onnx-offline` on PATH, is `backend-missing`. Neither blocks the SA command.

`--check` in this flat directory does not see the repo caches. Point the repo command at the caches instead:

```bash
node eval/baselines/asr/run-reviewed-36.js --check
```

SA locale for ASCEND is zh-CN once. It is not chosen by trying en-US as well.
