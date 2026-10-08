#!/usr/bin/env bash
# 刷新中国 IP 段表（ipdeny 聚合版）。它是**判据数据**，不是代码：建议每月跑一次并提交。
# 为什么用这个表而不是 GeoIP 库：Caddy 是 stock 镜像（没有 geoip 模块），自己维护一份 CIDR 表
# 不需要额外账号/许可，且判据看得见、可回读。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY
curl -fsS --max-time 90 -o "$DIR/cn-cidrs.txt.tmp" "https://www.ipdeny.com/ipblocks/data/aggregated/cn-aggregated.zone"
mv "$DIR/cn-cidrs.txt.tmp" "$DIR/cn-cidrs.txt"
echo "cn-cidrs.txt 已刷新：$(wc -l < "$DIR/cn-cidrs.txt" | tr -d ' ') 条"
