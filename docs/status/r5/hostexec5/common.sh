#!/bin/bash
# 1.19.4 第 5 轮：dsh 自己修代码（fix/1194-r5，基于 371c4bf4）。禁区文件见 FORBID。沙箱外代办的公共前置检查（监督助手写，会话写不了这个目录）。任何一条不过就退出 3，不执行后面的命令。
WS=/Users/belliedmonkey/dsh-plugins/release1194/wt5
BASE=371c4bf4f0af4c0d67e243920bc608ac2a3bea78
BRANCH=fix/1194-r5
HX=/Users/belliedmonkey/dsh-plugins/release1194/hostexec5
unset NODE_OPTIONS
die(){ echo "HOSTEXEC-PREFLIGHT-FAIL: $*"; exit 3; }
FORBID='^(\.claude/|\.github/|scripts/(asc|cws|amo|gh-|seed-auth|lib/asc)|package\.json$|package-lock\.json$|extension/manifest\.json$|extension/content/providers\.gen\.js$|\.gitignore$|safari-project)'
preflight(){
  [ "$(pwd -P)" = "$WS" ] || die "工作目录不是 $WS"
  [ "$(git -C "$WS" rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] || die "分支不是 $BRANCH"
  git -C "$WS" merge-base --is-ancestor "$BASE" HEAD || die "HEAD 不在 $BASE 之后"
  local changed; changed=$( (git -C "$WS" diff --name-only "$BASE"; git -C "$WS" ls-files --others --exclude-standard) | sort -u | grep -v '^\.dsh-bridge-git/')
  local f ok a
  # 2026-10-12 用户批准：规约提交（本地分支 docs/conventions-digest）里的 .claude/skills 文档改动随第 5 轮一起提交；内容必须与该分支逐字一致才放行。
  local docf; for docf in $(echo "$changed" | grep -E '^\.claude/skills/[^/]+/(SKILL|assets)\.md$'); do
    if cmp -s "$WS/$docf" <(git -C "$WS" show "docs/conventions-digest:$docf" 2>/dev/null); then changed=$(echo "$changed" | grep -vxF "$docf"); fi
  done
  local bad0; bad0=$(echo "$changed" | grep -E "$FORBID"); [ -z "$bad0" ] || die "改动碰了禁区文件：$(echo $bad0)"
  local v; v=$(node -p "require('$WS/package.json').version")
  [ "$(node -p "require('$WS/extension/manifest.json').version")" = "$v" ] || die "manifest 与 package.json 版本不一致"
  echo "preflight ok: version=$v HEAD=$(git -C "$WS" rev-parse --short HEAD)"
}
pbxcheck(){
  bash "$HX/pbxsig.sh" "$WS" > "$HX/logs/pbxsig.now"
  diff -q "$HX/pbxsig.baseline" "$HX/logs/pbxsig.now" >/dev/null || { diff "$HX/pbxsig.baseline" "$HX/logs/pbxsig.now" | head -20; die "Safari 工程（pbxproj/scheme/entitlements/swift/plist）与基线不一致"; }
  local v; v=$(node -p "require('$WS/package.json').version")
  local mv; mv=$(grep -ho 'MARKETING_VERSION = [0-9.]*;' "$WS/safari-project/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj/project.pbxproj" "$WS/safari-project-china/BelliedMonkey Translator CN/BelliedMonkey Translator CN.xcodeproj/project.pbxproj" | sort -u)
  [ "$mv" = "MARKETING_VERSION = $v;" ] || die "两棵工程的 MARKETING_VERSION 不是 $v：$(echo $mv)"
  echo "pbxcheck ok"
}
run(){ # run <name> <cmd...>：全部输出进日志，屏幕只给结尾
  local name=$1; shift; local log="$HX/logs/$(date +%H%M%S)-$name.log"
  echo "== $name"; "$@" > "$log" 2>&1; local st=$?
  tail -${TAILN:-6} "$log"; echo "== $name exit=$st log=$log"; return $st
}
