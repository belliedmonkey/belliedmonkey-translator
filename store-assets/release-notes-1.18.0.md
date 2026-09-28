# 1.18.0 发布说明（**GitHub Release / 更新日志用这一份**）

> 这一份描述**整个版本**，每条行内标明是哪个面。生成器把每一行变成一个列表项，所以不要用分组标题。
> 评分触发点（#453）单独写在 1.17.0 那一份里，本版不重复。本版 = React 迁移落地 + 1.16.1 之后
> 漏网的用户可见修复（EF-1 #498、timeout 熔断 #475、迎新分叉 #493、横幅 #485、未登录复习 #481）。

## 国际版 · zh-Hans

```
· 浏览器扩展 · 修复：YouTube 字幕拿不到时不再反复重试 —— 反复请求恰好会触发 YouTube 对字幕的封锁，连原生字幕都会跟着失效；现在每个视频至多请求 3 次，拿不到就明确显示「字幕不可用」，不再拖垮你本来能用的字幕。
· App 与浏览器扩展 · 修复：网络一直超时时，连续 5 次超时就自动停下来（不再无限重试），点一下「重试」即恢复 —— 不再白白转圈。
· App（iPhone / iPad / Mac）· 新：第一屏先问你要什么 —— 「读网页」「听」或「都要」，按你的选择走不同的路；只想听的人不再被引导去装扩展。
· App（iPhone / iPad）· 修复：「在 Safari 里打开扩展」的横幅不再反复出现 —— 点过一次就算问过了；也不再因为还没抓到句子，就把你已经装好的扩展当成没打开。
· App 与浏览器扩展 · 改进：没有登录也能进复习页；复习收尾更明确（评过一张就算完成）；去掉了几乎没人用的「检测页」入口。
· App 与浏览器扩展 · 内部：界面层整体迁移到了 React —— 行为与外观不变，为的是后面把界面改得更快更稳。
```

## 国际版 · en-US

```
· Browser extension · Fixed: When a YouTube transcript can't be fetched, the extension no longer retries the same request over and over — repeated requests are exactly what triggers YouTube's transcript blocking, which takes down even the native captions that still worked. At most 3 requests per video now, with a clear "subtitles unavailable" instead of a broken pipeline.
· App & browser extension · Fixed: When the network keeps timing out, translation stops by itself after 5 consecutive timeouts instead of retrying forever — tap "Retry" to resume. No more endless spinning.
· App (iPhone / iPad / Mac) · New: The first screen asks what you came for — "read web pages", "listen", or "both" — and picks the path to match; if you only want listening, it no longer pushes you toward the extension.
· App (iPhone / iPad) · Fixed: The "open the extension in Safari" banner no longer keeps coming back — one tap counts as asked; and an extension you already set up is no longer treated as missing just because it hasn't captured sentences yet.
· App & browser extension · Improved: Review opens without signing in; finishing a session ends more clearly (one graded card completes it); the hardly-used "check page" link is gone.
· App & browser extension · Internal: The entire UI layer now runs on React — same behavior, same look — so future interface work moves faster.
```

## 中国版 · zh-Hans

```
· 浏览器扩展 · 修复：YouTube 字幕拿不到时不再反复重试 —— 反复请求恰好会触发 YouTube 对字幕的封锁，连原生字幕都会跟着失效；现在每个视频至多请求 3 次，拿不到就明确显示「字幕不可用」，不再拖垮你本来能用的字幕。
· App 与浏览器扩展 · 修复：网络一直超时时，连续 5 次超时就自动停下来（不再无限重试），点一下「重试」即恢复 —— 不再白白转圈。
· App（iPhone / iPad / Mac）· 新：第一屏先问你要什么 —— 「读网页」「听」或「都要」，按你的选择走不同的路；只想听的人不再被引导去装扩展。
· App（iPhone / iPad）· 修复：「在 Safari 里打开扩展」的横幅不再反复出现 —— 点过一次就算问过了；也不再因为还没抓到句子，就把你已经装好的扩展当成没打开。
· App 与浏览器扩展 · 改进：没有登录也能进复习页；复习收尾更明确（评过一张就算完成）；去掉了几乎没人用的「检测页」入口。
· App 与浏览器扩展 · 内部：界面层整体迁移到了 React —— 行为与外观不变，为的是后面把界面改得更快更稳。
```
