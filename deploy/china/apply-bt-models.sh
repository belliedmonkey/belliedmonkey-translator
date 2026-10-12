#!/usr/bin/env bash
# deploy/china/apply-bt-models.sh — 上「模型按 IP 选源」那一层（2026-10-08，用户裁定）。
#
# 为什么是**就地定点插入**而不是整份同步：仓库里这份 `deploy/china/Caddyfile` 与服务器上那份
# **已经双向漂移**（服务器多 `/models/silero_vad.onnx` 与 `/diag-audio/*` 两块，仓库多几段注释块）——
# 2026-10-08 干跑时 diff 抓到的。整份覆盖会悄悄抹掉线上那一侧，所以只做「缺什么补什么」，
# 与既有的 `apply-models-relay.sh` 同一个路子。
#
# 四件事，件件回读：
#   ① 同步 supabase/functions/bt-models/（服务代码 + 文件清单 + CN 段表）
#   ② docker-compose 里补一个 bt-models 容器（已存在就跳过）
#   ③ Caddyfile 里补一条 handle /models/speechbrain-ecapa-voxlingua107.zip（已存在就跳过）
#      —— 其余既有 handle **一个字不动**
#   ④ 热重载 + 逐条回读四个（现在五个）/models/* 的 302
#
#   bash deploy/china/apply-bt-models.sh            # 干跑：只打印要做什么、并 diff 出要插入的内容
#   bash deploy/china/apply-bt-models.sh --apply    # 真做
set -euo pipefail

HOST="${BT_HOST:-root@49.233.0.7}"
KEY="${BT_KEY:-$HOME/.ssh/tencent_bt.key}"
DIR="${BT_DIR:-/opt/bt/deploy/china}"
FN_DIR="${BT_FN_DIR:-/opt/bt/supabase/functions}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APPLY="${1:-}"
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new "$HOST")

say() { printf '\n===== %s =====\n' "$1"; }
run() { if [ "$APPLY" = "--apply" ]; then "$@"; else echo "  [干跑] $*"; fi; }

say "① 同步 bt-models 目录 → $FN_DIR/bt-models"
run "${SSH[@]}" "mkdir -p $FN_DIR"
run scp -i "$KEY" -o IdentitiesOnly=yes -r "$REPO/supabase/functions/bt-models" "$HOST:$FN_DIR/"

say "② docker-compose：补 bt-models 容器（已存在即跳过）"
if "${SSH[@]}" "grep -q '^  bt-models:' $DIR/docker-compose.yml"; then
  echo "  已存在，跳过"
else
  run "${SSH[@]}" "cp $DIR/docker-compose.yml $DIR/docker-compose.yml.bak-\$(date +%F-%H%M) && python3 - <<'PY'
p='$DIR/docker-compose.yml'
s=open(p).read()
block = '''  bt-models:
    image: denoland/deno:alpine-2.1.4
    restart: unless-stopped
    working_dir: /app
    volumes:
      - ../../supabase/functions/bt-models:/app:ro
    command: [\"run\", \"--allow-net\", \"--allow-read\", \"index.ts\"]
    expose:
      - \"8000\"

'''
anchor = '  grant:\n    image: denoland/deno:alpine-2.1.4'
assert anchor in s, '锚点不在（grant 服务）'
s = s.replace(anchor, block + anchor, 1)
open(p,'w').write(s)
print('  已插入 bt-models 服务块')
PY"
fi

say "③ Caddyfile：补一条 handle（已存在即跳过）"
if "${SSH[@]}" "grep -q 'models/speechbrain-ecapa-voxlingua107.zip' $DIR/Caddyfile"; then
  echo "  已存在，跳过"
else
  run "${SSH[@]}" "cp $DIR/Caddyfile $DIR/Caddyfile.bak-\$(date +%F-%H%M) && python3 - <<'PY'
p='$DIR/Caddyfile'
s=open(p).read()
anchor = '\t\thandle /models/silero_vad.onnx {'
assert anchor in s, '锚点不在（silero_vad 那条 handle）'
block = '''\t\t# ── 语种识别包走**按 IP 选源**（2026-10-08，用户裁定）─────────────────────────
\t\t# 中国 IP → ModelScope；其它 → Hugging Face 原站。判据只在服务端：这里把**真实对端 IP**
\t\t# 用 header_up X-Real-IP **覆盖**写进去（客户端自带的 X-Forwarded-For 会被覆盖，不可伪造）。
\t\t# 其余既有 handle 一个字不动。
\t\thandle /models/speechbrain-ecapa-voxlingua107.zip {
\t\t\treverse_proxy bt-models:8000 {
\t\t\t\theader_up X-Real-IP {http.request.remote.host}
\t\t\t}
\t\t}
'''
i = s.index(anchor)
# 插在 silero_vad 那一整块之后
j = s.index('}', s.index('redir', i)) + 1
s = s[:j] + '\n' + block + s[j:]
open(p,'w').write(s)
print('  已在 silero_vad 之后插入 ecapa handle')
PY"
fi

say "④ 起容器 + 热重载 + 逐条回读"
if [ "$APPLY" = "--apply" ]; then
  "${SSH[@]}" "cd $DIR && docker compose up -d bt-models 2>&1 | tail -3 && docker compose exec -T proxy caddy reload --config /etc/caddy/Caddyfile 2>&1 | tail -3"
else
  echo "  [干跑] docker compose up -d bt-models && caddy reload"
fi
echo "  --- 五个 /models/* 逐个回读 ---"
for f in vits-mms-tha.zip kokoro-zh-en.zip sherpa-onnx-whisper-tiny.zip silero_vad.onnx speechbrain-ecapa-voxlingua107.zip; do
  if [ "$APPLY" = "--apply" ]; then
    out=$(curl -s -o /dev/null -D - -I "https://api.belliedmonkey.com/models/$f" | tr -d '\r' | awk 'NR==1||tolower($1)=="location:"' | tr '\n' ' ')
    printf '    %-42s → %s\n' "$f" "$out"
  else
    echo "  [干跑] curl -I https://api.belliedmonkey.com/models/$f"
  fi
done
echo
echo "  期望：前四条与改动前**逐字相同**；只有第五条 ecapa 走 bt-models（本机在中国 ⇒ modelscope）。"
echo "  另测备源与选源："
echo "    curl -sI 'https://api.belliedmonkey.com/models/speechbrain-ecapa-voxlingua107.zip?src=other'   # 应 302 到 huggingface"
