#!/bin/bash
# build-safari.sh — 一键构建并生成/更新 Safari Xcode 项目
#
#   bash build-safari.sh                    # 海外版 iOS   → com.belliedmonkeytranslator
#   bash build-safari.sh china              # 中国版 iOS   → com.belliedmonkeytranslator.cn
#   bash build-safari.sh global macos       # 海外版 macOS  → 同一个 App 记录的 macOS 平台
#   BUILD_NUMBER=11 bash build-safari.sh global macos
#
# ⚠️ iOS 与 macOS 共用同一棵工程树。转换器出的工程本来就是双平台的（4 个 target、
#    两个 scheme），platform 参数只决定「给你哪条归档指引 + 写不写 macOS 专属的
#    Info.plist 键」，不再另生成 --macos-only 的树。
#    为什么：--macos-only 出的是扁平布局（没有 Shared (App)），而 app:sync 的四个补丁
#    全按双平台布局写死，于是它只会打印「未生成，跳过」然后什么都不做 —— 已上架的
#    macOS 1.4.1 (14) 因此带的是转换器 979 字节的模板页，不是我们的学习 App。
#   MT_SYNC=on bash build-safari.sh         # 自用 TestFlight 包（同步开关在产物中打开，
#                                           #  源码不动，Gate B 照守；见 build.js SYNC_ON）
#
# 两个 flavor 生成两个独立的 Xcode 项目 / bundle id —— 对应两个 App Store app 记录
# (App Store 一个 app 记录只能对所有区发同一个二进制,合规隔离必须双分发)。
# 同一 flavor 的 iOS 与 macOS 共用一个 app 记录、同一个 bundle id,但 build 号各自独立。
#
# ⚠️ 为什么这个脚本每次都要重设工程设置(而不是只在首次生成时设一次):
#    safari-project*/ 全部在 .gitignore 里,是纯本地状态。旧版脚本在工程已存在时
#    直接跳过全部后处理,于是工程里的 MARKETING_VERSION 永远停在 converter 给的 1.0,
#    而 package.json 一路涨到 1.2.0 —— 2026-07-29 发版时就是这么发现漂移的
#    (App Store 上显示 1.0,扩展内部是 1.2.0)。现在设置每次都重新写入。

set -e

# BSD sed 在非 UTF-8 locale 下遇到中文（显示名「大肚猴翻译」）会直接
# `RE error: illegal byte sequence` 而中断。显式锁定 locale，别依赖调用者的环境。
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export LANG="${LANG:-en_US.UTF-8}"

FLAVOR="${1:-global}"
PLATFORM="${2:-ios}"

if [ "$FLAVOR" != "global" ] && [ "$FLAVOR" != "china" ]; then
  echo "❌ 未知 flavor：$FLAVOR（可选 global | china）"; exit 1
fi
if [ "$PLATFORM" != "ios" ] && [ "$PLATFORM" != "macos" ]; then
  echo "❌ 未知 platform：$PLATFORM（可选 ios | macos）"; exit 1
fi

DISPLAY_NAME="大肚猴翻译"              # 主屏/程序坞显示名(两个 flavor 相同)
# App Store Connect 里的主类别是「工具」——macOS 上架强制要求 Info.plist 声明,
# 且必须与 ASC 的类别一致,否则审核会挑(缺失则直接上传失败 code 90242)。
APP_CATEGORY="public.app-category.utilities"

if [ "$FLAVOR" = "china" ]; then
  APP_NAME="BelliedMonkey Translator CN"
  BUNDLE_ID="com.belliedmonkeytranslator.cn"
  DIST="$(pwd)/dist-china"
  BUILD_CMD="node build.js --flavor china"
  PROJ_BASE="$(pwd)/safari-project-china"
else
  APP_NAME="BelliedMonkey Translator"
  BUNDLE_ID="com.belliedmonkeytranslator"
  DIST="$(pwd)/dist"
  BUILD_CMD="node build.js"
  PROJ_BASE="$(pwd)/safari-project"
fi

# 一个 flavor 一棵树，两个平台共用（见文件头的告示）。转换器不带平台参数时出的就是
# 双平台工程：target 有 (iOS) 与 (macOS) 两套，布局是 Shared (App) / iOS (App) /
# macOS (App) —— 也正是 scripts/sync-app-assets.js 的补丁认得的那个布局。
SAFARI_PROJECT="$PROJ_BASE"
CONVERTER_PLATFORM=""
if [ "$PLATFORM" = "macos" ] && [ -d "${PROJ_BASE}-macos" ]; then
  echo ""
  echo "⚠️  发现遗留的 $(basename "${PROJ_BASE}-macos")/ —— 那是 --macos-only 的扁平布局，"
  echo "    app:sync 打不了补丁（装出来的 App 是转换器模板页）。它是 gitignored 的一次性"
  echo "    产物，删掉即可：rm -rf ${PROJ_BASE}-macos"
fi

# 版本号的唯一真源是 package.json(build.js 已强制 manifest.json 与它一致)。
VERSION=$(node -p "require('./package.json').version")

echo ""
echo "🌿 Safari 扩展构建（flavor: $FLAVOR · platform: $PLATFORM · $BUNDLE_ID · v$VERSION）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"

command -v node &>/dev/null || { echo "❌ 未找到 Node.js：https://nodejs.org"; exit 1; }

# safari-web-extension-converter 只随【完整版 Xcode】提供，Command Line Tools 没有。
# 注意：CLT 也带 xcrun，所以光检查 xcrun 会误判通过、然后在转换那步莫名失败。
if ! xcrun --find safari-web-extension-converter &>/dev/null; then
  echo "❌ 找不到 safari-web-extension-converter（它只随完整版 Xcode 提供，CLT 没有）。"
  echo ""
  echo "   当前活动开发者目录： $(xcode-select -p 2>/dev/null)"
  echo ""
  echo "   修复步骤："
  echo "   1) 从 App Store 安装完整 Xcode（约 15GB）"
  echo "   2) sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  echo "   3) sudo xcodebuild -license accept"
  echo "   4) 重新运行本脚本"
  exit 1
fi

# ── Step 1: 构建 web extension ──────────────────────────────────────────
echo ""
echo "▶ Step 1/3  构建扩展文件…"
$BUILD_CMD
echo ""

# ── Step 2: 生成(首次)并【每次都重设】Xcode 工程设置 ────────────────────
echo "▶ Step 2/3  生成 / 更新 Safari Xcode 项目…"
if [ -d "$SAFARI_PROJECT" ]; then
  echo "   已存在 $(basename "$SAFARI_PROJECT")/ —— 保留签名配置，只重设下列设置"
else
  xcrun safari-web-extension-converter "$DIST" \
    --project-location "$SAFARI_PROJECT" \
    --app-name "$APP_NAME" \
    --bundle-identifier "$BUNDLE_ID" \
    $CONVERTER_PLATFORM \
    --no-open
  echo "   ✓ Xcode 项目生成完毕"
fi

PBX=$(find "$SAFARI_PROJECT" -name project.pbxproj | head -1)
[ -n "$PBX" ] || { echo "❌ 找不到 project.pbxproj"; exit 1; }

# 幂等地写一个 build setting：已存在就替换，不存在就插到 app target 的
# PRODUCT_BUNDLE_IDENTIFIER 之后（只认 app，不认 .extension）。
set_app_key() {
  local key="$1" val="$2"
  perl -0pi -e "s/^\\s*\Q$key\E = [^;]*;\\n//mg" "$PBX"
  perl -0pi -e "s/(PRODUCT_BUNDLE_IDENTIFIER = \"?\Q$BUNDLE_ID\E\"?;)/$key = $val;\n\t\t\t\t\$1/g" "$PBX"
}

# converter 的 --bundle-identifier 只作用于扩展；app 的 id 是从 app 名派生的
# （macOS 上会变成 com.BelliedMonkey-Translator）。不修就会被当成一个全新的 App，
# 而不是给现有 app 记录加平台。
perl -0pi -e 's/PRODUCT_BUNDLE_IDENTIFIER = "com\.[A-Za-z0-9-]+";/PRODUCT_BUNDLE_IDENTIFIER = '"$BUNDLE_ID"';/g' "$PBX"
# 扩展 id 统一小写 .extension（converter 给的是 .Extension）
sed -i '' "s/PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE_ID\.Extension;/PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE_ID.extension;/g" "$PBX"
# 主屏显示名（用 perl 而非 sed —— 这行含中文，BSD sed 对非 ASCII 更脆弱）
perl -0pi -e "s/INFOPLIST_KEY_CFBundleDisplayName = [^;]*;/INFOPLIST_KEY_CFBundleDisplayName = \"$DISPLAY_NAME\";/g" "$PBX"
# 版本号跟随 package.json
sed -i '' "s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = $VERSION;/g" "$PBX"
# 出口合规：本扩展不实现也不打包任何加密，仅通过系统提供的 HTTPS 调用翻译 API，
# 因此预先声明豁免，上传时不再弹「App 加密文稿」。
# ⚠️ 哪天真加了自有加密（本地缓存加密、请求签名等），必须回来改掉这一行。
set_app_key "INFOPLIST_KEY_ITSAppUsesNonExemptEncryption" "NO"

# 类别键无条件写：两个平台共用一棵树，只在 macos 那次运行里写的话，先跑 ios 再归档
# macOS 就会缺它 —— 上传直接 90242 失败。iOS 侧带着它无害（系统忽略）。
set_app_key "INFOPLIST_KEY_LSApplicationCategoryType" "\"$APP_CATEGORY\""

echo "   ✓ bundle id = $BUNDLE_ID(.extension)　显示名「$DISPLAY_NAME」"
echo "   ✓ MARKETING_VERSION = $VERSION（跟随 package.json）"
echo "   ✓ 出口合规豁免已声明（ITSAppUsesNonExemptEncryption = NO）"
echo "   ✓ App 类别 = $APP_CATEGORY（macOS 必需，iOS 侧忽略）"

# build 号：App Store 要求同一平台每次上传都必须递增，且 iOS 与 macOS 各自独立计数。
# 仓库无从得知商店现状，所以只在显式给出时才写，否则原样保留并提醒。
if [ -n "$BUILD_NUMBER" ]; then
  sed -i '' "s/CURRENT_PROJECT_VERSION = [^;]*;/CURRENT_PROJECT_VERSION = $BUILD_NUMBER;/g" "$PBX"
  echo "   ✓ CURRENT_PROJECT_VERSION = $BUILD_NUMBER"
  echo "   ⚠️ 这行是全局替换，两个平台的 target 都被写成了 $BUILD_NUMBER。"
  echo "      两个平台的 build 号各自计数，所以归档另一个平台前要么重跑本脚本，"
  echo "      要么在 xcodebuild 上加 CURRENT_PROJECT_VERSION=<n> 覆盖（不动工程文件）。"
else
  CUR=$(grep -ohE "CURRENT_PROJECT_VERSION = [^;]*" "$PBX" | head -1 | sed 's/.*= //')
  echo "   ⚠️ build 号保持 $CUR —— 上传前请确认它大于 App Store Connect 里"
  echo "      【$PLATFORM 平台】的最后一个 build（两个平台各自计数）。"
  echo "      需要改就重跑： BUILD_NUMBER=<n> bash build-safari.sh $FLAVOR $PLATFORM"
fi

# ── Step 3: 后续操作 ────────────────────────────────────────────────────
XCODEPROJ=$(find "$SAFARI_PROJECT" -name "*.xcodeproj" | head -1)

echo ""
echo "▶ Step 3/3  在 Xcode 中完成签名与分发"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Xcode 项目： $XCODEPROJ"
echo ""
if [ "$PLATFORM" = "macos" ]; then
  SCHEME="$APP_NAME (macOS)"
  DEST="generic/platform=macOS"
else
  SCHEME="$APP_NAME (iOS)"
  DEST="generic/platform=iOS"
fi
echo " 这棵树是双平台的，scheme 有两个；本次要归档的是："
echo "   $SCHEME"
echo ""
echo " 命令行归档 + 直传（不用开 Xcode，登录态自动过 2FA）："
echo "   npm run app:sync      # 必须先跑：宿主 App 资源 + 四个补丁都在这一步"
echo "   xcodebuild -project \"$XCODEPROJ\" -scheme \"$SCHEME\" \\"
echo "     -configuration Release -destination \"$DEST\" \\"
echo "     -archivePath /tmp/archive.xcarchive DEVELOPMENT_TEAM=<TEAM> \\"
echo "     -allowProvisioningUpdates archive"
echo ""
echo " 或者用 Xcode："
echo " 1. open \"$XCODEPROJ\""
echo " 2. 每个 Target（app + Extension）→ Signing & Capabilities → 选 Team"
if [ "$PLATFORM" = "macos" ]; then
  echo "    macOS 还需确认已启用 App Sandbox（说题录音还需 audio-input，app:sync 会补）"
  echo " 3. 顶部选 My Mac → Product ▸ Archive"
else
  echo " 3. 顶部选真机或 Any iOS Device → Product ▸ Archive"
fi
echo " 4. Organizer → Distribute App → App Store Connect → Upload"
echo ""
echo " 上架前自查："
echo "   · 版本 $VERSION 与 package.json / manifest.json 一致"
echo "   · build 号大于该平台在 ASC 的最后一个"
echo "   · 若本次改动对某平台无效（例如浏览器语言检测在 Safari 上不生效），"
echo "     更新说明里不要写成该平台的新功能"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

read -p "现在打开 Xcode 吗？[Y/n] " answer
if [[ "$answer" != "n" && "$answer" != "N" ]]; then
  open "$XCODEPROJ"
fi
