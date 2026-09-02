#!/bin/bash
# Renders the GLOBAL marketing screenshots (learning-loop story, 5 frames × zh/en
# × device sizes) at exact resolutions via headless Chrome.
# Run from repo root: bash store-assets/src/render.sh
# Frames: 1 文章双语 2 视频字幕 3 复习卡 4 手机复习 5 双设备闭环 6 一键配置
set -e
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/.."
render(){ "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size="$4" --screenshot="$3" "file://$DIR/scene.html?f=$1&lang=$2&w=${4%,*}&h=${4#*,}"; }

for lang in zh en; do
  for f in 1 2 3 4 5 6; do
    render $f $lang "$OUT/$lang-iphone-$f.png" 1242,2688     # iPhone 6.5"
    render $f $lang "$OUT/$lang-ipad-$f.png"   2064,2752     # iPad 13"
    render $f $lang "$OUT/$lang-mac-$f.png"    2880,1800     # Mac App Store 16:10
    render $f $lang "$OUT/$lang-web-$f.png"    1280,800      # CWS / AMO
  done
done
echo "Rendered $(ls "$OUT"/*.png | wc -l | tr -d ' ') screenshots to $OUT"
