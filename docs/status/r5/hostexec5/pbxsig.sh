#!/bin/bash
# 签名（第 4 轮：swift/m/h 由 app/native 同步、属于可改代码，不进签名）：两棵 Safari 工程里所有「会被 xcodebuild 执行或决定构建行为」的文件，版本号行归一化。
cd "$1" || exit 2
find safari-project safari-project-china -type f \( -name '*.pbxproj' -o -name '*.xcscheme' -o -name '*.entitlements' -o -name '*.sh' -o -name '*.xcconfig' -o -name 'Info.plist' -o -name 'Package.swift' -o -name '*.plist' \) \
  -not -path '*/build/*' -not -path '*/xcuserdata/*' -not -path '*/.build/*' -not -path '*/Resources/*' 2>/dev/null | LC_ALL=C sort | while read -r f; do
  printf '%s ' "$f"; sed -E 's/(MARKETING_VERSION = )[0-9.]+;/\1X;/; s/(CURRENT_PROJECT_VERSION = )[0-9]+;/\1X;/' "$f" | shasum | cut -c1-16
done
