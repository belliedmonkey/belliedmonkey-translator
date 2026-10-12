#!/bin/bash
# 代办：npm run test:smoke（真实 Chrome + CDP；dsh 沙箱里 Chrome 起不来）。
source /Users/belliedmonkey/dsh-plugins/release1194/hostexec5/common.sh
cd "$WS" || exit 3
preflight
TAILN=40 run test-smoke npm run test:smoke
