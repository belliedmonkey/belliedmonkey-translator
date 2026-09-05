# 1.7.14 发布说明（国际版 11 份 + 中国版 1 份 · iOS 与 macOS 同文）

> 上一个上架版本是 **1.7.13**，所以这份只覆盖 1.7.13 → 1.7.14。
>
> **头条是 App 里的设置页**。1.7.13 的快速设置只做了扩展那一侧，App 里还是旧的
> 一长串表单 —— 同一个产品，两个地方两套操作。这一版把它们拉齐了。
>
> 第二件是语音默认值的改变，它**会影响已经在用的人**（原来默认用系统自带的声音，
> 现在不配就不朗读），所以必须写进说明，不能只当成「优化」。
>
> ⚠️ 不写内部说法（不提 EngineFields、不提「组件收敛」）。用户关心的是
> 「以前会怎样、现在会怎样」。
>
> 中国版与国际版不同：中国版的扩展没有编进同步，界面语言那条也不提「12 门」
> 这种对单一语言用户没有意义的数字。

---

## 国际版 · zh-Hans

```
App 里的设置终于和浏览器扩展一样了。

· 「快速 | 详细」两档进了 App。以前扩展里能一把 key 配好翻译、朗读、转写，而 App
  里还得一项项翻表单填 —— 现在两边是同一套，在哪台设备上配都一样。
· 不需要 Key 的引擎不再显示 Key 输入框。选了 Google 翻译还让你填密钥，是上一版
  一直存在的困惑。
· 界面语言补齐，印地语等此前只能看到英文界面的语言现在可以选到自己的。

朗读现在需要你自己选一个语音引擎。

· 以前默认用系统自带的声音，效果撑不起「听着学」这件事，而且没人主动选过它。
  现在不配就不朗读，配了才有 —— 设置页「语音」那一档一步就能配好。
· 顺带修掉一个尴尬的 bug：明明显示「未配置」，点试听却真的用系统声音念了出来，
  界面还说「播放中」。
```

## 国际版 · en-US

```
Settings in the app now match the browser extension.

· The Quick / Detailed split is in the app. One key used to configure translation,
  speech and transcription in the extension — but the app still made you fill in
  every field by hand. Same setup on every device now.
· Engines that need no key no longer show a key field. Picking Google Translate and
  still being asked for a secret was confusing, and it was there until now.
· More interface languages, so Hindi and others no longer fall back to English.

Speech now needs you to pick an engine.

· It used to default to the system voice. That voice isn't good enough to learn from,
  and nobody ever chose it. Now nothing is read aloud until you configure an engine —
  one step, under Settings › Speech.
· This also fixes an embarrassing one: it said "not configured" and yet the preview
  button really did speak in the system voice, while the screen claimed "playing".
```

## 中国版 · zh-Hans

```
App 里的设置终于和浏览器扩展一样了。

· 「快速 | 详细」两档进了 App。以前扩展里能一把 key 配好翻译、朗读、转写，而 App
  里还得一项项翻表单填 —— 现在两边是同一套，在哪台设备上配都一样。
· 不需要 Key 的引擎不再显示 Key 输入框。这是上一版一直存在的困惑。

朗读现在需要你自己选一个语音引擎。

· 以前默认用系统自带的声音，效果撑不起「听着学」这件事，而且没人主动选过它。
  现在不配就不朗读，配了才有 —— 设置页「语音」那一档一步就能配好。
· 顺带修掉一个尴尬的 bug：明明显示「未配置」，点试听却真的用系统声音念了出来，
  界面还说「播放中」。
```


## 国际版 · de-DE

```
Die Einstellungen in der App entsprechen jetzt der Browser-Erweiterung.

· Die Schnell-/Detailansicht ist jetzt in der App. Bisher wurde ein Schlüssel für Übersetzung,
  Sprache und Transkription in der Erweiterung verwendet – die App verlangte jedoch weiterhin,
  jedes Feld manuell auszufüllen. Jetzt ist die Einrichtung auf allen Geräten identisch.
· Engines, die keinen Schlüssel benötigen, zeigen kein Schlüsselfeld mehr. Google Translate
  auszuwählen und trotzdem nach einem Geheimnis gefragt zu werden, war verwirrend – und das
  blieb bis jetzt so.
· Weitere Oberflächensprachen, sodass Hindi und andere nicht mehr auf Englisch zurückfallen.

Für Sprache musst du jetzt eine Engine auswählen.

· Früher wurde standardmäßig die Systemstimme verwendet. Diese Stimme ist nicht gut genug,
  um davon zu lernen, und niemand hat sie je gewählt. Jetzt wird nichts vorgelesen, bis du
  eine Engine konfigurierst – ein Schritt unter Einstellungen › Sprache.
· Das behebt auch einen peinlichen Fehler: Es hieß „nicht konfiguriert“, aber die
  Vorschau-Schaltfläche sprach tatsächlich mit der Systemstimme, während der Bildschirm
  „Wiedergabe“ anzeigte.
```

## 国际版 · zh-Hant

```
應用程式內的設定現在與瀏覽器擴充功能一致。

· 快速／詳細的分流已加入應用程式。擴充功能中，一個金鑰即可設定翻譯、語音與轉錄——但應用程式仍要求你手動填寫每個欄位。現在所有裝置上的設定都相同了。
· 無需金鑰的引擎不再顯示金鑰欄位。選擇 Google 翻譯卻仍被要求輸入密鑰，這一直令人困惑，而這個問題直到現在才解決。
· 更多介面語言，因此印度語及其他語言不再退回英文。

語音現在需要你選擇一個引擎。

· 過去它預設使用系統語音。那個語音不足以用來學習，而且從來沒有人選擇它。現在，在你設定引擎之前，不會朗讀任何內容——只需在「設定 › 語音」下進行一個步驟。
· 這也修正了一個令人尷尬的問題：它顯示「未設定」，但預覽按鈕卻真的用系統語音說話，而螢幕上卻宣稱「播放中」。
```

## 国际版 · fr-FR

```
Les paramètres de l’application correspondent désormais à ceux de l’extension navigateur.

· La répartition Rapide / Détaillé est intégrée à l’application. Une seule clé servait à configurer la traduction, la parole et la transcription dans l’extension — mais l’application vous obligeait encore à remplir chaque champ à la main. Même configuration sur tous les appareils maintenant.
· Les moteurs qui ne nécessitent pas de clé n’affichent plus de champ de clé. Choisir Google Traduction et se voir quand même demander un secret prêtait à confusion, et c’était le cas jusqu’à présent.
· Plus de langues d’interface, afin que l’hindi et d’autres ne retombent plus sur l’anglais.

La parole nécessite désormais que vous choisissiez un moteur.

· Elle utilisait par défaut la voix du système. Cette voix n’est pas assez bonne pour apprendre, et personne ne l’a jamais choisie. Maintenant, rien n’est lu à voix haute tant que vous n’avez pas configuré un moteur — une seule étape, sous Réglages › Parole.
· Cela corrige aussi un point gênant : il affichait « non configuré » et pourtant le bouton d’aperçu parlait vraiment avec la voix du système, tandis que l’écran prétendait « lecture en cours ».
```

## 国际版 · ru

```
Настройки в приложении теперь совпадают с расширением для браузера.

· Разделение «Быстро / Подробно» теперь в приложении. Раньше один ключ использовался для настройки перевода, речи и транскрипции в расширении — но в приложении всё равно приходилось заполнять каждое поле вручную. Теперь настройка одинакова на всех устройствах.
· Для движков, которым не нужен ключ, поле ключа больше не отображается. Выбор Google Translate и запрос секретного ключа сбивал с толку, и так было до сих пор.
· Больше языков интерфейса, поэтому хинди и другие языки больше не переключаются на английский.

Для речи теперь нужно выбрать движок.

· Раньше по умолчанию использовался системный голос. Этот голос недостаточно хорош для обучения, и его никто никогда не выбирал. Теперь ничего не озвучивается, пока вы не настроите движок — один шаг в разделе «Настройки › Речь».
· Это также исправляет досадную ошибку: раньше отображалось «не настроено», но кнопка предпросмотра действительно озвучивала системным голосом, в то время как экран показывал «воспроизведение».
```

## 国际版 · ar-SA

```
أصبحت الإعدادات في التطبيق مطابقة لإضافة المتصفح.

· تقسيم سريع/مفصّل أصبح متاحًا في التطبيق. كان مفتاح واحد يُستخدم لتكوين الترجمة،
  والنطق، والنسخ في الإضافة — لكن التطبيق ما زال يطلب منك ملء كل حقل يدويًا. الآن الإعداد نفسه على كل جهاز.
· المحركات التي لا تتطلب مفتاحًا لم تعد تُظهر حقل المفتاح. اختيار ترجمة جوجل وما زال يُطلب منك سرّ كان مربكًا، وقد بقي كذلك حتى الآن.
· المزيد من لغات الواجهة، بحيث لا تعود الهندية وغيرها تتراجع إلى الإنجليزية.

أصبح النطق يتطلب منك اختيار محرك.

· كان يستخدم افتراضيًا صوت النظام. هذا الصوت ليس جيدًا بما يكفي للتعلّم منه، ولم يختره أحد أبدًا. الآن لا يُقرأ أي شيء بصوت عالٍ حتى تقوم بتكوين محرك — خطوة واحدة، ضمن الإعدادات › النطق.
· هذا أيضًا يصلح مشكلة محرجة: كان يعرض "غير مُكوّن" ومع ذلك زر المعاينة كان ينطق فعلًا بصوت النظام، بينما تعرض الشاشة "جارٍ التشغيل".
```

## 国际版 · pt-BR

```
As configurações do app agora correspondem às da extensão do navegador.

· A divisão Rápido / Detalhado está no app. Uma chave era usada para configurar tradução,
  fala e transcrição na extensão — mas o app ainda fazia você preencher
  cada campo manualmente. Agora a configuração é a mesma em todos os dispositivos.
· Mecanismos que não precisam de chave não mostram mais o campo de chave. Escolher o Google Tradutor e
  ainda assim ser solicitado a informar um segredo era confuso, e isso existia até agora.
· Mais idiomas de interface, então o hindi e outros não caem mais no inglês.

A fala agora exige que você escolha um mecanismo.

· Antes, ela usava a voz do sistema por padrão. Essa voz não é boa o suficiente para aprender com ela,
  e ninguém nunca a escolhia. Agora nada é lido em voz alta até você configurar um mecanismo —
  um passo, em Configurações › Fala.
· Isso também corrige um problema constrangedor: dizia "não configurado" e, mesmo assim, o botão
  de pré-visualização realmente falava com a voz do sistema, enquanto a tela afirmava "reproduzindo".
```

## 国际版 · es-ES

```
Los ajustes de la aplicación ahora coinciden con la extensión del navegador.

· La división Rápido / Detallado está en la aplicación. Una clave se usaba para configurar la traducción,
  el habla y la transcripción en la extensión — pero la aplicación aún te obligaba a rellenar
  cada campo manualmente. Ahora la misma configuración en todos los dispositivos.
· Los motores que no necesitan clave ya no muestran un campo de clave. Elegir Google Translate y
  que aún se te pidiera un secreto era confuso, y estuvo ahí hasta ahora.
· Más idiomas de interfaz, así que el hindi y otros ya no recurren al inglés.

El habla ahora requiere que elijas un motor.

· Antes se usaba por defecto la voz del sistema. Esa voz no es lo bastante buena para aprender de ella,
  y nadie la elegía nunca. Ahora nada se lee en voz alta hasta que configures un motor —
  un paso, en Ajustes › Habla.
· Esto también corrige algo vergonzoso: decía "no configurado" y sin embargo el botón de vista previa
  realmente hablaba con la voz del sistema, mientras la pantalla afirmaba "reproduciendo".
```

## 国际版 · ko

```
이제 앱의 설정이 브라우저 확장 프로그램과 일치합니다.

· 빠른/상세 분할이 앱에 추가되었습니다. 확장 프로그램에서는 번역, 음성, 받아쓰기를 구성하는 데 키 하나만 사용했지만, 앱에서는 여전히 모든 필드를 수동으로 입력해야 했습니다. 이제 모든 기기에서 동일한 설정을 사용합니다.
· 키가 필요 없는 엔진에는 더 이상 키 필드가 표시되지 않습니다. Google 번역을 선택했는데도 비밀 키를 요구하는 것은 혼란스러웠고, 지금까지 그렇게 되어 있었습니다.
· 인터페이스 언어가 더 추가되어 힌디어 등이 더 이상 영어로 대체되지 않습니다.

이제 음성은 엔진을 선택해야 합니다.

· 이전에는 시스템 음성으로 기본 설정되어 있었습니다. 그 음성은 학습하기에 충분하지 않았고, 아무도 선택하지 않았습니다. 이제 엔진을 구성하기 전까지는 아무것도 소리 내어 읽지 않습니다 — 설정 › 음성에서 한 단계만 거치면 됩니다.
· 또한 부끄러운 문제도 해결했습니다. "구성되지 않음"이라고 표시되면서도 미리 보기 버튼이 실제로 시스템 음성으로 말하고, 화면에는 "재생 중"이라고 표시되던 문제입니다.
```

## 国际版 · ja

```
アプリの設定がブラウザ拡張機能と一致するようになりました。

· クイック／詳細の分割がアプリに搭載されました。拡張機能では翻訳、音声、文字起こしの設定に1つのキーを使用していましたが、アプリではすべてのフィールドを手動で入力する必要がありました。現在はすべてのデバイスで同じ設定が適用されます。
· キーを必要としないエンジンでは、キーフィールドが表示されなくなりました。Google翻訳を選択しても秘密キーを求められるのは混乱を招くもので、これまで表示されていました。
· 対応インターフェース言語が増え、ヒンディー語などが英語にフォールバックしなくなりました。

音声はエンジンを選択する必要があります。

· 以前はシステム音声がデフォルトでした。その音声は学習に十分な品質ではなく、誰も選択しませんでした。現在はエンジンを設定するまで読み上げは行われません——設定 › 音声の1ステップです。
· これにより、恥ずかしい問題も修正されました。「未設定」と表示されながら、プレビューボタンが実際にシステム音声で話し、画面が「再生中」と主張していた問題です。
```

---

## 其余 10 门（国际版）

en-US 之外的 ar-SA / de-DE / es-ES / fr-FR / ja / ko / pt-BR / ru / zh-Hant，
由 `scripts/asc.js notes` 走翻译流程时按 zh-Hans 那份的**内容**产出，不逐字照抄
en-US（两份是分别写的，不是互译）。
