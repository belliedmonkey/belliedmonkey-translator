#!/bin/bash
# deploy/china/backup.sh — 每天一次整库备份，留最近 14 份（README §6）。
#
# ⚠️ 备份和数据库在**同一台机器**上 —— 它防的是「误删 / 升级坏了」，防不了「机器没了」。
#    异机副本还没做；README §6 的季度恢复演练才是判据，备份文件存在 ≠ 能恢复。
set -euo pipefail
D=/opt/bt/backups; mkdir -p "$D"; chmod 700 "$D"
cd /opt/bt/deploy/china
f="$D/bt-$(date +%F).dump"
docker compose exec -T db pg_dump -U postgres -Fc postgres > "$f.tmp" && mv "$f.tmp" "$f"
[ -s "$f" ] || { echo "$(date -Is) backup EMPTY" >> /var/log/bt-backup.log; exit 1; }
echo "$(date -Is) ok $(stat -c %s "$f") bytes" >> /var/log/bt-backup.log
ls -1t "$D"/bt-*.dump | tail -n +15 | xargs -r rm -f
