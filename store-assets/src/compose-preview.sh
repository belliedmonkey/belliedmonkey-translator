#!/bin/bash
# Mac App Preview（DESKTOP 2560×1600）合成：题卡 → 实时字幕真机录屏 → 题卡 → 对话听译真机录屏 → 结尾卡。
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
else
  SUBS=$R/en-subs.mov;     SUBS_AUDIO=$M/zh.wav; SUBS_T0=$(cat $R/en-subs.start.txt)
  TALK=$R/en-talk-v2.mov;  TALK_T0=$(cat $R/en-talk-v2.start.txt)
fi
CARD=2.5; FADE=0.25
SUBS_IN=1.5; SUBS_DUR=11      # 取录屏 1.5–12.5 s
TALK_IN=2;   TALK_DUR=9       # 取录屏 2–11 s
TOTAL=$(echo "$CARD*3 + $SUBS_DUR + $TALK_DUR" | bc)
SA=$(echo "$SUBS_T0 + $SUBS_IN" | bc); TA=$(echo "$TALK_T0 + $TALK_IN" | bc)
OUT=${OUT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/video}/$L-mac.mp4
echo "${L}：总长 $TOTAL s · 字幕段音轨起点 $SA s · 对话段音轨起点 $TA s"

V="fps=30,scale=2560:1600:flags=lanczos,setsar=1,format=yuv420p"
ffmpeg -v error -y \
  -loop 1 -framerate 30 -t $CARD -i $C/$L-subs.png \
  -ss $SUBS_IN -t $SUBS_DUR -i "$SUBS" \
  -loop 1 -framerate 30 -t $CARD -i $C/$L-talk.png \
  -ss $TALK_IN -t $TALK_DUR -i "$TALK" \
  -loop 1 -framerate 30 -t $CARD -i $C/$L-end.png \
  -ss $SA -t $SUBS_DUR -i "$SUBS_AUDIO" \
  -ss $TA -t $TALK_DUR -i "$CONV" \
  -i $M/music.wav \
  -filter_complex "\
[0:v]$V,fade=t=in:st=0:d=$FADE,fade=t=out:st=$(echo "$CARD-$FADE" | bc):d=$FADE[v0];\
[1:v]$V,trim=duration=$SUBS_DUR,setpts=PTS-STARTPTS,fade=t=in:st=0:d=$FADE,fade=t=out:st=$(echo "$SUBS_DUR-$FADE" | bc):d=$FADE[v1];\
[2:v]$V,fade=t=in:st=0:d=$FADE,fade=t=out:st=$(echo "$CARD-$FADE" | bc):d=$FADE[v2];\
[3:v]$V,trim=duration=$TALK_DUR,setpts=PTS-STARTPTS,fade=t=in:st=0:d=$FADE,fade=t=out:st=$(echo "$TALK_DUR-$FADE" | bc):d=$FADE[v3];\
[4:v]$V,fade=t=in:st=0:d=$FADE,fade=t=out:st=$(echo "$CARD-$FADE" | bc):d=$FADE[v4];\
[v0][v1][v2][v3][v4]concat=n=5:v=1:a=0[v];\
anullsrc=r=48000:cl=stereo,atrim=duration=$CARD[s0];\
[5:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-18:TP=-2,atrim=duration=$SUBS_DUR,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.3,afade=t=out:st=$(echo "$SUBS_DUR-0.4" | bc):d=0.4[s1];\
anullsrc=r=48000:cl=stereo,atrim=duration=$CARD[s2];\
[6:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-18:TP=-2,atrim=duration=$TALK_DUR,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.3,afade=t=out:st=$(echo "$TALK_DUR-0.4" | bc):d=0.4[s3];\
anullsrc=r=48000:cl=stereo,atrim=duration=$CARD[s4];\
[s0][s1][s2][s3][s4]concat=n=5:v=0:a=1[dia];\
[7:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=duration=$TOTAL,afade=t=out:st=$(echo "$TOTAL-2" | bc):d=2[mus];\
[dia][mus]amix=inputs=2:normalize=0:duration=first[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -profile:v high -pix_fmt yuv420p -r 30 -crf 18 -preset medium \
  -c:a aac -b:a 192k -ar 48000 -ac 2 -movflags +faststart -t $TOTAL "$OUT" || { echo "✗ 合成失败"; exit 1; }
ffprobe -v error -show_entries format=duration:stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,sample_rate,channels -of compact "$OUT"
