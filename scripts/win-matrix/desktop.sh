#!/usr/bin/env bash
# scripts/win-matrix/desktop.sh —— 一条命令跑 Windows **真机**（局域网里的台式机）这一行。
#
#   scripts/win-matrix/desktop.sh serve            # 只起文件服务（给台式机第一次跑 setup.ps1 用），Ctrl-C 结束
#   scripts/win-matrix/desktop.sh chrome|edge      # 推包 → 在台式机桌面会话里起浏览器 → 装载 + 整页翻译 → 语音 + 全屏 → YouTube 字幕
#
# 前提（一次性，见 .claude/skills/win-matrix/SKILL.md）：台式机跑过 setup.ps1；~/.ssh/config 里有 Host win-desktop；
# 私钥密码已进钥匙串（ssh-add --apple-use-keychain）。SSH 别名可用 MT_WIN_SSH 换。
set -euo pipefail
cd "$(dirname "$0")/../.."
HOST="${MT_WIN_SSH:-win-desktop}"; MODE="${1:-}"; PORT=8765; HERE=scripts/win-matrix
[ -n "$MODE" ] || { sed -n 2,9p "$0"; exit 2; }
WIN_IP="$(ssh -G "$HOST" | awk '/^hostname /{print $2}')"
MAC_IP="$(ipconfig getifaddr "$(route -n get "$WIN_IP" 2>/dev/null | awk '/interface:/{print $2}')")"
# 这台 Mac 的 shell 带着代理变量，Node 22 认 NODE_USE_ENV_PROXY：不清掉，连局域网地址都会被送去代理换回 503。
clean() { env -u NODE_USE_ENV_PROXY -u HTTP_PROXY -u http_proxy -u HTTPS_PROXY -u https_proxy -u ALL_PROXY "$@"; }
serve() {
  cp ~/.ssh/id_ed25519.pub "$HERE/mac.pub"   # gitignored；setup.ps1 从这里取公钥
  if ! curl -s --noproxy '*' -m 2 -o /dev/null "http://$MAC_IP:$PORT/page.html"; then
    (cd "$HERE" && nohup python3 -m http.server "$PORT" --bind 0.0.0.0 >/dev/null 2>&1 &) ; sleep 1
  fi
  curl -s --noproxy '*' -m 3 -o /dev/null -w "serving $HERE at http://$MAC_IP:$PORT/ → %{http_code}\n" "http://$MAC_IP:$PORT/page.html"
}
if [ "$MODE" = serve ]; then serve; echo "台式机管理员 PowerShell：\$u='http://$MAC_IP:$PORT'; irm \$u/setup.ps1 | iex"; exit 0; fi
case "$MODE" in chrome|edge) ;; *) echo "用法见文件头"; exit 2;; esac
[ -f dist/manifest.json ] || { echo "没有 dist/ —— 先 node build.js"; exit 1; }
serve
echo "== 推包 + 启动脚本"; ssh -T -o BatchMode=yes "$HOST" 'New-Item -ItemType Directory -Force C:\mt\dist | Out-Null'
scp -q -r dist/. "$HOST:C:/mt/dist/"; scp -q "$HERE/launch.ps1" "$HOST:C:/mt/launch.ps1"
echo "== 在桌面会话里起 $MODE"; ssh -T -o BatchMode=yes "$HOST" "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\mt\\launch.ps1 -Browser $MODE" | grep -vE 'post-quantum|store now|openssh.com/pq'
curl -s --noproxy '*' -m 5 "http://$WIN_IP:9223/json/version" | grep '"Browser"' || { echo "Mac 连不上 $WIN_IP:9223 —— 查 portproxy / 防火墙（SKILL.md 陷阱索引）"; exit 1; }
L="desktop-$MODE"
echo "== 装载 + 整页翻译";      MT_WIN_PAGE="http://$MAC_IP:$PORT/page.html" clean node "$HERE/chromium.js" "$WIN_IP" 9223 'C:\mt\dist' "$L" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(JSON.stringify({problems:j.problems,browser:j.browser,version:j.version,ms:j.translateMs,translations:(j.translations||[]).length,voices:(j.voices||[]).length,scrollbarPx:j.scrollbarPx}))})"
echo "== 语音 + 带真字幕的全屏"; clean node "$HERE/speech-fullscreen-chromium.js" "$WIN_IP" 9223 "$L" 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d.slice(d.indexOf('{\n')));const f=j.ytFullscreen||{};console.log(JSON.stringify({problems:j.problems,tts_zh:j['tts_zh-CN'],tts_en:j['tts_en-US'],subtitleWaitMs:j.subtitleWaitMs,enter:f.enter&&[f.enter.fullscreen,f.enter.overlayInside,f.enter.visible,f.enter.trans],later:f.later&&f.later.trans,exit:f.exit&&[f.exit.fullscreen,f.exit.overlay]},null,1))})"
echo "== YouTube 字幕（带广告处理）"; clean node "$HERE/yt-subtitles.js" "$WIN_IP" 9223 | grep -E '跳过|广告结束|真字幕|仍无|^\{"skips"' | cut -c1-200
echo "结果在 .local/win/$L*.json"
