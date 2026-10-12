#!/bin/bash
# 代办（默认关闭，host-exec.json 里 enabled:false；用户看完录屏单独下令后才由监督助手打开）：
# store-release 第 2 步（归档）→ 第 3 步（包体自查）→ 第 4 步（本地导出 + API key 上传 TestFlight）→ asc.js builds 回读。
# 不做：bind（挂版本）、asc-submit（提审）、cws/amo（扩展）、gh-release、推送。
source /Users/belliedmonkey/dsh-plugins/release1194/hostexec5/common.sh
unset NODE_OPTIONS   # SKILL 4：env -u NODE_OPTIONS
umask 022   # 代办环境默认 umask 077 → codesign 写出 600 的 CodeResources，Mac pkg 被 altool 90255 拒
cd "$WS" || exit 3
preflight
[ -z "$(git -C "$WS" status --porcelain --untracked-files=normal | grep -v ' \.dsh-bridge-git/$')" ] || die "工作区不干净：先提交，归档必须对应一个提交"
# build 号：store-release 0.1 —— 新号 = ASC 上该平台当前最大值 + 1。打开本代办前由监督助手按当时的 asc.js builds 读数改这里。
LINES=( "intl-ios|167" "intl-mac|115" "cn-ios|110" "cn-mac|108" )
[ "$(git -C "$WS" rev-parse HEAD)" != "$BASE" ] || die "HEAD 还是 $BASE：第 5 轮修复还没提交，归档必须对应一个提交"
# 第 3/4 轮门：① 验收结论文件（dsh 自动化验收写）必须 pass:true；② build 号必须 = ASC 该线当前最大号 + 1。
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(j.pass!==true){console.log("accept pass!=true");process.exit(1)}' "$WS/.local/accept5/result.json" || die "验收结论 .local/accept5/result.json 不是 pass:true"
ASCOUT=$(node scripts/asc.js builds 2>&1 | grep -viE 'apikey|api key|token|bearer|issuer|private')
maxof(){ echo "$ASCOUT" | awk -v app="($1)" -v plat="$2" '/^■/{cur=index($0,app)>0} cur && $2==plat && $3=="build"{if($4+0>m)m=$4+0} END{print m+0}'; }
for spec in "${LINES[@]}"; do IFS='|' read -r n bn <<< "$spec"
  case $n in intl-ios) want=$(( $(maxof com.belliedmonkeytranslator IOS) + 1 ));; intl-mac) want=$(( $(maxof com.belliedmonkeytranslator MAC_OS) + 1 ));;
             cn-ios) want=$(( $(maxof com.belliedmonkeytranslator.cn IOS) + 1 ));; cn-mac) want=$(( $(maxof com.belliedmonkeytranslator.cn MAC_OS) + 1 ));; esac
  [ "$bn" = "$want" ] || die "$n build 号 $bn ≠ ASC 最大号+1（$want）"; echo "$n build $bn = ASC 最大+1 ✓"
done
OUT=/tmp/r1194-r5; mkdir -p "$OUT"
run build-global node build.js || exit 1
run build-china node build.js --flavor china || exit 1
run app-sync npm run app:sync || exit 1
pbxcheck
P="safari-project/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj"
C="safari-project-china/BelliedMonkey Translator CN/BelliedMonkey Translator CN.xcodeproj"
cat > "$OUT/export-local.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>export</string>
<key>teamID</key><string>X2Q85MABWK</string>
<key>uploadSymbols</key><true/>
<key>signingStyle</key><string>automatic</string>
</dict></plist>
PLIST
KI=$(node -e "process.stdout.write(require('./scripts/lib/asc-client.js').slot('ascKeyId')||'')" 2>/dev/null)
II=$(node -e "process.stdout.write(require('./scripts/lib/asc-client.js').slot('ascIssuerId')||'')" 2>/dev/null)
KP=$(node -e "process.stdout.write((require('./scripts/lib/asc-client.js').slot('ascKeyPath')||'').replace(/^~/,process.env.HOME))" 2>/dev/null)
[ -n "$KI" ] && [ -n "$II" ] && [ -f "$KP" ] || die "ASC 凭据槽位不全（不打印内容）"
mkdir -p ~/.appstoreconnect/private_keys; [ -f ~/.appstoreconnect/private_keys/AuthKey_${KI}.p8 ] || cp "$KP" ~/.appstoreconnect/private_keys/AuthKey_${KI}.p8
for spec in "${LINES[@]}"; do case "$spec" in *TBD) die "build 号未填";; esac; done
fail=0
for spec in "${LINES[@]}"; do
  IFS='|' read -r n bn <<< "$spec"
  case $n in intl-ios) proj=$P; scheme="BelliedMonkey Translator (iOS)"; plat=iOS; t=ios;;
             intl-mac) proj=$P; scheme="BelliedMonkey Translator (macOS)"; plat=macOS; t=macos;;
             cn-ios) proj=$C; scheme="BelliedMonkey Translator CN (iOS)"; plat=iOS; t=ios;;
             cn-mac) proj=$C; scheme="BelliedMonkey Translator CN (macOS)"; plat=macOS; t=macos;; esac
  ar="$OUT/$n.xcarchive"; ex="$OUT/out-$n"; rm -rf "$ar" "$ex"
  TAILN=3 run "archive-$n" xcodebuild -project "$proj" -scheme "$scheme" -configuration Release -destination "generic/platform=$plat" -archivePath "$ar" DEVELOPMENT_TEAM=X2Q85MABWK CURRENT_PROJECT_VERSION=$bn -allowProvisioningUpdates archive || { fail=1; continue; }
  app=$(ls -d "$ar"/Products/Applications/*.app | head -1)
  if [ -d "$app/Contents" ]; then pl="$app/Contents/Info.plist"; else pl="$app/Info.plist"; fi
  chmod -R a+rX "$app"; nr=$(find "$app" ! -perm -o=r | wc -l | tr -d " "); echo "$n 非全员可读文件数=$nr"; [ "$nr" = 0 ] || { fail=1; continue; }
  echo "$n archive: version=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$pl") build=$(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$pl") bundle=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$pl")"
  codesign -d --entitlements :- "$app" 2>/dev/null | plutil -convert json -o - -- - 2>/dev/null | grep -oE 'applesignin|app-sandbox|audio-input' | sort -u | tr '\n' ' '; echo
  TAILN=3 run "export-$n" xcodebuild -exportArchive -archivePath "$ar" -exportOptionsPlist "$OUT/export-local.plist" -exportPath "$ex" || { fail=1; continue; }
  pkg=$(ls "$ex"/*.ipa "$ex"/*.pkg 2>/dev/null | head -1); [ -n "$pkg" ] || { echo "$n 导出产物不存在"; fail=1; continue; }
  TAILN=4 run "upload-$n" xcrun altool --upload-app -f "$pkg" -t $t --apiKey "$KI" --apiIssuer "$II"
  grep -q "No errors uploading" "$(ls -t "$HX"/logs/*-upload-$n.log | head -1)" && echo "$n UPLOAD OK" || { echo "$n UPLOAD 未见 No errors uploading"; fail=1; }
done
node scripts/asc.js builds 2>&1 | grep -viE 'apikey|api key|token|bearer|issuer|private' | head -60
exit $fail
