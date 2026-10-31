#!/bin/bash
# 对在跑的 Debug App 求值：JS 取自 .local/accept5/eval.js，结果打印（截 20KB）。只发往 App 自己的测试端点。
WS=/Users/belliedmonkey/dsh-plugins/release1194/wt5
p=$(cat "$WS/.local/accept5/port.txt" 2>/dev/null); [ -n "$p" ] || { echo "no port (先跑 accept-launch.sh)"; exit 3; }
[ -f "$WS/.local/accept5/eval.js" ] || { echo "no eval.js"; exit 3; }
curl -s --noproxy '*' -m 30 -X POST --data-binary @"$WS/.local/accept5/eval.js" "http://127.0.0.1:$p/eval" | head -c 20000; echo
