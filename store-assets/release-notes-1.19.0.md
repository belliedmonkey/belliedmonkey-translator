# 1.19.0 发布说明（**GitHub Release / 更新日志用这一份**）

> 这一份描述**整个版本**，每条行内标明是哪个面。生成器把每一行变成一个列表项，所以不要用分组标题。

## 国际版 · zh-Hans

```
· App（iPhone / iPad / Mac）· 新：首次打开改成三步 —— 先登录，再把两个语音包下到本机，最后才是引导。以前这两样是「第一次用到才下」，失败正好发生在你已经开始用的那一刻；现在它在门口一次说清，可重试、有进度。
· App（iPhone / iPad / Mac）· 变化：App 现在要先登录才给用 —— 引擎随登录到账、两个语音包要下到本机，登录是「配好了」的前提。浏览器扩展不受影响：仍然免登录、自带 key 可用。
· App（iPhone / iPad / Mac）· 新：系统翻译弹层的字号可以调了 —— 小 / 标准 / 大三档，叠在你系统的文字大小之上。在「设置 › 系统翻译」里选，选完下次弹出生效。
· App（iPhone / iPad / Mac）· 修复：退出重开后，首页有时会显示「未登录」，而同一次运行里设置页还是已登录 —— 两处现在读同一个状态；存储的一次瞬时读失败也不再被当成「已退出登录」。
· App（iPhone / iPad / Mac）· 修复：设备上留着一把旧 key（失效的、或写错的）时，登录可能整个跳过领取免费额度，而「领取」还会回你一句「已配好」—— 翻译其实仍在用那把旧 key。现在领取一定会发生、你自己填的 key 一个字都不会被动、回执说的是实际发生的事。
· App（iPhone / iPad / Mac）· 改进：实时字幕入口灰掉时那句过时的「需要 macOS 14.4 或更新」删了 —— 那条要求早已被设备内置识别器的 iOS / macOS 26 下限取代，现在只说真的那一句。
· App 与浏览器扩展 · 新：界面字体换成了设计稿的那两个字族 —— 拉丁字母用 Figtree（正文）与 Caprasimo（标题）；中文仍是系统字，所以中文的观感一点没变。
· App 与浏览器扩展 · 无障碍：用键盘 Tab 走一遍时，焦点环现在每个面都有 —— 此前只有设置页一处，弹窗、复习页与 App 里都看不出自己在哪。
· 扩展 · 改进：网页里的字幕条与字幕控制菜单并进全站形态语言 —— 圆角统一到三档（小元件 / 面板 / 胶囊），控制菜单里那个勾选号原先是一种不属于本站配色的绿，现在是品牌绿。
```

## 国际版 · en-US

```
· App (iPhone / iPad / Mac) · New: First launch is now three steps — sign in, download the two speech packs to this device, then onboarding. Those packs used to download the first time you needed them, which meant a failure landed exactly when you had started using the app; now it happens at the door, with progress and a retry.
· App (iPhone / iPad / Mac) · Changed: The app now requires signing in before it can be used — the engine arrives with your account and the two speech packs have to live on this device, so signing in is what "set up" means. The browser extension is unaffected: it still works signed-out with your own key.
· App (iPhone / iPad / Mac) · New: The system translation sheet now has three text sizes — Small, Standard, Large — on top of your system text size. Pick it in Settings › System translation; it takes effect the next time the sheet opens.
· App (iPhone / iPad / Mac) · Fixed: After quitting and reopening, the home screen could show "not signed in" while Settings still showed you signed in. Both now read the same state, and a momentary storage hiccup is no longer treated as a sign-out.
· App (iPhone / iPad / Mac) · Fixed: If the device still had an old (expired or mistyped) API key, signing in could skip claiming the free credit entirely — and the claim toast could still say "ready" while translation kept using that old key. Claiming now always happens, your own key is never touched, and the message says what actually happened.
· App (iPhone / iPad / Mac) · Improved: The greyed-out Live Subtitles entry no longer mentions macOS 14.4 — that requirement was replaced by the on-device recognizer's iOS / macOS 26 floor.
· App and browser extension · New: The interface now uses the two type families from our design system — Figtree for body text and Caprasimo for headings. Latin script only; CJK keeps the system font, so Chinese looks exactly as before.
· App and browser extension · Accessibility: Tabbing through the UI now shows a focus ring on every surface — before this only the settings page had one, so the popup, the review page and the app gave no clue where you were.
· Extension · Improved: The in-page subtitle line and its control menu now follow the shape language the rest of the product uses — radii collapsed onto the same three steps, and the menu's checkmark is no longer a green that belongs to nobody.
```

## 中国版 · zh-Hans

```
· App（iPhone / iPad / Mac）· 新：中国版也有了免费额度 —— 登录后自动到账（每账号 0.2 美元，够翻几百页）。不用先去阿里云申请 key 就能开始翻。请求经境内中继转发到阿里云百炼，我们不保存原文；用完回到「自带密钥」这条路，功能一个不少。
· App（iPhone / iPad / Mac）· 新：首次打开改成三步 —— 先登录，再把两个语音包下到本机，最后才是引导。以前这两样是「第一次用到才下」，失败正好发生在你已经开始用的那一刻；现在它在门口一次说清，可重试、有进度。
· App（iPhone / iPad / Mac）· 变化：App 现在要先登录才给用 —— 引擎随登录到账、两个语音包要下到本机，登录是「配好了」的前提。
· App（iPhone / iPad / Mac）· 新：系统翻译弹层的字号可以调了 —— 小 / 标准 / 大三档，叠在你系统的文字大小之上。在「设置 › 系统翻译」里选，选完下次弹出生效。
· App（iPhone / iPad / Mac）· 修复：退出重开后，首页有时会显示「未登录」，而同一次运行里设置页还是已登录 —— 两处现在读同一个状态；存储的一次瞬时读失败也不再被当成「已退出登录」。
· App（iPhone / iPad / Mac）· 修复：设备上留着一把旧 key（失效的、或写错的）时，登录可能整个跳过领取免费额度，而「领取」还会回你一句「已配好」—— 翻译其实仍在用那把旧 key。现在领取一定会发生、你自己填的 key 一个字都不会被动、回执说的是实际发生的事。
· App（iPhone / iPad / Mac）· 改进：实时字幕入口灰掉时那句过时的「需要 macOS 14.4 或更新」删了 —— 那条要求早已被设备内置识别器的 iOS / macOS 26 下限取代，现在只说真的那一句。
· App 与浏览器扩展 · 新：界面字体换成了设计稿的那两个字族 —— 拉丁字母用 Figtree（正文）与 Caprasimo（标题）；中文仍是系统字，所以中文的观感一点没变。
· App 与浏览器扩展 · 无障碍：用键盘 Tab 走一遍时，焦点环现在每个面都有 —— 此前只有设置页一处，弹窗、复习页与 App 里都看不出自己在哪。
· 扩展 · 改进：网页里的字幕条与字幕控制菜单并进全站形态语言 —— 圆角统一到三档（小元件 / 面板 / 胶囊），控制菜单里那个勾选号原先是一种不属于本站配色的绿，现在是品牌绿。
```
