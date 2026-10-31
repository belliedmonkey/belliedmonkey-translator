# 1.7.5 发布说明 · iOS（国际版 11 份 + 中国版 1 份）

> 上一个真正上架的版本是 **1.6.7**，所以这份文案覆盖 1.7.0 → 1.7.5 的全部改动，
> 不只是最后一次提交。
>
> **中国版与国际版不是同一份文案**，两处硬性不同：
>   · 中国版没有编进同步，所以不写「登录 / 别的设备 / 账号对不上」——那对他是假的；
>   · 中国版不提 belliedmonkey.cc（那是国际站）。
>
> ⚠️ 不写内部说法（「补登记」「recapture」「EXCLUDE_TAGS」）。用户关心的是
> 「以前会怎样、现在会怎样」。
>
> macOS 另有一条只对它成立的（界面不再是放大的手机版式），见
> `release-notes-1.7.5-macos.md` —— 写进 iOS 就是把一个不存在的功能说成新功能。

---

## 国际版 · zh-Hans

```
这一版把「配好 → 翻一页 → 记住它」这条路真正连了起来。

· 首次使用引导重做：一把 key 就能同时配好翻译、朗读和转写，填完当场自检告诉你通
  没通，不用等到翻第一页才发现配错了。
· 你真正停下来读完的句子会自动变成复习卡，装好就开着（快速滚过去的不算）。以前
  这个开关默认是关的，不少人翻完一整页才发现什么都没记下来。
· 在网页上翻完，可以直接回到 App 里继续复习；两边不是同一个账号时会当场说清楚，
  而不是安静地对不上。
· 段落里的快捷键和代码（比如 Super + Return）不再从译文里消失。以前它们会被整段
  丢掉，句子读着通顺，意思却是错的。
· 播客模式：语言标不出来的卡现在也读得出来 —— 此前在 iPhone 上这类卡一张都播不了。
```

## 国际版 · zh-Hant

```
這一版把「配好 → 翻一頁 → 記住它」這條路真正連了起來。

· 首次使用引導重做：一把 key 就能同時配好翻譯、朗讀和轉寫，填完當場自檢告訴你通
  不通，不用等到翻第一頁才發現配錯了。
· 你真正停下來讀完的句子會自動變成複習卡，裝好就開著（快速滑過去的不算）。以前
  這個開關預設是關的，不少人翻完一整頁才發現什麼都沒記下來。
· 在網頁上翻完，可以直接回到 App 裡繼續複習；兩邊不是同一個帳號時會當場說清楚，
  而不是安靜地對不上。
· 段落裡的快捷鍵和程式碼（例如 Super + Return）不再從譯文裡消失。以前它們會被整段
  丟掉，句子讀著通順，意思卻是錯的。
· 播客模式：語言標不出來的卡現在也讀得出來 —— 此前在 iPhone 上這類卡一張都播不了。
```

## 国际版 · en-US

```
This release finally connects the whole path: set it up, translate a page, keep what you read.

· Rebuilt first-run setup. One API key now configures translation, read-aloud and
  transcription together, and it tests itself right there — so you find out it works
  before you translate your first page, not after.
· Sentences you actually stop and finish reading turn into review cards, and capture
  is on from the start (scrolling past does not count). It used to be off by default,
  so people read a whole page and found nothing saved.
· After translating on the web you can go straight back into the app to review. If the
  two sides are signed in as different people, it now says so instead of quietly
  failing to line up.
· Keyboard shortcuts and inline code in a paragraph (Super + Return, for example) no
  longer vanish from the translation. They used to be dropped entirely, leaving a
  sentence that read fine but said the wrong thing.
· Podcast mode reads cards whose language could not be identified. On iPhone, those
  cards previously would not play at all.
```

## 国际版 · ja

```
「設定する → 1ページ訳す → 覚える」という道筋が、ようやく一本につながりました。

· 初回セットアップを作り直しました。APIキー1つで翻訳・読み上げ・文字起こしをまとめて
  設定でき、その場で接続テストまで行います。最初の1ページを訳してから間違いに気づく、
  ということがなくなります。
· 立ち止まって最後まで読んだ文は自動で復習カードになります（素早くスクロールしたものは
  対象外）。しかも最初からオンです。以前は既定でオフだったため、1ページ読み終えてから
  何も保存されていないと気づく人が少なくありませんでした。
· ウェブで訳したあと、そのままアプリに戻って復習を続けられます。両側のアカウントが
  違う場合はその場で知らせます。黙って噛み合わないままになりません。
· 段落中のキーボードショートカットやコード（Super + Return など）が訳文から消えなく
  なりました。以前は丸ごと落ちてしまい、文章としては自然でも意味が変わっていました。
· ポッドキャストモード：言語を判定できないカードも読み上げられます。iPhone では従来、
  この種のカードは1枚も再生できませんでした。
```

## 国际版 · ko

```
「설정 → 한 페이지 번역 → 기억하기」로 이어지는 흐름이 드디어 하나로 연결되었습니다.

· 첫 실행 설정을 새로 만들었습니다. API 키 하나로 번역·읽어주기·받아쓰기를 한 번에
  설정하고, 그 자리에서 연결까지 확인합니다. 첫 페이지를 번역한 뒤에야 잘못된 걸
  알게 되는 일이 없습니다.
· 멈춰서 끝까지 읽은 문장은 자동으로 복습 카드가 되며(빠르게 지나친 것은 제외),
  설치 직후부터 켜져 있습니다. 이전에는 기본이 꺼짐이라 한 페이지를 다 읽고 나서야
  아무것도 저장되지 않은 걸 발견하는 경우가 많았습니다.
· 웹에서 번역한 뒤 앱으로 바로 돌아가 복습을 이어갈 수 있습니다. 양쪽 계정이 다르면
  그 자리에서 알려줍니다. 조용히 어긋난 채로 두지 않습니다.
· 문단 안의 단축키나 코드(예: Super + Return)가 번역문에서 사라지지 않습니다. 예전에는
  통째로 빠져서, 문장은 자연스러운데 뜻이 달라졌습니다.
· 팟캐스트 모드: 언어를 알 수 없는 카드도 읽어 줍니다. iPhone에서는 지금까지 이런
  카드가 한 장도 재생되지 않았습니다.
```

## 国际版 · fr-FR

```
Cette version relie enfin tout le parcours : configurer, traduire une page, retenir ce qu’on a lu.

· Configuration initiale refaite. Une seule clé API configure à la fois la traduction,
  la lecture à voix haute et la transcription, et elle se teste sur place — vous savez
  que cela fonctionne avant votre première page, pas après.
· Les phrases que vous vous arrêtez vraiment pour lire deviennent des cartes de
  révision, et la collecte est active dès l’installation (faire défiler ne compte pas).
  Elle était désactivée par défaut : on lisait une page entière pour découvrir que rien
  n’avait été gardé.
· Après avoir traduit sur le web, vous revenez directement dans l’app pour réviser. Si
  les deux côtés ne sont pas le même compte, c’est dit clairement au lieu de ne pas
  correspondre en silence.
· Les raccourcis clavier et le code en ligne dans un paragraphe (Super + Return, par
  exemple) ne disparaissent plus de la traduction. Ils étaient purement supprimés : la
  phrase se lisait bien mais disait autre chose.
· Mode balado : les cartes dont la langue n’a pas pu être identifiée sont maintenant
  lues. Sur iPhone, elles ne se lisaient pas du tout.
```

## 国际版 · de-DE

```
Diese Version verbindet endlich den ganzen Weg: einrichten, eine Seite übersetzen, das Gelesene behalten.

· Die Ersteinrichtung ist neu. Ein API-Schlüssel richtet Übersetzung, Vorlesen und
  Transkription gemeinsam ein und prüft sich direkt selbst — du weißt vor der ersten
  Seite, dass es funktioniert, nicht danach.
· Sätze, bei denen du wirklich stehen bleibst und zu Ende liest, werden automatisch zu
  Lernkarten, und das ist ab der Installation an (schnelles Scrollen zählt nicht).
  Vorher war es standardmäßig aus: Man las eine ganze Seite und stellte danach fest,
  dass nichts gespeichert war.
· Nach dem Übersetzen im Web geht es direkt in der App weiter. Sind beide Seiten mit
  verschiedenen Konten angemeldet, wird das jetzt gesagt, statt still nicht zusammen
  zu passen.
· Tastenkürzel und Inline-Code in einem Absatz (etwa Super + Return) verschwinden nicht
  mehr aus der Übersetzung. Sie fielen komplett weg — der Satz las sich gut und sagte
  etwas anderes.
· Podcast-Modus: Karten, deren Sprache nicht bestimmt werden konnte, werden jetzt
  vorgelesen. Auf dem iPhone ließ sich davon bisher keine einzige abspielen.
```

## 国际版 · es-ES

```
Esta versión conecta por fin todo el recorrido: configurar, traducir una página y quedarse con lo leído.

· Configuración inicial rehecha. Una sola clave de API configura a la vez la traducción,
  la lectura en voz alta y la transcripción, y se comprueba allí mismo: sabes que
  funciona antes de tu primera página, no después.
· Las frases que realmente te detienes a terminar de leer se convierten en tarjetas de
  repaso, y la recopilación viene activada desde la instalación (pasar rápido no
  cuenta). Antes estaba desactivada por defecto: leías una página entera y descubrías
  que no se había guardado nada.
· Después de traducir en la web puedes volver directamente a la app para repasar. Si
  los dos lados no son la misma cuenta, ahora se dice claramente en vez de no encajar
  en silencio.
· Los atajos de teclado y el código dentro de un párrafo (por ejemplo, Super + Return)
  ya no desaparecen de la traducción. Antes se eliminaban por completo: la frase se
  leía bien pero decía otra cosa.
· Modo pódcast: ahora también se leen las tarjetas cuyo idioma no se pudo identificar.
  En el iPhone no se reproducía ninguna de ellas.
```

## 国际版 · pt-BR

```
Esta versão finalmente liga o caminho inteiro: configurar, traduzir uma página e guardar o que você leu.

· Configuração inicial refeita. Uma única chave de API configura tradução, leitura em
  voz alta e transcrição de uma vez, e testa a si mesma ali — você sabe que funciona
  antes da primeira página, não depois.
· As frases em que você realmente para e termina de ler viram cartões de revisão, e
  isso já vem ativado na instalação (rolar rápido não conta). Antes vinha desativado:
  a pessoa lia uma página inteira e só então via que nada tinha sido guardado.
· Depois de traduzir na web, dá para voltar direto ao app e continuar revisando. Se os
  dois lados estiverem em contas diferentes, isso é dito na hora, em vez de simplesmente
  não bater.
· Atalhos de teclado e código dentro de um parágrafo (Super + Return, por exemplo) não
  somem mais da tradução. Antes eles eram descartados por completo: a frase ficava bem
  escrita e dizia outra coisa.
· Modo podcast: cartões cujo idioma não pôde ser identificado agora são lidos. No
  iPhone, nenhum deles tocava.
```

## 国际版 · ru

```
В этой версии наконец соединился весь путь: настроить, перевести страницу, запомнить прочитанное.

· Первая настройка переделана. Один API-ключ сразу настраивает перевод, озвучивание и
  расшифровку и тут же проверяет себя — вы узнаёте, что всё работает, до первой
  страницы, а не после.
· Предложения, на которых вы действительно остановились и дочитали, сами становятся
  карточками, и сбор включён сразу после установки (быстрая прокрутка не считается).
  Раньше он был выключен по умолчанию: человек читал целую страницу и лишь потом
  обнаруживал, что ничего не сохранилось.
· После перевода в вебе можно сразу вернуться в приложение и продолжить повторение.
  Если это разные учётные записи, теперь об этом говорится прямо, а не молча не
  совпадает.
· Сочетания клавиш и код внутри абзаца (например, Super + Return) больше не исчезают
  из перевода. Раньше они выбрасывались целиком: фраза читалась гладко, но означала
  другое.
· Режим подкаста: карточки, язык которых не удалось определить, теперь озвучиваются.
  На iPhone они раньше не воспроизводились вовсе.
```

## 国际版 · ar-SA

```
يربط هذا الإصدار المسار كاملاً أخيراً: تُعِدّ التطبيق، تترجم صفحة، وتحتفظ بما قرأته.

· إعداد أول مرة أُعيدت كتابته. مفتاح API واحد يضبط الترجمة والقراءة الصوتية والتفريغ
  معاً، ويختبر نفسه في المكان نفسه — تعرف أنه يعمل قبل صفحتك الأولى لا بعدها.
· الجمل التي تتوقّف فعلاً لتُنهي قراءتها تتحوّل إلى بطاقات مراجعة، والجمع مُفعّل منذ
  التثبيت (التمرير السريع لا يُحتسب). كان مُعطّلاً افتراضياً، فيقرأ المرء صفحة كاملة
  ثم يكتشف أن شيئاً لم يُحفَظ.
· بعد الترجمة على الويب يمكنك العودة مباشرة إلى التطبيق لمتابعة المراجعة. وإذا كان
  الطرفان بحسابين مختلفين، يُقال ذلك بوضوح بدل ألّا يتطابقا بصمت.
· اختصارات لوحة المفاتيح والشيفرة داخل الفقرة (مثل Super + Return) لم تعد تختفي من
  الترجمة. كانت تُحذَف بالكامل، فتبدو الجملة سليمة بينما معناها مختلف.
· وضع البودكاست: البطاقات التي تعذّر تحديد لغتها تُقرأ الآن. على iPhone لم تكن أيٌّ
  منها تُشغَّل من قبل.
```

## 中国版 · zh-Hans

```
这一版把「配好 → 翻一页 → 记住它」这条路真正连了起来。

· 首次使用引导重做：一把 key 就能同时配好翻译、朗读和转写，填完当场自检告诉你通
  没通，不用等到翻第一页才发现配错了。
· 你真正停下来读完的句子会自动变成复习卡，装好就开着（快速滚过去的不算）。这些
  句子只存在你自己的设备上。以前这个开关默认是关的，不少人翻完一整页才发现什么
  都没记下来。
· 在网页上翻完，可以直接回到 App 里继续复习，不用自己去找。
· 段落里的快捷键和代码（比如 Super + Return）不再从译文里消失。以前它们会被整段
  丢掉，句子读着通顺，意思却是错的。
· 播客模式：语言标不出来的卡现在也读得出来 —— 此前在 iPhone 上这类卡一张都播不了。
```
