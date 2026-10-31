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

# Markers: shared file (keep in sync with main-first-user-visible-scan.sh)
MARKERS_FILE="$ROOT/scripts/lib/user-visible-markers.txt"
if [ ! -f "$MARKERS_FILE" ]; then
  echo "missing markers file: $MARKERS_FILE" >&2
  exit 2
fi
MARKERS=$(grep -v '^#' "$MARKERS_FILE" | grep -v '^[[:space:]]*$' || true)
if [ -z "$MARKERS" ]; then
  echo "empty markers file: $MARKERS_FILE" >&2
  exit 2
fi

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
done <<EOFMARK
$MARKERS
EOFMARK

# 热点文件：标记表里出现过的路径，文件本身在不在。
FILES=$(printf '%s\n' "$MARKERS" | cut -d'|' -f3 | sort -u)

{
  echo "# User-visible tip diff \`${BASE8}\` vs \`${HEAD8}\`"
  echo
  echo "- Base: \`${BASE}\` — $(subj "$BASE")"
  echo "- Head: \`${HEAD}\` — $(subj "$HEAD")"
  echo "- Generated: $(date -u +%Y-%m-%dT%H:%MZ) by \`scripts/tip-user-visible-diff.sh\`"
  echo "- Checklist: \`docs/product/user-visible-checklist.md\`"
  echo "- Markers: \`scripts/lib/user-visible-markers.txt\`"
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
  done <<EOFFILES
$FILES
EOFFILES
  echo
  echo "File \`absent\` on head with markers MISSING is a dropped surface."
  echo "File \`present\` on both with markers MISSING is a deletion inside a file that is still there."
} > "$OUT"

echo "$OUT"
echo "PRESENT ${n_present} MISSING ${n_missing} NEW ${n_new} ABSENT ${n_absent}"
