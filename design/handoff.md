# 大肚猴翻译 — 视觉改版交接说明

设计稿：`Logo & FAB.dc.html`（形象定稿：2a 图标 · 2b FAB）、`App Mockups.dc.html`（App 六屏）、`Extension Mockups.dc.html`（扩展端五面 + 警告态）。
基础：Organic 设计系统 token（下表已解析成 hex，源头是 `_ds/organic-*/styles.css`）。

## 1. 色板（新旧映射）

| 用途 | 旧值 | 新值 | 备注 |
| --- | --- | --- | --- |
| 品牌主色（按钮、FAB 关、进度条） | #0a7a3c | **terracotta #c67139** (`accent`) | hover/pressed 用 accent-600 #b2622d |
| 译文颜色（.mt-translation、复习卡译文） | #0a7a3c | **sage #56633f** (`accent-2-700`) | 分隔线同色 18% 透明 |
| 译文颜色 · 暗色页面 | #4ade80 | **#aebf92** (`accent-2-400`) | |
| 「翻译中 / 已开启」状态 | #065f46 | **#728157** (`accent-2-600`) | FAB 开态、开关、徽章 |
| 页面底色 | #fff / #f3f4f6 | **cream #f5ead8** (`bg`)，卡片 #fff | |
| 正文字色 | #1a1a1a / #111827 | **#201e1d** (`text`) | |
| 边框 / 分隔 | #e5e7eb | **#dcd3c4** (`neutral-300`)，行分隔 neutral-200 #eee7db | |
| 次要文字 | #6b7280 | text 45–55% 透明，或 neutral-600 #82796a | |
| 警告（缺 Key） | 琥珀系 | accent-100 #fff2eb 底 / accent-400 #f6a06b 框 / accent-800 #643312 字 | popup `.setup-note.warn` |
| 提示（免费引擎） | 绿系 | accent-2-100 #f0fae1 底 / accent-2-300 #ccdbb2 框 / accent-2-900 #272e1b 字 | popup `.setup-note` |
| 危险操作 | #c1121f | 保留红，建议 #b3261e | 仍为描边按钮 |

完整 100–900 阶梯直接从 `styles.css` 拷贝进各 CSS 的 `:root`。**暗色模式 Organic 未提供**——建议先按现有 `prefers-color-scheme` 结构保留旧暗色逻辑，只把绿色换成 accent-2-400/300，后续再派生完整暗色阶。

## 2. 形态与字体

- 圆角：容器 16–28px，按钮/输入框一律胶囊 `border-radius: 999px`；打分按钮 16–18px。
- 图标：Lucide，`stroke-width: 2.75`。
- 展示字体 Caprasimo（仅拉丁，CJK 自动回落系统字体，效果即设计稿所示）、正文 Figtree；扩展端不引入外部字体也可接受——形象靠图形不靠字体。
- 禁用态：45% 不透明度（原 0.45/0.55 统一为 0.45）。

## 3. 图标 icon.svg（替换 extension/icons/icon.svg，重新导出全部 png）

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#c67139"/>
  <circle cx="26" cy="36" r="11" fill="#f5ead8"/><circle cx="102" cy="36" r="11" fill="#f5ead8"/>
  <circle cx="26" cy="36" r="5" fill="#ffc6a5"/><circle cx="102" cy="36" r="5" fill="#ffc6a5"/>
  <circle cx="64" cy="42" r="26" fill="#f5ead8"/>
  <circle cx="55" cy="38" r="3.4" fill="#201e1d"/><circle cx="73" cy="38" r="3.4" fill="#201e1d"/>
  <path d="M58 48c3.5 3.4 8.5 3.4 12 0" stroke="#201e1d" stroke-width="2.75" stroke-linecap="round" fill="none"/>
  <circle cx="64" cy="89" r="33" fill="#f5ead8"/>
  <g fill="#8c491a" transform="translate(64 91) scale(0.72) translate(-45 -51)">
    <rect x="28" y="34" width="34" height="7" rx="2"/><rect x="41.5" y="26" width="7" height="11" rx="2"/>
    <path d="M45 41c0 13-6 22-17 29l5 6c8-6 13-13 15-21 2 8 7 15 15 21l5-6c-11-7-17-16-17-29z"/>
  </g>
</svg>
```

- 16px（favicon 档）删掉五官和文字，只留耳朵 + 头 + 肚三个米白圆（见 Logo & FAB 2a 尺寸阶梯）。
- 暗色底变体：rect 换 #2e2b25（neutral-900），其余不变。

## 4. FAB（floating-button.js 的 innerHTML + floating-button.css）

定稿 2b：同一只猴悬浮。64×64 viewBox（耳朵伸出主圆，热区仍 52px 圆）：

- **关**：主圆 #c67139，耳朵米白描边圆（stroke #c67139 2px、内耳 #ffc6a5），米白头（眼 2.2r + 微笑）+ 米白肚（内含 0.22 缩放的文字 path，#8c491a）。
- **开（翻译中）**：主圆与耳描边换 #728157，眼睛换成弧线眯眼，肚内换成两行圆角矩形——上行 #201e1d、下行 #c67139。替换现有右上角状态点。
- 阴影：关 `0 4px 10px rgba(198,113,57,.4)`；开 `rgba(114,129,87,.45)`。按压 scale(0.91) 保留。
- 点译芯片 `.mt-translate-chip`：底色 #c67139，胶囊不变。

SVG 逐段代码见 `Extension Mockups.dc.html` 1f / `Logo & FAB.dc.html` 2b（可直接拷贝，把 var() 换成上表 hex）。

## 5. 各文件改动清单

| 文件 | 改动 |
| --- | --- |
| `extension/styles/bilingual.css` | .mt-translation 颜色 → #56633f（暗 #aebf92）、border-top 同色 18%；进度条渐变 → #c67139→#f6a06b |
| `extension/styles/floating-button.css` | §4 |
| `extension/popup/popup.css` | :root 换 token；header 徽章、setup-note 两态、开关 #728157、主按钮 #c67139；选择器/输入框胶囊化（radius 999px） |
| `extension/options/options.css` | 同上；卡片 radius 24px、页面底色 #f5ead8、卡片白底 shadow-sm |
| `extension/learn/review.css` | :root 换 token；译文 .tr → accent-2-800 #3d472b；强度条 accent 陶土；徽章 lit → accent-2；reveal 主按钮陶土胶囊；四档打分含 .when 结构不变 |
| `extension/icons/icon.svg` + png ×6 | §3 |
| `app/style.css` | --green 拆成两个变量：主操作 #c67139、状态/译文 sage；其余 token 同表。注意保留 [hidden]!important、:where() 作用域、16px 输入字号、48px 触控高度 |
| `store-assets/` `screenshots-cn/` | 定稿后按新形象重渲染（scene.html 模板换色即可） |

## 6. 设计规则（沿用不动摇）

- 四档打分永不合并；.when 间隔预告永远显示。
- 所有 in-flight 控件必须可见地禁用（45%）。
- 警告/提示两态永不同屏；未配置引擎时主按钮禁用且原因写在按钮上方。
- 徽章三态：实线亮 = 新鲜通过，虚线 = 过期（stale），灰 = 未验证。
- 译文永远在原文下方、只换颜色不换字体——这条产品铁律同时是品牌符号（logo 肚子里那两行）。

## 7. Mock 索引

| 界面 | 位置 |
| --- | --- |
| App 登录/首页/复习问答/设置/FAB 页 | App Mockups 1a–1f |
| Popup 正常态 / 警告态 | Extension Mockups 1a / 2a |
| 复习页（桌面） | Extension Mockups 1b |
| 页内进度条·双语段落·点译芯片 | Extension Mockups 1c |
| 视频双语字幕 | Extension Mockups 1d |
| 设置页（含语音卡片） | Extension Mockups 1e |
| 图标三底色 + 尺寸阶梯 / FAB 两态 | Logo & FAB 2a / 2b |

## 8. 落地后的形象真源(2026-08-15 实装备注)

猴形象几何存在**三份有意的拷贝**,改五官/肚子时三处都要动:
1. `extension/icons/icon.svg` — 规范真源(popup/options 页与商店模板都 `<img>` 引用它,不再内联);
2. `extension/content/floating-button.js` — FAB 的共享几何(颜色全在 floating-button.css,几何因两态五官/肚内容不同而独立);
3. `store-assets/src/promo-tile.html` — 奶油底反色变体(唯一一处,构图不同,刻意保留内联)。

颜色的唯一真源是 `build/palette.config.js`(→ `content/palette.gen.js` + `styles/organic-tokens.gen.css`);
页面注入 CSS 与 icon.svg 里的字面 hex 由 build.js 的 palette gate 钉住——注册表不认识的 hex 直接拒绝构建。

### §8 补:App 图标槽位(2026-08-15 白框病修复)

主屏/程序坞图标与商店图标是**不同交付物**:
- **iOS App 图标** = `app/appicon/ios-1024.png`,**满幅、不圆角、不透明**(圆角 iOS 自己裁;带透明角的圆角稿会被垫白 → 白框);
- **macOS App 图标** = `app/appicon/mac-icon-*`,圆角稿按 Apple 网格 824/1024 居中、四周透明;
- 商店/网页继续用 `extension/icons/icon.svg` 圆角稿。
`scripts/sync-app-assets.js` Patch 7 每次把这套覆写进转换器的 AppIcon.appiconset——转换器默认会把扩展图标贴在白底上,这就是白框的来源。
