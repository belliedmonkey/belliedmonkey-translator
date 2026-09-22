#!/bin/bash
# 打腾讯云 Web 函数的代码包：bt-relay/index.ts → relay.mjs（deno bundle），加垫片与启动脚本。
# 用法：deploy/china-relay/build-scf.sh [输出目录]   → <输出目录>/bt-relay-scf.zip
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/deploy/china-relay/.out}"
W="$(mktemp -d)"
deno bundle -q -o "$W/relay.mjs" "$ROOT/supabase/functions/bt-relay/index.ts"
cp "$ROOT/deploy/china-relay/scf/"{deno-shim.mjs,main.mjs,scf_bootstrap} "$W/"
chmod 755 "$W/scf_bootstrap"
mkdir -p "$OUT"
rm -f "$OUT/bt-relay-scf.zip"
(cd "$W" && zip -qX "$OUT/bt-relay-scf.zip" relay.mjs deno-shim.mjs main.mjs scf_bootstrap)
rm -rf "$W"
echo "$OUT/bt-relay-scf.zip"
