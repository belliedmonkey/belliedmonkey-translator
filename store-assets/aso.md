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
| `keywords` `description` `promotionalText` | `appStoreVersionLocalizations` | `aso` | 是（但两个平台读同一份文案，所以描述要同时讲清 Mac 与 iPhone） |

## 四条不能忘的约束

1. **`keywords` 里逗号两侧不能有空格。** 空格计入那 100 个字符，而且会让 Apple 把
   `" 双语"` 当成一个**另外的**词。`test/aso-copy.test.js` 会拦。
2. **不放竞品名**（`沉浸式翻译` / `彩云小译` / `DeepL` / `Immersive Translate`）——
   Metadata Rejection 里最典型的一类，代价是排队位置清零。既有的引擎商标（`youtube` 国际版
   过审 10 次、四个中文引擎名中国版过审 4 次）**保留但不新增**。国际版的**描述**里不点名服务商。
3. **`keywords` 顶到 93–98 而不是 100。** 未用的字符是纯浪费（Apple 不因少写而加权），
   但顶满会让下次微调必须先删词 —— 而 keywords 随版本锁定，下次能改是下一版。
4. **口径红线**（2026-09-15 起由 `test/lib/copy-redlines.js` 拦）：不说「没有追踪 / 没有埋点」
   （我们发匿名用量事件，可关）；不说不加限定的「完全免费」；国际版不说「路径上没有我们的服务器」
   （免费额度经我们的中继）。iPhone 的实时字幕写「任意 App」，不点名 Safari。中国版不提 YouTube。

> 2026-09-15（1.11.0）整份重写：主叙事从「扩展 + 复习卡」换成「实时字幕 · 对话听译 · 网页 · 视频 ·
> 文档 · 复习卡」。此前 1.8.0 的对话、1.9.0 的免费额度、1.10.0 的文档翻译在商店页上都一个字没有。
> it / tr / vi / pl 四个 locale 此前从没推上 ASC（线上只有 11 个），这一版一并建。

---

## 国际版 · en-US · name

```
BelliedMonkey Translator
```

## 国际版 · en-US · subtitle

```
Live subtitles & bilingual web
```

## 国际版 · en-US · keywords

```
interpreter,conversation,captions,youtube,transcribe,flashcards,language,learning,dual,speech,pdf
```

## 国际版 · en-US · description

```
BelliedMonkey Translator puts two languages on screen wherever you read, watch or talk — and the sentences you actually read come back as review cards.

LIVE SUBTITLES (APP)
Bilingual subtitles for whatever your device is playing. On Mac, the app listens to system audio and shows a floating subtitle bar that stays on top of any app, even full-screen video (macOS 14.4 or later). On iPhone, play a video or podcast out loud in any app, and a picture-in-picture window scrolls the original and the translation, sentence by sentence.

CONVERSATION · LIVE INTERPRETER (APP)
Talk across a language gap. Both sides speak freely; each sentence is transcribed, translated and can be read aloud. On iOS 26 and macOS 26, on-device transcription keeps the audio on your device.

WEB PAGES, SIDE BY SIDE
The Safari extension (also on Chrome and Firefox) keeps every paragraph's original text with the translation right below it. No switching tabs, no losing your place.

VIDEO DUAL SUBTITLES
YouTube, podcasts and web video get sentence-matched dual subtitles. No captions? Turn on AI transcript subtitles.

DOCUMENT TRANSLATION
Open a PDF, Word file or image and read it page by page, original and translation side by side.

LEARN AS YOU READ
Sentences you actually read can become review cards on a forgetting curve — read, listen and write practice, sentence notes and read-aloud. Optional sync lets your phone review what you read on your computer.

YOUR ENGINE, YOUR CHOICE
Bring your own AI service key, or any compatible endpoint. Once signed in, you can also try a small free credit from us.

PRIVACY, SPELLED OUT
Your keys and settings stay on your device. With your own key, text goes straight to the provider you chose; with the free credit, it passes through our relay and is not stored. Live Subtitles and on-device transcription never record audio. We send anonymous usage events (which features are used, never page content), and you can turn them off in Settings. No ads. The whole app is open source and free to download.
```

## 国际版 · en-US · promotionalText

```
New: Live Subtitles for anything playing on your Mac or iPhone, plus a conversation interpreter. Bilingual web pages, documents and review cards, all in one app.
```

---

## 国际版 · zh-Hans · name

```
大肚猴翻译 BelliedMonkey
```

## 国际版 · zh-Hans · subtitle

```
实时双语字幕、对话听译、网页对照
```

## 国际版 · zh-Hans · keywords

```
同声传译,口译,画中画,视频,英语,日语,韩语,学英语,背单词,生词本,遗忘曲线,记忆卡,语言学习,外刊,美剧,youtube,插件,扩展,开源,文档,pdf,论文,播客,会议,直播,语音,转写
```

## 国际版 · zh-Hans · description

```
读网页、看视频、开会聊天，原文和译文同屏；你真正读过的句子，还会变成复习卡回来找你。

【实时字幕（App）】
给设备上正在播放的声音配双语字幕。Mac 上听系统声音，悬浮字幕条盖在任意 App 与全屏视频之上（需 macOS 14.4 或更新）；iPhone 上在任意 App 里外放视频或播客，画中画小窗逐句滚动原文与译文。

【对话 · 实时听译（App）】
跨语言面对面交流：双方自由说话，每句自动转写、翻译，还能朗读出来。iOS 26 / macOS 26 上可选设备内置转写，声音只在你的设备上识别。

【网页双语对照】
Safari 扩展（也支持 Chrome、Firefox）在每段原文下方显示译文，不跳转、不丢阅读位置。

【视频双语字幕】
YouTube、播客与网页视频逐句对齐双语字幕；没有字幕的视频，可以开启 AI 转写字幕。

【文档翻译】
打开 PDF、Word 或图片，逐页原文译文对照阅读。

【读过的句子会变成复习卡】
真正读完的句子按遗忘曲线回来：读 / 听 / 写三档练习，配句子解析与朗读。可选同步，电脑上读、手机上复习。

【引擎你自己选】
填入你自己的 AI 服务密钥，或任何兼容的接口；登录后也可以先用我们提供的一小份免费额度。

【隐私，说清楚】
密钥与设置只存在你的设备上。用自己的密钥时，文字直接发往你选的服务商；用免费额度时，经我们的中继转发，不保存。实时字幕与设备内置转写都不录音。我们会发送匿名用量事件（用了哪些功能，不含网页内容），可在设置里关闭。没有广告，完整开源，免费下载。
```

## 国际版 · zh-Hans · promotionalText

```
新增实时字幕：Mac 与 iPhone 上正在播放的任何声音都能配双语字幕；对话听译支持设备内置转写。网页对照、文档翻译、复习卡照旧好用。
```

---

## 中国版 · zh-Hans · name

```
大肚猴翻译
```

## 中国版 · zh-Hans · subtitle

```
实时字幕、对话听译、网页双语对照
```

## 中国版 · zh-Hans · keywords

```
同声传译,口译,画中画,外刊,阅读,英语,日语,记忆,间隔重复,遗忘曲线,背单词,生词本,语言学习,开源,文档,论文,会议,播客,语音,转写,美剧,DeepSeek,通义千问,Kimi,智谱
```

## 中国版 · zh-Hans · description

```
大肚猴翻译是一款开源的双语翻译工具：读网页、看视频、面对面交流，原文和译文同屏；你真正读过的句子，还会变成复习卡回来找你。

【实时字幕（App）】
给设备上正在播放的声音配双语字幕。Mac 上听系统声音，悬浮字幕条盖在任意 App 与全屏视频之上（需 macOS 14.4 或更新）；iPhone 上在任意 App 里外放视频或播客，画中画小窗逐句滚动原文与译文。

【对话 · 实时听译（App）】
跨语言面对面交流：双方自由说话，每句自动转写、翻译，还能朗读出来。iOS 26 / macOS 26 上可选设备内置转写，声音只在你的设备上识别。

【网页双语对照】
Safari 扩展在每段原文下方即时显示译文，边读边对照，不打断阅读节奏。

【文档翻译】
打开 PDF、Word 或图片，逐页原文译文对照阅读。

【用你自己的大模型 Key】
支持 DeepSeek、智谱 GLM、通义千问、Kimi，也可填写任何兼容 Chat Completions / Messages 格式的接口地址。填好后点「测试连接」，通不通当场就知道。

【读过的，才会变成复习卡】
真正停下来读完的句子会连同来源页面一起存进学习库，按记忆强度安排复习：读 / 听 / 写三档轮换，配句子解析与朗读。

【关于账号与数据】
翻译本身不需要账号：API Key 只保存在本机，翻译请求由你的设备直接发往你选择的服务商，不经过我们的服务器。实时字幕与设备内置转写都不录音；设备内置朗读（离线模型）首次使用时，会从我们的文件服务器下载一次模型文件。App 内提供可选登录，仅用于在你自己的设备之间同步学习进度。无广告、无第三方统计、不收集你的浏览记录。

需自备一个大模型服务的 API Key（部分服务商提供免费额度）。免费下载，完整开源，源码与常见问题见支持页面。
```

## 中国版 · zh-Hans · promotionalText

```
新增实时字幕：Mac 与 iPhone 上正在播放的任何声音都能配双语字幕；对话听译支持设备内置转写。自带大模型 Key，翻译请求不经过我们的服务器，免费下载、完整开源。
```

---

## 国际版 · ja · name

```
BelliedMonkey 翻訳
```

## 国际版 · ja · subtitle

```
ライブ字幕・会話通訳・対訳ウェブ
```

## 国际版 · ja · keywords

```
英語,韓国語,中国語,語学,単語帳,忘却曲線,間隔反復,多読,洋書,ニュース,論文,音読,発音,オープンソース,英語学習,精読,文字起こし,ピクチャインピクチャ,同時通訳,PDF,ポッドキャスト
```

## 国际版 · ja · description

```
見る・読む・話す、そのすべてを二言語で。実際に読んだ文は復習カードになって戻ってきます。

【ライブ字幕（アプリ）】
端末で再生中の音声に二言語字幕を付けます。Mac ではシステム音声を聞き取り、どのアプリや全画面動画の上にも字幕バーを表示します（macOS 14.4 以降）。iPhone では任意のアプリで動画やポッドキャストをスピーカー再生すると、ピクチャ・イン・ピクチャの小窓に原文と訳文が一文ずつ流れます。

【会話 · リアルタイム通訳（アプリ）】
言葉の壁を越えて対面で話せます。双方が自由に話し、一文ごとに文字起こし・翻訳し、読み上げもできます。iOS 26 / macOS 26 では端末内蔵の文字起こしを選べ、音声は端末の中だけで認識されます。

【対訳ウェブページ】
Safari 拡張機能（Chrome・Firefox にも対応）が段落ごとに原文を残し、すぐ下に訳文を表示します。

【動画の二言語字幕】
YouTube・ポッドキャスト・ウェブ動画に文単位の二言語字幕。字幕のない動画には AI 文字起こし字幕を使えます。

【文書翻訳】
PDF・Word・画像を開き、ページごとに原文と訳文を並べて読めます。

【読んだ文が身につく】
実際に読んだ文が忘却曲線に沿った復習カードになります。読む・聞く・書くの練習、文の解説、読み上げ。同期は任意で、パソコンで読んだ文をスマートフォンで復習できます。

【エンジンは自分で選ぶ】
お使いの AI サービスのキー、または互換性のある任意のエンドポイントを設定できます。サインインすると、当方の少額の無料クレジットも試せます。

【プライバシーを明確に】
キーと設定は端末に保存されます。自分のキーを使うとテキストは選んだ提供元へ直接送られ、無料クレジットを使う場合は当方の中継を経由し、保存はしません。ライブ字幕と端末内蔵の文字起こしは録音しません。匿名の利用データ（使った機能のみ、ページ内容は含まず）を送信し、設定でオフにできます。広告なし。アプリ全体がオープンソースで、ダウンロードは無料です。
```

## 国际版 · ja · promotionalText

```
新機能：Mac と iPhone で再生中のあらゆる音声にライブ字幕。会話通訳は端末内蔵の文字起こしに対応。対訳ウェブ、文書翻訳、復習カードもそのまま。
```

---

## 国际版 · ko · name

```
BelliedMonkey 번역
```

## 国际版 · ko · subtitle

```
실시간 자막·대화 통역·대역 웹
```

## 国际版 · ko · keywords

```
영어,일본어,중국어,어학,단어장,망각곡선,간격반복,원서,뉴스,논문,발음,독해,오픈소스,영어공부,외국어,암기,플래시카드,토익,듣기,받아쓰기,PIP,팟캐스트,회의,PDF,동시통역
```

## 国际版 · ko · description

```
보고, 읽고, 말하는 모든 순간을 두 언어로. 실제로 읽은 문장은 복습 카드가 되어 돌아옵니다.

【실시간 자막（앱）】
기기에서 재생 중인 소리에 이중 언어 자막을 붙입니다. Mac에서는 시스템 오디오를 듣고, 어떤 앱이나 전체 화면 영상 위에도 떠 있는 자막 바를 표시합니다(macOS 14.4 이상). iPhone에서는 아무 앱에서나 영상이나 팟캐스트를 스피커로 재생하면 PIP 창에 원문과 번역이 문장 단위로 흐릅니다.

【대화 · 실시간 통역（앱）】
언어가 달라도 마주 보고 이야기하세요. 양쪽이 자유롭게 말하면 문장마다 받아쓰고 번역하며, 읽어주기도 합니다. iOS 26 / macOS 26에서는 기기 내장 받아쓰기를 선택할 수 있어 음성이 기기 안에서만 인식됩니다.

【대역 웹페이지】
Safari 확장 프로그램(Chrome·Firefox도 지원)이 문단마다 원문을 두고 바로 아래에 번역을 표시합니다.

【영상 이중 자막】
YouTube, 팟캐스트, 웹 영상에 문장 단위 이중 자막. 자막이 없는 영상에는 AI 받아쓰기 자막을 켤 수 있습니다.

【문서 번역】
PDF, Word, 이미지를 열어 페이지마다 원문과 번역을 나란히 읽습니다.

【읽은 문장이 남습니다】
실제로 읽은 문장이 망각 곡선에 맞춘 복습 카드가 됩니다. 읽기·듣기·쓰기 연습, 문장 해설, 읽어주기. 동기화는 선택이며, 컴퓨터에서 읽은 문장을 휴대폰에서 복습할 수 있습니다.

【엔진은 직접 고릅니다】
사용 중인 AI 서비스의 키나 호환되는 엔드포인트를 넣으세요. 로그인하면 저희가 제공하는 소량의 무료 크레딧도 써 볼 수 있습니다.

【프라이버시, 분명하게】
키와 설정은 기기에 저장됩니다. 내 키를 쓰면 텍스트는 고른 제공자에게 곧바로 가고, 무료 크레딧을 쓰면 저희 중계를 거치며 저장하지 않습니다. 실시간 자막과 기기 내장 받아쓰기는 녹음하지 않습니다. 익명 사용 데이터(어떤 기능을 썼는지만, 페이지 내용 제외)를 보내며 설정에서 끌 수 있습니다. 광고 없음. 앱 전체가 오픈 소스이며 무료로 내려받을 수 있습니다.
```

## 国际版 · ko · promotionalText

```
새 기능: Mac과 iPhone에서 재생 중인 모든 소리에 실시간 자막. 대화 통역은 기기 내장 받아쓰기를 지원합니다. 대역 웹, 문서 번역, 복습 카드도 그대로.
```

---

## 国际版 · zh-Hant · name

```
大肚猴翻譯 BelliedMonkey
```

## 国际版 · zh-Hant · subtitle

```
即時雙語字幕、對話聽譯、網頁對照
```

## 国际版 · zh-Hant · keywords

```
同步口譯,口譯,子母畫面,影片,英文,日文,韓文,學英文,背單字,生字本,遺忘曲線,記憶卡,語言學習,外刊,美劇,youtube,擴充功能,開源,文件,pdf,論文,會議,直播,語音,轉寫
```

## 国际版 · zh-Hant · description

```
讀網頁、看影片、開會交談，原文與譯文同屏；你真正讀過的句子，還會變成複習卡回來找你。

【即時字幕（App）】
為裝置上正在播放的聲音配上雙語字幕。Mac 上聽系統聲音，懸浮字幕列蓋在任何 App 與全螢幕影片之上（需 macOS 14.4 或更新版本）；iPhone 上在任何 App 裡外放影片或 Podcast，子母畫面小窗逐句捲動原文與譯文。

【對話 · 即時聽譯（App）】
跨語言面對面溝通：雙方自由說話，每句自動轉寫、翻譯，還能朗讀出來。iOS 26 / macOS 26 上可選用裝置內建轉寫，聲音只在你的裝置上辨識。

【網頁雙語對照】
Safari 擴充功能（也支援 Chrome、Firefox）在每段原文下方顯示譯文，不跳轉、不弄丟閱讀位置。

【影片雙語字幕】
YouTube、Podcast 與網頁影片逐句對齊雙語字幕；沒有字幕的影片，可以開啟 AI 轉寫字幕。

【文件翻譯】
打開 PDF、Word 或圖片，逐頁原文譯文對照閱讀。

【讀過的句子會變成複習卡】
真正讀完的句子依遺忘曲線回來：讀 / 聽 / 寫三檔練習，配句子解析與朗讀。可選用同步，電腦上讀、手機上複習。

【引擎你自己選】
填入你自己的 AI 服務金鑰，或任何相容的端點；登入後也可以先用我們提供的一小份免費額度。

【隱私，說清楚】
金鑰與設定只存在你的裝置上。用自己的金鑰時，文字直接送往你選的服務商；用免費額度時，經我們的中繼轉送，不保存。即時字幕與裝置內建轉寫都不錄音。我們會傳送匿名使用資料（用了哪些功能，不含網頁內容），可在設定裡關閉。沒有廣告，完整開放原始碼，免費下載。
```

## 国际版 · zh-Hant · promotionalText

```
新增即時字幕：Mac 與 iPhone 上正在播放的任何聲音都能配雙語字幕；對話聽譯支援裝置內建轉寫。網頁對照、文件翻譯、複習卡一樣好用。
```

---

## 国际版 · de-DE · name

```
BelliedMonkey Übersetzer
```

## 国际版 · de-DE · subtitle

```
Live-Untertitel & Dolmetscher
```

## 国际版 · de-DE · keywords

```
vokabeln,karteikarten,englisch,wortschatz,sprachen,gespräch,transkription,pdf,podcast,video,lernen
```

## 国际版 · de-DE · description

```
Lesen, schauen, sprechen – in zwei Sprachen gleichzeitig. Und die Sätze, die du wirklich gelesen hast, kommen als Wiederholungskarten zurück.

LIVE-UNTERTITEL (APP)
Zweisprachige Untertitel für alles, was dein Gerät gerade abspielt. Auf dem Mac hört die App den Systemton und zeigt eine schwebende Untertitelleiste über jeder App, auch über Vollbildvideos (ab macOS 14.4). Auf dem iPhone spielst du ein Video oder einen Podcast in einer beliebigen App über den Lautsprecher ab, und ein Bild-in-Bild-Fenster zeigt Original und Übersetzung Satz für Satz.

GESPRÄCH · LIVE-DOLMETSCHER (APP)
Unterhalte dich über Sprachgrenzen hinweg. Beide Seiten sprechen frei; jeder Satz wird transkribiert, übersetzt und auf Wunsch vorgelesen. Unter iOS 26 und macOS 26 kannst du die geräteinterne Transkription wählen – der Ton bleibt dann auf deinem Gerät.

ZWEISPRACHIGE WEBSEITEN
Die Safari-Erweiterung (auch für Chrome und Firefox) lässt jeden Absatz im Original stehen und zeigt die Übersetzung direkt darunter.

DOPPELTE UNTERTITEL BEI VIDEOS
YouTube, Podcasts und Webvideos bekommen satzweise zugeordnete zweisprachige Untertitel. Keine Untertitel vorhanden? Schalte KI-Transkript-Untertitel ein.

DOKUMENTÜBERSETZUNG
Öffne ein PDF, eine Word-Datei oder ein Bild und lies Seite für Seite Original und Übersetzung nebeneinander.

GELESENES BLEIBT
Sätze, die du wirklich gelesen hast, werden zu Wiederholungskarten nach der Vergessenskurve: Lese-, Hör- und Schreibübungen, Satzerklärungen und Vorlesen. Die Synchronisierung ist optional.

DEINE ENGINE, DEINE WAHL
Trage den Schlüssel deines eigenen KI-Dienstes oder einen kompatiblen Endpunkt ein. Angemeldet kannst du auch ein kleines Gratis-Guthaben von uns ausprobieren.

DATENSCHUTZ, KLAR GESAGT
Schlüssel und Einstellungen bleiben auf deinem Gerät. Mit eigenem Schlüssel geht der Text direkt an den gewählten Anbieter; mit dem Gratis-Guthaben läuft er über unser Relay und wird nicht gespeichert. Live-Untertitel und geräteinterne Transkription nehmen nichts auf. Wir senden anonyme Nutzungsdaten (welche Funktionen, nie Seiteninhalte), abschaltbar in den Einstellungen. Keine Werbung. Die gesamte App ist quelloffen und kostenlos herunterzuladen.
```

## 国际版 · de-DE · promotionalText

```
Neu: Live-Untertitel für alles, was auf Mac oder iPhone läuft, und ein Gesprächsdolmetscher. Dazu zweisprachige Webseiten, Dokumente und Lernkarten.
```

---

## 国际版 · fr-FR · name

```
BelliedMonkey Traducteur
```

## 国际版 · fr-FR · subtitle

```
Sous-titres live et interprète
```

## 国际版 · fr-FR · keywords

```
traduction,vocabulaire,fiches,révision,langues,anglais,conversation,transcription,pdf,podcast
```

## 国际版 · fr-FR · description

```
Lire, regarder, parler — en deux langues à la fois. Et les phrases que vous avez vraiment lues reviennent en cartes de révision.

SOUS-TITRES EN DIRECT (APP)
Des sous-titres bilingues pour tout ce que votre appareil diffuse. Sur Mac, l'app écoute le son du système et affiche une barre de sous-titres flottante au-dessus de n'importe quelle app, même en vidéo plein écran (macOS 14.4 ou ultérieur). Sur iPhone, lancez une vidéo ou un podcast sur le haut-parleur dans n'importe quelle app : une fenêtre en image dans l'image fait défiler l'original et la traduction, phrase par phrase.

CONVERSATION · INTERPRÈTE EN DIRECT (APP)
Parlez par-delà la barrière de la langue. Chacun parle librement ; chaque phrase est transcrite, traduite et peut être lue à voix haute. Sous iOS 26 et macOS 26, la transcription intégrée à l'appareil garde le son sur votre appareil.

PAGES WEB BILINGUES
L'extension Safari (aussi pour Chrome et Firefox) garde chaque paragraphe d'origine avec la traduction juste en dessous.

SOUS-TITRES DOUBLES POUR LES VIDÉOS
YouTube, podcasts et vidéos web reçoivent des sous-titres bilingues alignés phrase à phrase. Pas de sous-titres ? Activez les sous-titres par transcription IA.

TRADUCTION DE DOCUMENTS
Ouvrez un PDF, un fichier Word ou une image et lisez page par page l'original et la traduction côte à côte.

CE QUE VOUS LISEZ RESTE
Les phrases vraiment lues deviennent des cartes de révision selon la courbe de l'oubli : lecture, écoute, écriture, explications de phrase et lecture à voix haute. Synchronisation facultative.

VOTRE MOTEUR, VOTRE CHOIX
Renseignez la clé de votre propre service d'IA ou un endpoint compatible. Une fois connecté, vous pouvez aussi essayer un petit crédit gratuit offert par nous.

LA CONFIDENTIALITÉ, CLAIREMENT
Vos clés et réglages restent sur votre appareil. Avec votre clé, le texte va directement au fournisseur choisi ; avec le crédit gratuit, il passe par notre relais et n'est pas conservé. Les sous-titres en direct et la transcription intégrée n'enregistrent rien. Nous envoyons des données d'usage anonymes (quelles fonctions, jamais le contenu des pages), désactivables dans les réglages. Aucune publicité. L'app est open source et gratuite à télécharger.
```

## 国际版 · fr-FR · promotionalText

```
Nouveau : sous-titres en direct pour tout ce qui joue sur Mac ou iPhone, et un interprète de conversation. Plus pages web bilingues, documents et cartes de révision.
```

---

## 国际版 · es-ES · name

```
BelliedMonkey Traductor
```

## 国际版 · es-ES · subtitle

```
Subtítulos en vivo y diálogos
```

## 国际版 · es-ES · keywords

```
traducción,vocabulario,tarjetas,repaso,idiomas,inglés,intérprete,transcripción,conversación,pdf
```

## 国际版 · es-ES · description

```
Lee, mira y habla en dos idiomas a la vez. Y las frases que has leído de verdad vuelven como tarjetas de repaso.

SUBTÍTULOS EN VIVO (APP)
Subtítulos bilingües para todo lo que suena en tu dispositivo. En Mac, la app escucha el audio del sistema y muestra una barra de subtítulos flotante sobre cualquier app, incluso con vídeo a pantalla completa (macOS 14.4 o posterior). En iPhone, reproduce un vídeo o pódcast por el altavoz en cualquier app y una ventana de imagen en imagen muestra original y traducción, frase a frase.

CONVERSACIÓN · INTÉRPRETE EN VIVO (APP)
Habla por encima de la barrera del idioma. Las dos partes hablan con libertad; cada frase se transcribe, se traduce y se puede leer en voz alta. En iOS 26 y macOS 26 puedes elegir la transcripción integrada en el dispositivo y el audio no sale de él.

PÁGINAS WEB BILINGÜES
La extensión de Safari (también para Chrome y Firefox) conserva cada párrafo original con la traducción justo debajo.

SUBTÍTULOS DOBLES EN VÍDEO
YouTube, pódcast y vídeo web reciben subtítulos bilingües alineados frase a frase. ¿Sin subtítulos? Activa los subtítulos por transcripción con IA.

TRADUCCIÓN DE DOCUMENTOS
Abre un PDF, un archivo de Word o una imagen y lee página a página el original y la traducción lado a lado.

LO QUE LEES SE QUEDA
Las frases que lees de verdad se convierten en tarjetas de repaso según la curva del olvido: lectura, escucha, escritura, notas de frase y lectura en voz alta. Sincronización opcional.

TU MOTOR, TU ELECCIÓN
Introduce la clave de tu propio servicio de IA o un endpoint compatible. Con sesión iniciada, también puedes probar un pequeño crédito gratuito nuestro.

PRIVACIDAD, SIN RODEOS
Tus claves y ajustes se quedan en tu dispositivo. Con tu clave, el texto va directo al proveedor que elegiste; con el crédito gratuito, pasa por nuestro relé y no se guarda. Los subtítulos en vivo y la transcripción integrada no graban nada. Enviamos datos de uso anónimos (qué funciones, nunca el contenido de las páginas), desactivables en Ajustes. Sin anuncios. Toda la app es de código abierto y se descarga gratis.
```

## 国际版 · es-ES · promotionalText

```
Novedad: subtítulos en vivo para todo lo que suena en Mac o iPhone, y un intérprete de conversación. Además, web bilingüe, documentos y tarjetas de repaso.
```

---

## 国际版 · ru · name

```
BelliedMonkey Переводчик
```

## 国际版 · ru · subtitle

```
Живые субтитры и разговор
```

## 国际版 · ru · keywords

```
словарь,карточки,повторение,языки,английский,память,запоминание,устный,транскрипция,pdf,подкаст
```

## 国际版 · ru · description

```
Читайте, смотрите и говорите сразу на двух языках. А фразы, которые вы действительно прочитали, вернутся карточками для повторения.

ЖИВЫЕ СУБТИТРЫ (ПРИЛОЖЕНИЕ)
Двуязычные субтитры для всего, что звучит на вашем устройстве. На Mac приложение слушает системный звук и показывает плавающую строку субтитров поверх любого приложения, даже полноэкранного видео (macOS 14.4 или новее). На iPhone включите видео или подкаст через динамик в любом приложении — окно «картинка в картинке» покажет оригинал и перевод по фразам.

РАЗГОВОР · ЖИВОЙ ПЕРЕВОДЧИК (ПРИЛОЖЕНИЕ)
Общайтесь, несмотря на языковой барьер. Обе стороны говорят свободно; каждая фраза расшифровывается, переводится и может быть озвучена. В iOS 26 и macOS 26 можно выбрать встроенную расшифровку — звук остаётся на устройстве.

ДВУЯЗЫЧНЫЕ СТРАНИЦЫ
Расширение Safari (а также для Chrome и Firefox) сохраняет каждый абзац оригинала и показывает перевод прямо под ним.

ДВОЙНЫЕ СУБТИТРЫ К ВИДЕО
YouTube, подкасты и веб-видео получают двуязычные субтитры с пофразовым соответствием. Нет субтитров — включите ИИ-расшифровку.

ПЕРЕВОД ДОКУМЕНТОВ
Откройте PDF, файл Word или изображение и читайте постранично оригинал и перевод рядом.

ПРОЧИТАННОЕ ОСТАЁТСЯ
Действительно прочитанные фразы становятся карточками по кривой забывания: чтение, аудирование, письмо, разборы предложений и озвучивание. Синхронизация — по желанию.

ВАШ ДВИЖОК, ВАШ ВЫБОР
Укажите ключ своего ИИ-сервиса или совместимую конечную точку. После входа можно попробовать и небольшой бесплатный лимит от нас.

ПРИВАТНОСТЬ БЕЗ НЕДОМОЛВОК
Ключи и настройки хранятся на устройстве. Со своим ключом текст идёт напрямую выбранному поставщику; с бесплатным лимитом — через наш ретранслятор и не сохраняется. Живые субтитры и встроенная расшифровка ничего не записывают. Мы отправляем анонимные данные об использовании (какие функции, никогда не содержимое страниц), их можно отключить в настройках. Без рекламы. Всё приложение с открытым исходным кодом и скачивается бесплатно.
```

## 国际版 · ru · promotionalText

```
Новое: живые субтитры для всего, что звучит на Mac или iPhone, и переводчик для разговора. А ещё двуязычные страницы, документы и карточки для повторения.
```

---

## 国际版 · pt-BR · name

```
BelliedMonkey Tradutor
```

## 国际版 · pt-BR · subtitle

```
Legendas ao vivo e intérprete
```

## 国际版 · pt-BR · keywords

```
tradução,vocabulário,flashcards,revisão,idiomas,inglês,memória,conversa,transcrição,pdf,podcast
```

## 国际版 · pt-BR · description

```
Leia, assista e converse em dois idiomas ao mesmo tempo. E as frases que você realmente leu voltam como cartões de revisão.

LEGENDAS AO VIVO (APP)
Legendas bilíngues para tudo o que toca no seu aparelho. No Mac, o app ouve o áudio do sistema e mostra uma barra de legendas flutuante sobre qualquer app, até em vídeo em tela cheia (macOS 14.4 ou posterior). No iPhone, toque um vídeo ou podcast pelo alto-falante em qualquer app e uma janela picture-in-picture mostra original e tradução, frase a frase.

CONVERSA · INTÉRPRETE AO VIVO (APP)
Converse apesar da barreira do idioma. Os dois lados falam livremente; cada frase é transcrita, traduzida e pode ser lida em voz alta. No iOS 26 e no macOS 26, a transcrição integrada no aparelho mantém o áudio no aparelho.

PÁGINAS WEB BILÍNGUES
A extensão do Safari (também para Chrome e Firefox) mantém cada parágrafo original com a tradução logo abaixo.

LEGENDAS DUPLAS EM VÍDEO
YouTube, podcasts e vídeos da web ganham legendas bilíngues alinhadas frase a frase. Sem legendas? Ative as legendas por transcrição com IA.

TRADUÇÃO DE DOCUMENTOS
Abra um PDF, um arquivo do Word ou uma imagem e leia página a página o original e a tradução lado a lado.

O QUE VOCÊ LÊ FICA
As frases que você realmente leu viram cartões de revisão pela curva do esquecimento: leitura, escuta, escrita, notas de frase e leitura em voz alta. Sincronização opcional.

SEU MOTOR, SUA ESCOLHA
Coloque a chave do seu próprio serviço de IA ou um endpoint compatível. Com login, você também pode experimentar um pequeno crédito gratuito nosso.

PRIVACIDADE, SEM RODEIOS
Suas chaves e ajustes ficam no aparelho. Com a sua chave, o texto vai direto para o provedor escolhido; com o crédito gratuito, passa pelo nosso relé e não é armazenado. As legendas ao vivo e a transcrição integrada não gravam nada. Enviamos dados de uso anônimos (quais recursos, nunca o conteúdo das páginas), desligáveis nos Ajustes. Sem anúncios. O app inteiro é de código aberto e gratuito para baixar.
```

## 国际版 · pt-BR · promotionalText

```
Novidade: legendas ao vivo para tudo o que toca no Mac ou no iPhone, e um intérprete de conversa. Além de web bilíngue, documentos e cartões de revisão.
```

---

## 国际版 · ar-SA · name

```
BelliedMonkey مترجم
```

## 国际版 · ar-SA · subtitle

```
ترجمة مباشرة ومترجم فوري
```

## 国际版 · ar-SA · keywords

```
مفردات,بطاقات,مراجعة,لغات,إنجليزي,قراءة,ذاكرة,تكرار,مفتوح المصدر,أخبار,تعلم,محادثة,PDF,بودكاست
```

## 国际版 · ar-SA · description

```
اقرأ وشاهد وتحدّث بلغتين في آنٍ واحد. والجُمل التي قرأتها فعلاً تعود إليك بطاقاتِ مراجعة.

ترجمة مباشرة (التطبيق)
ترجمة ثنائية اللغة لكل ما يُشغَّل على جهازك. على Mac يستمع التطبيق إلى صوت النظام ويعرض شريط ترجمة عائمًا فوق أي تطبيق، حتى فوق الفيديو بملء الشاشة (macOS 14.4 أو أحدث). وعلى iPhone شغّل فيديو أو بودكاست عبر مكبّر الصوت في أي تطبيق، فتعرض نافذة صورة داخل صورة النص الأصلي والترجمة جملةً بجملة.

محادثة · مترجم فوري (التطبيق)
تحدّث رغم اختلاف اللغة. يتكلم الطرفان بحرية، وتُفرَّغ كل جملة وتُترجَم ويمكن قراءتها بصوت مسموع. على iOS 26 وmacOS 26 يمكنك اختيار التفريغ الصوتي المدمج في الجهاز فيبقى الصوت على جهازك.

صفحات ويب بلغتين
تُبقي إضافة Safari (وكذلك Chrome وFirefox) كل فقرة بنصها الأصلي وتعرض الترجمة أسفلها مباشرةً.

ترجمة مزدوجة للفيديو
يحصل YouTube والبودكاست وفيديو الويب على ترجمة ثنائية مطابقة جملةً بجملة. لا توجد ترجمة؟ فعّل الترجمة المولَّدة بالتفريغ الصوتي بالذكاء الاصطناعي.

ترجمة المستندات
افتح ملف PDF أو Word أو صورة واقرأ صفحةً بصفحة النص الأصلي والترجمة جنبًا إلى جنب.

ما تقرأه يبقى معك
تتحول الجُمل التي قرأتها فعلاً إلى بطاقات مراجعة وفق منحنى النسيان: قراءة واستماع وكتابة، مع شرح الجُمل والقراءة الصوتية. المزامنة اختيارية.

محرّكك واختيارك
أدخل مفتاح خدمة الذكاء الاصطناعي الخاصة بك أو أي نقطة نهاية متوافقة. وبعد تسجيل الدخول يمكنك تجربة رصيد مجاني صغير منّا.

الخصوصية بوضوح
تبقى مفاتيحك وإعداداتك على جهازك. مع مفتاحك يذهب النص مباشرةً إلى المزوّد الذي اخترته، ومع الرصيد المجاني يمرّ عبر خادم الترحيل لدينا ولا يُحفَظ. الترجمة المباشرة والتفريغ المدمج لا يسجّلان شيئًا. نرسل بيانات استخدام مجهولة (أي الميزات فقط، لا محتوى الصفحات) ويمكن إيقافها من الإعدادات. بلا إعلانات. التطبيق كله مفتوح المصدر وتنزيله مجاني.
```

## 国际版 · ar-SA · promotionalText

```
جديد: ترجمة مباشرة لكل ما يُشغَّل على Mac أو iPhone، ومترجم للمحادثات. إضافة إلى صفحات ويب بلغتين والمستندات وبطاقات المراجعة.
```

---

## 国际版 · it · name

```
BelliedMonkey Traduttore
```

## 国际版 · it · subtitle

```
Sottotitoli live e interprete
```

## 国际版 · it · keywords

```
inglese,tradurre,vocaboli,ripasso,video,imparare,flashcard,podcast,conversazione,trascrizione,pdf
```

## 国际版 · it · description

```
Leggi, guarda e parla in due lingue insieme. E le frasi che hai davvero letto tornano come carte di ripasso.

SOTTOTITOLI LIVE (APP)
Sottotitoli bilingui per tutto ciò che il tuo dispositivo sta riproducendo. Su Mac l'app ascolta l'audio di sistema e mostra una barra di sottotitoli fluttuante sopra qualsiasi app, anche sui video a schermo intero (macOS 14.4 o successivo). Su iPhone riproduci un video o un podcast dall'altoparlante in qualsiasi app e una finestra picture-in-picture mostra originale e traduzione, frase per frase.

CONVERSAZIONE · INTERPRETE LIVE (APP)
Parla oltre la barriera della lingua. Entrambi parlano liberamente; ogni frase viene trascritta, tradotta e può essere letta ad alta voce. Su iOS 26 e macOS 26 puoi scegliere la trascrizione sul dispositivo e l'audio resta sul dispositivo.

PAGINE WEB BILINGUI
L'estensione per Safari (anche per Chrome e Firefox) mantiene ogni paragrafo originale con la traduzione subito sotto.

SOTTOTITOLI DOPPI PER I VIDEO
YouTube, podcast e video sul web ottengono sottotitoli bilingui allineati frase per frase. Niente sottotitoli? Attiva quelli trascritti dall'IA.

TRADUZIONE DI DOCUMENTI
Apri un PDF, un file Word o un'immagine e leggi pagina per pagina originale e traduzione affiancati.

LEGGI E TI RESTA
Le frasi che hai davvero letto diventano carte di ripasso sulla curva dell'oblio: lettura, ascolto, scrittura, note sulla frase e lettura ad alta voce. Sincronizzazione facoltativa.

IL TUO MOTORE, LA TUA SCELTA
Inserisci la chiave del tuo servizio di IA o un endpoint compatibile. Dopo l'accesso puoi provare anche un piccolo credito gratuito offerto da noi.

PRIVACY, DETTA CHIARA
Chiavi e impostazioni restano sul tuo dispositivo. Con la tua chiave il testo va direttamente al fornitore scelto; con il credito gratuito passa dal nostro relay e non viene conservato. I sottotitoli live e la trascrizione sul dispositivo non registrano nulla. Inviamo dati d'uso anonimi (quali funzioni, mai il contenuto delle pagine), disattivabili nelle impostazioni. Nessuna pubblicità. Tutta l'app è open source e si scarica gratis.
```

## 国际版 · it · promotionalText

```
Novità: sottotitoli live per tutto ciò che suona su Mac o iPhone e un interprete per conversare. In più pagine web bilingui, documenti e carte di ripasso.
```

---

## 国际版 · tr · name

```
BelliedMonkey Çeviri
```

## 国际版 · tr · subtitle

```
Canlı altyazı ve tercüman
```

## 国际版 · tr · keywords

```
İngilizce,kelime,tekrar,okuma,ezber,sözlük,yabancı,video,podcast,öğrenme,sohbet,transkript,pdf
```

## 国际版 · tr · description

```
Oku, izle ve konuş — aynı anda iki dilde. Gerçekten okuduğun cümleler de tekrar kartı olarak geri gelir.

CANLI ALTYAZI (UYGULAMA)
Cihazında çalan her şey için iki dilli altyazı. Mac'te uygulama sistem sesini dinler ve her uygulamanın, hatta tam ekran videonun üstünde duran yüzen bir altyazı çubuğu gösterir (macOS 14.4 veya sonrası). iPhone'da herhangi bir uygulamada videoyu ya da podcast'i hoparlörden çal; resim içinde resim penceresi özgün metni ve çeviriyi cümle cümle gösterir.

SOHBET · CANLI TERCÜMAN (UYGULAMA)
Dil engelini aşarak yüz yüze konuş. İki taraf da serbestçe konuşur; her cümle yazıya dökülür, çevrilir ve sesli okunabilir. iOS 26 ve macOS 26'da cihaz içi transkripsiyonu seçebilirsin; ses cihazında kalır.

İKİ DİLLİ WEB SAYFALARI
Safari eklentisi (Chrome ve Firefox için de var) her paragrafın özgün metnini korur, çevirisini hemen altında gösterir.

VİDEOLARDA ÇİFT ALTYAZI
YouTube, podcast'ler ve web videoları cümle cümle eşleşen iki dilli altyazı alır. Altyazı yok mu? Yapay zekâ transkripsiyonlu altyazıyı aç.

BELGE ÇEVİRİSİ
Bir PDF, Word dosyası ya da görsel aç; özgün metni ve çeviriyi sayfa sayfa yan yana oku.

OKU, AKLINDA KALSIN
Gerçekten okuduğun cümleler unutma eğrisine göre tekrar kartlarına dönüşür: okuma, dinleme, yazma, cümle açıklamaları ve sesli okuma. Eşitleme isteğe bağlıdır.

MOTORU SEN SEÇ
Kendi yapay zekâ servisinin anahtarını ya da uyumlu bir uç noktayı gir. Giriş yaptıktan sonra bizim sunduğumuz küçük bir ücretsiz krediyi de deneyebilirsin.

GİZLİLİK, AÇIKÇA
Anahtarların ve ayarların cihazında kalır. Kendi anahtarınla metin doğrudan seçtiğin sağlayıcıya gider; ücretsiz krediyle bizim aktarma sunucumuzdan geçer ve saklanmaz. Canlı altyazı ve cihaz içi transkripsiyon hiçbir şey kaydetmez. Anonim kullanım verisi (hangi özellikler, asla sayfa içeriği) göndeririz; ayarlardan kapatabilirsin. Reklam yok. Uygulamanın tamamı açık kaynaktır ve ücretsiz indirilir.
```

## 国际版 · tr · promotionalText

```
Yeni: Mac ya da iPhone'da çalan her şey için canlı altyazı ve sohbet tercümanı. Ayrıca iki dilli web sayfaları, belgeler ve tekrar kartları.
```

---

## 国际版 · vi · name

```
BelliedMonkey Dịch
```

## 国际版 · vi · subtitle

```
Phụ đề trực tiếp và phiên dịch
```

## 国际版 · vi · keywords

```
tiếng Anh,ngoại ngữ,từ vựng,ôn tập,đọc,ghi nhớ,video,học,podcast,luyện nghe,hội thoại,chép lời,pdf
```

## 国际版 · vi · description

```
Đọc, xem và nói chuyện bằng hai ngôn ngữ cùng lúc. Những câu bạn thực sự đã đọc sẽ quay lại thành thẻ ôn tập.

PHỤ ĐỀ TRỰC TIẾP (ỨNG DỤNG)
Phụ đề song ngữ cho mọi thứ đang phát trên thiết bị. Trên Mac, ứng dụng nghe âm thanh hệ thống và hiện một thanh phụ đề nổi trên mọi ứng dụng, kể cả video toàn màn hình (macOS 14.4 trở lên). Trên iPhone, phát video hoặc podcast qua loa ngoài trong bất kỳ ứng dụng nào, cửa sổ hình trong hình sẽ chạy bản gốc và bản dịch theo từng câu.

HỘI THOẠI · PHIÊN DỊCH TRỰC TIẾP (ỨNG DỤNG)
Trò chuyện vượt rào cản ngôn ngữ. Hai bên nói tự do; mỗi câu được chép lời, dịch và có thể đọc thành tiếng. Trên iOS 26 và macOS 26, bạn có thể chọn chép lời ngay trên thiết bị, âm thanh không rời khỏi máy.

TRANG WEB SONG NGỮ
Tiện ích Safari (có cả cho Chrome và Firefox) giữ nguyên từng đoạn gốc và hiện bản dịch ngay bên dưới.

PHỤ ĐỀ KÉP CHO VIDEO
YouTube, podcast và video trên web có phụ đề song ngữ khớp theo từng câu. Không có phụ đề? Bật phụ đề chép lời bằng AI.

DỊCH TÀI LIỆU
Mở PDF, tệp Word hoặc hình ảnh và đọc từng trang bản gốc cạnh bản dịch.

ĐỌC XONG LÀ NHỚ
Những câu bạn thực sự đã đọc thành thẻ ôn tập theo đường cong quên: đọc, nghe, viết, ghi chú câu và đọc thành tiếng. Đồng bộ là tùy chọn.

TỰ CHỌN CỖ MÁY DỊCH
Điền khóa dịch vụ AI của riêng bạn hoặc một điểm cuối tương thích. Sau khi đăng nhập, bạn cũng có thể dùng thử một khoản tín dụng miễn phí nhỏ từ chúng tôi.

QUYỀN RIÊNG TƯ, NÓI RÕ RÀNG
Khóa và cài đặt ở lại trên thiết bị. Dùng khóa của bạn thì văn bản đi thẳng tới nhà cung cấp bạn chọn; dùng tín dụng miễn phí thì đi qua máy chủ chuyển tiếp của chúng tôi và không được lưu. Phụ đề trực tiếp và chép lời trên thiết bị không ghi âm. Chúng tôi gửi dữ liệu sử dụng ẩn danh (tính năng nào được dùng, không bao giờ là nội dung trang), có thể tắt trong Cài đặt. Không quảng cáo. Toàn bộ ứng dụng là mã nguồn mở và tải về miễn phí.
```

## 国际版 · vi · promotionalText

```
Mới: phụ đề trực tiếp cho mọi thứ đang phát trên Mac hoặc iPhone, cùng trình phiên dịch hội thoại. Thêm web song ngữ, tài liệu và thẻ ôn tập.
```

---

## 国际版 · pl · name

```
BelliedMonkey Tłumacz
```

## 国际版 · pl · subtitle

```
Napisy na żywo i tłumacz mowy
```

## 国际版 · pl · keywords

```
angielski,języki,słówka,powtórki,czytanie,pamięć,fiszki,nauka,podcast,rozmowa,transkrypcja,pdf
```

## 国际版 · pl · description

```
Czytaj, oglądaj i rozmawiaj w dwóch językach naraz. A zdania, które naprawdę przeczytasz, wracają jako fiszki do powtórek.

NAPISY NA ŻYWO (APLIKACJA)
Dwujęzyczne napisy do wszystkiego, co gra na Twoim urządzeniu. Na Macu aplikacja słucha dźwięku systemowego i pokazuje pływający pasek napisów nad każdą aplikacją, także nad filmem na pełnym ekranie (macOS 14.4 lub nowszy). Na iPhonie odtwórz film lub podcast przez głośnik w dowolnej aplikacji, a okno obraz w obrazie pokaże oryginał i tłumaczenie zdanie po zdaniu.

ROZMOWA · TŁUMACZ NA ŻYWO (APLIKACJA)
Rozmawiaj ponad barierą językową. Obie strony mówią swobodnie; każde zdanie jest spisywane, tłumaczone i może zostać odczytane na głos. W iOS 26 i macOS 26 możesz wybrać transkrypcję na urządzeniu — dźwięk zostaje na urządzeniu.

DWUJĘZYCZNE STRONY
Rozszerzenie Safari (także dla Chrome i Firefox) zostawia każdy akapit w oryginale, a tłumaczenie pokazuje tuż pod nim.

PODWÓJNE NAPISY DO FILMÓW
YouTube, podcasty i filmy w sieci dostają dwujęzyczne napisy dopasowane zdanie po zdaniu. Brak napisów? Włącz napisy z transkrypcji AI.

TŁUMACZENIE DOKUMENTÓW
Otwórz PDF, plik Word lub obraz i czytaj strona po stronie oryginał obok tłumaczenia.

PRZECZYTANE ZOSTAJE
Zdania, które naprawdę przeczytasz, stają się fiszkami na krzywej zapominania: czytanie, słuchanie, pisanie, objaśnienia zdań i czytanie na głos. Synchronizacja jest opcjonalna.

SILNIK WYBIERASZ TY
Wpisz klucz własnej usługi AI albo zgodny endpoint. Po zalogowaniu możesz też wypróbować mały darmowy kredyt od nas.

PRYWATNOŚĆ, JASNO
Klucze i ustawienia zostają na urządzeniu. Z własnym kluczem tekst trafia prosto do wybranego dostawcy; z darmowym kredytem przechodzi przez nasz serwer pośredniczący i nie jest zapisywany. Napisy na żywo i transkrypcja na urządzeniu niczego nie nagrywają. Wysyłamy anonimowe dane o użyciu (które funkcje, nigdy treść stron), do wyłączenia w ustawieniach. Bez reklam. Cała aplikacja jest open source i do pobrania za darmo.
```

## 国际版 · pl · promotionalText

```
Nowość: napisy na żywo do wszystkiego, co gra na Macu lub iPhonie, oraz tłumacz rozmów. Do tego dwujęzyczne strony, dokumenty i fiszki.
```
