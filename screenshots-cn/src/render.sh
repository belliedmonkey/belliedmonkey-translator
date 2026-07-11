#!/bin/bash
# Renders the App Store marketing screenshots for the China listing at exact
# device resolutions via headless Chrome. Run from repo root: bash screenshots-cn/src/render.sh
set -e
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/.."
render(){ "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size="$3" --screenshot="$2" "file://$DIR/$1"; }
render scene1-hero.html    "$OUT/cn-iphone-1-hero.png"    1242,2688
render scene2-engines.html "$OUT/cn-iphone-2-engines.png" 1242,2688
render scene1-hero.html    "$OUT/cn-ipad-1-hero.png"      2064,2752
render scene2-engines.html "$OUT/cn-ipad-2-engines.png"   2064,2752
echo "Rendered 4 screenshots to $OUT"
