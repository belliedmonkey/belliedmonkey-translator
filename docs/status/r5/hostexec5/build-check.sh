#!/bin/bash
# 代办：三个 build + app:sync + 四个 Release 只编译（不签名、不归档、不上传）+ 包体自查（store-release 第 2、3 步的本地部分）。
source /Users/belliedmonkey/dsh-plugins/release1194/hostexec5/common.sh
cd "$WS" || exit 3
preflight
run build-global node build.js || exit 1
run build-china node build.js --flavor china || exit 1
run build-firefox node build.js firefox || exit 1
run app-sync npm run app:sync || exit 1
pbxcheck
P="safari-project/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj"
C="safari-project-china/BelliedMonkey Translator CN/BelliedMonkey Translator CN.xcodeproj"
fail=0
for spec in "intl-ios|$P|BelliedMonkey Translator (iOS)|iOS" "intl-mac|$P|BelliedMonkey Translator (macOS)|macOS" "cn-ios|$C|BelliedMonkey Translator CN (iOS)|iOS" "cn-mac|$C|BelliedMonkey Translator CN (macOS)|macOS"; do
  IFS='|' read -r n proj scheme plat <<< "$spec"
  TAILN=2 run "xc-$n" xcodebuild -project "$proj" -scheme "$scheme" -configuration Release -destination "generic/platform=$plat" -derivedDataPath ".local/r1194r5-dd-$n" CODE_SIGNING_ALLOWED=NO build || fail=1
done
[ $fail = 0 ] || exit 1
TAILN=8 run verify-ios-intl node scripts/verify-ios-bundle.js .local/r1194r5-dd-intl-ios || fail=1
TAILN=8 run verify-ios-cn node scripts/verify-ios-bundle.js .local/r1194r5-dd-cn-ios || fail=1
for n in intl-ios cn-ios; do fl=global; [ $n = cn-ios ] && fl=china
  app=$(ls -d "$WS"/.local/r1194r5-dd-$n/Build/Products/Release-iphoneos/*.app | head -1)
  TAILN=2 run "fresh-$n" node scripts/check-app-freshness.js "$app" $fl || fail=1
done
echo "== 包体自查（store-release 第 3 步）"
for n in intl-ios intl-mac cn-ios cn-mac; do
  d="$WS/.local/r1194r5-dd-$n/Build/Products"; app=$(ls -d "$d"/Release*/*.app | head -1)
  if [ -d "$app/Contents" ]; then pl="$app/Contents/Info.plist"; res="$app/Contents/Resources"; else pl="$app/Info.plist"; res="$app"; fi
  ver=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$pl"); bid=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$pl")
  mh=$(find "$app" -name Main.html -not -path '*.appex*' | head -1); msz=$( [ -n "$mh" ] && stat -f%z "$mh" || echo none)
  echo "$n version=$ver bundle=$bid Main.html=$msz"
done
for n in cn-ios cn-mac; do
  ext=$(find "$WS/.local/r1194r5-dd-$n/Build/Products" -name '*.appex' -path '*Extension*' | head -1); r="$ext"; [ -d "$ext/Contents/Resources" ] && r="$ext/Contents/Resources"
  echo "$n sync=$(grep -m1 -oE '^  enabled: [a-z]+' "$r/learn/backend.config.js" 2>/dev/null | tr -d ' ') brand-hits=$(grep -rlE 'ChatGPT|OpenAI|\bClaude\b|api\.openai\.com|api\.anthropic\.com' "$r" 2>/dev/null | wc -l | tr -d ' ') google-engine=$(grep -o '"id":"google"' "$r/content/providers.gen.js" 2>/dev/null | wc -l | tr -d ' ') default-deepseek=$(grep -c "provider: 'deepseek'" "$r/background.js" 2>/dev/null)"
done
exit $fail
