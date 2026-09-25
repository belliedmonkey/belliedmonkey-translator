#!/bin/bash
# iPhone App Preview（IPHONE_67 · 886×1920）合成：题卡 → App 里点「开始」→ Safari 测试页 + 画中画字幕窗滚动
#   → **系统翻译**（在别的 App 里选字点「翻译」，弹层出译文）→ 结尾卡。
# 2026-09-25：加了系统翻译那一段（iPhone 独有、1.14.0 起，商店视频里从来没出现过；用户当天裁定「要」）。
#   它**没有对白**，音轨给静音。
# 用法：compose-preview-ios.sh <zh|en>
# 素材：14 Pro 真机 USB 录屏（1180×2556 · 60fps，宽高比与 886×1920 相同）。录屏时手机扬声器被系统静音，
#       App 听的是 Mac 扬声器外放的同一条音轨 —— 所以成片的对白就用那条音轨，按「录屏段起点 epoch」与「外放起点 epoch」对齐。
# 各段的入点 / 时长随每次录屏不同，用环境变量给：
#   APP_MOV APP_IN APP_DUR           App 段（点「实时字幕」「开始」）
#   SYS_MOV SYS_IN SYS_DUR           系统翻译段（选字 → 翻译 → 弹层；无声）
#   PIP_MOV PIP_IN PIP_DUR PIP_T0     画中画段；PIP_T0 = 该段录屏开始的 epoch 秒
#   AUDIO AUD_T0                      外放的那条原始视频（取其音轨）与外放开始的 epoch 秒
set -u
M=${STORE_MEDIA:?设 STORE_MEDIA 指向录屏素材目录（cards-ios/ 下的竖版题卡、music.wav；录屏原片太大不进仓库）}
C=${CARDS:-$M/cards-ios}   # 题卡：无头渲染 store-assets/src/preview-card.html?t=subs|end&lang=zh|en&size=ios（886×1920）
L=$1
: "${APP_MOV:?}" "${APP_IN:?}" "${APP_DUR:?}" "${PIP_MOV:?}" "${PIP_IN:?}" "${PIP_DUR:?}" "${PIP_T0:?}" "${AUDIO:?}" "${AUD_T0:?}"
: "${SYS_MOV:?}" "${SYS_IN:?}" "${SYS_DUR:?}"
# 缺了系统翻译那一段就停下 —— 少一段在成片里看不出来，只有对着秒数数才发现。
[ -f "$SYS_MOV" ] || { echo "✗ 缺 $SYS_MOV（系统翻译那一段的录屏）"; exit 1; }
CARD=2.5; FADE=0.25
TOTAL=$(echo "$CARD*2 + $APP_DUR + $PIP_DUR + $SYS_DUR" | bc)
# Apple 的 App Preview 卡 15–30 s。超了就停，别等上传时才被打回来。
case $(echo "$TOTAL > 30" | bc) in 1) echo "✗ 总长 $TOTAL s 超过 Apple 的 30 s 上限"; exit 1;; esac
PA=$(printf '%.3f' "$(echo "$PIP_T0 + $PIP_IN - $AUD_T0" | bc)")   # 画中画段第一帧时，外放音轨已经放到第几秒（bc 出「.417」不带前导 0，ffmpeg 的 -ss 不认）
PA_END=$(printf '%.3f' "$(echo "$PA + $PIP_DUR" | bc)")
OUT=${OUT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/video}/$L-ios.mp4
echo "${L}：总长 $TOTAL s（Apple 上限 30）· 画中画段对白取外放音轨 $PA s 起"
case $PA in -*) echo "✗ 画中画段早于外放开始（PA=$PA），把 PIP_IN 往后挪"; exit 1;; esac
# 声源当时是 `while true; do afplay …; done` 循环外放的，所以取音轨也要**循环着取**：
# `-stream_loop -1` 输入 + 滤镜里按绝对起止截。这不是取巧，是**还原当时真正在响的声音** ——
# 越过一轮之后喇叭里放的本来就是文件开头。
#
# 不循环的后果不是报错，是**安静地少一截**：2026-09-25 实测 `-ss 51.7 -t 11` 只给了
# 4.615 s，于是 zh-ios.mp4 的音轨 21.7 s 配 28 s 的画面。片子照样能放（后半段没声），
# 而**苹果的转码器直接判它 `MOV_RESAVE_CORRUPTED`**，上传后异步失败 —— 脚本那一步还打了 ✓。

# out_range=tv：题卡 PNG 是全范围，不压成 tv 范围时 concat 出来是 yuvj420p（商店要 yuv420p）
V="fps=30,scale=886:1920:flags=lanczos:out_range=tv,setsar=1,format=yuv420p"
ffmpeg -v error -y \
  -loop 1 -framerate 30 -t $CARD -i $C/$L-subs.png \
  -ss $APP_IN -t $APP_DUR -i "$APP_MOV" \
  -ss $PIP_IN -t $PIP_DUR -i "$PIP_MOV" \
  -ss $SYS_IN -t $SYS_DUR -i "$SYS_MOV" \
  -loop 1 -framerate 30 -t $CARD -i $C/$L-end.png \
  -stream_loop -1 -i "$AUDIO" \
  -i $M/music.wav \
  -filter_complex "\
[0:v]$V,fade=t=in:st=0:d=$FADE,fade=t=out:st=$(echo "$CARD-$FADE" | bc):d=$FADE[v0];\
[1:v]$V,trim=duration=$APP_DUR,setpts=PTS-STARTPTS,fade=t=in:st=0:d=$FADE[v1];\
[2:v]$V,trim=duration=$PIP_DUR,setpts=PTS-STARTPTS,fade=t=out:st=$(echo "$PIP_DUR-$FADE" | bc):d=$FADE[v2];\
[3:v]$V,trim=duration=$SYS_DUR,setpts=PTS-STARTPTS,fade=t=in:st=0:d=$FADE,fade=t=out:st=$(echo "$SYS_DUR-$FADE" | bc):d=$FADE[v3];\
[4:v]$V,fade=t=in:st=0:d=$FADE,fade=t=out:st=$(echo "$CARD-$FADE" | bc):d=$FADE[v4];\
[v0][v1][v2][v3][v4]concat=n=5:v=1:a=0[v];\
anullsrc=r=48000:cl=stereo,atrim=duration=$(echo "$CARD + $APP_DUR" | bc)[s0];\
[5:a]atrim=start=$PA:end=$PA_END,asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-18:TP=-2,afade=t=in:st=0:d=0.3,afade=t=out:st=$(echo "$PIP_DUR-0.4" | bc):d=0.4[s1];\
anullsrc=r=48000:cl=stereo,atrim=duration=$(echo "$SYS_DUR + $CARD" | bc)[s2];\
[s0][s1][s2]concat=n=3:v=0:a=1[dia];\
[6:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=duration=$TOTAL,afade=t=out:st=$(echo "$TOTAL-2" | bc):d=2[mus];\
[dia][mus]amix=inputs=2:normalize=0:duration=first[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -profile:v high -pix_fmt yuv420p -r 30 -crf 18 -preset medium \
  -c:a aac -b:a 192k -ar 48000 -ac 2 -movflags +faststart -t $TOTAL "$OUT" || { echo "✗ 合成失败"; exit 1; }
ffprobe -v error -show_entries format=duration:stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,sample_rate,channels -of compact "$OUT"

# ── 出片后的判据：音轨必须和画面一样长 ────────────────────────────────────────
# 「能放」不是判据。音轨短一截的片子在本地播放器里看不出来（后半段静音而已），
# 而 App Store Connect 上传后**异步**判 MOV_RESAVE_CORRUPTED —— 那时脚本早就退出了、
# 上传那一步也打过 ✓，只有回读 assetDeliveryState 才看得见。所以在这里就拦住。
VD=$(ffprobe -v error -select_streams v:0 -show_entries stream=duration -of csv=p=0 "$OUT")
AD=$(ffprobe -v error -select_streams a:0 -show_entries stream=duration -of csv=p=0 "$OUT")
python3 - "$VD" "$AD" "$TOTAL" <<'PY' || { echo "   ⇒ 删掉这个残片，别让它被传上去"; rm -f "$OUT"; exit 1; }
import sys
v, a, t = (float(x) for x in sys.argv[1:4])
bad = []
if abs(v - a) > 0.2: bad.append(f"音轨 {a:.2f}s 与画面 {v:.2f}s 不等长（差 {abs(v-a):.2f}s）")
if abs(v - t) > 0.2: bad.append(f"画面 {v:.2f}s 与计划的 {t:.2f}s 不符")
if bad:
    print("✗ " + "；".join(bad))
    print("  音轨短了多半是外放音轨没循环着取 —— 见上面 PA 那一段的注释")
    sys.exit(1)
print(f"✓ 音画等长 {v:.2f}s")
PY
