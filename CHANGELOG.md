# Changelog

> **生成的文件，不要手改。** 来源是 `store-assets/release-notes-*.md`（App Store「新功能」栏的唯一真源）；
> 改内容请改那里，然后跑 `node scripts/gen-changelog.js`。日期是该版发布说明首次进仓库的那天。

## 1.9.2 — 2026-09-11

- The popup now has a "Live transcription + translation" row that starts with one tap whenever the page has a video or audio element (players inside web components included); when the player lives in an embedded frame it says so and offers a way in. The in-overlay entry no longer waits 15 seconds.
- On Safari, starting from the popup shows a "Tap to start" button on the page — one more tap and capture begins (Safari only captures audio after a tap on the page itself).
- One-key setup gains "Live transcription (optional)": when the platform has no live interface, add one key from a provider that does; engines with a live interface are marked "· live" in the transcription list.

<details><summary>中文</summary>

- 弹窗里新增「实时转写 + 翻译」一行，只要页面上有视频或音频就能一键开始（包括网页组件里的播放器）；播放器在嵌入框架里时会告诉你并给出口。叠层里的转写入口不再要等十几秒。
- Safari 上从弹窗开始转写时，页面上会出现「点此开始」再点一次即可（Safari 需要在页面里点一下才能采集声音）。
- 一键配置里新增「实时转写（可选）」：默认平台没有实时接口时，另填一把带实时接口的 key 就能实时转写；转写引擎列表里带实时接口的会标出「· 实时」。

</details>

## 1.9.1 — 2026-09-11

- When a provider rejects your API key (401/403), translation now stops right away and tells you on the page to check that key in Settings — no more failing paragraph by paragraph.
- The app's home screen now guides you to turn on the Safari extension: three illustrated steps, a one-tap jump to the check page, and an “I've turned it on” button to dismiss.
- After you've translated a few pages, a single line at the end of the translation asks whether you'd like to rate the app; dismiss it and it stays away for 90 days.
- Fix: after claiming the free allowance, the card wrongly said you were using your own key, and “Switch back to free credit” did nothing.

<details><summary>中文</summary>

- API key 被服务商拒绝（401/403）时，翻译会立刻停下，并在页面上告诉你去设置里检查这把 key，不再逐段反复失败。
- App 首页更清楚地引导打开 Safari 扩展：三步图示 + 一键跳到检测页，确认打开后点「我已打开」即可收起。
- 翻过几页之后，会在译文末尾问一次要不要去商店评分；关掉就 90 天内不再出现。
- 修复：领取免费额度后卡片误显示「你现在用的是自己的 key」，且「改回免费额度」点了没反应。

</details>

## 1.9.0 — 2026-09-10

- New free allowance: sign in to claim a small allowance we provide — enough to translate a few hundred pages, usable for translation, read-aloud, and transcription. When it runs out, add your own API key or join the community. Prefer not to sign in? Nothing changes — bring your own key or use the free Google engine.
- Fix: on the setup screen, tapping “Continue” right after pasting a key could drop the key in some cases; it now saves it before moving on.
- Secondary text in light mode is a touch more legible.

<details><summary>中文</summary>

- 新增免费额度：登录后领一份我们提供的额度，够翻几百页，翻译、朗读、转写都能用。用完可以填自己的 API key 继续，或加入社群。不想登录也照旧——填自己的 key 或用免费的 Google 引擎。
- 修复：在引导页填完 key 直接点「继续」，个别情况下 key 会没保存；现在点「继续」会先把它配好再走。
- 浅色模式下的部分说明文字调得更清晰。

</details>

## 1.8.0 — 2026-09-07

- Two new things:
- Podcasts and videos with no subtitles can now get bilingual subtitles. Tap "AI transcript subtitles" where it says subtitles are unavailable, and the audio goes to the transcription engine you configured (live streams show word-by-word on the video, with a full-sentence history beside it).
- New in the app: "Conversation · live interpreter". They speak, you read Chinese; hold "I'll talk" to speak Chinese and show the translation — read aloud too. Keeps listening while locked; finished sentences go into review.
- The app's home screen is redesigned around one card: what's due today.
- Privacy: audio goes only to the transcription endpoint you configured — our servers never touch it. No recording is kept, only text.

<details><summary>中文</summary>

- 两件新东西：
- 没有字幕的播客和视频，现在也能有双语字幕。在「字幕不可用」里点一下「AI 转写字幕」，音频会发到你自己配置的转写引擎生成字幕（直播是画面内逐词显示，旁边一栏整句历史）。
- App 新增「对话 · 实时听译」：对方说外语，你看中文；按住「我说」讲中文，译成外语给对方看，还能朗读。锁屏也继续听，说完的句子进复习。
- 另外 App 首页重做：今天该做的事收成一张卡。
- 隐私：音频只发往你自己配置的转写端点，我们的服务器不接触；不保存录音，只留文字。

</details>

## 1.7.18 — 2026-09-07

- Three fixes:
- In the app, once you set up a speech engine, Podcast Mode and the card's "Listen" button now appear right away — no relaunch needed.
- The app's review screen no longer shows a "Continue in the app" button (that one belongs to the browser extension).
- Links and light grey text that were hard to read in Dark Mode (for example "Get a key" in Settings) are now legible; light-mode buttons and secondary text are a shade darker too.
- The 1.7.17 fix is still here: your API key no longer disappears after one-tap setup.

<details><summary>中文</summary>

- 修复三处：
- App 里配好语音引擎后，「播客模式」入口和卡片上的「听一遍」现在立刻出现，不用重启 App。
- App 复习页顶部不再出现「在 App 里继续复习」按钮（那是给浏览器扩展用的）。
- 深色模式下看不清的链接与浅灰文字（例如设置里的「去申请 key」）全部调到可读；浅色模式的按钮与次要文字也略加深了一档。
- 1.7.17 的修复仍在：一键配置粘贴 key 后不再消失。

</details>

## 1.7.17 — 2026-09-06

- Fix: in the app's Settings, "One key sets up all three" lost the API key — and the three
- test rows — the moment you tapped the button. The key now stays put and each test reports
- on its own line.
- Everything from 1.7.16 is still here: the redesigned sign-in (Apple / Google first),
- feedback and rating entry points on every surface, and anonymous usage data with a single
- switch in Settings to turn it off.

<details><summary>中文</summary>

- 修复：App 设置里的「一键配置」，粘贴 API Key 后点「配好」按钮，key 和自检结果会一起消失。
- 现在 key 留在原地，三项自检逐行显示结果。
- 1.7.16 的改动仍在：登录页重做（Apple / Google 一键登录在前）、每个面都有反馈与评分入口、
- 匿名用量数据（设置里一个开关可关）。

</details>

## 1.7.16 — 2026-09-05

- Sign-in, redesigned: Apple and Google one-tap sign-in sit at the top; email is folded into
- a single line and expands only when you need it. The code step now replaces the form
- instead of stacking under it.
- Feedback and rating are one tap away on every surface — settings, the popup, the end of
- onboarding, and the app's settings — to write to the developer or rate on the store.
- Anonymous usage data is now sent: only which features are used, on which browser, and
- whether a translation succeeded or failed — never the pages you read, the text, the
- addresses, your keys or your account. On by default, one switch in Settings turns it off,
- and turning it off deletes what this device sent. Privacy policy section 5 lists every field.

<details><summary>中文</summary>

- 登录页重做了：Apple 和 Google 一键登录放在最上面，邮箱登录折叠成一行，需要时再展开。
- 验证码那一步不再往下堆，整块换成输入框。
- 每个面都有了「反馈」和「评分」入口：设置页、弹窗、引导结尾和 App 设置里都能一键写信
- 给开发者，或去商店评分。
- 开始发送匿名用量数据：只有用了哪些功能、在哪个浏览器、翻译成功还是失败 —— 不含你读的
- 网页、文字、地址、密钥或账号。默认开启，设置里一个开关可关，关掉即删除这台设备发过的
- 数据。隐私政策第 5 节逐条写明。

</details>

## 1.7.14 — 2026-09-05

- Settings in the app now match the browser extension.
- The Quick / Detailed split is in the app. One key used to configure translation,
- speech and transcription in the extension — but the app still made you fill in
- every field by hand. Same setup on every device now.
- Engines that need no key no longer show a key field. Picking Google Translate and
- still being asked for a secret was confusing, and it was there until now.
- More interface languages, so Hindi and others no longer fall back to English.
- Speech now needs you to pick an engine.
- It used to default to the system voice. That voice isn't good enough to learn from,
- and nobody ever chose it. Now nothing is read aloud until you configure an engine —
- one step, under Settings › Speech.
- This also fixes an embarrassing one: it said "not configured" and yet the preview
- button really did speak in the system voice, while the screen claimed "playing".

<details><summary>中文</summary>

- App 里的设置终于和浏览器扩展一样了。
- 「快速 | 详细」两档进了 App。以前扩展里能一把 key 配好翻译、朗读、转写，而 App
- 里还得一项项翻表单填 —— 现在两边是同一套，在哪台设备上配都一样。
- 不需要 Key 的引擎不再显示 Key 输入框。选了 Google 翻译还让你填密钥，是上一版
- 一直存在的困惑。
- 界面语言补齐，印地语等此前只能看到英文界面的语言现在可以选到自己的。
- 朗读现在需要你自己选一个语音引擎。
- 以前默认用系统自带的声音，效果撑不起「听着学」这件事，而且没人主动选过它。
- 现在不配就不朗读，配了才有 —— 设置页「语音」那一档一步就能配好。
- 顺带修掉一个尴尬的 bug：明明显示「未配置」，点试听却真的用系统声音念了出来，
- 界面还说「播放中」。

</details>

## 1.7.12 — 2026-09-03

- The big one: **no password to remember, no code to wait for.**
- Sign in with Apple or Google, in one tap. Until now the only way in was an emailed
- six-digit code — leave the app, find the mail, copy the digits back. Email still
- works if you would rather not use a third-party account.
- Rebuilt first-run setup. One API key now configures translation, read-aloud and
- transcription together, and it tests itself right there — you find out it works
- before your first page, not after.
- Sentences you actually stop and finish reading turn into review cards, and capture
- is on from the start (scrolling past does not count).
- If you sign in as a different account while this device still holds another
- account's material, it now says so — nothing was lost; sign back in and it returns.
- Keyboard shortcuts and inline code in a paragraph (Super + Return, for example) no
- longer vanish from the translation.

<details><summary>中文</summary>

- 这一版最大的变化：**不用记密码、也不用等验证码邮件了**。
- 用 Apple 或 Google 一键登录。原来只有邮箱验证码那一条路，要切出去收信、再把六位
- 数字抄回来 —— 现在按一下就完了。邮箱那条仍然在，不想用第三方账号可以继续用。
- 首次使用引导重做：一把 key 就能同时配好翻译、朗读和转写，填完当场自检告诉你通没通，
- 不用等到翻第一页才发现配错了。
- 你真正停下来读完的句子会自动变成复习卡，装好就开着（快速滚过去的不算）。
- 换了另一个账号登录时，如果这台设备上还有原来账号的学习材料，会明确告诉你 ——
- 那些卡没有丢，用原来的账号登录就会回来。
- 段落里的快捷键和代码（比如 Super + Return）不再从译文里消失。以前它们会被整段
- 丢掉，句子读着通顺，意思却是错的。

</details>

## 1.7.5 — 2026-09-03

- This release finally connects the whole path: set it up, translate a page, keep what you read.
- Rebuilt first-run setup. One API key now configures translation, read-aloud and
- transcription together, and it tests itself right there — so you find out it works
- before you translate your first page, not after.
- Sentences you actually stop and finish reading turn into review cards, and capture
- is on from the start (scrolling past does not count). It used to be off by default,
- so people read a whole page and found nothing saved.
- After translating on the web you can go straight back into the app to review. If the
- two sides are signed in as different people, it now says so instead of quietly
- failing to line up.
- Keyboard shortcuts and inline code in a paragraph (Super + Return, for example) no
- longer vanish from the translation. They used to be dropped entirely, leaving a
- sentence that read fine but said the wrong thing.
- Podcast mode reads cards whose language could not be identified. On iPhone, those
- cards previously would not play at all.

<details><summary>中文</summary>

- 这一版把「配好 → 翻一页 → 记住它」这条路真正连了起来。
- 首次使用引导重做：一把 key 就能同时配好翻译、朗读和转写，填完当场自检告诉你通
- 没通，不用等到翻第一页才发现配错了。
- 你真正停下来读完的句子会自动变成复习卡，装好就开着（快速滚过去的不算）。以前
- 这个开关默认是关的，不少人翻完一整页才发现什么都没记下来。
- 在网页上翻完，可以直接回到 App 里继续复习；两边不是同一个账号时会当场说清楚，
- 而不是安静地对不上。
- 段落里的快捷键和代码（比如 Super + Return）不再从译文里消失。以前它们会被整段
- 丢掉，句子读着通顺，意思却是错的。
- 播客模式：语言标不出来的卡现在也读得出来 —— 此前在 iPhone 上这类卡一张都播不了。

</details>

## 1.6.8 — 2026-08-29

- The first launch now walks you through actually getting translation working: pick
- your languages, set up an engine, enable the Safari extension, then translate a
- page right there to see it work.
- You can look around without signing in. An account is only needed when you want
- review progress synced to another device.
- After installing on iPhone, there's a new page at belliedmonkey.cc/setup.html:
- follow the three steps to enable the extension in Settings, come back, and it
- turns green by itself to confirm it worked — a question that previously had no
- answer anywhere.
- Two places that used to leave you waiting are fixed: a failed translation now
- says so and offers a retry you can tap, instead of sitting at "Translating…"
- forever; and an API Key you type in Settings is no longer lost if you lock the
- screen or switch apps before leaving the field.

<details><summary>中文</summary>

- 第一次打开 App 会有一段引导，带你把翻译真正用起来：选语言、配好翻译引擎、启用
- Safari 扩展、然后当场翻一页看看效果。
- 不登录也能进来看。登录只在你想把复习进度同步到别的设备时才需要。
- 在 iPhone 上装好之后，官网上多了一页 belliedmonkey.cc/setup.html：照着上面三步
- 去系统设置里启用扩展，回到那一页它会自己变绿告诉你「成功了」——这是以前一直
- 没有答案的问题。
- 修好了两处会让人白等的地方：翻译如果失败，现在会明确告诉你并给一个可以点的
- 重试，而不是一直停在「翻译中」；在设置里填完 API Key 之后直接锁屏或切走，Key
- 也不会再丢了。

</details>

## 1.6.7 — 2026-08-26

- Podcast mode now works like a music app:
- Playback keeps going when you leave the app, lock the phone, or switch away —
- card after card, without stopping.
- The Lock Screen shows the card being read: the sentence, its translation, and —
- while the analysis plays — three lines (vocabulary / phrases / grammar) that
- light up one at a time as they are spoken.
- The Dynamic Island shows your progress; press and hold to see the full sentence
- and translation.
- Play/pause and next work from the Lock Screen, your car and your headphones.
- "Previous" repeats the current card from the top.
- Playback resumes by itself after a phone call ends.
- Also: the screen no longer dims while podcast mode is in front. To keep seeing the
- card after you lock the phone, turn on Always-On Display (Settings → Display &
- Brightness → Always On).
- Note: this version changes how the analysis is split for speech, so previously
- downloaded analysis audio needs to be preloaded once more for fully offline playback.

<details><summary>中文</summary>

- 播客模式现在像音乐 App 一样工作了：
- 退到后台、锁屏、切到别的 App，朗读都会继续，一张卡接一张卡地往下走。
- 锁屏上能看到正在念的那张卡片——原句、译句，念到解析时下面三行（生词 / 短语 /
- 语法）会跟着念到哪儿就亮到哪儿。
- 灵动岛上显示当前进度，长按展开能看到完整的原句和译句。
- 锁屏、车机和耳机上的播放/暂停、下一张都能用；「上一曲」是「再听一遍」。
- 来电结束后自动继续播放。
- 另外：App 在前台时屏幕不再自动锁上。锁屏之后想一直看到卡片，请打开系统的「息屏
- 常显」（设置 → 显示与亮度 → 始终显示）。
- 小提示：这一版改进了朗读的分段方式，之前预载的解析语音需要重新预载一次，才能恢复
- 整轮离线播放。

</details>

## 1.6.6 — 2026-08-24

- Fixed: on React-rendered sites such as Substack, turning translation on made text
- impossible to select and hyperlinks impossible to open.
- The translation was being inserted as a sibling inside a container the page's own
- framework owns, so every change of selection made the framework re-lay-out every
- paragraph in the article — which wiped the selection, and moved the paragraph out
- from under the pointer between mouse-down and mouse-up so the click never reached
- the link. The translation now goes inside its own paragraph and leaves the page's
- structure alone.
- Also:
- When the speech endpoint cannot be reached it now says so and stops within 20
- seconds, instead of waiting for the system timeout.
- Stability fixes in capture and review.
- (The podcast preload feature is part of the macOS / iOS app, not the extension.)

<details><summary>中文</summary>

- 修复：在 Substack 这类用 React 渲染的网站上，开启翻译后选不中文字、超链接也点不开。
- 译文节点原本插在页面框架管辖的容器里，导致每次选中文字都会让整篇文章的段落被重新
- 排布一遍——选区因此被清掉，鼠标按下和抬起之间段落已经换了位置，点击也就到不了链接
- 上。现在译文改为插入到原文段落内部，不再打扰页面自己的结构。
- 本次同时带来 1.6.5 的全部内容：
- 播客模式可以离线用了。出发前点一下「预载离线资源」，今天要听的语音、句子解析和
- 译文就全部下到本机，路上完全没网也能整轮播完。第一下只算账——告诉你有多少张卡、
- 要花多少次付费调用，不花一分钱；你看清楚了再点第二下。
- 开卡更快。一张卡需要的东西现在一次性同时请求，句与句之间的空档没有了。
- 采集时没有译文的卡，现在可以用你已经配好的引擎补上译文。
- 连不上语音引擎时会明确说出来并停下，而不是一声不响地把整副牌跳完再说「本轮听完了」。
- 预载过程中按「停止」会立刻生效。

</details>

## 1.6.5 — 2026-08-23

- Podcast mode can now be taken offline. Tap Preload before you set out and the speech,
- sentence notes and translations for today's deck are downloaded to your device, so a
- whole session plays with no network at all.
- The first tap only prices it — it shows how many cards and how many billed calls, and
- spends nothing. You decide, then tap again.
- Cards start faster. Everything a card needs is now requested at once instead of one
- piece at a time, so the silence between sentences is gone.
- Cards captured without a translation can be given one, using the engine you already
- configured.
- When the speech engine cannot be reached, it now says so and stops — instead of
- skipping through the whole deck in silence and reporting that the round is finished.
- Stop now takes effect promptly during a preload.

<details><summary>中文</summary>

- 播客模式可以离线用了。出发前点一下「预载离线资源」，今天要听的语音、句子解析和译文
- 就全部下到本机，路上完全没网也能整轮播完。
- 第一下只算账——告诉你有多少张卡、要花多少次付费调用，不花一分钱。你看清楚了再点
- 第二下。
- 开卡更快。一张卡需要的东西现在一次性同时请求，不再一段一段地取，句与句之间的空档
- 没有了。
- 采集时没有译文的卡，现在可以用你已经配好的引擎补上译文。
- 连不上语音引擎时会明确说出来并停下——而不是一声不响地把整副牌跳完，再告诉你
- 「本轮听完了」。
- 预载过程中按「停止」现在会立刻生效。

</details>

## 1.6.4 — 2026-08-22

- Reasoning models now translate long passages reliably. Some of them used to return a
- successful response with no text in it — the paragraph just stayed blank, with no error
- to explain why. Requests now carry only the fields each endpoint is known to accept,
- which fixed that and cut a long paragraph from about 15 seconds to 3.
- Advanced settings accept your own request parameters, so a private or corporate
- endpoint can be tuned without waiting for us to add it.
- More engines to choose from — each one measured against its real endpoint rather
- than its documentation.
- An engine whose default model had been retired no longer fails the moment you pick it.
- Fixed a few interface strings that showed their formatting marks verbatim.

<details><summary>中文</summary>

- 推理型模型现在能稳定翻完长段落。此前它们有时会返回一个「成功」的响应、里面却一个字
- 都没有——那一段就那样空着，也没有任何报错说明原因。现在请求只携带各端点确实接受的
- 字段，这个问题解决了，一个长段落也从约 15 秒降到 3 秒。
- 高级设置可以自己填请求参数，私有或企业端点不必等我们适配。
- 可选引擎更多——每一个都是拿真实端点测出来的，不是照着文档写的。
- 某个引擎的默认模型已被下架，导致一选就报错，现已修复。
- 修正了几处界面文案里原样显示出来的格式符号。

</details>

## 1.5.3 — 2026-08-19

- Custom endpoints are now used exactly as you type them, with no exceptions. Failed
- requests quote the server's own explanation instead of a generic message, and the
- request body concedes any optional field the server says it will not accept. The
- translation cache is keyed by endpoint and model, so changing either takes effect
- immediately, and 「Test connection」 always makes a real request.

<details><summary>中文</summary>

- 自定义接口地址现在逐字使用，没有例外。请求被拒时会附上服务端原话，而不是一句笼统的
- 「服务端拒绝了这次请求」；请求体会让掉服务端点名不接受的可选字段再试一次。翻译缓存的
- 键包含端点与模型，改地址或模型立刻生效；「测试连接」一定真发一次请求。
- --

</details>

## 1.5.1 — 2026-08-15

- 1.5.1 — Meet the BelliedMonkey
- A full visual redesign:
- New mascot icon and in-page floating button — a pot-bellied monkey carrying the translation
- Warm terracotta & sage palette across every surface (popup, settings, review, app)
- Translations default to a calmer sage green; your custom color is untouched, old defaults migrate once automatically
- Translation, learning and privacy model unchanged

<details><summary>中文</summary>

- 1.5.1 —— 大肚猴新形象
- 整套视觉改版：
- 新吉祥物图标与页内悬浮按钮——大肚猴，肚子里装着译文
- 全部界面换上暖陶土与鼠尾草配色（弹窗、设置、复习页、App）
- 译文默认色改为更柔和的鼠尾草绿；你自定义过的颜色不受影响，旧默认色一次性自动迁移
- 翻译与学习功能不变，隐私模型不变

</details>

## 1.5.0 — 2026-08-13

- 1.5.0 — Listen, speak, read, write: every sentence, every skill
- The learning module now trains all four skills:
- New exercises: translation multiple-choice, blind-listen word picking, read-aloud scoring, AI comprehension questions
- Each review automatically rotates to your least-recently-verified skill — a sentence counts as learned only while all four stay fresh
- Read-aloud scoring: your recording goes only to the transcription endpoint you configure, and is discarded once the transcript returns — it never touches a server of ours. No endpoint configured, no speaking exercise.
- Optional AI-generated questions use your own API key — one call per card, cached forever
- Every new exercise has a zero-cost local variant — fully usable with no API configured at all

<details><summary>中文</summary>

- 1.5.0 —— 听说读写，每句都练到
- 学习模块升级为四技能训练体系：
- 新题型：译文选择题、盲听选词、朗读评测、AI 理解题
- 每次复习自动轮换「最久没验证」的能力——四项都保持新鲜，才算真正学会
- 朗读评测：录音只发送到你自己配置的转写服务，识别后立即丢弃，绝不经过我们的服务器；不配置就不出现朗读题
- AI 出题（可选）：用你自己的 API 为每张卡生成干扰项与理解题，每卡一次调用、永久缓存
- 所有新题型都有零成本的本地版本——不配置任何 API 也完整可用

</details>

