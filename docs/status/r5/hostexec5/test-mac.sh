#!/bin/bash
# 代办：npm run test:mac（它自己重建带 __mtTest 的 Debug 包、起 App、跑 M1–M7；会退出同 bundle id 的 App；听译组自己静音、测完还原）。
source /Users/belliedmonkey/dsh-plugins/release1194/hostexec5/common.sh
cd "$WS" || exit 3
preflight
run app-sync npm run app:sync || exit 1
pbxcheck
V0=$(osascript -e 'get volume settings' 2>/dev/null)
TAILN=40 run test-mac npm run test:mac; st=$?
# test:mac 自己的静音还原在本机会失败（2026-10-11 两次实测）；测前是静音就只把静音设回去（不碰音量数值），并读回。
if echo "$V0" | grep -q 'output muted:true'; then osascript -e 'set volume with output muted'; fi
echo "volume before=[$V0] after=[$(osascript -e 'get volume settings' 2>/dev/null)]"
exit $st
