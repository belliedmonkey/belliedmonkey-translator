# App Store 商店文案（ASO）

`scripts/asc.js` 的 `aso` 与 `appinfo` 两条命令都读这一份，各取自己那几个字段 ——
文案只有一处，不会漂移。标题格式沿用 `parseNotes` 已建立的约定，多一段字段名：

```
## <国际版|中国版> · <locale> · <name|subtitle|keywords|description|promotionalText>
```

## 哪个字段归哪条命令

| 字段 | 端点 | 命令 | 分平台？ |
|---|---|---|---|
| `name` `subtitle` | `appInfoLocalizations` | `appinfo` | **否** —— app 级，iOS/macOS 共用一条 |
| `keywords` `description` `promotionalText` | `appStoreVersionLocalizations` | `aso` | 是 |

## 三条不能忘的约束

1. **`keywords` 里逗号两侧不能有空格。** 空格计入那 100 个字符，而且会让 Apple 把
   `" 双语"` 当成一个**另外的**词。`test/aso-copy.test.js` 会拦。
2. **不放竞品名**（`沉浸式翻译` / `彩云小译` / `DeepL` / `Immersive Translate`）——
   Metadata Rejection 里最典型的一类，代价是排队位置清零。`沉浸式`（通用形容词）可以，
   竞品全称不行。既有的引擎商标（`youtube` 国际版过审 10 次、四个中文引擎名中国版过审
   4 次）**保留但不新增**。
3. **`keywords` 顶到 93–98 而不是 100。** 未用的字符是纯浪费（Apple 不因少写而加权），
   但顶满会让下次微调必须先删词 —— 而 keywords 随版本锁定，下次能改是下一版。

---

## 国际版 · en-US · name

```
BelliedMonkey Translator
```

## 国际版 · en-US · subtitle

```
Bilingual web, video subtitles
```

## 国际版 · en-US · keywords

```
immersive,dual,translate,captions,youtube,language,learning,flashcards,spaced,repetition,extension
```

## 国际版 · en-US · description

```
Most translators stop at the translation. BelliedMonkey Translator keeps going: read the web and watch video bilingually, and the sentences you actually read come back as review cards on a forgetting curve. Free, open source, and no servers of ours in the translation path.

WEB PAGES, SIDE BY SIDE
Turn on translation and every paragraph keeps its original text with a fresh translation right below it, in a distinct color. No switching tabs, no losing your place — just read.

YOUTUBE DUAL SUBTITLES
Watch with the original subtitle on top and the translation underneath, matched sentence by sentence, so you can follow along and pick up the language as you go.

LEARN AS YOU READ
Sentences you actually read can become review cards on a forgetting curve — read, listen and write tiers, free practice, sentence notes, and read-aloud. Off by default, and everything stays on your device.

SYNC ACROSS YOUR DEVICES (OPTIONAL)
Sign in with a free email account and your phone can review what you read on your computer. What sync stores on our servers: your saved sentences and translations, their source page URL and title, and review times — in readable form, only for your account. Delete a source or your account and it is removed from all devices. Without signing in, nothing leaves your device.

BRING YOUR OWN ENGINE
Google translation works instantly, with no setup. Prefer an AI model? Add your own key for OpenAI, Claude, DeepSeek, or GLM and translate with the engine you trust. You're always in control.

PRIVATE BY DESIGN
No tracking, no telemetry, no ads. No servers of ours in the translation path — text goes straight to the provider you choose, and your keys and settings stay on your device. No account unless you want one. The entire app is open source.

FREE AND OPEN
BelliedMonkey Translator is free and fully open source.

Great for reading foreign news and blogs, studying a language, following creators who speak another language, and browsing the global web the way you'd browse your own.
```

## 国际版 · en-US · promotionalText

```
Not just another translator — sentences you actually read come back as review cards on a forgetting curve. Free, open source, your key stays on device.
```

---

## 国际版 · zh-Hans · name

```
大肚猴翻译 BelliedMonkey
```

## 国际版 · zh-Hans · subtitle

```
网页沉浸式双语对照、视频双字幕、生词复习卡
```

## 国际版 · zh-Hans · keywords

```
翻译器,英语,日语,韩语,学英语,背单词,生词本,遗忘曲线,间隔重复,记忆卡,语言学习,外刊,精读,划词,美剧,外语,youtube,插件,扩展,免费,开源,原文,论文,单词,阅读,法语
```

## 国际版 · zh-Hans · description

```
读外网、看外语视频时，原文和译文同屏；而你真正读过的句子，第二天会回来找你。

【网页双语对照】
每段原文下方直接显示译文，用颜色区分，不跳转、不丢失阅读位置，整页一键双语。

【视频双语字幕】
YouTube、播客与网页视频，原文在上、译文在下逐句对齐，提前译好，播放不卡顿。

【读过的句子会变成复习卡】
这是它和别的翻译扩展最大的不同。开启学习后，你真正停下来读完的句子（快速滚过去的不算）会连同来源页面一起进入学习库，按遗忘曲线回到你面前：读 / 听 / 写三档轮换，配句子解析与朗读，每次评分都写明下次什么时候再见。电脑上读，手机上复习。

【引擎你自己选】
免费的 Google 通道零配置就能用；想要更好的质量，填入你自己的 API Key —— 支持 OpenAI、Claude、DeepSeek、GLM（智谱）、通义千问、Kimi，也可以填任何兼容 Chat Completions / Messages 格式的自建或中转接口。

【隐私】
没有埋点、没有广告、翻译链路上没有我们的服务器。翻译请求由你的设备直接发往你选择的服务商，API Key 与设置只留在本机。不登录也能完整使用；只有你主动开启同步，学习进度才会在你自己的设备之间流转。

完全免费，完整开源。
```

## 国际版 · zh-Hans · promotionalText

```
不只是翻译：你真正读过的句子会变成复习卡，按遗忘曲线回来找你。网页双语对照 + 视频双字幕，完全免费开源，API Key 只留在本机。
```

---

## 中国版 · zh-Hans · name

```
大肚猴翻译
```

## 中国版 · zh-Hans · subtitle

```
沉浸式网页双语对照、视频双字幕、生词复习卡
```

## 中国版 · zh-Hans · keywords

```
翻译器,外刊,阅读,英语,日语,记忆,间隔重复,遗忘曲线,背单词,生词本,语言学习,划词,开源,免费,原文,论文,插件,扩展,精读,美剧,DeepSeek,通义千问,Kimi,智谱
```

## 中国版 · zh-Hans · promotionalText

```
不只是翻译：你真正读过的句子会变成复习卡，按遗忘曲线回来找你。网页双语对照 + 视频双字幕，自带大模型 Key，原文不经过我们的服务器。完全免费、完整开源。
```
