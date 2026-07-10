#!/bin/bash
# build-safari.sh — 一键构建并生成 Safari iOS Xcode 项目
# 在 Mac 上运行：
#   bash build-safari.sh          # 海外版(global) → com.belliedmonkeytranslator
#   bash build-safari.sh china    # 中国版(china)  → com.belliedmonkeytranslator.cn
#
# 两个 flavor 生成两个独立的 Xcode 项目 / bundle id —— 对应两个 App Store app 记录
# (App Store 一个 app 记录只能对所有区发同一个二进制,合规隔离必须双分发)。

set -e

FLAVOR="${1:-global}"
if [ "$FLAVOR" != "global" ] && [ "$FLAVOR" != "china" ]; then
  echo "❌ 未知 flavor：$FLAVOR（可选 global | china）"
  exit 1
fi

DISPLAY_NAME="大肚猴翻译"              # what shows on the iOS home screen (both flavors)
if [ "$FLAVOR" = "china" ]; then
  APP_NAME="BelliedMonkey Translator CN"        # Xcode app/target (distinct DerivedData)
  BUNDLE_ID="com.belliedmonkeytranslator.cn"
  DIST="$(pwd)/dist-china"
  SAFARI_PROJECT="$(pwd)/safari-project-china"
  BUILD_CMD="node build.js --flavor china"
else
  APP_NAME="BelliedMonkey Translator"           # English brand name (Xcode app/target)
  BUNDLE_ID="com.belliedmonkeytranslator"
  DIST="$(pwd)/dist"
  SAFARI_PROJECT="$(pwd)/safari-project"
  BUILD_CMD="node build.js"
fi

echo ""
echo "🌿 构建 Safari iOS 翻译插件（flavor: $FLAVOR → $BUNDLE_ID）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 检查依赖
if ! command -v node &>/dev/null; then
  echo "❌ 未找到 Node.js，请先安装：https://nodejs.org"
  exit 1
fi

# safari-web-extension-converter 只随【完整版 Xcode】提供，Command Line Tools 没有。
# 注意：CLT 也带 xcrun，所以光检查 xcrun 会误判通过、然后在转换那步莫名失败。
if ! xcrun --find safari-web-extension-converter &>/dev/null; then
  echo "❌ 找不到 safari-web-extension-converter（它只随完整版 Xcode 提供，CLT 没有）。"
  echo ""
  echo "   当前活动开发者目录： $(xcode-select -p 2>/dev/null)"
  echo ""
  echo "   修复步骤："
  echo "   1) 从 App Store 安装完整 Xcode（约 15GB）"
  echo "   2) 把活动开发者目录指向完整 Xcode："
  echo "      sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  echo "   3) 首次需同意许可： sudo xcodebuild -license accept"
  echo "   4) 重新运行： bash build-safari.sh"
  exit 1
fi

# Step 1: 构建 web extension
echo ""
echo "▶ Step 1/3  构建扩展文件…"
$BUILD_CMD
echo ""

# Step 2: 转换为 Xcode 项目
echo "▶ Step 2/3  转换为 Safari Xcode 项目…"
if [ -d "$SAFARI_PROJECT" ]; then
  echo "   已存在 safari-project/，跳过转换（如需重新生成请先删除该目录）"
else
  xcrun safari-web-extension-converter "$DIST" \
    --project-location "$SAFARI_PROJECT" \
    --app-name "$APP_NAME" \
    --bundle-identifier "$BUNDLE_ID" \
    --ios-only \
    --no-open
  echo "   ✓ Xcode 项目生成完毕"

  # Post-process: home-screen name = 中文; extension bundle id prefixed under app id.
  PBX=$(find "$SAFARI_PROJECT" -name project.pbxproj | head -1)
  if [ -n "$PBX" ]; then
    sed -i '' "s/INFOPLIST_KEY_CFBundleDisplayName = [^;]*;/INFOPLIST_KEY_CFBundleDisplayName = \"$DISPLAY_NAME\";/g" "$PBX"
    sed -i '' "s/PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE_ID\.Extension;/PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE_ID.extension;/g" "$PBX"
    echo "   ✓ 显示名设为「$DISPLAY_NAME」,bundle id = $BUNDLE_ID(.extension)"
  fi
fi

# Step 3: 提示后续操作
XCODEPROJ=$(find "$SAFARI_PROJECT" -name "*.xcodeproj" | head -1)

echo ""
echo "▶ Step 3/3  在 Xcode 中完成安装"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Xcode 项目位置："
echo "   $XCODEPROJ"
echo ""
echo " 接下来的步骤："
echo ""
echo " 1. 用 Xcode 打开项目："
echo "    open \"$XCODEPROJ\""
echo ""
echo " 2. 设置签名（每个 Target 都要设置）："
echo "    左侧选 $APP_NAME → Signing & Capabilities"
echo "    Team → 选你的 Apple ID（Personal Team）"
echo "    同样设置 $APP_NAME Extension"
echo ""
echo " 3. 用数据线连接 iPhone，在顶部选择你的设备"
echo ""
echo " 4. 点击 ▶ Run（或按 ⌘R）"
echo ""
echo " 5. 手机上启用扩展："
echo "    设置 → Safari → 扩展 → 大肚猴翻译 → 打开"
echo "    → 允许访问所有网站"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 自动打开 Xcode（可选）
read -p "现在打开 Xcode 吗？[Y/n] " answer
if [[ "$answer" != "n" && "$answer" != "N" ]]; then
  open "$XCODEPROJ"
fi
