#!/bin/bash
# Renders the CHINA screenshots (7 frames × iPhone 6.5" + iPad 13" + Mac + 官网 web)
# at exact resolutions via headless Chrome. Run from repo root:
#   bash screenshots-cn/src/render.sh
#
# Frames: 1 网页双语  2 国内引擎+自带Key  3 复习卡  4 学习设置  5 文档  6 实时字幕  7 对话听译
# 6/7 的原料是 capture-app.js 拍的 dist-app-china；商店顺序见 scripts/asc-media.js 的 ORDER。
# 竖版用手机实拍、横版(Mac)用桌面实拍 —— 见 scene.html 里的 DESK/PHONE 分支。
# The phone frames photograph dist-china itself (see the capture script referenced
# in scene.html) — the same "shoot the product, don't mock it" rule the global
# store assets follow. Re-run the capture first whenever the UI changes.
set -e
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/.."
render(){ "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size="$3" --screenshot="$2" \
  "file://$DIR/scene.html?f=$1&w=${3%,*}&h=${3#*,}"; }

for f in 1 2 3 4 5 6 7; do
  render $f "$OUT/cn-iphone-$f.png" 1242,2688     # iPhone 6.5"
  render $f "$OUT/cn-ipad-$f.png"   2064,2752     # iPad 13"
  render $f "$OUT/cn-mac-$f.png"    2880,1800     # Mac App Store 16:10
  render $f "$OUT/cn-web-$f.png"    1280,800      # 官网 belliedmonkey.com 首页
done
echo "Rendered $(ls "$OUT"/cn-*.png | wc -l | tr -d ' ') China screenshots to $OUT"
