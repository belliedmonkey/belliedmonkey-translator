#!/usr/bin/env bash
# scripts/main-first-user-visible-scan.sh — BEL-125
#
# 自动扫：上一正式上架 tip（BASE）上的用户可见标记，在 MAIN 上是否还在。
# 替代纯人工 git grep「主干先行」形检。
#
# 用法：
#   bash scripts/main-first-user-visible-scan.sh <BASE_RFS_TIP> [MAIN_REF]
#
# MAIN_REF 默认 origin/main（解析成 commit）。
# 输出：
#   docs/status/main-first-scan-<BASE8>-vs-<MAIN8>.md
#
# 退出码：参数或 SHA 不对 → 2。写完收据 → 0。
# MISSING / 非祖先 不让脚本失败：收据本身就是质量闸要的证。
# **缺这份收据 = BLOCKED**（提审 / marketing 落条宣称「上架过 IA 已在 main」时）。

set -euo pipefail

usage() {
  echo "usage: bash scripts/main-first-user-visible-scan.sh BASE_RFS_TIP [MAIN_REF]" >&2
  echo "  MAIN_REF defaults to origin/main" >&2
  exit 2
}

[ $# -ge 1 ] && [ $# -le 2 ] || usage

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

MAIN_REF="${2:-origin/main}"

if ! BASE=$(git rev-parse --verify "${1}^{commit}" 2>/dev/null); then
  echo "not a commit: $1" >&2
  usage
fi
if ! MAIN=$(git rev-parse --verify "${MAIN_REF}^{commit}" 2>/dev/null); then
  echo "not a commit: $MAIN_REF" >&2
  usage
fi
BASE8=${BASE:0:8}
MAIN8=${MAIN:0:8}

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
  git grep -I -F -q -e "$3" "$1" -- "$2"
}

file_exists() {
  git cat-file -e "$1:$2" 2>/dev/null
}

subj() {
  git log -1 --format='%s' "$1"
}

ANCESTOR=no
if git merge-base --is-ancestor "$BASE" "$MAIN" 2>/dev/null; then
  ANCESTOR=yes
fi

OUT="docs/status/main-first-scan-${BASE8}-vs-${MAIN8}.md"
mkdir -p docs/status

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

n_present=0
n_missing=0
n_new=0
n_absent=0
n_base_present=0
n_base_present_on_main=0

while IFS='|' read -r id label path marker; do
  [ -n "$id" ] || continue
  base_hit=0
  main_hit=0
  if has_marker "$BASE" "$path" "$marker"; then base_hit=1; fi
  if has_marker "$MAIN" "$path" "$marker"; then main_hit=1; fi
  if [ "$base_hit" -eq 1 ]; then
    n_base_present=$((n_base_present + 1))
    if [ "$main_hit" -eq 1 ]; then
      n_base_present_on_main=$((n_base_present_on_main + 1))
    fi
  fi
  if [ "$base_hit" -eq 1 ] && [ "$main_hit" -eq 1 ]; then
    status=PRESENT
    n_present=$((n_present + 1))
  elif [ "$base_hit" -eq 1 ]; then
    status=MISSING
    n_missing=$((n_missing + 1))
  elif [ "$main_hit" -eq 1 ]; then
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

FILES=$(printf '%s\n' "$MARKERS" | cut -d'|' -f3 | sort -u)

{
  echo "# Main-first user-visible scan \`${BASE8}\` vs \`${MAIN8}\`"
  echo
  echo "- Base (RFS tip): \`${BASE}\` — $(subj "$BASE")"
  echo "- Main ref: \`${MAIN_REF}\` → \`${MAIN}\` — $(subj "$MAIN")"
  echo "- Base is ancestor of Main: **${ANCESTOR}** (\`git merge-base --is-ancestor\`)"
  echo "- Generated: $(date -u +%Y-%m-%dT%H:%MZ) by \`scripts/main-first-user-visible-scan.sh\`"
  echo "- Checklist: \`docs/product/user-visible-checklist.md\`"
  echo "- Markers: \`scripts/lib/user-visible-markers.txt\`"
  echo
  echo "Counts: PRESENT ${n_present} · MISSING ${n_missing} · NEW ${n_new} · ABSENT ${n_absent}"
  echo "- Markers PRESENT on BASE: ${n_base_present}"
  echo "- Of those, also PRESENT on MAIN: ${n_base_present_on_main}"
  echo
  echo "Semantics match tip-user-visible-diff (BASE↔MAIN):"
  echo "- PRESENT = on BASE and on MAIN"
  echo "- MISSING = on BASE, gone on MAIN（上架过 IA 未进 main）"
  echo "- NEW = on MAIN only"
  echo "- ABSENT = neither"
  echo
  echo "**缺本收据 = BLOCKED**（宣称「上架过 IA 已在 main / 可 marketing 落条」的提审或打版路径）。"
  echo "脚本对 MISSING / 非祖先不 exit≠0；裁决在 QD / 形检。"
  echo
  echo "## Ancestry"
  echo
  if [ "$ANCESTOR" = yes ]; then
    echo "BASE is an ancestor of MAIN — tip lineage reaches main."
  else
    echo "BASE is **not** an ancestor of MAIN — shipped tip is off the main line;"
    echo "marker PRESENT/MISSING still reports content presence, but main-first"
    echo "形检 must treat this as a red flag until BASE (or its user-visible)"
    echo "lands on main."
  fi
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
  echo "| path | base | main |"
  echo "|---|---|---|"
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    b=absent
    m=absent
    if file_exists "$BASE" "$path"; then b=present; fi
    if file_exists "$MAIN" "$path"; then m=present; fi
    echo "| \`${path}\` | ${b} | ${m} |"
  done <<EOFFILES
$FILES
EOFFILES
  echo
  echo "File \`absent\` on main with markers MISSING = dropped surface not on main."
} > "$OUT"

echo "$OUT"
echo "ANCESTOR ${ANCESTOR} PRESENT ${n_present} MISSING ${n_missing} NEW ${n_new} ABSENT ${n_absent} BASE_PRESENT ${n_base_present} BASE_ON_MAIN ${n_base_present_on_main}"
