#!/usr/bin/env bash
# deploy/china/apply-models-relay.sh — 一条命令把 /models/* 的 302 中继部署到腾讯机（#566/#565）。
#
# 用法（服务器上）：
#   curl -fsSL https://raw.githubusercontent.com/belliedmonkey/belliedmonkey-translator/feat/firstrun-gates/deploy/china/apply-models-relay.sh | bash
#
# 做四件事：备份 Caddyfile → 在 /functions/v1/* 块后插入两个 handle /models/*.zip → redir 302 →
# 热重载（docker compose exec proxy caddy reload）→ curl 验证回 302。幂等：已有 /models 块则只验证。
# 出任何问题：cp Caddyfile.bak-<日期> Caddyfile && docker compose exec proxy caddy reload --config /etc/caddy/Caddyfile
set -euo pipefail

DIR="${1:-/opt/bt/deploy/china}"
cd "$DIR"

STAMP=$(date +%F)
if ! grep -q '/models/' Caddyfile; then
  cp Caddyfile "Caddyfile.bak-$STAMP"
  python3 - <<'PY'
p = 'Caddyfile'
s = open(p).read()
anchor = 'handle_path /functions/v1/* {'
i = s.index(anchor)
depth = 0; j = i
while True:
    if s[j] == '{': depth += 1
    elif s[j] == '}': depth -= 1
    if depth == 0: break
    j += 1
ins = '''
		# ── 模型下载中继（2026-10-05，#565）：客户端只见 api.belliedmonkey.com，不见真实托管 ──
		handle /models/vits-mms-tha.zip {
			redir https://github.com/belliedmonkey/belliedmonkey-translator/releases/download/device-models-2/vits-mms-tha.zip 302
		}
		handle /models/kokoro-zh-en.zip {
			redir https://www.modelscope.cn/models/belliedmonkey/belliedmonkey-device-models/resolve/master/kokoro-zh-en.zip 302
		}
'''
open(p, 'w').write(s[:j+1] + ins + s[j+1:])
print('✓ 已插入 /models 块')
PY
  if docker compose version >/dev/null 2>&1; then
    docker compose exec -T proxy caddy reload --config /etc/caddy/Caddyfile
  else
    docker-compose exec -T proxy caddy reload --config /etc/caddy/Caddyfile
  fi
  echo '✓ Caddy 已热重载'
else
  echo '• /models 块已存在，跳过插入与重载'
fi

echo
echo '── 验证（期望两条都是 302 + location）──'
fail=0
for f in kokoro-zh-en.zip vits-mms-tha.zip; do
  echo "== $f =="
  curl -sI --max-time 10 "https://api.belliedmonkey.com/models/$f" | grep -iE '^HTTP|^location' || fail=1
done
[ "$fail" = 0 ] && echo '✓ 全部 302，中继修好了' || { echo '✗ 有不是 302 的 —— 回滚：'; echo "  cp $DIR/Caddyfile.bak-$STAMP $DIR/Caddyfile && docker compose exec -T proxy caddy reload --config /etc/caddy/Caddyfile"; exit 1; }
