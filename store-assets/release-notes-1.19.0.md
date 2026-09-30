# 1.19.0 发布说明（**GitHub Release / 更新日志用这一份**）

> 这一份描述**整个版本**，每条行内标明是哪个面。生成器把每一行变成一个列表项，所以不要用分组标题。

## 国际版 · zh-Hans

```
· App（iPhone / iPad / Mac）· 新：系统翻译弹层的字号可以调了 —— 小 / 标准 / 大三档，叠在你系统的文字大小之上。在「设置 › 系统翻译」里选，选完下次弹出生效。
· App（iPhone / iPad / Mac）· 修复：退出重开后，首页有时会显示「未登录」，而同一次运行里设置页还是已登录 —— 两处现在读同一个状态；存储的一次瞬时读失败也不再被当成「已退出登录」。
· App（iPhone / iPad / Mac）· 修复：设备上留着一把旧 key（失效的、或写错的）时，登录可能整个跳过领取免费额度，而「领取」还会回你一句「已配好」—— 翻译其实仍在用那把旧 key。现在领取一定会发生、你自己填的 key 一个字都不会被动、回执说的是实际发生的事。
· App（iPhone / iPad / Mac）· 改进：实时字幕入口灰掉时那句过时的「需要 macOS 14.4 或更新」删了 —— 那条要求早已被设备内置识别器的 iOS / macOS 26 下限取代，现在只说真的那一句。
```

## 国际版 · en-US

```
· App (iPhone / iPad / Mac) · New: The system translation sheet now has three text sizes — Small, Standard, Large — on top of your system text size. Pick it in Settings › System translation; it takes effect the next time the sheet opens.
· App (iPhone / iPad / Mac) · Fixed: After quitting and reopening, the home screen could show “not signed in” while Settings still showed you signed in. Both now read the same state, and a momentary storage hiccup is no longer treated as a sign-out.
· App (iPhone / iPad / Mac) · Fixed: If the device still had an old (expired or mistyped) API key, signing in could skip claiming the free credit entirely — and the claim toast could still say “ready” while translation kept using that old key. Claiming now always happens, your own key is never touched, and the message says what actually happened.
· App (iPhone / iPad / Mac) · Improved: The greyed-out Live Subtitles entry no longer mentions macOS 14.4 — that requirement was replaced by the on-device recognizer's iOS / macOS 26 floor.
```

## 中国版 · zh-Hans

```
· App（iPhone / iPad / Mac）· 新：系统翻译弹层的字号可以调了 —— 小 / 标准 / 大三档，叠在你系统的文字大小之上。在「设置 › 系统翻译」里选，选完下次弹出生效。
· App（iPhone / iPad / Mac）· 修复：退出重开后，首页有时会显示「未登录」，而同一次运行里设置页还是已登录 —— 两处现在读同一个状态；存储的一次瞬时读失败也不再被当成「已退出登录」。
· App（iPhone / iPad / Mac）· 改进：实时字幕入口灰掉时那句过时的「需要 macOS 14.4 或更新」删了 —— 那条要求早已被设备内置识别器的 iOS / macOS 26 下限取代，现在只说真的那一句。
```
