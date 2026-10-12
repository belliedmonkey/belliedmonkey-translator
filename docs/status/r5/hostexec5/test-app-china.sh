#!/bin/bash
# 代办：npm run test:app:china（会起无头 Chrome；dsh 沙箱里 Chrome 自己的沙箱初始化失败，所以放到沙箱外）。
source /Users/belliedmonkey/dsh-plugins/release1194/hostexec5/common.sh
cd "$WS" || exit 3
preflight
TAILN=40 run test-app-china npm run test:app:china
