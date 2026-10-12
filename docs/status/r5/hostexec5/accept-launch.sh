#!/bin/bash
# 代办：退出同 bundle id 的 App，起 test:mac 编好的 Debug 包（带 __mtTest 端点），等端点通，端口写到 .local/accept5/port.txt。
source /Users/belliedmonkey/dsh-plugins/release1194/hostexec5/common.sh
cd "$WS" || exit 3
preflight
app=$(ls -d "$WS"/.local/mac-debug-dd/Build/Products/Debug/*.app 2>/dev/null | head -1); [ -n "$app" ] || die "没有 Debug 包：先跑 test-mac.sh"
osascript -e 'quit app id "com.belliedmonkeytranslator"' >/dev/null 2>&1; sleep 3
pkill -f "Build/Products/Debug/BelliedMonkey Translator.app/Contents/MacOS" 2>/dev/null; sleep 1
for i in 1 2 3; do open "$app" && break; sleep 2; done
for t in $(seq 1 60); do for p in $(seq 8790 8799); do
  if curl -s --noproxy '*' -m 1 "http://127.0.0.1:$p/ping" | grep -q '"mt-test"'; then echo "$p" > "$WS/.local/accept5/port.txt"; echo "ready port=$p app=$app"; exit 0; fi
done; sleep 1; done
die "60s 内端点不通"
