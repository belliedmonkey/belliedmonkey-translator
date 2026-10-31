#!/bin/bash
# 把 dsh 写在 .local/progress-dsh.txt 的新行追加进 release1194/progress-r5.txt（会话写不了 release1194/）。
S=/Users/belliedmonkey/dsh-plugins/release1194/wt5/.local/progress-dsh.txt; D=/Users/belliedmonkey/dsh-plugins/release1194/progress-r5.txt; M=/Users/belliedmonkey/dsh-plugins/release1194/hostexec5/logs/progress-synced
[ -f "$S" ] || { echo "no $S"; exit 0; }
n=$(cat "$M" 2>/dev/null || echo 0); t=$(wc -l < "$S" | tr -d ' ')
[ "$t" -gt "$n" ] && tail -n +$((n+1)) "$S" | sed 's/^/[dsh] /' >> "$D"; echo "$t" > "$M"; echo "synced $((t-n)) lines"
