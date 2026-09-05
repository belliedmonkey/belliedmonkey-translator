# Firefox AMO 商店文案

`scripts/amo-listing.js` 读这一份，`test/amo-copy.test.js` 守它。标题格式：

```
## <locale> · <description>
```

AMO 的 `name` 与 `summary` 已经是 10 个 locale，**这里只管 `description`** ——
它此前只有 en-US 与 zh-CN 两个，其余 8 个 locale 的用户看到的是 zh-CN（`default_locale`）。

## 三条约束

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

---

## de · description

```
Das Web lesen und Videos schauen – in zwei Sprachen gleichzeitig, und das Gelesene wirklich behalten.

ZWEISPRACHIGE SEITEN – Jeder Absatz behält seinen Originaltext, die Übersetzung steht direkt darunter, in einer Farbe deiner Wahl. Kein Tab-Wechsel, kein Verlieren der Textstelle.
DOPPELTE UNTERTITEL – Videos, Podcasts und Video-Beiträge bekommen satzweise zugeordnete zweisprachige Untertitel: Original oben, Übersetzung darunter, der Wiedergabe voraus übersetzt.
LESEN UND BEHALTEN – Schalte das Lernen ein, und die Sätze, die du wirklich gelesen hast, werden zu Wiederholungskarten: Lese-, Hör- und Schreibübungen, Satzerklärungen und Vorlesen, geplant nach Gedächtnisstärke. Mit Synchronisierung wiederholst du sie auch auf dem Handy.
EIGENER SCHLÜSSEL – Trage den Schlüssel deines eigenen KI-Dienstes ein, oder einen beliebigen kompatiblen eigenen Endpunkt.
PRIVAT VON GRUND AUF – Kein Konto nötig, kein Tracking, keine Drittanbieter-Analysen (nur anonyme Nutzungsdaten, abschaltbar) und kein Server von uns im Übersetzungsweg: Dein Text geht direkt aus dem Browser an die von dir gewählte Engine, mit deinem Schlüssel. Die Synchronisierung über mehrere Geräte ist optional und bleibt aus, bis du dich anmeldest. Kostenlos und quelloffen.

Website: https://belliedmonkey.cc
```

## es-ES · description

```
Lee la web y mira vídeos en dos idiomas a la vez, y recuerda de verdad lo que has leído.

PÁGINAS BILINGÜES — Cada párrafo conserva su texto original con la traducción justo debajo, en el color que elijas. Sin cambiar de pestaña, sin perder el hilo.
SUBTÍTULOS DOBLES — Vídeos, pódcast y publicaciones con vídeo obtienen subtítulos bilingües alineados frase a frase: original arriba, traducción debajo, traducidos por delante de la reproducción.
LÉELO Y QUÉDATELO — Activa el aprendizaje y las frases que realmente lees se convierten en tarjetas de repaso: ejercicios de lectura, escucha y escritura, notas de frase y lectura en voz alta, programados según la fuerza de tu memoria. Con la sincronización activada, repasa desde el móvil.
TU PROPIA CLAVE — Introduce la clave de tu propio servicio de IA, o cualquier endpoint personalizado compatible.
PRIVADO POR DISEÑO — Sin cuenta, sin rastreo y sin ningún servidor nuestro en la ruta de traducción: tu texto va directo del navegador al motor que elijas, con tu clave. La sincronización entre dispositivos es opcional y está desactivada hasta que inicies sesión. Gratis y de código abierto.

Sitio web: https://belliedmonkey.cc
```

## fr · description

```
Lisez le web et regardez des vidéos en deux langues à la fois — et retenez vraiment ce que vous lisez.

PAGES BILINGUES — Chaque paragraphe conserve son texte d'origine, la traduction s'affiche juste en dessous, dans la couleur de votre choix. Aucun changement d'onglet, aucune perte de repère.
SOUS-TITRES DOUBLES — Vidéos, podcasts et publications vidéo reçoivent des sous-titres bilingues alignés phrase à phrase : original en haut, traduction en dessous, traduits en avance sur la lecture.
LIRE ET RETENIR — Activez l'apprentissage : les phrases que vous avez vraiment lues deviennent des cartes de révision — exercices de lecture, d'écoute et d'écriture, explications de phrase et lecture à voix haute, planifiés selon la force de votre mémoire. Avec la synchronisation, révisez aussi sur votre téléphone.
VOTRE PROPRE CLÉ — Renseignez la clé de votre propre service d'IA, ou n'importe quel endpoint personnalisé compatible.
CONFIDENTIEL PAR CONCEPTION — Aucun compte, aucun pistage, et aucun serveur à nous sur le chemin de la traduction : votre texte va directement du navigateur au moteur que vous avez choisi, avec votre clé. La synchronisation multi-appareils est facultative et reste désactivée tant que vous ne vous connectez pas. Gratuit et open source.

Site web : https://belliedmonkey.cc
```

## ja · description

```
ウェブも動画も二言語で同時に——そして読んだ内容を本当に覚える。

【対訳ページ】段落ごとに原文をそのまま残し、そのすぐ下に訳文を、好きな色で表示します。タブを切り替える必要も、読んでいた場所を見失うこともありません。
【二言語字幕】動画・ポッドキャスト・動画付き投稿に、文単位で対応した二言語字幕を表示します。原文が上、訳文が下、再生に先回りして翻訳します。
【読んだ文が身につく】学習をオンにすると、実際に読んだ文が復習カードになります。読む・聞く・書くの練習、文の解説、読み上げを、記憶の強さに合わせて出題。同期をオンにすればスマートフォンでも復習できます。
【自分のキーで】お使いの AI サービスのキー、または互換性のある任意のカスタムエンドポイントを設定できます。
【設計からプライバシー優先】アカウント不要、トラッキングなし、翻訳経路に当方のサーバーは一切ありません。テキストはブラウザーから、あなたが選んだエンジンへ、あなたのキーで直接送られます。複数端末の同期は任意で、サインインするまで無効のままです。無料・オープンソース。

ウェブサイト：https://belliedmonkey.cc
```

## ko · description

```
웹도 영상도 두 언어로 동시에 — 그리고 읽은 내용을 실제로 기억하세요.

【대역 웹페이지】문단마다 원문을 그대로 두고 바로 아래에 번역문을 원하는 색으로 표시합니다. 탭을 옮길 필요도, 읽던 자리를 잃을 일도 없습니다.
【이중 자막】영상, 팟캐스트, 영상 게시물에 문장 단위로 맞춘 이중 자막을 표시합니다. 원문이 위, 번역이 아래, 재생보다 앞서 번역합니다.
【읽은 문장이 남습니다】학습을 켜면 실제로 읽은 문장이 복습 카드가 됩니다. 읽기·듣기·쓰기 연습, 문장 해설, 읽어주기를 기억 강도에 맞춰 배치합니다. 동기화를 켜면 휴대폰에서도 복습할 수 있습니다.
【내 키로】사용 중인 AI 서비스의 키, 또는 호환되는 임의의 사용자 지정 엔드포인트를 넣으세요.
【설계부터 프라이버시】계정이 필요 없고, 추적하지 않으며, 번역 경로에 저희 서버는 없습니다. 텍스트는 브라우저에서 여러분이 고른 엔진으로, 여러분의 키와 함께 곧바로 전송됩니다. 여러 기기 동기화는 선택 사항이며 로그인하기 전까지 꺼져 있습니다. 무료, 오픈 소스.

웹사이트: https://belliedmonkey.cc
```

## pt-PT · description

```
Leia a web e assista a vídeos em dois idiomas ao mesmo tempo — e lembre-se de verdade do que leu.

PÁGINAS BILÍNGUES — Cada parágrafo mantém o texto original com a tradução logo abaixo, na cor que você escolher. Sem trocar de aba, sem perder o ponto da leitura.
LEGENDAS DUPLAS — Vídeos, podcasts e publicações em vídeo ganham legendas bilíngues alinhadas frase a frase: original em cima, tradução embaixo, traduzidas à frente da reprodução.
LEU, GUARDOU — Ative o aprendizado e as frases que você realmente leu viram cartões de revisão: exercícios de leitura, escuta e escrita, notas de frase e leitura em voz alta, agendados pela força da memória. Com a sincronização ligada, revise pelo celular.
SUA PRÓPRIA CHAVE — Use a chave do seu próprio serviço de IA, ou qualquer endpoint personalizado compatível.
PRIVADO POR PADRÃO — Sem conta, sem rastreamento e sem nenhum servidor nosso no caminho da tradução: seu texto vai direto do navegador para o motor que você escolheu, com a sua chave. A sincronização entre dispositivos é opcional e fica desligada até você entrar. Gratuito e de código aberto.

Site: https://belliedmonkey.cc
```

## ru · description

```
Читайте веб и смотрите видео сразу на двух языках — и действительно запоминайте прочитанное.

ДВУЯЗЫЧНЫЕ СТРАНИЦЫ — Каждый абзац сохраняет оригинал, а перевод появляется прямо под ним, в выбранном вами цвете. Не нужно переключать вкладки и терять место в тексте.
ДВОЙНЫЕ СУБТИТРЫ — Для видео, подкастов и видеопостов — двуязычные субтитры с пофразовым соответствием: оригинал сверху, перевод снизу, перевод идёт с опережением воспроизведения.
ПРОЧИТАЛ — ЗАПОМНИЛ — Включите обучение, и фразы, которые вы действительно прочитали, станут карточками для повторения: упражнения на чтение, аудирование и письмо, разборы предложений и озвучивание — по силе запоминания. С включённой синхронизацией повторяйте с телефона.
СВОЙ КЛЮЧ — Укажите ключ своего ИИ-сервиса или любую совместимую собственную конечную точку.
ПРИВАТНОСТЬ ПО УМОЛЧАНИЮ — Аккаунт не нужен, слежки нет, и на пути перевода нет наших серверов: текст идёт из браузера прямо в выбранный вами движок с вашим ключом. Синхронизация между устройствами необязательна и выключена, пока вы не войдёте. Бесплатно и с открытым исходным кодом.

Сайт: https://belliedmonkey.cc
```

## zh-TW · description

```
用兩種語言同時讀網頁、看影片——讀過的句子還能真正記住。

【雙語網頁】每個段落保留原文，譯文以你選的顏色顯示在正下方。不必切換分頁，也不會弄丟閱讀位置。
【影片雙語字幕】影片、Podcast 與影片貼文都能有逐句對齊的雙語字幕——原文在上、譯文在下，提前翻譯整句，播放不卡頓。
【讀過即累積】開啟學習後，真正讀過的句子會自動變成複習卡：讀・聽・寫多種練習，加上句子解析與朗讀，依記憶強度安排複習；開啟同步後，手機上也能複習。
【自備金鑰】填入你自己的 AI 服務金鑰，或任何相容的自訂端點。
【隱私優先】不需帳號、沒有追蹤，翻譯路徑上也沒有我們的伺服器：文字從瀏覽器直接送到你選的引擎，用的是你自己的金鑰。跨裝置同步是選用功能，你不登入就不會開啟。免費、開放原始碼。

網站：https://belliedmonkey.cc
```

## en-US · description

```
Read the web and watch videos in two languages at once — and actually remember what you read.

BILINGUAL PAGES — Every paragraph keeps its original text with the translation right below it, in a color you choose. No tab switching, no losing your place.
DUAL SUBTITLES — Videos, podcasts and video posts get sentence-matched dual subtitles: original on top, translation below, translated ahead of playback.
READ IT, KEEP IT — Turn on learning and the sentences you actually read become review cards: read/listen/write exercises, sentence notes and read-aloud, scheduled by memory strength. Review on your phone with sync on.
BRING YOUR OWN KEY — Plug in your own AI service key, or any compatible custom endpoint.
PRIVATE BY DESIGN — No account needed, no tracking, no third-party analytics (only anonymous usage events, off in one switch), and no server of ours in the translation path: your text goes straight from your browser to the engine you picked, with your key. Multi-device sync is optional, off until you sign in. Free and open source.

Website: https://belliedmonkey.cc
```

## zh-CN · description

```
用两种语言同时读网页、看视频——读过的句子还能真正记住。

【双语网页】每个段落保留原文，译文以你选的颜色显示在正下方。不切换页面、不丢上下文。
【视频双语字幕】视频、播客与视频帖逐句对齐的双语字幕——原文在上、译文在下，提前翻译整句，播放不卡顿。
【读过即积累】开启学习后，真正读过的句子自动变成复习卡：读·听·写多种练习 + 句子解析 + 朗读，按记忆强度安排复习；开同步后手机上也能复习。
【自带 key】填入你自己的 AI 服务密钥，或任何兼容的自定义接口。
【隐私优先】无账号、无追踪、无第三方统计（只有可关闭的匿名用量事件）、无中间服务器——密钥与设置只存在你的设备上。开源免费。

官网：https://belliedmonkey.cc
```
