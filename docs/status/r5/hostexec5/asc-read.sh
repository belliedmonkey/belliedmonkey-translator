#!/bin/bash
# 代办：ASC 只读查询（store-release 第 0.1 步）。凭据只在本脚本的 node 进程里用，不打印。
source /Users/belliedmonkey/dsh-plugins/release1194/hostexec5/common.sh
cd "$WS" || exit 3
preflight
case "$1" in builds|versions) ;; *) die "只允许 builds / versions";; esac
node scripts/asc.js "$1" 2>&1 | grep -viE 'apikey|api key|token|bearer|issuer|private' | head -80
