#!/bin/bash
# scripts/ensure-screen-awake.sh — 真机验证前的第一道检查：屏幕真的在显示吗？
#
# 为什么存在（2026-08-29 花了一小时的教训）：
# 屏保运行时 WebKit 会节流，不渲染。于是 WKWebView 的宿主 App 表现为：
#   · 窗口标题栏截得到（AppKit 画的）
#   · 网页内容一片空白
#   · 整屏截图只有壁纸，连别的 App 窗口都没有
#   · list_windows 仍报 is_on_screen:true —— 它只管几何，不管有没有真被画出来
# 当时据此得出「未签名 Debug 包白屏」的结论，还做了对照实验（旧包也白屏）
# 并把两次都归因成「包有问题」—— 而共同原因是「屏幕没在显示」。
# 一条会把环境问题伪装成产品缺陷的路，必须在跑任何截图/录像前先堵掉。
#
# 边界（重要）：屏保能自动解，**锁屏不能**。锁屏要密码，脚本给不了，
# 也不该给。所以这个脚本的契约是：能解的解掉，解不掉就**明确失败**，
# 绝不「看起来没问题」地继续 —— 那正是 §4 禁止的那种沉默。
#
# ⚠️ 别高估「自动解除」这一半的价值：
#   sysadminctl -screenLock status → 本机是 "delay is immediate"，
#   即屏保一起来就锁屏。这种设置下自动解除**永远走不通**，脚本必然落到
#   「请手动解锁」那一支。所以本脚本对我们的真实价值是**检测 + 大声失败**，
#   不是省掉那次解锁。把它当成「防止把环境问题误判成产品缺陷」的闸门，
#   而不是「无人值守的续命手段」。
#
# 用法：
#   bash scripts/ensure-screen-awake.sh          # 检查并尝试解除，失败则 exit 1
#   bash scripts/ensure-screen-awake.sh --check  # 只检查不动手

set -u
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

saver_running() {
  osascript -e 'tell application "System Events" to get running of screen saver preferences' 2>/dev/null
}

# 锁屏与屏保是两件事：屏保在跑不代表要密码，而锁屏时 loginwindow 会持有会话。
screen_locked() {
  python3 - <<'PY' 2>/dev/null
import subprocess, sys
try:
    out = subprocess.run(['ioreg','-n','Root','-d1'], capture_output=True, text=True, timeout=5).stdout
    print('yes' if '"CGSSessionScreenIsLocked" = Yes' in out else 'no')
except Exception:
    print('unknown')
PY
}

state=$(saver_running)
locked=$(screen_locked)

if [ "$state" != "true" ] && [ "$locked" != "yes" ]; then
  echo "✓ 屏幕在显示（屏保未运行、未锁屏）"
  exit 0
fi

echo "⚠️  屏幕没有在显示 —— 此时截图与录像都不可信"
[ "$state" = "true" ] && echo "    屏保: 运行中"
[ "$locked" = "yes" ] && echo "    锁屏: 是"

if [ "$CHECK_ONLY" = "1" ]; then exit 1; fi

if [ "$locked" = "yes" ]; then
  echo "✗ 锁屏需要密码，脚本无法解除，也不应当尝试。"
  echo "  请手动解锁后重跑验证 —— 不要在这个状态下截图取证。"
  exit 1
fi

echo "→ 尝试结束屏保…"
killall ScreenSaverEngine 2>/dev/null
sleep 2

if [ "$(saver_running)" = "true" ] || [ "$(screen_locked)" = "yes" ]; then
  echo "✗ 仍未恢复（可能屏保后需要密码）。请手动解锁后重跑。"
  exit 1
fi
echo "✓ 屏保已解除，屏幕恢复显示"
