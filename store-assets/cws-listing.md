# Chrome Web Store 长描述

CWS 的 API **没有商店文案端点**（只有上传 / 发布 / 草稿状态），长描述、截图、数据披露都只能在开发者后台手填。
这份文件是那两格的唯一来源：发版时整段复制进后台「Store listing → Description」，保存后**回读页面**确认已换。

- 短描述（summary）不在这里：它是包里的 `extension/_locales/*/messages.json` → `extension_description`，随包上传。
- 口径与 `store-assets/amo-listing.md` 同一套（红线见 `test/lib/copy-redlines.js`）；CWS 后台只有英文与简体中文两份。
- 不写 HTML；网址写裸的。

---

## en · description

```
Read the web and watch videos in two languages at once — and actually remember what you read.

BILINGUAL PAGES — Every paragraph keeps its original text with the translation right below it, in a color you choose. No tab switching, no losing your place.
DUAL SUBTITLES — YouTube, podcasts and video posts get sentence-matched dual subtitles: original on top, translation below, translated ahead of playback. No captions? Turn on AI transcript subtitles.
DOCUMENTS — Open a PDF, Word file or image and read it page by page, original and translation side by side.
READ IT, KEEP IT — Turn on learning and the sentences you actually read become review cards: read/listen/write exercises, sentence notes and read-aloud, scheduled by memory strength. Review on your phone with sync on.
YOUR ENGINE — Plug in your own AI service key or any compatible endpoint; once signed in, you can also try a small free credit from us.
PRIVACY, SPELLED OUT — No account needed. Your keys and settings stay in your browser. With your own key, text goes straight to the provider you picked; with the free credit it passes through our relay and is not stored. We send anonymous usage events (which features are used, never page content), off in one switch. Multi-device sync is optional, off until you sign in. Open source.

Also on iPhone, iPad and Mac: the BelliedMonkey Translator app adds Live Subtitles for anything playing on the device and a conversation interpreter. Both recognise speech on the device and need iOS 26 / macOS 26.

Website: https://belliedmonkey.cc
```

## zh-CN · description

```
用两种语言同时读网页、看视频——读过的句子还能真正记住。

【双语网页】每个段落保留原文，译文以你选的颜色显示在正下方。不切换页面、不丢上下文。
【视频双语字幕】YouTube、播客与视频帖逐句对齐的双语字幕——原文在上、译文在下，提前翻译整句；没有字幕的视频可以开启 AI 转写字幕。
【文档翻译】打开 PDF、Word 或图片，逐页原文译文对照阅读。
【读过即积累】开启学习后，真正读过的句子自动变成复习卡：读·听·写多种练习 + 句子解析 + 朗读，按记忆强度安排复习；开同步后手机上也能复习。
【引擎你来选】填入你自己的 AI 服务密钥，或任何兼容的自定义接口；登录后也可以先用我们提供的一小份免费额度。
【隐私说清楚】不需要账号，密钥与设置只存在你的浏览器里。用自己的密钥时，文字直接发往你选的服务商；用免费额度时经我们的中继转发、不保存。会发送匿名用量事件（用了哪些功能，不含网页内容），一个开关即可关闭。多设备同步是可选的，登录后才开启。开源。

iPhone、iPad 与 Mac 上的大肚猴翻译 App 还有「实时字幕」（给设备上正在播放的声音配双语字幕）和「对话 · 实时听译」。两者都在设备上识别语音，需要 iOS 26 / macOS 26。

官网：https://belliedmonkey.cc
```
