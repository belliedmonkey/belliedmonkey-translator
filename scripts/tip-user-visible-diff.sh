#!/usr/bin/env bash
# scripts/tip-user-visible-diff.sh — BEL-124
#
# 对照两个 tip 上的用户可见标记，写出一份收据。
# 标记表与 docs/product/user-visible-checklist.md 是同一批项。
# 路径取自仓库里真实文件（aac5a87d 上这些符号在，ecd8b8b4 上不在），
# 不写占位路径。
#
# 用法（仓库根目录，别处也行，脚本自己找到根）：
#   bash scripts/tip-user-visible-diff.sh <BASE_TIP> <HEAD_TIP>
#
# 输出：
#   docs/status/tip-user-visible-diff-<BASE8>-vs-<HEAD8>.md
#
# 退出码：参数或 SHA 不对 → 2。写完收据 → 0。
# MISSING 不让脚本失败：收据本身就是质量闸要的证，判 BLOCKED 的是人 / QD-JUDGE。

set -euo pipefail

usage() {
  echo "usage: bash scripts/tip-user-visible-diff.sh BASE_TIP HEAD_TIP" >&2
  exit 2
}

[ $# -eq 2 ] || usage

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

if ! BASE=$(git rev-parse --verify "${1}^{commit}" 2>/dev/null); then
  echo "not a commit: $1" >&2
  usage
fi
if ! HEAD=$(git rev-parse --verify "${2}^{commit}" 2>/dev/null); then
  echo "not a commit: $2" >&2
  usage
fi
BASE8=${BASE:0:8}
HEAD8=${HEAD:0:8}

# id | 清单名 | 路径 | 标记（git grep -F 的字面量）
# 路径均在 aac5a87d 上存在；D-02 一类标记在 ecd8b8b4 上不存在。
MARKERS=$(cat <<'EOF'
D-02|D-02 整体进度（细条）|src/app/AppShell.jsx|packs-dl-progress
D-02|D-02 整体进度（绘制）|src/app/shell-model.js|paintDlProgress
D-02|D-02 整体进度（% · 大小）|src/app/shell-model.js|firstrun_packs_progress_pct
D-02|D-02 整体进度（CTA 键）|src/app/shell-model.js|firstrun_packs_busy_pct
D-02|D-02 整体进度（CTA 文案 下载中 {n}%）|src/app/shell-model.js|下载中 {n}%
D-02|D-02 整体进度（汇总）|src/app/pack-progress.js|aggregatePackProgress
D-03|D-03 齐了就离开包屏|src/app/shell-model.js|dismissPacksAfterDone
N24-M01|N24 M-01 行右态|src/app/shell-model.js|N24 M-01
N24-M02|N24 M-02 文案锁|src/app/shell-model.js|N24 文案锁 M-02
N24-M03|N24 M-03 语言包与朗读|src/app/settings-view.jsx|N24 M-03
N24-M04|N24 M-04 高级参数|src/app/settings-view.jsx|N24 M-04
switch|一键⇄分项确认（设置）|src/app/settings-view.jsx|opt_mode_switch_to_quick
switch|一键⇄分项确认（选项页）|src/pages/options.jsx|opt_mode_switch_to_detail
P0-B|句子序 P0-B 新→旧（模型）|src/app/listen-model.js|P0-B
P0-B|句子序 P0-B 新→旧（视图）|src/app/listen-view.jsx|P0-B
captionDesk|字幕台 captionDesk|src/app/layout-caption.js|captionDesk
Duo-06|Duo-06 门控徽章|src/app/listen-view.jsx|Duo-06
Duo-08|Duo-08 安全区 +12|app/style.css|Duo-08
thai|泰语听译 thaiGrokStt（听译）|src/app/listen-model.js|thaiGrokStt
thai|泰语听译 thaiGrokStt（模块）|app/grok-stt.js|thaiGrokStt
thai|泰语听译国际包模块表|build/app-bundle.js|INTL_GROK_MODULES
thai-peel|泰语听译中国剥扫|build/china-gate.js|grok-stt-open
EOF
)

has_marker() {
  # $1 sha  $2 path  $3 marker
  git grep -I -F -q -e "$3" "$1" -- "$2"
}

file_exists() {
  git cat-file -e "$1:$2" 2>/dev/null
}

subj() {
  git log -1 --format='%s' "$1"
}

OUT="docs/status/tip-user-visible-diff-${BASE8}-vs-${HEAD8}.md"
mkdir -p docs/status

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

n_present=0
n_missing=0
n_new=0
n_absent=0

while IFS='|' read -r id label path marker; do
  [ -n "$id" ] || continue
  base_hit=0
  head_hit=0
  if has_marker "$BASE" "$path" "$marker"; then base_hit=1; fi
  if has_marker "$HEAD" "$path" "$marker"; then head_hit=1; fi
  if [ "$base_hit" -eq 1 ] && [ "$head_hit" -eq 1 ]; then
    status=PRESENT
    n_present=$((n_present + 1))
  elif [ "$base_hit" -eq 1 ]; then
    status=MISSING
    n_missing=$((n_missing + 1))
  elif [ "$head_hit" -eq 1 ]; then
    status=NEW
    n_new=$((n_new + 1))
  else
    status=ABSENT
    n_absent=$((n_absent + 1))
  fi
  printf '%s\t%s\t%s\t%s\t%s\n' "$status" "$id" "$label" "$path" "$marker" >> "$TMP"
done <<EOF
$MARKERS
EOF

# 热点文件：标记表里出现过的路径，文件本身在不在。
FILES=$(printf '%s\n' "$MARKERS" | cut -d'|' -f3 | sort -u)

{
  echo "# User-visible tip diff \`${BASE8}\` vs \`${HEAD8}\`"
  echo
  echo "- Base: \`${BASE}\` — $(subj "$BASE")"
  echo "- Head: \`${HEAD}\` — $(subj "$HEAD")"
  echo "- Generated: $(date -u +%Y-%m-%dT%H:%MZ) by \`scripts/tip-user-visible-diff.sh\`"
  echo "- Checklist: \`docs/product/user-visible-checklist.md\`"
  echo
  echo "Counts: PRESENT ${n_present} · MISSING ${n_missing} · NEW ${n_new} · ABSENT ${n_absent}"
  echo
  echo "MISSING means the marker is on the base tip and gone on the head tip."
  echo "A submit / marketing cut with MISSING rows needs a product card before it proceeds."
  echo "Silent drop is forbidden. \`QD-JUDGE-submit-*\` without this receipt is BLOCKED."
  echo
  for status in MISSING PRESENT NEW ABSENT; do
    echo "## ${status}"
    echo
    if ! grep -q "^${status}"$'\t' "$TMP"; then
      echo "(none)"
      echo
      continue
    fi
    echo "| id | item | path | marker |"
    echo "|---|---|---|---|"
    grep "^${status}"$'\t' "$TMP" | while IFS=$'\t' read -r _st id label path marker; do
      echo "| ${id} | ${label} | \`${path}\` | \`${marker}\` |"
    done
    echo
  done

  echo "## Hotspot files"
  echo
  echo "| path | base | head |"
  echo "|---|---|---|"
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    b=absent
    h=absent
    if file_exists "$BASE" "$path"; then b=present; fi
    if file_exists "$HEAD" "$path"; then h=present; fi
    echo "| \`${path}\` | ${b} | ${h} |"
  done <<EOF
$FILES
EOF
  echo
  echo "File \`absent\` on head with markers MISSING is a dropped surface."
  echo "File \`present\` on both with markers MISSING is a deletion inside a file that is still there."
} > "$OUT"

echo "$OUT"
echo "PRESENT ${n_present} MISSING ${n_missing} NEW ${n_new} ABSENT ${n_absent}"
