#!/usr/bin/env bash
# deploy/china/apply-models-relay.sh — /models/* 302 中继（v3：能修复 v1 劈坏的文件）。
#
# v1 的括号计数在起点 depth=0 就判「配对完成」，把插入点落在 anchor 第一个字符之后 ——
# `handle_path` 被劈成 `h` + 块 + `andle_path`，Caddy 报 unrecognized directive: h。
# v3 三条路：
#   ① 检测到损伤签名（孤行 h … andle_path）⇒ 把块挪回正确位置、拼回 anchor；
#   ② 没有 /models 块 ⇒ 全新插入（计数器已修：见过 { 才允许判配对）；
#   ③ 已正确 ⇒ 只重载。
# 之后永远：热重载 + 严格验证 302（200 判红）。
set -euo pipefail

DIR="${1:-/opt/bt/deploy/china}"
cd "$DIR"

# 只在要动文件前留备份（修复损伤 / 全新插入）；今天服务器上已有一份，不覆盖。
if ! grep -q '/models/' Caddyfile; then cp Caddyfile "Caddyfile.bak-$(date +%F)"; fi

python3 - <<'PY'
p = 'Caddyfile'
s = open(p).read()
MODELS = '\t\thandle /models/'

import re
INS = '''
		# ── 模型下载中继（2026-10-05，#565）：客户端只见 api.belliedmonkey.com，不见真实托管 ──
		handle /models/vits-mms-tha.zip {
			redir https://github.com/belliedmonkey/belliedmonkey-translator/releases/download/device-models-2/vits-mms-tha.zip 302
		}
		handle /models/kokoro-zh-en.zip {
			redir https://www.modelscope.cn/models/belliedmonkey/belliedmonkey-device-models/resolve/master/kokoro-zh-en.zip 302
		}
'''

# ── ① 修复 v1 的损伤：孤行 h …<坏块>… andle_path —— 丢弃坏块字节，确定性重建 ──
m = re.search(r'(?m)^([ \t]*)h[ \t]*$\n', s)
if m and 'andle_path /functions/v1/* {' in s:
    b = s.index('andle_path /functions/v1/* {')
    after = s[b + len('andle_path /functions/v1/* {'):]
    c = after.index('}')            # functions 块的闭合
    s = s[:m.start()] + m.group(1) + 'handle_path /functions/v1/* {' + after[:c+1] + INS + after[c+1:]
    open(p, 'w').write(s)
    print('✓ 已修复 v1 劈坏的插入（anchor 拼回、规范块重建）')
    raise SystemExit

# ── ② 全新插入 ──
if '/models/' not in s:
    anchor = 'handle_path /functions/v1/* {'
    i = s.index(anchor)
    depth = 0; j = i; seen = False
    while True:
        if s[j] == '{': depth += 1; seen = True
        elif s[j] == '}': depth -= 1
        if seen and depth == 0: break   # v1 的 bug：seen 之前不许判配对
        j += 1
    open(p, 'w').write(s[:j+1] + INS + s[j+1:])
    print('✓ 已插入 /models 块')
    raise SystemExit

print('• /models 块已在正确位置，无需改动')
PY

if docker compose version >/dev/null 2>&1; then
  docker compose exec -T proxy caddy reload --config /etc/caddy/Caddyfile
else
  docker-compose exec -T proxy caddy reload --config /etc/caddy/Caddyfile
fi
echo '✓ Caddy 已热重载'

echo
echo '── 验证（必须是 302 + location，200 不算过）──'
fail=0
for f in kokoro-zh-en.zip vits-mms-tha.zip; do
  echo "== $f =="
  h=$(curl -sI --max-time 10 "https://api.belliedmonkey.com/models/$f")
  echo "$h" | grep -iE '^HTTP|^location'
  echo "$h" | head -1 | grep -qE 'HTTP/[0-9.]+ 302' || fail=1
done
[ "$fail" = 0 ] && echo '✓ 全部 302，中继修好了' || { echo '✗ 有不是 302 的 —— 回滚：'; echo "  cp $DIR/Caddyfile.bak-* $DIR/Caddyfile && docker compose exec -T proxy caddy reload --config /etc/caddy/Caddyfile"; exit 1; }
