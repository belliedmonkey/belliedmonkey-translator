# Mac 完整视频离线字幕（BEL-103）

一条入口：`python -m offline_video_asr`。Mac App 用 `Process` 调这个模块，不再起第二套模型。

## 输入约定（只此一种）

`--input` 是唯一的媒体参数，视频或音轨都可以。CLI 里的 `extract_to_wav` 先收成 **16 kHz 单声道 PCM WAV**，再进唯一的 `transcribe_wav`。已经是这个 WAV 的文件直接用。其它容器按这个顺序抽：

1. `OFFLINE_VIDEO_ASR_EXTRACT_BIN`（`macos/extract.swift`，AVFoundation，bootstrap 编出来）
2. `afconvert`
3. `ffmpeg`

App **不自己抽轨**。它把用户选的视频路径传给同一个 CLI。

ForcedAligner 单段不超过 `pin.json` 的 `fa_segment_s`（300 秒）。更长就切开，时间戳加回偏移。默认墙钟 14400 秒。`--segment-s` 大于 300 直接拒绝。

## 锁版

`pin.json`。权重不下进 App 包。首次任务下到：

`~/Library/Application Support/com.belliedmonkeytranslator/models/qwen3-asr/<repo>/<revision>/`

App 沙盒里用的是它自己的 Application Support，由 `--support-dir` 传入。下载之后、推理之前核对 weight sha256。`--offline` 时缺文件是 `model_missing`，不联网。可选 1.7B 只有 `--profile 1.7b` 才启用，默认 `0.6b`。

包：`mlx-qwen3-asr==0.4.4`。

## 失败码

非 0 退出，stderr 一行 JSON `{"ok":false,"code":...}`。不把半成品字幕当成功。

`no_audio_track` `codec_unsupported` `media_encrypted`（payload 同时带 `drm: true`）`drm` `model_missing` `model_hash_mismatch` `download_failed` `disk_low` `oom` `sidecar_crash` `cancelled` `timeout` `empty_hyp` `pin_mismatch`

加密媒体：AVFoundation 看到受保护内容时报 `media_encrypted`，JSON 里同时有 `drm`。

## 本机没有 Apple Silicon 时

契约测试不加载 MLX：

```bash
cd tools/offline-video-asr
PYTHONPATH=. python3 -m unittest tests.test_contract
```

`--engine fixture` 走同一条抽轨 / 切段 / SRT / VTT 路径，不下载模型。它不是质量结论。

## Mac 冒烟（Apple Silicon）

1. `bash tools/offline-video-asr/bootstrap-mac.sh`
2. 设好脚本打印的 `PYTHONPATH` 和 `OFFLINE_VIDEO_ASR_EXTRACT_BIN`。
3. `"$DEST/venv/bin/python3" -m offline_video_asr --input /path/to/movie.mp4 --out /tmp/ova-out`
4. 通过：`/tmp/ova-out/out.srt` 与 `out.vtt` 非空，cue 时间单调且落在时长内。`result.json` 的 `extract` 在有小工具时是 `helper`。
5. 再跑一次加 `--offline`，断网也能过（权重已在 Application Support 且 hash 相符）。

App：`bootstrap-mac.sh` 把 venv 和包放进 Application Support。`defaults write <bundle id> offlineVideoAsr -bool YES` 之后，页面 `OfflineVideoAsr.start(path, outDir)` 走 `mtOfflineVideoAsr`，原生侧拉起上面同一个模块。Flag 默认关。没有新的首页按钮（可见入口等 Pencil 稿）。

## 不做

不换听译的本机识别，不进 iOS target，不改默认翻译引擎，不把权重打进包，不把这条任务写成听译已经胜过本机听写。
