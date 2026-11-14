# 36 条原始音频定位（大文件不入库、不进 git）

许可证（见基线 README.txt）：FLEURS CC-BY-4.0；ASCEND CC-BY-SA-4.0。30 条 FLEURS 1668–1682（en_us + cmn_hans_cn），6 条 ASCEND 00004,00009,00028,00055,00066,00068。

## 盒路径（本包制作机）

- 根：`/workspace/baseline-sa-sv-36-20261113/audio/`
- `audio/ascend/*.wav`
- `audio/fleurs/cmn_hans_cn/*.wav` 与 `audio/fleurs/en_us/*.wav`（完整相对路径与 hash 见同目录 `SHA256SUMS-audio.txt`，摘自基线 `SHA256SUMS`）
- 基线 `SHA256SUMS` 本步复算：`fd17a2c1062ae8d8ffd50c8bf0d820aebe26751c72f1aa1764c3d7006a1d5358`

## Mac 路径

- 工程结账：`/Users/belliedmonkey/mobiletranslator`（机标识 `e223ea06-b095-46bd-82fd-4bc961a21408`）
- 不能假定 OpenBot 能读本盒或自动读 Mac。接续时应用上述 hash 在可访问的副本上核对，不要改官方分数或重跑 SA/SV（除非用户另行明确授权）。
- 听审用的 wav 还出现在 `/workspace/baseline-review-*`，那是耳听材料，不是语义人审。

## 体积

- `audio/` 合计约 23MB，整棵基线 tar 约 23.5MB，不可再套进本 <25MB 归档。
