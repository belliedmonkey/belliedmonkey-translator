#!/bin/bash
# App Preview 视频的**可复现输入**：题卡 + 三条音轨。
# 用法：STORE_MEDIA=~/some/dir bash store-assets/src/make-preview-inputs.sh
#
# 为什么有这个脚本（2026-09-23）：`compose-preview.sh` / `compose-preview-ios.sh` 的输入
# 原先**全部**只存在于 $STORE_MEDIA —— 那个目录不进仓库，于是 09-20 那四支成片之后素材
# 全丢了，「重跑一次合成」变成了「整个重拍」。现在除了**录屏原片**（太大，仍不进仓库）
# 之外，每一项输入都能由这个脚本从仓库里重新生成：
#
#   cards/{en,zh}-{subs,talk,end}.png  ← preview-card.html（无头 Chrome，2560×1600）
#   en.wav / zh.wav                     ← `say` 念 .local/spike/conv/ref.txt 的单语侧
#   music.wav                           ← ffmpeg 合成的环境音床（−30 LUFS，35 s）
#   conv.wav                            ← 拷自 .local/spike/conv/conv.wav（对话段外放的那条）
#
# 还差的那一半（只能现场拍，判据见 docs/verification-spec.md §2.G 第 6 条）：
#   rec/{en,zh}-subs.mov       + rec/{en,zh}-subs.start.txt
#   rec/{en,zh}-talk-v2.mov    + rec/{en,zh}-talk-v2.start.txt
# `.start.txt` 里写**开始录屏的那一刻、音轨已经播到第几秒**（通常 0），合成脚本按它对齐声画。
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
# 默认落在 `.local/store-media/`（gitignored，但**在仓库里、不随会话消失**）——
# 上一次素材全丢，一半原因就是它们待在一个临时目录里。
M=${STORE_MEDIA:-$ROOT/.local/store-media}
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
mkdir -p "$M/cards" "$M/cards-ios" "$M/rec"

# ── 题卡 ────────────────────────────────────────────────────────────────────
for lang in en zh; do
  for t in subs talk end; do
    "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
      --window-size=2560,1600 --screenshot="$M/cards/$lang-$t.png" \
      "file://$DIR/preview-card.html?t=$t&lang=$lang" >/dev/null 2>&1
  done
done
echo "题卡 6 张 → $M/cards"

# iPhone 竖版题卡（886×1920）。iOS 那支只用 subs / end 两张 —— 它没有「对话」那一段。
# 2026-09-25 补：原来这个脚本只出 Mac 的六张，于是 compose-preview-ios.sh 的 cards-ios/
# 一直是空的，而它的报错是「文件不存在」，指不到「谁该生成它」。
for lang in en zh; do
  for t in subs end; do
    "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
      --window-size=886,1920 --screenshot="$M/cards-ios/$lang-$t.png" \
      "file://$DIR/preview-card.html?t=$t&lang=$lang&size=ios" >/dev/null 2>&1
  done
done
echo "竖版题卡 4 张 → $M/cards-ios"

# ── 声源音轨 ────────────────────────────────────────────────────────────────
# 与 preview-stage.html 同一场景（供应商询价），句子取自 .local/spike/conv/ref.txt 的单语侧：
# **zh 版的片子放英文声源**（条上出中文译文），en 版反过来。
# 句间 2.2 s：定稿的双语要在条上**停够久**才拍得到 —— 09-23 头一条用 1.1 s，11 秒的取景窗里
# 大半时间条上只有一行斜体的实时原文，而这支片子要展示的恰恰是「原文 + 译文」那一格。
say_track() {  # $1=voice  $2=out  $3...=sentences
  local voice=$1 out=$2; shift 2
  local tmp; tmp=$(mktemp -d); local i=0 list="$tmp/list.txt"
  ffmpeg -v error -y -f lavfi -i "anullsrc=r=22050:cl=mono" -t 2.2 "$tmp/gap.wav"
  : > "$list"
  echo "file '$tmp/gap.wav'" >> "$list"          # 前导静音：录屏开始时不至于第一个字就被切掉
  for s in "$@"; do
    i=$((i + 1))
    say -v "$voice" -r 168 -o "$tmp/s$i.aiff" "$s"
    ffmpeg -v error -y -i "$tmp/s$i.aiff" -ar 22050 -ac 1 "$tmp/s$i.wav"
    echo "file '$tmp/s$i.wav'" >> "$list"
    echo "file '$tmp/gap.wav'" >> "$list"
  done
  ffmpeg -v error -y -f concat -safe 0 -i "$list" -ar 48000 -ac 2 "$out"
  rm -rf "$tmp"
}
say_track Samantha "$M/en.wav" \
  "We can ship the first batch next Tuesday if the deposit arrives by Friday." \
  "The quote already includes freight and insurance, but not customs duties." \
  "We need to see a sample first before we decide on the order quantity." \
  "Payment can be by letter of credit or wire transfer, which do you prefer?" \
  "Lead time for this batch is forty-five days."
say_track Tingting "$M/zh.wav" \
  "如果定金周五之前到账，我们下周二就能发第一批货。" \
  "这个报价里已经包含了运费和保险，但不含关税。" \
  "我们需要先看一下样品，再决定订单数量。" \
  "付款方式可以是信用证，也可以是电汇，你们更倾向哪一种？" \
  "这批货的交期是四十五天。"
echo "声源音轨 → $M/{en,zh}.wav（$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$M/en.wav" | cut -d. -f1) s / $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$M/zh.wav" | cut -d. -f1) s）"

# ── 环境音床 ────────────────────────────────────────────────────────────────
# 纯合成，不用任何第三方素材（商店视频的音乐是有版权风险的那一格）。−30 LUFS，垫在对白下面。
ffmpeg -v error -y \
  -f lavfi -i "sine=frequency=220:duration=35" -f lavfi -i "sine=frequency=277.18:duration=35" \
  -f lavfi -i "sine=frequency=329.63:duration=35" -f lavfi -i "sine=frequency=110:duration=35" \
  -filter_complex "[0:a]volume=0.25,tremolo=f=0.18:d=0.35[a0];[1:a]volume=0.18,tremolo=f=0.13:d=0.3[a1];\
[2:a]volume=0.13,tremolo=f=0.11:d=0.4[a2];[3:a]volume=0.3[a3];\
[a0][a1][a2][a3]amix=inputs=4:normalize=0,lowpass=f=1400,loudnorm=I=-30:TP=-6,afade=t=in:st=0:d=2[m]" \
  -map "[m]" -ar 48000 -ac 2 "$M/music.wav"
echo "环境音床 → $M/music.wav"

# ── 对话段外放的语料 ────────────────────────────────────────────────────────
if [ -f "$ROOT/.local/spike/conv/conv.wav" ]; then
  cp "$ROOT/.local/spike/conv/conv.wav" "$M/conv.wav"; echo "对话语料 → $M/conv.wav"
else
  echo "⚠️ 找不到 .local/spike/conv/conv.wav —— 对话段要另找一条中英交替语料（CONV_WAV 可覆盖）"
fi

# ── 还差什么 ────────────────────────────────────────────────────────────────
miss=0
for f in en-subs zh-subs en-talk-v2 zh-talk-v2; do
  [ -f "$M/rec/$f.mov" ] || { echo "缺录屏：rec/$f.mov"; miss=1; }
  [ -f "$M/rec/$f.start.txt" ] || { echo "缺对齐点：rec/$f.start.txt"; miss=1; }
done
[ $miss -eq 0 ] && echo "✓ 输入齐了，可以跑 compose-preview.sh" || echo "↑ 这些只能现场录屏，见 store-assets/README.md"
