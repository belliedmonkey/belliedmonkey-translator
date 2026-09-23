#!/bin/bash
# Renders the GLOBAL marketing screenshots (9 frames × zh/en × device sizes) at
# exact resolutions via headless Chrome.
# Run from repo root: bash store-assets/src/render.sh
# Frames: 1 文章双语 2 视频字幕 3 复习卡 4 手机复习 5 双设备闭环 6 一键配置 7 文档
#         8 实时字幕 9 对话听译（8/9 的原料由 capture-app.js 拍；商店顺序见 asc-media.js ORDER）
set -e
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/.."
render(){ "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size="$4" --screenshot="$3" "file://$DIR/scene.html?f=$1&lang=$2&w=${4%,*}&h=${4#*,}"; }

for lang in zh en; do
  for f in 1 2 3 4 5 6 7 8 9; do
    render $f $lang "$OUT/$lang-iphone-$f.png" 1242,2688     # iPhone 6.5"
    render $f $lang "$OUT/$lang-ipad-$f.png"   2064,2752     # iPad 13"
    render $f $lang "$OUT/$lang-mac-$f.png"    2880,1800     # Mac App Store 16:10
    render $f $lang "$OUT/$lang-web-$f.png"    1280,800      # CWS / AMO
  done
done
echo "Rendered $(ls "$OUT"/*.png | wc -l | tr -d ' ') screenshots to $OUT"

# 帧 10（系统翻译）**只渲 iPhone 尺寸**：原料只有 phone 档。
# iPad 拍不到（没有 iPad 硬件，模拟器里没有 TranslationUIProvider 这个扩展点）；
# Mac 根本没有这个功能；扩展两店不放 App 独有的东西。
for lang in zh en; do
  [ -f "$DIR/assets/$lang-phone-systrans.png" ] || { echo "跳过 f=10（缺 $lang-phone-systrans.png）"; continue; }
  render 10 $lang "$OUT/$lang-iphone-10.png" 1242,2688
  # web 档（1280×800）**只给官网**，不给扩展两店。这不是靠自觉：CWS / AMO 与 ASC
  # 都按 asc-media.js 的 ORDER_GLOBAL / ORDER_CN 逐帧取图，而 10 不在那两张表里
  # （见 asc-media.js 的「按构造排除」一段）—— 多出这个文件漏不进商店。
  render 10 $lang "$OUT/$lang-web-10.png"    1280,800
done
