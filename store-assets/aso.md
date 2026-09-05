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
No tracking, no ads, no third-party analytics — only anonymous usage events (which features are used, never page content), off in one switch. No servers of ours in the translation path — text goes straight to the provider you choose, and your keys and settings stay on your device. No account unless you want one. The entire app is open source.

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

## 中国版 · zh-Hans · description

```
大肚猴翻译是一款免费、开源的 Safari 双语翻译扩展 —— 但它不止于翻译：你真正读过的句子会留下来，按遗忘曲线回来找你复习。

【网页双语对照】
原文段落下方即时显示译文，边读边对照，不打断阅读节奏。

【用你自己的大模型 Key】
支持 DeepSeek、智谱 GLM、通义千问、Kimi，也可填写任何兼容 Chat Completions / Messages 格式的接口地址（中转代理、自建服务都可以）。填好后点一下「测试连接」，通不通当场就知道。

【读过的，才会变成复习卡】
快速滚过去的不算。真正停下来读完的句子，会连同来源页面一起存进学习库，按记忆强度安排复习：读 / 听 / 写三档轮换，配句子解析与朗读，每个评分都写明下次什么时候再见。

【收什么、怎么学，你说了算】
按语言筛选要收录的句子，按站点关闭采集，按来源批量删除；学习库随时导出，也可一键清空。

【关于账号与数据】
翻译本身不需要账号：API Key 只保存在本机，翻译请求由你的设备直接发往你选择的服务商，不经过我们的服务器。
App 内提供可选登录（邮箱验证码或密码），仅用于在你自己的设备之间同步学习进度；不登录也能完整使用翻译与本机复习。
无广告、无第三方统计、不收集你的浏览记录。

需自备一个大模型服务的 API Key（部分服务提供免费额度）。完全开源，源码与常见问题见支持页面。
```

## 中国版 · zh-Hans · promotionalText

```
不只是翻译：你真正读过的句子会变成复习卡，按遗忘曲线回来找你。网页双语对照 + 视频双字幕，自带大模型 Key，原文不经过我们的服务器。完全免费、完整开源。
```

---

## 国际版 · ja · name

```
BelliedMonkey 翻訳
```

## 国际版 · ja · subtitle

```
対訳ウェブ・二言語字幕・復習カード
```

## 国际版 · ja · keywords

```
英語,韓国語,中国語,語学,単語帳,忘却曲線,間隔反復,多読,洋書,ニュース,論文,音読,発音,無料,オープンソース,拡張機能,リーディング,英語学習,海外ニュース,英字新聞,精読,字幕翻訳
```

## 国际版 · ja · description

```
ウェブも動画も二言語で同時に読み、読んだ内容を本当に覚えるための Safari 拡張機能です。

【対訳ページ】
翻訳をオンにすると、段落ごとに原文がそのまま残り、そのすぐ下に訳文が別の色で表示されます。タブを切り替える必要も、読んでいた場所を見失うこともありません。

【動画の二言語字幕】
動画・ポッドキャスト・動画付きの投稿に、文単位で対応した二言語字幕を表示します。原文が上、訳文が下。再生に先回りして翻訳するので、途中で止まりません。

【読んだ文が身につく】
学習をオンにすると、実際に読んだ文が復習カードになります。読む・聞く・書くの練習、文の解説、読み上げを、記憶の強さに合わせて出題します。既定ではオフで、データはすべて端末内に残ります。

【端末間の同期（任意）】
無料のメールアカウントでサインインすると、パソコンで読んだ文をスマートフォンで復習できます。同期がサーバーに保存するもの：保存した文と訳文、その出典ページの URL とタイトル、復習の日時 —— いずれも判読可能な形で、あなたのアカウントの中だけに。出典やアカウントを削除すれば、すべての端末から消えます。サインインしなければ、何一つ端末の外に出ません。

【エンジンは自分で選ぶ】
無料の通道は設定なしですぐ使えます。品質を上げたいときは、お使いの AI サービスのキー、または互換性のある任意のカスタムエンドポイントを設定してください。主導権は常にあなたにあります。

【設計からプライバシー優先】
トラッキングなし、広告なし、第三者の分析なし — 匿名の利用データ（使った機能だけ、ページ内容は含まず）のみで、設定でオフにできます。翻訳経路に当方のサーバーは一切ありません —— テキストはあなたが選んだ提供元へ直接送られ、キーと設定は端末に残ります。アカウントは必要なときだけ。全体がオープンソースです。

【無料・オープン】
完全に無料、そして完全にオープンソースです。

海外のニュースやブログを読む、語学を学ぶ、別の言語で話す作り手を追いかける —— 自国のウェブと同じ感覚で、世界中のウェブを読むために。
```

## 国际版 · ja · promotionalText

```
ただの翻訳では終わりません。実際に読んだ文が忘却曲線に沿って復習カードになって戻ってきます。無料・オープンソース、キーは端末の中だけ。
```

---

## 国际版 · ko · name

```
BelliedMonkey 번역
```

## 国际版 · ko · subtitle

```
대역 웹·이중 자막·복습 카드
```

## 国际版 · ko · keywords

```
영어,일본어,중국어,어학,단어장,망각곡선,간격반복,원서,뉴스,논문,발음,독해,무료,오픈소스,확장,리딩,영어공부,자막번역,해외뉴스,영어독해,외국어,암기,플래시카드,토익,듣기
```

## 国际版 · ko · description

```
웹도 영상도 두 언어로 동시에 읽고, 읽은 내용을 실제로 기억하기 위한 Safari 확장 프로그램입니다.

【대역 웹페이지】
번역을 켜면 문단마다 원문이 그대로 남고 바로 아래에 번역문이 다른 색으로 표시됩니다. 탭을 옮길 필요도, 읽던 자리를 잃을 일도 없습니다.

【영상 이중 자막】
영상, 팟캐스트, 영상 게시물에 문장 단위로 맞춘 이중 자막을 표시합니다. 원문이 위, 번역이 아래. 재생보다 앞서 번역하므로 도중에 멈추지 않습니다.

【읽은 문장이 남습니다】
학습을 켜면 실제로 읽은 문장이 복습 카드가 됩니다. 읽기·듣기·쓰기 연습, 문장 해설, 읽어주기를 기억 강도에 맞춰 배치합니다. 기본값은 꺼짐이며, 데이터는 모두 기기 안에 남습니다.

【기기 간 동기화（선택）】
무료 이메일 계정으로 로그인하면 컴퓨터에서 읽은 문장을 휴대폰에서 복습할 수 있습니다. 동기화가 서버에 저장하는 것: 저장한 문장과 번역문, 출처 페이지의 URL과 제목, 복습 시각 —— 모두 읽을 수 있는 형태로, 여러분의 계정 안에서만. 출처나 계정을 삭제하면 모든 기기에서 사라집니다. 로그인하지 않으면 어떤 것도 기기를 떠나지 않습니다.

【엔진은 직접 고릅니다】
무료 채널은 설정 없이 바로 쓸 수 있습니다. 품질을 높이고 싶다면 사용 중인 AI 서비스의 키, 또는 호환되는 임의의 사용자 지정 엔드포인트를 넣으세요. 주도권은 언제나 여러분에게 있습니다.

【설계부터 프라이버시】
추적 없음, 광고 없음, 제3자 분석 없음 — 익명 사용 데이터(어떤 기능을 썼는지만, 페이지 내용은 제외)만 보내며 설정에서 끌 수 있습니다. 번역 경로에 저희 서버는 없습니다 —— 텍스트는 여러분이 고른 제공자에게 곧바로 전송되고, 키와 설정은 기기에 남습니다. 계정은 원할 때만. 전체가 오픈 소스입니다.

【무료, 오픈】
완전히 무료이며 완전한 오픈 소스입니다.

외국 뉴스와 블로그를 읽고, 언어를 공부하고, 다른 언어로 말하는 창작자를 따라가기 —— 자국 웹을 보듯 세계의 웹을 보기 위해.
```

## 国际版 · ko · promotionalText

```
단순한 번역기가 아닙니다. 실제로 읽은 문장이 망각 곡선에 따라 복습 카드로 돌아옵니다. 무료·오픈 소스, 키는 기기 안에만.
```

---

## 国际版 · zh-Hant · name

```
大肚猴翻譯 BelliedMonkey
```

## 国际版 · zh-Hant · subtitle

```
網頁雙語對照、影片雙字幕、生詞卡
```

## 国际版 · zh-Hant · keywords

```
翻譯器,英文,日文,韓文,學英文,背單字,生字本,遺忘曲線,間隔重複,記憶卡,語言學習,外刊,精讀,劃詞,美劇,外語,擴充功能,免費,開源,原文,論文,閱讀,法文,發音,聽力,新聞,學日文
```

## 国际版 · zh-Hant · description

```
讀外文網站、看外語影片時，原文與譯文同屏；而你真正讀過的句子，第二天會回來找你。

【網頁雙語對照】
每段原文下方直接顯示譯文，用顏色區分，不跳轉、不弄丟閱讀位置，整頁一鍵雙語。

【影片雙語字幕】
影片、Podcast 與網頁影片，原文在上、譯文在下逐句對齊，提前譯好，播放不卡頓。

【讀過的句子會變成複習卡】
這是它和其他翻譯擴充功能最大的不同。開啟學習後，你真正停下來讀完的句子（快速滑過去的不算）會連同來源頁面一起進入學習庫，依遺忘曲線回到你面前：讀 / 聽 / 寫三檔輪換，配句子解析與朗讀，每次評分都寫明下次什麼時候再見。預設關閉，資料留在你的裝置上。

【跨裝置同步（選用）】
用免費的電子郵件帳號登入，就能在手機上複習電腦上讀過的內容。同步存在伺服器上的東西：你收藏的句子與譯文、它們的來源頁面網址與標題、複習時間 —— 都是可讀的形式，只屬於你的帳號。刪掉來源或帳號，所有裝置上都會一併移除。不登入，任何東西都不會離開你的裝置。

【引擎你自己選】
免費通道零設定就能用；想要更好的品質，填入你自己的 AI 服務金鑰，或任何相容的自訂端點。主導權始終在你手上。

【隱私】
沒有追蹤、沒有廣告、沒有第三方分析 —— 只傳送匿名使用資料（用了哪些功能，不含網頁內容），設定裡可關。翻譯路徑上沒有我們的伺服器 —— 翻譯請求由你的裝置直接送往你選擇的服務商，金鑰與設定只留在本機。不登入也能完整使用。

完全免費，完整開放原始碼。
```

## 国际版 · zh-Hant · promotionalText

```
不只是翻譯：你真正讀過的句子會變成複習卡，依遺忘曲線回來找你。網頁雙語對照 + 影片雙字幕，完全免費開源，API 金鑰只留在本機。
```

---

## 国际版 · de-DE · name

```
BelliedMonkey Übersetzer
```

## 国际版 · de-DE · subtitle

```
Zweisprachig lesen und lernen
```

## 国际版 · de-DE · keywords

```
untertitel,vokabeln,karteikarten,englisch,wortschatz,wiederholung,kostenlos,sprachen,gedächtnis
```

## 国际版 · de-DE · description

```
Das Web lesen und Videos schauen – in zwei Sprachen gleichzeitig. Und die Sätze, die du wirklich gelesen hast, kommen am nächsten Tag zu dir zurück.

ZWEISPRACHIGE SEITEN
Schalte die Übersetzung ein: Jeder Absatz behält seinen Originaltext, die Übersetzung steht direkt darunter, farblich abgesetzt. Kein Tab-Wechsel, kein Verlieren der Textstelle.

DOPPELTE UNTERTITEL BEI VIDEOS
Videos, Podcasts und Video-Beiträge bekommen satzweise zugeordnete zweisprachige Untertitel: Original oben, Übersetzung darunter. Übersetzt wird der Wiedergabe voraus, damit nichts stockt.

GELESENES BLEIBT
Schalte das Lernen ein, und die Sätze, bei denen du wirklich stehen geblieben bist (überflogene zählen nicht), werden zu Wiederholungskarten: Lese-, Hör- und Schreibübungen, Satzerklärungen und Vorlesen, geplant nach Gedächtnisstärke. Standardmäßig aus, und alles bleibt auf deinem Gerät.

SYNCHRONISIERUNG (OPTIONAL)
Melde dich mit einer kostenlosen E-Mail-Adresse an, dann wiederholst du auf dem Handy, was du am Rechner gelesen hast. Was die Synchronisierung auf unseren Servern speichert: deine gespeicherten Sätze und Übersetzungen, die URL und den Titel der Quellseite sowie die Wiederholungszeitpunkte – in lesbarer Form und nur für dein Konto. Löschst du eine Quelle oder dein Konto, verschwindet sie von allen Geräten. Ohne Anmeldung verlässt nichts dein Gerät.

DEINE EIGENE ENGINE
Ein kostenloser Kanal funktioniert ohne jede Einrichtung. Willst du bessere Qualität, trage den Schlüssel deines eigenen KI-Dienstes ein oder einen beliebigen kompatiblen eigenen Endpunkt. Die Entscheidung bleibt bei dir.

PRIVAT VON GRUND AUF
Kein Tracking, keine Werbung, keine Drittanbieter-Analysen – nur anonyme Nutzungsdaten (welche Funktionen, nie Seiteninhalte), in den Einstellungen abschaltbar. Kein Server von uns im Übersetzungsweg – dein Text geht direkt an den Anbieter, den du gewählt hast, und Schlüssel wie Einstellungen bleiben auf deinem Gerät. Ein Konto nur, wenn du eins willst.

KOSTENLOS UND QUELLOFFEN
Vollständig kostenlos und vollständig quelloffen.
```

## 国际版 · de-DE · promotionalText

```
Nicht nur übersetzen: Sätze, die du wirklich gelesen hast, kommen als Wiederholungskarten zurück – nach Vergessenskurve. Kostenlos, quelloffen, Schlüssel bleibt lokal.
```

---

## 国际版 · fr-FR · name

```
BelliedMonkey Traducteur
```

## 国际版 · fr-FR · subtitle

```
Lire en bilingue et retenir
```

## 国际版 · fr-FR · keywords

```
traduction,sous-titres,vocabulaire,fiches,révision,langues,anglais,mémorisation,gratuit,libre
```

## 国际版 · fr-FR · description

```
Lisez le web et regardez des vidéos en deux langues à la fois. Et les phrases que vous avez vraiment lues reviennent vers vous le lendemain.

PAGES BILINGUES
Activez la traduction : chaque paragraphe conserve son texte d'origine, la traduction s'affiche juste en dessous, dans une couleur distincte. Aucun changement d'onglet, aucune perte de repère.

SOUS-TITRES DOUBLES POUR LES VIDÉOS
Vidéos, podcasts et publications vidéo reçoivent des sous-titres bilingues alignés phrase à phrase : original en haut, traduction en dessous. La traduction est faite en avance sur la lecture, rien ne s'interrompt.

CE QUE VOUS LISEZ RESTE
Activez l'apprentissage : les phrases devant lesquelles vous vous êtes vraiment arrêté (celles que vous avez survolées ne comptent pas) deviennent des cartes de révision — exercices de lecture, d'écoute et d'écriture, explications de phrase et lecture à voix haute, planifiés selon la force de votre mémoire. Désactivé par défaut, et tout reste sur votre appareil.

SYNCHRONISATION (FACULTATIVE)
Connectez-vous avec une adresse e-mail gratuite et révisez sur votre téléphone ce que vous avez lu sur votre ordinateur. Ce que la synchronisation conserve sur nos serveurs : vos phrases et traductions enregistrées, l'URL et le titre de la page source, et les dates de révision — sous une forme lisible, uniquement pour votre compte. Supprimez une source ou votre compte et elle disparaît de tous vos appareils. Sans connexion, rien ne quitte votre appareil.

VOTRE PROPRE MOTEUR
Un canal gratuit fonctionne immédiatement, sans configuration. Pour une meilleure qualité, renseignez la clé de votre propre service d'IA, ou n'importe quel endpoint personnalisé compatible. Vous gardez la main.

CONFIDENTIEL PAR CONCEPTION
Aucun pistage, aucune publicité, aucune analyse tierce — seulement des données d'usage anonymes (quelles fonctions, jamais le contenu des pages), désactivables dans les réglages. Aucun serveur à nous sur le chemin de la traduction — votre texte part directement vers le fournisseur que vous avez choisi, et votre clé comme vos réglages restent sur votre appareil. Un compte seulement si vous en voulez un.

GRATUIT ET OUVERT
Entièrement gratuit et entièrement open source.
```

## 国际版 · fr-FR · promotionalText

```
Pas seulement traduire : les phrases vraiment lues reviennent en cartes de révision, selon la courbe de l'oubli. Gratuit, open source, clé gardée sur l'appareil.
```

---

## 国际版 · es-ES · name

```
BelliedMonkey Traductor
```

## 国际版 · es-ES · subtitle

```
Web bilingüe y subtítulos
```

## 国际版 · es-ES · keywords

```
traducción,vocabulario,tarjetas,repaso,idiomas,inglés,lectura,memoria,repetición,gratis,aprender
```

## 国际版 · es-ES · description

```
Lee la web y mira vídeos en dos idiomas a la vez. Y las frases que has leído de verdad vuelven a buscarte al día siguiente.

PÁGINAS BILINGÜES
Activa la traducción: cada párrafo conserva su texto original y la traducción aparece justo debajo, en un color distinto. Sin cambiar de pestaña, sin perder el hilo.

SUBTÍTULOS DOBLES EN VÍDEO
Vídeos, pódcast y publicaciones con vídeo reciben subtítulos bilingües alineados frase a frase: original arriba, traducción debajo. Se traduce por delante de la reproducción, así nada se detiene.

LO QUE LEES SE QUEDA
Activa el aprendizaje y las frases ante las que realmente te detuviste (las que pasaste de largo no cuentan) se convierten en tarjetas de repaso: ejercicios de lectura, escucha y escritura, notas de frase y lectura en voz alta, programados según la fuerza de tu memoria. Desactivado por defecto, y todo se queda en tu dispositivo.

SINCRONIZACIÓN (OPCIONAL)
Inicia sesión con una cuenta de correo gratuita y repasa en el móvil lo que leíste en el ordenador. Lo que la sincronización guarda en nuestros servidores: tus frases y traducciones guardadas, la URL y el título de la página de origen, y las fechas de repaso — en forma legible y solo para tu cuenta. Si borras una fuente o tu cuenta, desaparece de todos los dispositivos. Sin iniciar sesión, nada sale de tu dispositivo.

TU PROPIO MOTOR
Un canal gratuito funciona al instante, sin configuración. Si quieres más calidad, introduce la clave de tu propio servicio de IA, o cualquier endpoint personalizado compatible. Tú mandas.

PRIVADO POR DISEÑO
Sin rastreo, sin anuncios, sin analíticas de terceros: solo datos de uso anónimos (qué funciones, nunca el contenido de las páginas), desactivables en Ajustes. Ningún servidor nuestro en la ruta de traducción: tu texto va directo al proveedor que elijas, y tu clave y tus ajustes se quedan en tu dispositivo. Cuenta solo si tú quieres una.

GRATIS Y ABIERTO
Completamente gratis y completamente de código abierto.
```

## 国际版 · es-ES · promotionalText

```
No es solo traducir: las frases que lees vuelven como tarjetas de repaso, según la curva del olvido. Gratis, código abierto, tu clave se queda en el dispositivo.
```

---

## 国际版 · ru · name

```
BelliedMonkey Переводчик
```

## 国际版 · ru · subtitle

```
Двуязычный веб и субтитры
```

## 国际版 · ru · keywords

```
словарь,карточки,повторение,языки,английский,чтение,память,запоминание,бесплатно,японский,статьи
```

## 国际版 · ru · description

```
Читайте веб и смотрите видео сразу на двух языках. А фразы, которые вы действительно прочитали, вернутся к вам на следующий день.

ДВУЯЗЫЧНЫЕ СТРАНИЦЫ
Включите перевод: каждый абзац сохраняет оригинал, а перевод появляется прямо под ним, другим цветом. Не нужно переключать вкладки и терять место в тексте.

ДВОЙНЫЕ СУБТИТРЫ К ВИДЕО
Для видео, подкастов и видеопостов — двуязычные субтитры с пофразовым соответствием: оригинал сверху, перевод снизу. Перевод идёт с опережением воспроизведения, поэтому ничего не подвисает.

ПРОЧИТАННОЕ ОСТАЁТСЯ
Включите обучение — и фразы, на которых вы действительно остановились (пролистанные не считаются), станут карточками для повторения: упражнения на чтение, аудирование и письмо, разборы предложений и озвучивание, по силе запоминания. По умолчанию выключено, и всё остаётся на вашем устройстве.

СИНХРОНИЗАЦИЯ (ПО ЖЕЛАНИЮ)
Войдите с бесплатным почтовым адресом — и повторяйте на телефоне то, что прочитали на компьютере. Что синхронизация хранит на наших серверах: сохранённые фразы и переводы, адрес и заголовок страницы-источника, а также время повторений — в читаемом виде и только для вашей учётной записи. Удалите источник или учётную запись — и он исчезнет со всех устройств. Без входа ничего не покидает ваше устройство.

СВОЙ ДВИЖОК
Бесплатный канал работает сразу, без настройки. Нужно качество выше — укажите ключ своего ИИ-сервиса или любую совместимую собственную конечную точку. Решение всегда за вами.

ПРИВАТНОСТЬ ПО УМОЛЧАНИЮ
Никакой слежки, рекламы и сторонней аналитики — только анонимные данные об использовании (какие функции, никогда содержимое страниц), отключаются в настройках. На пути перевода нет наших серверов: текст идёт напрямую выбранному вами поставщику, а ключ и настройки остаются на устройстве. Учётная запись — только если она вам нужна.

БЕСПЛАТНО И ОТКРЫТО
Полностью бесплатно и полностью с открытым исходным кодом.
```

## 国际版 · ru · promotionalText

```
Не просто перевод: фразы, которые вы действительно прочитали, возвращаются карточками по кривой забывания. Бесплатно, открытый код, ключ остаётся на устройстве.
```

---

## 国际版 · pt-BR · name

```
BelliedMonkey Tradutor
```

## 国际版 · pt-BR · subtitle

```
Web bilíngue e legendas
```

## 国际版 · pt-BR · keywords

```
tradução,vocabulário,flashcards,revisão,idiomas,inglês,leitura,memória,repetição,grátis,aprender
```

## 国际版 · pt-BR · description

```
Leia a web e assista a vídeos em dois idiomas ao mesmo tempo. E as frases que você realmente leu voltam para você no dia seguinte.

PÁGINAS BILÍNGUES
Ative a tradução: cada parágrafo mantém o texto original e a tradução aparece logo abaixo, em uma cor distinta. Sem trocar de aba, sem perder o ponto da leitura.

LEGENDAS DUPLAS EM VÍDEO
Vídeos, podcasts e publicações em vídeo ganham legendas bilíngues alinhadas frase a frase: original em cima, tradução embaixo. A tradução vai à frente da reprodução, então nada trava.

O QUE VOCÊ LÊ FICA
Ative o aprendizado e as frases em que você realmente parou (as que passou correndo não contam) viram cartões de revisão: exercícios de leitura, escuta e escrita, notas de frase e leitura em voz alta, agendados pela força da memória. Desligado por padrão, e tudo fica no seu aparelho.

SINCRONIZAÇÃO (OPCIONAL)
Entre com uma conta de e-mail gratuita e revise no celular o que leu no computador. O que a sincronização guarda nos nossos servidores: suas frases e traduções salvas, o endereço e o título da página de origem, e os horários de revisão — em forma legível e apenas para a sua conta. Apague uma fonte ou sua conta e ela some de todos os aparelhos. Sem entrar, nada sai do seu aparelho.

SEU PRÓPRIO MOTOR
Um canal gratuito funciona na hora, sem configuração. Quer mais qualidade? Coloque a chave do seu próprio serviço de IA, ou qualquer endpoint personalizado compatível. O controle é sempre seu.

PRIVADO POR PADRÃO
Sem rastreamento, sem anúncios, sem analytics de terceiros — só dados de uso anônimos (quais recursos, nunca o conteúdo das páginas), desligáveis nos Ajustes. Nenhum servidor nosso no caminho da tradução: seu texto vai direto para o provedor que você escolheu, e sua chave e ajustes ficam no aparelho. Conta só se você quiser uma.

GRÁTIS E ABERTO
Totalmente gratuito e totalmente de código aberto.
```

## 国际版 · pt-BR · promotionalText

```
Não é só traduzir: as frases que você realmente leu voltam como cartões de revisão, pela curva do esquecimento. Grátis, código aberto, sua chave fica no aparelho.
```

---

## 国际版 · ar-SA · name

```
BelliedMonkey مترجم
```

## 国际版 · ar-SA · subtitle

```
ويب ثنائي اللغة وترجمة الفيديو
```

## 国际版 · ar-SA · keywords

```
مفردات,بطاقات,مراجعة,لغات,إنجليزي,ياباني,قراءة,ذاكرة,تكرار,مجاني,مفتوح المصدر,إضافة,أخبار,تعلم
```

## 国际版 · ar-SA · description

```
اقرأ الويب وشاهد الفيديو بلغتين في آنٍ واحد. والجُمل التي قرأتها فعلاً تعود إليك في اليوم التالي.

صفحات بلغتين
شغّل الترجمة: تبقى كل فقرة بنصها الأصلي، وتظهر الترجمة أسفلها مباشرةً بلون مختلف. لا تنقّل بين علامات التبويب، ولا فقدان لموضع القراءة.

ترجمة مزدوجة للفيديو
تحصل مقاطع الفيديو والبودكاست والمنشورات المصوّرة على ترجمة ثنائية مطابقة جملةً بجملة: الأصل في الأعلى والترجمة أسفله. تتم الترجمة قبل التشغيل، فلا يتوقف شيء.

ما تقرأه يبقى معك
شغّل التعلّم، فتتحول الجُمل التي توقفت عندها فعلاً (وليست التي مررت عليها سريعًا) إلى بطاقات مراجعة: تمارين قراءة واستماع وكتابة، وشرح للجُمل، وقراءة صوتية، مرتّبة حسب قوة التذكّر. مُعطّل افتراضيًا، وكل شيء يبقى على جهازك.

المزامنة (اختيارية)
سجّل الدخول ببريد إلكتروني مجاني لتراجع على هاتفك ما قرأته على حاسوبك. ما تحفظه المزامنة على خوادمنا: الجُمل والترجمات التي حفظتها، وعنوان صفحة المصدر وعنوانها، وأوقات المراجعة — بصيغة مقروءة ولحسابك وحدك. احذف مصدرًا أو حسابك فيُحذف من كل الأجهزة. وبدون تسجيل الدخول لا يغادر شيء جهازك.

محرّكك أنت
هناك قناة مجانية تعمل فورًا دون أي إعداد. وإن أردت جودة أعلى، أدخل مفتاح خدمة الذكاء الاصطناعي الخاصة بك، أو أي نقطة نهاية مخصّصة متوافقة. القرار لك دائمًا.

الخصوصية من التصميم
لا تتبّع ولا قياسات ولا إعلانات. لا خادم لنا في مسار الترجمة: يذهب نصّك مباشرةً إلى المزوّد الذي اخترته، ويبقى مفتاحك وإعداداتك على جهازك. والحساب فقط إن أردته.

مجاني ومفتوح
مجاني بالكامل ومفتوح المصدر بالكامل.
```

## 国际版 · ar-SA · promotionalText

```
ليست مجرد ترجمة: الجُمل التي قرأتها فعلاً تعود بطاقاتِ مراجعة وفق منحنى النسيان. مجاني ومفتوح المصدر، ومفتاحك يبقى على جهازك.
```

## 国际版 · it · name

```
BelliedMonkey Traduttore
```

## 国际版 · it · subtitle

```
Web bilingue e sottotitoli
```

## 国际版 · it · keywords

```
inglese,tradurre,vocaboli,ripasso,lettura,notizie,memoria,video,imparare,gratis,flashcard,podcast
```

## 国际版 · it · description

```
Un'estensione per Safari che ti fa leggere il web e guardare i video in due lingue insieme — e ricordare davvero quello che leggi.

PAGINE BILINGUI
Attiva la traduzione e ogni paragrafo conserva il testo originale, con la traduzione subito sotto, in un colore distinto. Nessun cambio di scheda, nessun segno perso: si legge e basta.

SOTTOTITOLI DOPPI PER I VIDEO
Video, podcast e post con video ottengono sottotitoli bilingui allineati frase per frase: originale sopra, traduzione sotto. La traduzione va in anticipo sulla riproduzione, così non si inceppa.

LEGGI E TI RESTA
Attiva l'apprendimento e le frasi che hai davvero letto diventano carte di ripasso: esercizi di lettura, ascolto e scrittura, note sulla frase e lettura ad alta voce, programmati in base alla forza della memoria. Disattivato di default, e tutto resta sul tuo dispositivo.

SINCRONIZZAZIONE TRA DISPOSITIVI (FACOLTATIVA)
Accedi con un account email gratuito e dal telefono potrai ripassare ciò che hai letto sul computer. Cosa conserva la sincronizzazione sui nostri server: le frasi e le traduzioni salvate, l'indirizzo e il titolo della pagina di origine e gli orari di ripasso — in forma leggibile e solo per il tuo account. Se elimini una fonte o il tuo account, spariscono da tutti i dispositivi. Senza accedere, niente lascia il tuo dispositivo.

SCEGLI TU IL MOTORE
Il canale gratuito funziona subito, senza configurazione. Vuoi più qualità? Inserisci la chiave del tuo servizio di IA, o qualsiasi endpoint personalizzato compatibile. Il controllo resta sempre tuo.

PRIVATO PER SCELTA
Nessun tracciamento, nessuna pubblicità, nessuna analisi di terze parti — solo dati d'uso anonimi (quali funzioni, mai il contenuto delle pagine), disattivabili nelle impostazioni. Nessun nostro server sul percorso della traduzione: il testo va direttamente al fornitore che scegli, e le tue chiavi e impostazioni restano sul dispositivo. Nessun account, a meno che tu non lo voglia. Tutta l'app è open source.

GRATIS E APERTA
BelliedMonkey Traduttore è gratuita e completamente open source.

Perfetta per leggere notizie e blog stranieri, studiare una lingua, seguire creator che parlano un'altra lingua e navigare il web globale come navighi quello di casa.
```

## 国际版 · it · promotionalText

```
Non il solito traduttore: le frasi che leggi davvero tornano come carte di ripasso sulla curva dell'oblio. Gratis, open source, la tua chiave resta sul dispositivo.
```

---

## 国际版 · tr · name

```
BelliedMonkey Çeviri
```

## 国际版 · tr · subtitle

```
İki dilli web ve altyazı
```

## 国际版 · tr · keywords

```
İngilizce,kelime,tekrar,okuma,haber,ezber,sözlük,yabancı,video,ücretsiz,podcast,öğrenme,dizi,film
```

## 国际版 · tr · description

```
Web'i okurken ve video izlerken iki dili aynı anda gösteren, okuduklarını gerçekten aklında tutmanı sağlayan bir Safari eklentisi.

İKİ DİLLİ SAYFALAR
Çeviriyi aç: her paragraf özgün metnini korur, çevirisi hemen altında ayrı bir renkte belirir. Sekme değiştirmek yok, kaldığın yeri kaybetmek yok — sadece oku.

VİDEOLARDA ÇİFT ALTYAZI
Videolar, podcast'ler ve videolu gönderiler cümle cümle eşleşen iki dilli altyazı alır: üstte özgün metin, altta çeviri. Çeviri oynatmanın önünden gittiği için takılma olmaz.

OKU, AKLINDA KALSIN
Öğrenmeyi açtığında gerçekten okuduğun cümleler tekrar kartlarına dönüşür: okuma, dinleme ve yazma alıştırmaları, cümle açıklamaları ve sesli okuma — hafızanın gücüne göre programlanır. Varsayılan olarak kapalıdır ve her şey cihazında kalır.

CİHAZLAR ARASI EŞİTLEME (İSTEĞE BAĞLI)
Ücretsiz bir e-posta hesabıyla giriş yap, bilgisayarında okuduklarını telefonundan tekrar et. Eşitlemenin sunucularımızda tuttukları: kaydettiğin cümleler ve çevirileri, kaynak sayfanın adresi ve başlığı, tekrar zamanları — okunabilir biçimde ve yalnızca senin hesabın için. Bir kaynağı ya da hesabını silersen hepsi tüm cihazlardan kalkar. Giriş yapmazsan hiçbir şey cihazından çıkmaz.

MOTORU SEN SEÇ
Ücretsiz kanal kurulum gerektirmeden çalışır. Daha iyi kalite mi istiyorsun? Kendi yapay zekâ servisinin anahtarını ya da uyumlu herhangi bir özel uç noktayı gir. Kontrol her zaman sende.

TASARIMDAN GİZLİ
Takip yok, telemetri yok, reklam yok. Çeviri yolunda bize ait hiçbir sunucu yok: metin doğrudan seçtiğin sağlayıcıya gider, anahtarların ve ayarların cihazında kalır. İstemezsen hesap gerekmez. Uygulamanın tamamı açık kaynaktır.

ÜCRETSİZ VE AÇIK
BelliedMonkey Çeviri ücretsizdir ve tamamen açık kaynaklıdır.

Yabancı haber ve blogları okumak, dil öğrenmek, başka bir dilde konuşan içerik üreticilerini takip etmek ve dünya web'inde kendi dilindeymiş gibi gezinmek için.
```

## 国际版 · tr · promotionalText

```
Sıradan bir çeviri aracı değil: gerçekten okuduğun cümleler unutma eğrisine göre tekrar kartı olarak geri gelir. Ücretsiz, açık kaynak, anahtarın cihazında kalır.
```

---

## 国际版 · vi · name

```
BelliedMonkey Dịch
```

## 国际版 · vi · subtitle

```
Web song ngữ và phụ đề kép
```

## 国际版 · vi · keywords

```
tiếng Anh,ngoại ngữ,từ vựng,ôn tập,đọc,tin tức,ghi nhớ,video,học,miễn phí,podcast,phim,luyện nghe
```

## 国际版 · vi · description

```
Tiện ích Safari giúp bạn đọc web và xem video bằng hai ngôn ngữ cùng lúc — và thật sự nhớ được những gì đã đọc.

TRANG WEB SONG NGỮ
Bật dịch: mỗi đoạn văn giữ nguyên bản gốc, bản dịch hiện ngay bên dưới bằng một màu riêng. Không phải đổi thẻ, không mất chỗ đang đọc — cứ thế mà đọc.

PHỤ ĐỀ KÉP CHO VIDEO
Video, podcast và bài đăng có video đều có phụ đề song ngữ khớp theo từng câu: bản gốc ở trên, bản dịch ở dưới. Bản dịch chạy trước phần phát nên không bị khựng.

ĐỌC XONG LÀ NHỚ
Bật phần học, những câu bạn thực sự đã đọc sẽ thành thẻ ôn tập: bài tập đọc, nghe và viết, ghi chú câu và đọc thành tiếng, được sắp lịch theo độ bền của trí nhớ. Mặc định tắt, và mọi thứ nằm trên máy bạn.

ĐỒNG BỘ GIỮA CÁC THIẾT BỊ (TÙY CHỌN)
Đăng nhập bằng một tài khoản email miễn phí, rồi ôn trên điện thoại những gì đã đọc trên máy tính. Đồng bộ lưu gì trên máy chủ của chúng tôi: các câu và bản dịch bạn đã lưu, địa chỉ và tiêu đề trang nguồn, thời điểm ôn tập — ở dạng đọc được và chỉ thuộc tài khoản của bạn. Xóa một nguồn hoặc xóa tài khoản là chúng biến mất khỏi mọi thiết bị. Không đăng nhập thì không có gì rời khỏi máy bạn.

TỰ CHỌN CỖ MÁY DỊCH
Kênh miễn phí chạy ngay, không cần cài đặt gì. Muốn chất lượng cao hơn? Điền khóa dịch vụ AI của riêng bạn, hoặc bất kỳ điểm cuối tùy chỉnh tương thích nào. Quyền quyết định luôn thuộc về bạn.

RIÊNG TƯ NGAY TỪ THIẾT KẾ
Không theo dõi, không quảng cáo, không phân tích của bên thứ ba — chỉ dữ liệu sử dụng ẩn danh (tính năng nào được dùng, không bao giờ là nội dung trang), tắt được trong Cài đặt. Không có máy chủ nào của chúng tôi nằm trên đường dịch: văn bản đi thẳng tới nhà cung cấp bạn chọn, còn khóa và cài đặt thì ở lại trên máy bạn. Không cần tài khoản trừ khi bạn muốn. Toàn bộ ứng dụng là mã nguồn mở.

MIỄN PHÍ VÀ MỞ
BelliedMonkey Dịch miễn phí và hoàn toàn mã nguồn mở.

Rất hợp để đọc tin tức và blog nước ngoài, học một ngoại ngữ, theo dõi những người sáng tạo nói thứ tiếng khác, và lướt web toàn cầu như lướt web tiếng mẹ đẻ.
```

## 国际版 · vi · promotionalText

```
Không chỉ là một công cụ dịch: những câu bạn thực sự đọc sẽ quay lại thành thẻ ôn tập theo đường cong quên. Miễn phí, mã nguồn mở, khóa nằm trên máy bạn.
```

---

## 国际版 · pl · name

```
BelliedMonkey Tłumacz
```

## 国际版 · pl · subtitle

```
Dwujęzyczny web i napisy
```

## 国际版 · pl · keywords

```
angielski,języki,słówka,powtórki,czytanie,wiadomości,pamięć,fiszki,nauka,video,darmowy,podcast
```

## 国际版 · pl · description

```
Rozszerzenie Safari, dzięki któremu czytasz sieć i oglądasz filmy w dwóch językach naraz — i naprawdę zapamiętujesz to, co przeczytasz.

DWUJĘZYCZNE STRONY
Włącz tłumaczenie: każdy akapit zachowuje oryginalny tekst, a tłumaczenie pojawia się tuż pod nim, w wyróżnionym kolorze. Bez przełączania kart, bez gubienia miejsca — po prostu czytasz.

PODWÓJNE NAPISY DO FILMÓW
Filmy, podcasty i wpisy z wideo dostają dwujęzyczne napisy dopasowane zdanie po zdaniu: oryginał na górze, tłumaczenie pod spodem. Tłumaczenie wyprzedza odtwarzanie, więc nic się nie zacina.

PRZECZYTANE ZOSTAJE
Włącz naukę, a zdania, które faktycznie przeczytasz, staną się fiszkami do powtórek: ćwiczenia z czytania, słuchania i pisania, objaśnienia zdań oraz czytanie na głos, planowane według siły pamięci. Domyślnie wyłączone, a wszystko zostaje na Twoim urządzeniu.

SYNCHRONIZACJA MIĘDZY URZĄDZENIAMI (OPCJONALNA)
Zaloguj się darmowym kontem e-mail, a na telefonie powtórzysz to, co przeczytałeś na komputerze. Co synchronizacja przechowuje na naszych serwerach: zapisane zdania i ich tłumaczenia, adres i tytuł strony źródłowej oraz terminy powtórek — w czytelnej postaci i wyłącznie dla Twojego konta. Usunięcie źródła lub konta kasuje je ze wszystkich urządzeń. Bez logowania nic nie opuszcza Twojego urządzenia.

SILNIK WYBIERASZ TY
Darmowy kanał działa od razu, bez konfiguracji. Chcesz wyższej jakości? Wpisz klucz własnej usługi AI albo dowolny zgodny własny endpoint. Kontrolę zawsze masz Ty.

PRYWATNE Z ZAŁOŻENIA
Bez śledzenia, bez reklam, bez analityki firm trzecich — tylko anonimowe dane o użyciu (które funkcje, nigdy treść stron), do wyłączenia w ustawieniach. Na drodze tłumaczenia nie ma żadnego naszego serwera: tekst idzie prosto do wybranego przez Ciebie dostawcy, a klucze i ustawienia zostają na urządzeniu. Konto tylko wtedy, gdy sam zechcesz. Cała aplikacja jest open source.

DARMOWE I OTWARTE
BelliedMonkey Tłumacz jest darmowy i w pełni otwartoźródłowy.

Świetny do czytania zagranicznych wiadomości i blogów, nauki języka, śledzenia twórców mówiących w innym języku i przeglądania światowej sieci tak, jak przeglądasz swoją.
```

## 国际版 · pl · promotionalText

```
To nie kolejny tłumacz: zdania, które faktycznie przeczytasz, wracają jako fiszki na krzywej zapominania. Za darmo, open source, klucz zostaje na urządzeniu.
```
