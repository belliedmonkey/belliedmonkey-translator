# 1.8.0 发布说明（国际版 11 份 + 中国版 1 份 · iOS 与 macOS 同文）

> 两件新东西，都是「没有字幕 / 没有字幕可抓」的场景（PR #202、#205、#207、#209、#214）：
> ① 扩展：无字幕的播客与视频页，点一下「AI 转写字幕」，音频送到**你自己配置的**转写引擎生成
> 字幕，再走原有的双语字幕；直播是画面内逐词 + 旁边整句历史。② App：新模式「对话 · 实时听译」——
> 对方说、你看中文；按住说中文，译成外语给对方看并朗读；锁屏继续；定稿句进复习。顺带首页重设计。
> 隐私一句必须写（Gate E）：音频只发往你配置的端点，我们不接触、不保存录音。
> 中国版的转写引擎是通义千问（实时接口 #214），国际版是 OpenAI / Gemini；文案里只说「你配置的转写引擎」，
> 不点名（注册表是唯一登记处）。

---

## 国际版 · zh-Hans

```
两件新东西：
· 没有字幕的播客和视频，现在也能有双语字幕。在「字幕不可用」里点一下「AI 转写字幕」，音频会发到你自己配置的转写引擎生成字幕（直播是画面内逐词显示，旁边一栏整句历史）。
· App 新增「对话 · 实时听译」：对方说外语，你看中文；按住「我说」讲中文，译成外语给对方看，还能朗读。锁屏也继续听，说完的句子进复习。
另外 App 首页重做：今天该做的事收成一张卡。

隐私：音频只发往你自己配置的转写端点，我们的服务器不接触；不保存录音，只留文字。
```

## 国际版 · en-US

```
Two new things:
· Podcasts and videos with no subtitles can now get bilingual subtitles. Tap "AI transcript subtitles" where it says subtitles are unavailable, and the audio goes to the transcription engine you configured (live streams show word-by-word on the video, with a full-sentence history beside it).
· New in the app: "Conversation · live interpreter". They speak, you read Chinese; hold "I'll talk" to speak Chinese and show the translation — read aloud too. Keeps listening while locked; finished sentences go into review.
The app's home screen is redesigned around one card: what's due today.

Privacy: audio goes only to the transcription endpoint you configured — our servers never touch it. No recording is kept, only text.
```

## 中国版 · zh-Hans

```
两件新东西：
· 没有字幕的播客和视频，现在也能有双语字幕。在「字幕不可用」里点一下「AI 转写字幕」，音频会发到你自己配置的转写引擎生成字幕（直播是画面内逐词显示，旁边一栏整句历史）。
· App 新增「对话 · 实时听译」：对方说外语，你看中文；按住「我说」讲中文，译成外语给对方看，还能朗读。锁屏也继续听，说完的句子进复习。
另外 App 首页重做：今天该做的事收成一张卡。

隐私：音频只发往你自己配置的转写端点，我们的服务器不接触；不保存录音，只留文字。
```

## 国际版 · zh-Hant

```
兩件新東西：
· 沒有字幕的 Podcast 和影片，現在也能有雙語字幕。在「字幕不可用」裡點一下「AI 轉寫字幕」，音訊會送到你自己設定的轉寫引擎產生字幕（直播是畫面內逐字顯示，旁邊一欄整句歷史）。
· App 新增「對話 · 即時聽譯」：對方說外語，你看中文；按住「我說」講中文，譯成外語給對方看，還能朗讀。鎖定畫面也繼續聽，說完的句子進複習。
另外 App 首頁重做：今天該做的事收成一張卡。

隱私：音訊只送往你自己設定的轉寫端點，我們的伺服器不接觸；不保存錄音，只留文字。
```

## 国际版 · ja

```
新機能が 2 つ：
· 字幕のないポッドキャストや動画にも二言語字幕を。「字幕を利用できません」の横の「AI 文字起こし字幕」をタップすると、音声があなたが設定した文字起こしエンジンに送られ字幕になります（ライブ配信は映像内に単語ごと、横に文単位の履歴）。
· アプリに「会話・リアルタイム通訳」を追加。相手が話すと日本語で読め、「話す」を長押しして日本語で話せば相手向けに翻訳して表示、読み上げも。ロック中も聞き続け、確定した文は復習へ。
アプリのホーム画面も刷新：今日やることを 1 枚のカードに。

プライバシー：音声はあなたが設定した文字起こしエンドポイントにのみ送られ、当方のサーバーは触れません。録音は保存せず、テキストだけを残します。
```

## 国际版 · ko

```
새로운 기능 두 가지:
· 자막 없는 팟캐스트와 영상에도 이중 자막을. ‘자막 사용 불가’ 옆의 ‘AI 전사 자막’을 누르면 오디오가 직접 설정한 전사 엔진으로 보내져 자막이 됩니다(라이브는 화면 안에 단어 단위, 옆에 문장 단위 기록).
· 앱에 ‘대화 · 실시간 통역’ 추가. 상대가 말하면 한국어로 읽고, ‘내가 말하기’를 길게 눌러 한국어로 말하면 상대에게 번역해 보여 주고 읽어 줍니다. 잠금 중에도 계속 듣고, 확정된 문장은 복습으로.
앱 홈 화면도 새 단장: 오늘 할 일을 카드 한 장에.

개인정보: 오디오는 사용자가 설정한 전사 엔드포인트로만 전송되며 당사 서버는 접근하지 않습니다. 녹음은 저장하지 않고 텍스트만 남깁니다.
```

## 国际版 · de-DE

```
Zwei Neuerungen:
· Podcasts und Videos ohne Untertitel bekommen jetzt zweisprachige Untertitel. Tippen Sie bei „Untertitel nicht verfügbar“ auf „KI-Transkript-Untertitel“ – das Audio geht an die von Ihnen eingerichtete Transkriptions-Engine (Livestreams: Wort für Wort im Bild, daneben der Satzverlauf).
· Neu in der App: „Gespräch · Live-Dolmetscher“. Ihr Gegenüber spricht, Sie lesen mit; halten Sie „Ich spreche“ gedrückt, und Ihre Worte werden übersetzt angezeigt und vorgelesen. Hört auch bei gesperrtem Bildschirm weiter; fertige Sätze wandern in die Wiederholung.
Der Startbildschirm der App ist neu: eine Karte mit dem, was heute ansteht.

Datenschutz: Audio geht nur an den von Ihnen eingerichteten Transkriptions-Endpunkt – unsere Server berühren es nie. Es wird keine Aufnahme gespeichert, nur Text.
```

## 国际版 · fr-FR

```
Deux nouveautés :
· Les podcasts et vidéos sans sous-titres peuvent maintenant avoir des sous-titres bilingues. Touchez « Sous-titres par transcription IA » là où les sous-titres sont indisponibles : l’audio part vers le moteur de transcription que vous avez configuré (en direct : mot à mot dans l’image, avec l’historique des phrases à côté).
· Nouveau dans l’app : « Conversation · interprète en direct ». Votre interlocuteur parle, vous lisez ; maintenez « Je parle » pour parler, la traduction s’affiche pour lui et peut être lue à voix haute. Continue d’écouter écran verrouillé ; les phrases terminées vont en révision.
L’écran d’accueil de l’app est repensé autour d’une carte : ce qu’il y a à faire aujourd’hui.

Confidentialité : l’audio ne part que vers le point de transcription que vous avez configuré — nos serveurs n’y touchent jamais. Aucun enregistrement conservé, seulement du texte.
```

## 国际版 · es-ES

```
Dos novedades:
· Los pódcast y vídeos sin subtítulos ahora pueden tener subtítulos bilingües. Toca «Subtítulos por transcripción IA» donde dice que no hay subtítulos: el audio va al motor de transcripción que configuraste (en directo: palabra a palabra sobre el vídeo, con el historial de frases al lado).
· Nuevo en la app: «Conversación · intérprete en vivo». La otra persona habla, tú lees; mantén pulsado «Yo hablo» para hablar y mostrarle la traducción, también en voz alta. Sigue escuchando con la pantalla bloqueada; las frases terminadas van al repaso.
La pantalla de inicio de la app se rediseñó en torno a una tarjeta: lo que toca hoy.

Privacidad: el audio va solo al punto de transcripción que configuraste; nuestros servidores nunca lo tocan. No se guarda ninguna grabación, solo texto.
```

## 国际版 · pt-BR

```
Duas novidades:
· Podcasts e vídeos sem legenda agora podem ter legendas bilíngues. Toque em “Legendas por transcrição de IA” onde diz que não há legendas: o áudio vai para o mecanismo de transcrição que você configurou (ao vivo: palavra por palavra no vídeo, com o histórico de frases ao lado).
· Novo no app: “Conversa · intérprete ao vivo”. A outra pessoa fala, você lê; segure “Eu falo” para falar e mostrar a tradução, com leitura em voz alta. Continua ouvindo com a tela bloqueada; frases concluídas vão para a revisão.
A tela inicial do app foi redesenhada em torno de um cartão: o que fazer hoje.

Privacidade: o áudio vai só para o endpoint de transcrição que você configurou — nossos servidores nunca tocam nele. Nenhuma gravação é guardada, só texto.
```

## 国际版 · ru

```
Две новинки:
· Подкасты и видео без субтитров теперь могут получить двуязычные субтитры. Нажмите «Субтитры ИИ-расшифровки» там, где субтитры недоступны: звук уйдёт в настроенный вами движок расшифровки (в прямом эфире — слово за словом на видео, рядом история фраз).
· Новое в приложении: «Разговор · живой переводчик». Собеседник говорит — вы читаете; удерживайте «Говорю я», чтобы сказать своё, перевод покажется ему и озвучится. Слушает и при заблокированном экране; готовые фразы уходят в повторение.
Главный экран приложения переработан вокруг одной карточки: что нужно сегодня.

Конфиденциальность: звук уходит только на настроенную вами конечную точку расшифровки — наши серверы его не касаются. Записи не сохраняются, только текст.
```

## 国际版 · ar-SA

```
ميزتان جديدتان:
· البودكاست والفيديوهات بلا ترجمة يمكنها الآن الحصول على ترجمة ثنائية اللغة. انقر «ترجمات بالتفريغ الذكي» حيث تظهر رسالة عدم توفر الترجمة، فيُرسَل الصوت إلى محرك التفريغ الذي أعددته (في البث المباشر: كلمة بكلمة على الفيديو، وبجانبه سجل الجمل).
· جديد في التطبيق: «محادثة · مترجم فوري». يتحدث الطرف الآخر وتقرأ أنت؛ اضغط مطوّلًا على «أنا أتحدث» لتتكلم فتظهر له الترجمة وتُقرأ بصوت عالٍ. يواصل الاستماع والشاشة مقفلة؛ الجمل المكتملة تذهب إلى المراجعة.
أُعيد تصميم الشاشة الرئيسية للتطبيق حول بطاقة واحدة: ما عليك فعله اليوم.

الخصوصية: يُرسَل الصوت فقط إلى نقطة التفريغ التي أعددتها — خوادمنا لا تلمسه أبدًا. لا يُحفَظ أي تسجيل، النص فقط.
```
