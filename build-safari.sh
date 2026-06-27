#!/bin/bash
# build-safari.sh — 一键构建并生成 Safari iOS Xcode 项目
# 在 Mac 上运行：bash build-safari.sh

set -e

APP_NAME="MobileTranslator"
DIST="$(pwd)/dist"
SAFARI_PROJECT="$(pwd)/safari-project"

echo ""
echo "🌿 构建 Safari iOS 翻译插件"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 检查依赖
if ! command -v node &>/dev/null; then
  echo "❌ 未找到 Node.js，请先安装：https://nodejs.org"
  exit 1
fi

if ! command -v xcrun &>/dev/null; then
  echo "❌ 未找到 xcrun，请先安装 Xcode Command Line Tools："
  echo "   xcode-select --install"
  exit 1
fi

# Step 1: 构建 web extension
echo ""
echo "▶ Step 1/3  构建扩展文件…"
node build.js
echo ""

# Step 2: 转换为 Xcode 项目
echo "▶ Step 2/3  转换为 Safari Xcode 项目…"
if [ -d "$SAFARI_PROJECT" ]; then
  echo "   已存在 safari-project/，跳过转换（如需重新生成请先删除该目录）"
else
  xcrun safari-web-extension-converter "$DIST" \
    --project-location "$SAFARI_PROJECT" \
    --app-name "$APP_NAME" \
    --bundle-identifier "com.mobiletranslator.app" \
    --ios-only \
    --no-open
  echo "   ✓ Xcode 项目生成完毕"
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
echo "    左侧选 MobileTranslator → Signing & Capabilities"
echo "    Team → 选你的 Apple ID（Personal Team）"
echo "    同样设置 MobileTranslator Extension"
echo ""
echo " 3. 用数据线连接 iPhone，在顶部选择你的设备"
echo ""
echo " 4. 点击 ▶ Run（或按 ⌘R）"
echo ""
echo " 5. 手机上启用扩展："
echo "    设置 → Safari → 扩展 → MobileTranslator → 打开"
echo "    → 允许访问所有网站"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 自动打开 Xcode（可选）
read -p "现在打开 Xcode 吗？[Y/n] " answer
if [[ "$answer" != "n" && "$answer" != "N" ]]; then
  open "$XCODEPROJ"
fi
