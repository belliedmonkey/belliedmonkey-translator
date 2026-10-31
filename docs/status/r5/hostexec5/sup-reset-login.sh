#!/bin/bash
# 监督方守望（不在白名单、不由 dsh 执行）：dsh 写 .local/accept5/REQUEST-RESET-<n> 后，
# 退出 App → 删整个 App 容器 → 起 Debug 包 → 测试账号邮箱验证码登录（otp-type 现铸并键入，不显示）→ 写 RESET-DONE-<n>。
A=~/dsh-plugins/release1194/wt5/.local/accept5; WS=~/dsh-plugins/release1194/wt5; LOG=~/dsh-plugins/release1194/accept5-sup.log
ev(){ curl -s --noproxy '*' -m 15 -X POST --data-binary "$1" "http://127.0.0.1:$(cat $A/port.txt)/eval"; }
for i in $(seq 1 2160); do   # 最多 6 小时
  for req in "$A"/REQUEST-RESET-*; do
    [ -e "$req" ] || continue; n=${req##*-}; [ -e "$A/RESET-DONE-$n" ] && continue
    echo "$(date '+%F %T') reset #$n start" >> $LOG
    osascript -e 'quit app id "com.belliedmonkeytranslator"' >/dev/null 2>&1; sleep 4
    pkill -f "BelliedMonkey Translator.app/Contents/MacOS/BelliedMonkey Translator"; sleep 2
    rm -rf ~/Library/Containers/com.belliedmonkeytranslator
    (cd "$WS" && bash ~/dsh-plugins/release1194/hostexec5/accept-launch.sh) >> $LOG 2>&1 || { echo '{"ok":false,"why":"launch"}' > "$A/RESET-DONE-$n"; continue; }
    sleep 6
    for attempt in 1 2; do
      ev 'document.getElementById("btn-signin").click(); "ok"' >/dev/null; sleep 1
      ev '(()=>{const e=document.getElementById("email"); e.focus(); e.value="belliedmonkey.en@gmail.com"; e.dispatchEvent(new Event("input",{bubbles:true})); document.getElementById("send").click(); return "sent"})()' >/dev/null
      for w in $(seq 1 20); do sleep 1; ev '(()=>{const e=document.getElementById("code");return !!(e&&!e.hidden&&e.getClientRects().length)})()' | grep -q true && break; done
      echo "$(date '+%T') attempt $attempt code-visible-after ${w}s" >> $LOG
      sleep 6   # 等 App 自己的发码请求落地再现铸，免得后到的那封把现铸的码顶掉
      env -u NODE_OPTIONS node ~/dsh-plugins/release1194/accept/otp-fill.js >> $LOG 2>&1; sleep 1
      ev 'document.getElementById("code-form").requestSubmit(); "v"' >/dev/null
      ok=0; for w in $(seq 1 40); do sleep 1; ev '(()=>{const v=id=>{const e=document.getElementById(id);return !!(e&&!e.hidden&&e.getClientRects().length)};return !v("signed-out")})()' | grep -q true && { ok=1; break; }; done
      [ $ok = 1 ] && { echo "$(date '+%T') attempt $attempt signed in after ${w}s" >> $LOG; break; }
      echo "$(date '+%T') attempt $attempt still at login gate; wait 65s (otp rate limit)" >> $LOG; sleep 65
    done
    st=$(ev 'JSON.stringify((()=>{const v=id=>{const e=document.getElementById(id);return !!(e&&!e.hidden&&e.getClientRects().length)};return {loginGate:v("btn-signin")||v("email"),packs:v("firstrun-packs")}})())')
    echo "$(date '+%F %T') reset #$n done $st" >> $LOG
    echo "{\"ok\":true,\"at\":\"$(date '+%F %T')\",\"state\":$st}" > "$A/RESET-DONE-$n"
  done
  sleep 10
done
