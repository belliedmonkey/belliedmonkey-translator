#!/bin/bash
# Mac App Preview（DESKTOP 2560×1600）合成：题卡 → 实时字幕录屏 → 题卡 → 对话听译录屏 → 快速翻译录屏 → 结尾卡。
# 2026-09-25：加了「快速翻译」一段（Mac 独有、1.13.1 起）。Apple 的 App Preview 卡 15–30 s，
#   所以字幕 11→10 s、对话 9→8 s 各让出一秒，三张题卡不动 ⇒ 总长 28.5 s。
#   快速翻译那一段**没有对白**（它本来就是安静的），音轨给静音，全程只有环境音床。
# 用法：compose-preview.sh <zh|en>
# 声音：两段录屏各自配「录制时正在外放的那条原始音轨」的对应片段（按录制开始时记下的时间点对齐），
#       对白 loudnorm −18 LUFS；全程垫合成的环境音床（music.wav，−30 LUFS）。题卡段只有音乐。
set -u
M=${STORE_MEDIA:?设 STORE_MEDIA 指向录屏素材目录（rec/ 下的真机录屏、en.wav / zh.wav、music.wav；录屏原片太大不进仓库）}
R=$M/rec; C=${CARDS:-$M/cards}   # 题卡：Chrome 无头渲染 store-assets/src/preview-card.html?t=subs|talk|end&lang=zh|en（2560×1600）
CONV=${CONV_WAV:-$M/conv.wav}   # 对话段外放的中英交替语料
L=$1
if [ "$L" = zh ]; then
  SUBS=$R/zh-subs.mov;     SUBS_AUDIO=$M/en.wav; SUBS_T0=$(cat $R/zh-subs.start.txt)
  TALK=$R/zh-talk-v2.mov;  TALK_T0=$(cat $R/zh-talk-v2.start.txt)
  QUICK=$R/zh-quick.mov
else
  SUBS=$R/en-subs.mov;     SUBS_AUDIO=$M/zh.wav; SUBS_T0=$(cat $R/en-subs.start.txt)
  TALK=$R/en-talk-v2.mov;  TALK_T0=$(cat $R/en-talk-v2.start.txt)
  QUICK=$R/en-quick.mov
fi
# 缺了快速翻译那一段就**停下**，别安静地出一支 25.5 s 的片子 —— 少一段在成片里看不出来，
# 只有对着秒数数才发现，而那正是这一类素材最容易糊弄过去的地方。
[ -f "$QUICK" ] || { echo "✗ 缺 $QUICK（快速翻译那一段的录屏）"; exit 1; }
CARD=2.5; FADE=0.25
SUBS_IN=1.5; SUBS_DUR=10      # 取录屏 1.5–11.5 s（原来 11 s，让一秒给快速翻译）
TALK_IN=2;   TALK_DUR=8       # 取录屏 2–10 s（原来 9 s，同上）
QUICK_DUR=3                   # 快速翻译：选中 → 面板出译文，够看清一次
TOTAL=$(echo "$CARD*3 + $SUBS_DUR + $TALK_DUR + $QUICK_DUR" | bc)
SA=$(echo "$SUBS_T0 + $SUBS_IN" | bc); TA=$(echo "$TALK_T0 + $TALK_IN" | bc)
SA_END=$(echo "$SA + $SUBS_DUR" | bc); TA_END=$(echo "$TA + $TALK_DUR" | bc)
# 两条外放音轨当时都是 `while true; do afplay …; done` 循环放的，所以取的时候也要
# **循环着取**（`-stream_loop -1` + 滤镜里按绝对起止截）—— 越过一轮之后喇叭里放的
# 本来就是文件开头，这是还原，不是取巧。不循环的后果是**安静地少一截**：
# 2026-09-25 iOS 那支就这么出了个 21.7 s 音轨配 28 s 画面的片子，本地能放，
# 传到 ASC 被异步判 MOV_RESAVE_CORRUPTED。下面出片后有门禁兜住。
OUT=${OUT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/video}/$L-mac.mp4
echo "${L}：总长 $TOTAL s（Apple 上限 30）· 字幕段音轨起点 $SA s · 对话段音轨起点 $TA s"

V="fps=30,scale=2560:1600:flags=lanczos,setsar=1,format=yuv420p"
ffmpeg -v error -y \
  -loop 1 -framerate 30 -t $CARD -i $C/$L-subs.png \
  -ss $SUBS_IN -t $SUBS_DUR -i "$SUBS" \
  -loop 1 -framerate 30 -t $CARD -i $C/$L-talk.png \
  -ss $TALK_IN -t $TALK_DUR -i "$TALK" \
  -ss 0 -t $QUICK_DUR -i "$QUICK" \
  -loop 1 -framerate 30 -t $CARD -i $C/$L-end.png \
  -stream_loop -1 -i "$SUBS_AUDIO" \
  -stream_loop -1 -i "$CONV" \
  -i $M/music.wav \
  -filter_complex "\
[0:v]$V,fade=t=in:st=0:d=$FADE,fade=t=out:st=$(echo "$CARD-$FADE" | bc):d=$FADE[v0];\
[1:v]$V,trim=duration=$SUBS_DUR,setpts=PTS-STARTPTS,fade=t=in:st=0:d=$FADE,fade=t=out:st=$(echo "$SUBS_DUR-$FADE" | bc):d=$FADE[v1];\
[2:v]$V,fade=t=in:st=0:d=$FADE,fade=t=out:st=$(echo "$CARD-$FADE" | bc):d=$FADE[v2];\
[3:v]$V,trim=duration=$TALK_DUR,setpts=PTS-STARTPTS,fade=t=in:st=0:d=$FADE,fade=t=out:st=$(echo "$TALK_DUR-$FADE" | bc):d=$FADE[v3];\
[4:v]$V,trim=duration=$QUICK_DUR,setpts=PTS-STARTPTS,fade=t=in:st=0:d=$FADE,fade=t=out:st=$(echo "$QUICK_DUR-$FADE" | bc):d=$FADE[v4];\
[5:v]$V,fade=t=in:st=0:d=$FADE,fade=t=out:st=$(echo "$CARD-$FADE" | bc):d=$FADE[v5];\
[v0][v1][v2][v3][v4][v5]concat=n=6:v=1:a=0[v];\
anullsrc=r=48000:cl=stereo,atrim=duration=$CARD[s0];\
[6:a]atrim=start=$SA:end=$SA_END,asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-18:TP=-2,afade=t=in:st=0:d=0.3,afade=t=out:st=$(echo "$SUBS_DUR-0.4" | bc):d=0.4[s1];\
anullsrc=r=48000:cl=stereo,atrim=duration=$CARD[s2];\
[7:a]atrim=start=$TA:end=$TA_END,asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-18:TP=-2,afade=t=in:st=0:d=0.3,afade=t=out:st=$(echo "$TALK_DUR-0.4" | bc):d=0.4[s3];\
anullsrc=r=48000:cl=stereo,atrim=duration=$QUICK_DUR[s4];\
anullsrc=r=48000:cl=stereo,atrim=duration=$CARD[s5];\
[s0][s1][s2][s3][s4][s5]concat=n=6:v=0:a=1[dia];\
[8:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=duration=$TOTAL,afade=t=out:st=$(echo "$TOTAL-2" | bc):d=2[mus];\
[dia][mus]amix=inputs=2:normalize=0:duration=first[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -profile:v high -pix_fmt yuv420p -r 30 -crf 18 -preset medium \
  -c:a aac -b:a 192k -ar 48000 -ac 2 -movflags +faststart -t $TOTAL "$OUT" || { echo "✗ 合成失败"; exit 1; }
ffprobe -v error -show_entries format=duration:stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,sample_rate,channels -of compact "$OUT"

# ── 出片后的判据：音轨必须和画面一样长（与 compose-preview-ios.sh 同一条）────────
# 「能放」不是判据 —— 音轨短一截只是后半段静音，本地看不出来，而 ASC 上传后异步判
# MOV_RESAVE_CORRUPTED，那时脚本早退出了、上传那一步还打过 ✓。
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
    print("  音轨短了多半是外放音轨没循环着取 —— 见上面 SA/TA 那一段的注释")
    sys.exit(1)
print(f"✓ 音画等长 {v:.2f}s")
PY
