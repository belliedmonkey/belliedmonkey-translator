# Firefox AMO 商店文案

`scripts/amo-listing.js` 读这一份，`test/amo-copy.test.js` 守它。标题格式：

```
## <locale> · <description>
```

AMO 的 `name` 与 `summary` 已经是 10 个 locale，**这里只管 `description`** ——
它此前只有 en-US 与 zh-CN 两个，其余 8 个 locale 的用户看到的是 zh-CN（`default_locale`）。

## 四条约束

1. **一个 HTML 标签都不要写，网址写成裸的。** API 的 PATCH 会把 HTML **转义成文字** ——
   写 `<a href="…">` 进去，商店页上显示的就是这一串标签本身。AMO 自己会把裸网址
   linkify（这也正是线上那条坏链接的来历：有人写了转义的 `&lt;a&gt;`，AMO 把它里面的
   裸网址接管了，于是英文页面上显示出两百字符的 `prod.outgoing…` 跳转地址）。
   把链接交给 AMO 做，我们只写地址。`scripts/amo-listing.js` 会硬拦回读里出现的
   `&lt;a`。
2. **不写具体的引擎品牌名。** 商店文案一旦点名就得跟着注册表走
   （`build/providers.config.js` 是唯一来源），而商店文案改不动那么勤。说「你自己的
   AI 服务密钥」。
3. **pt-PT 槽位里是巴西葡语。** 现有的 name/summary 就是这样（`você` / `aprendizado`），
   而扩展自己出的是 `pt_BR`。这里保持与既有 summary 同一语域，不在这一版擅自改槽位 ——
   换成 pt-BR 会让 pt-PT 那条留在线上无人认领。
4. **口径红线**（2026-09-15 起由 `test/lib/copy-redlines.js` 拦）：不说「没有追踪」（发匿名用量事件，可关）、
   不说不加限定的「完全免费」、不说「路径上没有我们的服务器」（免费额度经我们的中继）。

> 2026-09-15（1.11.0）重写：补上 AI 转写字幕、文档翻译、免费额度，隐私段按路径说；末尾一句指向 App 的
> 实时字幕与对话听译（Firefox 版本身没有这两个功能，只能说「App 里有」）。

---

## de · description

```
Das Web lesen und Videos schauen – in zwei Sprachen gleichzeitig, und das Gelesene wirklich behalten.

ZWEISPRACHIGE SEITEN – Jeder Absatz behält seinen Originaltext, die Übersetzung steht direkt darunter, in einer Farbe deiner Wahl. Kein Tab-Wechsel, kein Verlieren der Textstelle.
DOPPELTE UNTERTITEL – YouTube, Podcasts und Video-Beiträge bekommen satzweise zugeordnete zweisprachige Untertitel: Original oben, Übersetzung darunter, der Wiedergabe voraus übersetzt. Keine Untertitel? Schalte KI-Transkript-Untertitel ein.
DOKUMENTE – Öffne ein PDF, eine Word-Datei oder ein Bild und lies Seite für Seite Original und Übersetzung nebeneinander.
LESEN UND BEHALTEN – Schalte das Lernen ein, und die Sätze, die du wirklich gelesen hast, werden zu Wiederholungskarten: Lese-, Hör- und Schreibübungen, Satzerklärungen und Vorlesen, geplant nach Gedächtnisstärke. Mit Synchronisierung wiederholst du sie auch auf dem Handy.
DEINE ENGINE – Trage den Schlüssel deines eigenen KI-Dienstes oder einen kompatiblen Endpunkt ein; angemeldet kannst du auch ein kleines Gratis-Guthaben von uns ausprobieren.
DATENSCHUTZ, KLAR GESAGT – Kein Konto nötig. Schlüssel und Einstellungen bleiben in deinem Browser. Mit eigenem Schlüssel geht der Text direkt an den gewählten Anbieter; mit dem Gratis-Guthaben läuft er über unser Relay und wird nicht gespeichert. Wir senden anonyme Nutzungsdaten (welche Funktionen, nie Seiteninhalte), mit einem Schalter abschaltbar. Die Synchronisierung über mehrere Geräte ist optional und bleibt aus, bis du dich anmeldest. Quelloffen.

Auf iPhone und Mac bringt die BelliedMonkey-App außerdem Live-Untertitel für alles, was auf dem Gerät läuft, und einen Gesprächsdolmetscher. Beide erkennen Sprache auf dem Gerät und benötigen iOS 26 / macOS 26.

Website: https://belliedmonkey.cc
```

## es-ES · description

```
Lee la web y mira vídeos en dos idiomas a la vez, y recuerda de verdad lo que has leído.

PÁGINAS BILINGÜES — Cada párrafo conserva su texto original con la traducción justo debajo, en el color que elijas. Sin cambiar de pestaña, sin perder el hilo.
SUBTÍTULOS DOBLES — YouTube, pódcast y publicaciones con vídeo obtienen subtítulos bilingües alineados frase a frase: original arriba, traducción debajo, traducidos por delante de la reproducción. ¿Sin subtítulos? Activa los subtítulos por transcripción con IA.
DOCUMENTOS — Abre un PDF, un archivo de Word o una imagen y lee página a página el original y la traducción lado a lado.
LÉELO Y QUÉDATELO — Activa el aprendizaje y las frases que realmente lees se convierten en tarjetas de repaso: ejercicios de lectura, escucha y escritura, notas de frase y lectura en voz alta, programados según la fuerza de tu memoria. Con la sincronización activada, repasa desde el móvil.
TU MOTOR — Introduce la clave de tu propio servicio de IA o un endpoint compatible; con sesión iniciada, también puedes probar un pequeño crédito gratuito nuestro.
PRIVACIDAD, SIN RODEOS — No hace falta cuenta. Tus claves y ajustes se quedan en tu navegador. Con tu clave, el texto va directo al proveedor que elegiste; con el crédito gratuito, pasa por nuestro relé y no se guarda. Enviamos datos de uso anónimos (qué funciones, nunca el contenido de las páginas), desactivables con un interruptor. La sincronización entre dispositivos es opcional y está desactivada hasta que inicies sesión. Código abierto.

En iPhone y Mac, la app BelliedMonkey añade subtítulos en vivo para todo lo que suena en el dispositivo y un intérprete de conversación. Ambos reconocen la voz en el dispositivo y requieren iOS 26 / macOS 26.

Sitio web: https://belliedmonkey.cc
```

## fr · description

```
Lisez le web et regardez des vidéos en deux langues à la fois — et retenez vraiment ce que vous lisez.

PAGES BILINGUES — Chaque paragraphe conserve son texte d'origine, la traduction s'affiche juste en dessous, dans la couleur de votre choix. Aucun changement d'onglet, aucune perte de repère.
SOUS-TITRES DOUBLES — YouTube, podcasts et publications vidéo reçoivent des sous-titres bilingues alignés phrase à phrase : original en haut, traduction en dessous, traduits en avance sur la lecture. Pas de sous-titres ? Activez les sous-titres par transcription IA.
DOCUMENTS — Ouvrez un PDF, un fichier Word ou une image et lisez page par page l'original et la traduction côte à côte.
LIRE ET RETENIR — Activez l'apprentissage : les phrases que vous avez vraiment lues deviennent des cartes de révision — exercices de lecture, d'écoute et d'écriture, explications de phrase et lecture à voix haute, planifiés selon la force de votre mémoire. Avec la synchronisation, révisez aussi sur votre téléphone.
VOTRE MOTEUR — Renseignez la clé de votre propre service d'IA ou un endpoint compatible ; une fois connecté, vous pouvez aussi essayer un petit crédit gratuit offert par nous.
LA CONFIDENTIALITÉ, CLAIREMENT — Aucun compte nécessaire. Vos clés et réglages restent dans votre navigateur. Avec votre clé, le texte va directement au fournisseur choisi ; avec le crédit gratuit, il passe par notre relais et n'est pas conservé. Nous envoyons des données d'usage anonymes (quelles fonctions, jamais le contenu des pages), désactivables d'un interrupteur. La synchronisation multi-appareils est facultative et reste désactivée tant que vous ne vous connectez pas. Open source.

Sur iPhone et Mac, l'app BelliedMonkey ajoute des sous-titres en direct pour tout ce qui joue sur l'appareil et un interprète de conversation. Les deux reconnaissent la parole sur l'appareil et nécessitent iOS 26 / macOS 26.

Site web : https://belliedmonkey.cc
```

## ja · description

```
ウェブも動画も二言語で同時に——そして読んだ内容を本当に覚える。

【対訳ページ】段落ごとに原文をそのまま残し、そのすぐ下に訳文を、好きな色で表示します。タブを切り替える必要も、読んでいた場所を見失うこともありません。
【二言語字幕】YouTube・ポッドキャスト・動画付き投稿に、文単位で対応した二言語字幕を表示します。原文が上、訳文が下、再生に先回りして翻訳します。字幕のない動画には AI 文字起こし字幕を使えます。
【文書翻訳】PDF・Word・画像を開き、ページごとに原文と訳文を並べて読めます。
【読んだ文が身につく】学習をオンにすると、実際に読んだ文が復習カードになります。読む・聞く・書くの練習、文の解説、読み上げを、記憶の強さに合わせて出題。同期をオンにすればスマートフォンでも復習できます。
【エンジンは自分で】お使いの AI サービスのキー、または互換性のある任意のエンドポイントを設定できます。サインインすると、当方の少額の無料クレジットも試せます。
【プライバシーを明確に】アカウント不要。キーと設定はブラウザーの中に保存されます。自分のキーならテキストは選んだ提供元へ直接、無料クレジットなら当方の中継を経由し、保存はしません。匿名の利用データ（使った機能のみ、ページ内容は含まず）を送信し、スイッチ一つでオフにできます。複数端末の同期は任意で、サインインするまで無効のままです。オープンソース。

iPhone と Mac の BelliedMonkey アプリには、端末で再生中の音声に付くライブ字幕と会話通訳もあります。どちらも端末上で音声を認識し、iOS 26 / macOS 26 が必要です。

ウェブサイト：https://belliedmonkey.cc
```

## ko · description

```
웹도 영상도 두 언어로 동시에 — 그리고 읽은 내용을 실제로 기억하세요.

【대역 웹페이지】문단마다 원문을 그대로 두고 바로 아래에 번역문을 원하는 색으로 표시합니다. 탭을 옮길 필요도, 읽던 자리를 잃을 일도 없습니다.
【이중 자막】YouTube, 팟캐스트, 영상 게시물에 문장 단위로 맞춘 이중 자막을 표시합니다. 원문이 위, 번역이 아래, 재생보다 앞서 번역합니다. 자막이 없는 영상에는 AI 받아쓰기 자막을 켤 수 있습니다.
【문서 번역】PDF, Word, 이미지를 열어 페이지마다 원문과 번역을 나란히 읽습니다.
【읽은 문장이 남습니다】학습을 켜면 실제로 읽은 문장이 복습 카드가 됩니다. 읽기·듣기·쓰기 연습, 문장 해설, 읽어주기를 기억 강도에 맞춰 배치합니다. 동기화를 켜면 휴대폰에서도 복습할 수 있습니다.
【엔진은 직접】사용 중인 AI 서비스의 키나 호환되는 엔드포인트를 넣으세요. 로그인하면 저희가 제공하는 소량의 무료 크레딧도 써 볼 수 있습니다.
【프라이버시, 분명하게】계정이 필요 없습니다. 키와 설정은 브라우저 안에 저장됩니다. 내 키를 쓰면 텍스트는 고른 제공자에게 곧바로 가고, 무료 크레딧을 쓰면 저희 중계를 거치며 저장하지 않습니다. 익명 사용 데이터(어떤 기능을 썼는지만, 페이지 내용 제외)를 보내며 스위치 하나로 끌 수 있습니다. 여러 기기 동기화는 선택 사항이며 로그인하기 전까지 꺼져 있습니다. 오픈 소스.

iPhone과 Mac용 BelliedMonkey 앱에는 기기에서 재생 중인 소리에 붙는 실시간 자막과 대화 통역도 있습니다. 둘 다 기기에서 음성을 인식하며 iOS 26 / macOS 26이 필요합니다.

웹사이트: https://belliedmonkey.cc
```

## pt-PT · description

```
Leia a web e assista a vídeos em dois idiomas ao mesmo tempo — e lembre-se de verdade do que leu.

PÁGINAS BILÍNGUES — Cada parágrafo mantém o texto original com a tradução logo abaixo, na cor que você escolher. Sem trocar de aba, sem perder o ponto da leitura.
LEGENDAS DUPLAS — YouTube, podcasts e publicações em vídeo ganham legendas bilíngues alinhadas frase a frase: original em cima, tradução embaixo, traduzidas à frente da reprodução. Sem legendas? Ative as legendas por transcrição com IA.
DOCUMENTOS — Abra um PDF, um arquivo do Word ou uma imagem e leia página a página o original e a tradução lado a lado.
LEU, GUARDOU — Ative o aprendizado e as frases que você realmente leu viram cartões de revisão: exercícios de leitura, escuta e escrita, notas de frase e leitura em voz alta, agendados pela força da memória. Com a sincronização ligada, revise pelo celular.
SEU MOTOR — Use a chave do seu próprio serviço de IA ou um endpoint compatível; com login, você também pode experimentar um pequeno crédito gratuito nosso.
PRIVACIDADE, SEM RODEIOS — Não precisa de conta. Suas chaves e ajustes ficam no navegador. Com a sua chave, o texto vai direto para o provedor escolhido; com o crédito gratuito, passa pelo nosso relé e não é armazenado. Enviamos dados de uso anônimos (quais recursos, nunca o conteúdo das páginas), desligáveis com um botão. A sincronização entre dispositivos é opcional e fica desligada até você entrar. Código aberto.

No iPhone e no Mac, o app BelliedMonkey traz também legendas ao vivo para tudo o que toca no aparelho e um intérprete de conversa. Os dois reconhecem a fala no aparelho e exigem iOS 26 / macOS 26.

Site: https://belliedmonkey.cc
```

## ru · description

```
Читайте веб и смотрите видео сразу на двух языках — и действительно запоминайте прочитанное.

ДВУЯЗЫЧНЫЕ СТРАНИЦЫ — Каждый абзац сохраняет оригинал, а перевод появляется прямо под ним, в выбранном вами цвете. Не нужно переключать вкладки и терять место в тексте.
ДВОЙНЫЕ СУБТИТРЫ — YouTube, подкасты и видеопосты получают двуязычные субтитры с пофразовым соответствием: оригинал сверху, перевод снизу, перевод идёт с опережением воспроизведения. Нет субтитров — включите ИИ-расшифровку.
ДОКУМЕНТЫ — Откройте PDF, файл Word или изображение и читайте постранично оригинал и перевод рядом.
ПРОЧИТАЛ — ЗАПОМНИЛ — Включите обучение, и фразы, которые вы действительно прочитали, станут карточками для повторения: упражнения на чтение, аудирование и письмо, разборы предложений и озвучивание — по силе запоминания. С включённой синхронизацией повторяйте с телефона.
СВОЙ ДВИЖОК — Укажите ключ своего ИИ-сервиса или совместимую конечную точку; после входа можно попробовать и небольшой бесплатный лимит от нас.
ПРИВАТНОСТЬ БЕЗ НЕДОМОЛВОК — Аккаунт не нужен. Ключи и настройки хранятся в браузере. Со своим ключом текст идёт напрямую выбранному поставщику; с бесплатным лимитом — через наш ретранслятор и не сохраняется. Мы отправляем анонимные данные об использовании (какие функции, никогда не содержимое страниц), отключаются одним переключателем. Синхронизация между устройствами необязательна и выключена, пока вы не войдёте. Открытый исходный код.

На iPhone и Mac приложение BelliedMonkey добавляет живые субтитры для всего, что звучит на устройстве, и переводчик для разговора.

Сайт: https://belliedmonkey.cc
```

## zh-TW · description

```
用兩種語言同時讀網頁、看影片——讀過的句子還能真正記住。

【雙語網頁】每個段落保留原文，譯文以你選的顏色顯示在正下方。不必切換分頁，也不會弄丟閱讀位置。
【影片雙語字幕】YouTube、Podcast 與影片貼文都能有逐句對齊的雙語字幕——原文在上、譯文在下，提前翻譯整句；沒有字幕的影片可以開啟 AI 轉寫字幕。
【文件翻譯】打開 PDF、Word 或圖片，逐頁原文譯文對照閱讀。
【讀過即累積】開啟學習後，真正讀過的句子會自動變成複習卡：讀・聽・寫多種練習，加上句子解析與朗讀，依記憶強度安排複習；開啟同步後，手機上也能複習。
【引擎你來選】填入你自己的 AI 服務金鑰，或任何相容的自訂端點；登入後也可以先用我們提供的一小份免費額度。
【隱私說清楚】不需帳號，金鑰與設定只存在你的瀏覽器裡。用自己的金鑰時，文字直接送往你選的服務商；用免費額度時經我們的中繼轉送、不保存。會傳送匿名使用資料（用了哪些功能，不含網頁內容），一個開關即可關閉。跨裝置同步是選用功能，登入後才開啟。開放原始碼。

iPhone 與 Mac 上的大肚猴翻譯 App 還有「即時字幕」（為裝置上正在播放的聲音配雙語字幕）與「對話 · 即時聽譯」。兩者都在裝置上辨識語音，需要 iOS 26 / macOS 26。

網站：https://belliedmonkey.cc
```

## en-US · description

```
Read the web and watch videos in two languages at once — and actually remember what you read.

BILINGUAL PAGES — Every paragraph keeps its original text with the translation right below it, in a color you choose. No tab switching, no losing your place.
DUAL SUBTITLES — YouTube, podcasts and video posts get sentence-matched dual subtitles: original on top, translation below, translated ahead of playback. No captions? Turn on AI transcript subtitles.
DOCUMENTS — Open a PDF, Word file or image and read it page by page, original and translation side by side.
READ IT, KEEP IT — Turn on learning and the sentences you actually read become review cards: read/listen/write exercises, sentence notes and read-aloud, scheduled by memory strength. Review on your phone with sync on.
YOUR ENGINE — Plug in your own AI service key or any compatible endpoint; once signed in, you can also try a small free credit from us.
PRIVACY, SPELLED OUT — No account needed. Your keys and settings stay in your browser. With your own key, text goes straight to the provider you picked; with the free credit it passes through our relay and is not stored. We send anonymous usage events (which features are used, never page content), off in one switch. Multi-device sync is optional, off until you sign in. Open source.

On iPhone and Mac, the BelliedMonkey Translator app adds Live Subtitles for anything playing on the device and a conversation interpreter. Both recognise speech on the device and need iOS 26 / macOS 26.

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

iPhone 与 Mac 上的大肚猴翻译 App 还有「实时字幕」（给设备上正在播放的声音配双语字幕）和「对话 · 实时听译」。两者都在设备上识别语音，需要 iOS 26 / macOS 26。

官网：https://belliedmonkey.cc
```
