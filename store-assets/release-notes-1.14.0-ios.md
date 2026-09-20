# 1.14.0 发布说明 · iOS（国际版 15 份）

> **主角是 iPhone 系统翻译（Gate J-2）。** macOS 没有 TranslationUIProvider 这个扩展点，所以那份不提它。
> **中国版 iOS 这一版不发**：`com.belliedmonkeytranslator.cn` 还没有 `DEFAULT_TRANSLATION_APP` 与 `APP_GROUPS` 两项能力，`.cn.MTTranslateExt` 这个 App ID 也还没建（用户裁定 2026-09-21：先发五面，中国 iOS 下一版补）。所以这份文件里没有「中国版」段。
> 提到「对话 · 实时听译」时紧跟系统要求，是 docs/release-checklist.md §3 的硬要求。
> 用法：`node scripts/asc.js notes com.belliedmonkeytranslator IOS 1.14.0 store-assets/release-notes-1.14.0-ios.md`

## 国际版 · zh-Hans

```
· 新：系统翻译 —— 在任何 App 里选中文字点「翻译」，就用你自己配的引擎翻，不经过我们的服务器。先到「设置 › App › 翻译 › 默认翻译App」里选大肚猴翻译。需要 iOS 18.4 及以上。
· 新：配好引擎之后当场测一遍并把结果摆出来 —— 通了才说「可以用了」，没通会指出是哪一项、错在哪。
· 新：首页多一张卡，引导把大肚猴翻译设成系统默认的翻译 App。
· 新：Discord 社区入口，在「讨论」里。
· 修复：「对话 · 实时听译」中途切换耳机或扬声器之后不再收不到声音（需要 iOS 26）。
```

## 国际版 · en-US

```
· New: System translation — select text in any app, tap “Translate,” and it goes to the engine you configured, never through our servers. First choose BelliedMonkey in Settings › Apps › Translate › Default Translate App. Requires iOS 18.4 or later.
· New: After you set up an engine, it is tested right there and the result is shown — it only says “Ready” once the test passes, and names the item that failed if one does.
· New: A card on the home screen walks you through making BelliedMonkey your default translate app.
· New: Discord community link, under “Discuss.”
· Fixed: Conversation · Live interpreting no longer goes silent after switching between headphones and speaker (requires iOS 26).
```

## 国际版 · zh-Hant

```
· 新：系統翻譯 —— 在任何 App 裡選中文字點「翻譯」，就用你自己配的引擎翻，不經過我們的伺服器。先到「設定 › App › 翻譯 › 預設翻譯App」裡選大肚猴翻譯。需要 iOS 18.4 及以上。
· 新：配好引擎之後當場測一遍並把結果擺出來 —— 通了才說「可以用了」，沒通會指出是哪一項、錯在哪。
· 新：首頁多一張卡，引導把大肚猴翻譯設成系統預設的翻譯 App。
· 新：Discord 社群入口，在「討論」裡。
· 修復：「對話 · 即時口譯」中途切換耳機或喇叭之後不再收不到聲音（需要 iOS 26）。
```

## 国际版 · ja

```
· 新機能：システム翻訳 —— どのアプリでもテキストを選んで「翻訳」をタップすれば、ご自身で設定したエンジンで翻訳します。当社のサーバーは経由しません。先に「設定 › App › 翻訳 › デフォルトの翻訳App」でBelliedMonkeyを選んでください。iOS 18.4以降が必要です。
· 新機能：エンジンを設定するとその場でテストし、結果を表示します。通ったときだけ「使えます」と表示し、失敗した項目はその場で示します。
· 新機能：ホームにカードを追加。既定の翻訳Appに設定する手順を案内します。
· 新機能：Discordコミュニティへの入口（「ディスカッション」内）。
· 修正：「会話・リアルタイム通訳」でイヤホンとスピーカーを切り替えた後に音声が届かなくなる問題（iOS 26が必要）。
```

## 国际版 · ko

```
· 신규: 시스템 번역 — 어떤 앱에서든 텍스트를 선택하고 ‘번역’을 누르면 직접 설정한 엔진으로 번역합니다. 당사 서버를 거치지 않습니다. 먼저 설정 › App › 번역 › 기본 번역 App에서 BelliedMonkey를 선택하세요. iOS 18.4 이상이 필요합니다.
· 신규: 엔진을 설정하면 그 자리에서 한 번 테스트하고 결과를 보여 줍니다. 통과했을 때만 ‘사용할 수 있습니다’라고 표시하며, 실패한 항목은 그 자리에서 알려 줍니다.
· 신규: 홈 화면에 기본 번역 App으로 지정하는 방법을 안내하는 카드가 생겼습니다.
· 신규: Discord 커뮤니티 입구(‘토론’ 안).
· 수정: ‘대화 · 실시간 통역’에서 이어폰과 스피커를 전환한 뒤 소리가 들어오지 않던 문제(iOS 26 필요).
```

## 国际版 · de-DE

```
· Neu: Systemübersetzung — Text in jeder App markieren, auf „Übersetzen“ tippen, und es läuft über die von Ihnen eingerichtete Engine, nie über unsere Server. Wählen Sie zuerst BelliedMonkey unter Einstellungen › Apps › Übersetzen › Standard-Übersetzungs-App. Erfordert iOS 18.4 oder neuer.
· Neu: Nach dem Einrichten einer Engine wird sie direkt getestet und das Ergebnis angezeigt — „Einsatzbereit“ steht erst da, wenn der Test besteht; andernfalls wird genannt, was fehlschlug.
· Neu: Eine Karte auf der Startseite führt durch das Festlegen als Standard-Übersetzungs-App.
· Neu: Zugang zur Discord-Community unter „Diskussion“.
· Behoben: „Gespräch · Live-Dolmetschen“ verstummt nicht mehr nach dem Wechsel zwischen Kopfhörer und Lautsprecher (erfordert iOS 26).
```

## 国际版 · fr-FR

```
· Nouveau : traduction système — sélectionnez du texte dans n’importe quelle app, touchez « Traduire », et cela passe par le moteur que vous avez configuré, jamais par nos serveurs. Choisissez d’abord BelliedMonkey dans Réglages › Apps › Traduire › App de traduction par défaut. Nécessite iOS 18.4 ou ultérieur.
· Nouveau : une fois le moteur configuré, il est testé sur place et le résultat s’affiche — « Prêt » n’apparaît qu’après un test réussi, sinon l’élément en échec est nommé.
· Nouveau : une carte sur l’écran d’accueil explique comment définir BelliedMonkey comme app de traduction par défaut.
· Nouveau : accès à la communauté Discord, dans « Discussion ».
· Correction : « Conversation · interprétation en direct » ne devient plus muet après un basculement entre écouteurs et haut-parleur (nécessite iOS 26).
```

## 国际版 · es-ES

```
· Nuevo: traducción del sistema: selecciona texto en cualquier app, toca «Traducir» y se usa el motor que tú configuraste, nunca nuestros servidores. Primero elige BelliedMonkey en Ajustes › Apps › Traducir › App de traducción por omisión. Requiere iOS 18.4 o posterior.
· Nuevo: tras configurar un motor se prueba ahí mismo y se muestra el resultado: solo dice «Listo» si la prueba pasa; si no, indica qué falló.
· Nuevo: una tarjeta en la pantalla de inicio te guía para ponerlo como app de traducción por omisión.
· Nuevo: acceso a la comunidad de Discord, en «Debate».
· Corregido: «Conversación · interpretación en directo» ya no se queda sin sonido al cambiar entre auriculares y altavoz (requiere iOS 26).
```

## 国际版 · pt-BR

```
· Novo: tradução do sistema — selecione texto em qualquer app, toque em “Traduzir” e ele usa o motor que você configurou, nunca nossos servidores. Primeiro escolha o BelliedMonkey em Ajustes › Apps › Traduzir › App de Tradução Padrão. Requer iOS 18.4 ou posterior.
· Novo: depois de configurar um motor, ele é testado ali mesmo e o resultado aparece — só diz “Pronto” quando o teste passa; caso contrário, aponta o item que falhou.
· Novo: um cartão na tela inicial orienta a definir o app como tradutor padrão do sistema.
· Novo: entrada para a comunidade no Discord, em “Discussão”.
· Corrigido: “Conversa · interpretação ao vivo” não fica mais sem som ao alternar entre fones e alto-falante (requer iOS 26).
```

## 国际版 · ru

```
· Новое: системный перевод — выделите текст в любом приложении, нажмите «Перевести», и он уйдёт в настроенный вами движок, минуя наши серверы. Сначала выберите BelliedMonkey в «Настройки › Приложения › Перевод › Приложение для перевода по умолчанию». Требуется iOS 18.4 или новее.
· Новое: после настройки движка он сразу проверяется, и результат виден — «Готово» появляется только при успешной проверке, иначе названа неудавшаяся часть.
· Новое: карточка на главном экране подсказывает, как назначить приложение переводчиком по умолчанию.
· Новое: вход в сообщество Discord — в разделе «Обсуждение».
· Исправлено: «Диалог · синхронный перевод» больше не теряет звук после переключения между наушниками и динамиком (требуется iOS 26).
```

## 国际版 · ar-SA

```
· جديد: ترجمة النظام — حدّد نصًا في أي تطبيق واضغط «ترجمة»، فيُترجَم عبر المحرّك الذي أعددته أنت، دون المرور بخوادمنا. اختر أولًا BelliedMonkey من الإعدادات › التطبيقات › الترجمة › تطبيق الترجمة الافتراضي. يتطلب iOS 18.4 أو أحدث.
· جديد: بعد إعداد المحرّك يُختبر في مكانه وتظهر النتيجة — لا يُقال «جاهز» إلا بعد نجاح الاختبار، وإلا فيُسمّى البند الذي أخفق.
· جديد: بطاقة في الشاشة الرئيسية ترشدك إلى جعله تطبيق الترجمة الافتراضي.
· جديد: مدخل إلى مجتمع Discord ضمن «النقاش».
· إصلاح: «المحادثة · الترجمة الفورية» لم يعد الصوت ينقطع بعد التبديل بين السماعة ومكبر الصوت (يتطلب iOS 26).
```

## 国际版 · it

```
· Novità: traduzione di sistema — seleziona del testo in qualsiasi app, tocca «Traduci» e viene usato il motore che hai configurato, mai i nostri server. Scegli prima BelliedMonkey in Impostazioni › App › Traduci › App di traduzione predefinita. Richiede iOS 18.4 o successivo.
· Novità: dopo aver configurato un motore viene provato sul posto e il risultato è mostrato — «Pronto» compare solo se la prova riesce, altrimenti viene indicato l’elemento fallito.
· Novità: una scheda nella schermata iniziale spiega come impostarlo come app di traduzione predefinita.
· Novità: accesso alla comunità Discord, in «Discussione».
· Corretto: «Conversazione · interpretariato dal vivo» non resta più senza audio dopo il passaggio tra auricolari e altoparlante (richiede iOS 26).
```

## 国际版 · tr

```
· Yeni: sistem çevirisi — herhangi bir uygulamada metni seçip “Çevir”e dokunun; kendi yapılandırdığınız motorla çevrilir, sunucularımızdan geçmez. Önce Ayarlar › Uygulamalar › Çevir › Varsayılan Çeviri Uygulaması’ndan BelliedMonkey’i seçin. iOS 18.4 veya üstü gerekir.
· Yeni: bir motoru kurduktan sonra hemen orada sınanır ve sonuç gösterilir — yalnızca sınama geçerse “Hazır” yazar, geçmezse başarısız olan madde belirtilir.
· Yeni: ana ekrana, varsayılan çeviri uygulaması yapmayı anlatan bir kart eklendi.
· Yeni: “Tartışma” içinde Discord topluluğu girişi.
· Düzeltildi: “Konuşma · canlı çeviri”, kulaklıkla hoparlör arasında geçiş yapıldıktan sonra artık sessiz kalmıyor (iOS 26 gerekir).
```

## 国际版 · vi

```
· Mới: dịch hệ thống — chọn văn bản trong bất kỳ ứng dụng nào, chạm “Dịch”, và nó dùng công cụ bạn tự cấu hình, không đi qua máy chủ của chúng tôi. Trước tiên hãy chọn BelliedMonkey trong Cài đặt › Ứng dụng › Dịch › Ứng dụng dịch mặc định. Cần iOS 18.4 trở lên.
· Mới: sau khi cấu hình công cụ, nó được thử ngay tại chỗ và hiện kết quả — chỉ báo “Dùng được” khi thử đạt; nếu không, nêu rõ mục nào hỏng.
· Mới: màn hình chính có thêm một thẻ hướng dẫn đặt làm ứng dụng dịch mặc định.
· Mới: lối vào cộng đồng Discord, trong mục “Thảo luận”.
· Sửa: “Hội thoại · phiên dịch trực tiếp” không còn mất tiếng sau khi chuyển giữa tai nghe và loa (cần iOS 26).
```

## 国际版 · pl

```
· Nowość: tłumaczenie systemowe — zaznacz tekst w dowolnej aplikacji, dotknij „Tłumacz”, a trafi on do skonfigurowanego przez Ciebie silnika, nigdy na nasze serwery. Najpierw wybierz BelliedMonkey w Ustawienia › Aplikacje › Tłumacz › Domyślna aplikacja tłumacząca. Wymaga iOS 18.4 lub nowszego.
· Nowość: po skonfigurowaniu silnika jest on od razu sprawdzany i widać wynik — „Gotowe” pojawia się dopiero po udanym teście, w przeciwnym razie wskazana jest pozycja, która zawiodła.
· Nowość: karta na ekranie głównym prowadzi przez ustawienie aplikacji jako domyślnego tłumacza.
· Nowość: wejście do społeczności Discord w sekcji „Dyskusja”.
· Poprawiono: „Rozmowa · tłumaczenie na żywo” nie milknie już po przełączeniu między słuchawkami a głośnikiem (wymaga iOS 26).
```
