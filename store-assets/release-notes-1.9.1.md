# 1.9.1 发布说明（国际版 11 份 + 中国版 1 份 · iOS 与 macOS 同文）

> 补丁版。三件事都来自 1.9.0 上线后 5 天的用量事件与用户实测（第八期，PR #227–#230）：
> ① 一把被服务商拒绝的 key 会让每一段各失败一次、界面上没有出口 —— 现在立刻停下并指到该改的地方；
> ② 装了 App 的人大多没把 Safari 扩展打开 —— App 首页把「去 Safari 里打开」做成唯一主动作，并给三步图示；
> ③ 评分入口此前只在复习完一轮之后出现，几乎没人走到 —— 现在翻过几页之后在译文末尾问一次，关掉就 90 天不再问；
> ④（国际版）领取免费额度时卡片误显示「你现在用的是自己的 key」，且「改回免费额度」按钮无效 —— 已修。
> 商店文案里不点名具体服务商（注册表是唯一登记处）。

---

## 国际版 · zh-Hans

```
· API key 被服务商拒绝（401/403）时，翻译会立刻停下，并在页面上告诉你去设置里检查这把 key，不再逐段反复失败。
· App 首页更清楚地引导打开 Safari 扩展：三步图示 + 一键跳到检测页，确认打开后点「我已打开」即可收起。
· 翻过几页之后，会在译文末尾问一次要不要去商店评分；关掉就 90 天内不再出现。
· 修复：领取免费额度后卡片误显示「你现在用的是自己的 key」，且「改回免费额度」点了没反应。
```

## 国际版 · en-US

```
· When a provider rejects your API key (401/403), translation now stops right away and tells you on the page to check that key in Settings — no more failing paragraph by paragraph.
· The app's home screen now guides you to turn on the Safari extension: three illustrated steps, a one-tap jump to the check page, and an “I've turned it on” button to dismiss.
· After you've translated a few pages, a single line at the end of the translation asks whether you'd like to rate the app; dismiss it and it stays away for 90 days.
· Fix: after claiming the free allowance, the card wrongly said you were using your own key, and “Switch back to free credit” did nothing.
```

## 中国版 · zh-Hans

```
· API Key 被服务商拒绝（401/403）时，翻译会立刻停下，并在页面上告诉你去设置里检查这把 Key，不再逐段反复失败。
· App 首页更清楚地引导打开 Safari 扩展：三步图示 + 一键跳到检测页，确认打开后点「我已打开」即可收起。
· 翻过几页之后，会在译文末尾问一次要不要去 App Store 评分；关掉就 90 天内不再出现。
```

## 国际版 · zh-Hant

```
· API key 被服務商拒絕（401/403）時，翻譯會立刻停下，並在頁面上告訴你去設定裡檢查這把 key，不再逐段反覆失敗。
· App 首頁更清楚地引導打開 Safari 擴充功能：三步圖示 + 一鍵跳到檢測頁，確認打開後點「我已打開」即可收起。
· 翻過幾頁之後，會在譯文末尾問一次要不要去商店評分；關掉就 90 天內不再出現。
· 修復：領取免費額度後卡片誤顯示「你現在用的是自己的 key」，且「改回免費額度」點了沒反應。
```

## 国际版 · ja

```
· API キーがプロバイダーに拒否された（401/403）場合、翻訳をすぐに停止し、設定でキーを確認するようページ上で案内します。段落ごとに失敗し続けることはなくなりました。
· アプリのホーム画面で Safari 拡張機能をオンにする手順をわかりやすく案内：3 ステップの図解、確認ページへのワンタップ、「オンにしました」で閉じられます。
· 数ページ翻訳したあと、訳文の末尾で一度だけストア評価をお願いします。閉じると 90 日間は表示されません。
· 修正：無料枠を受け取ったあとカードに「ご自身のキーを使用中」と誤表示され、「無料枠に戻す」が反応しなかった問題。
```

## 国际版 · ko

```
· API 키가 제공업체에서 거부되면(401/403) 번역을 즉시 멈추고, 설정에서 키를 확인하라고 페이지에 알려줍니다. 더 이상 문단마다 반복 실패하지 않습니다.
· 앱 홈 화면에서 Safari 확장 프로그램 켜는 방법을 더 분명하게 안내: 3단계 그림, 확인 페이지로 한 번에 이동, 「켰어요」로 닫기.
· 몇 페이지 번역한 뒤 번역문 끝에서 한 번만 스토어 평가를 요청합니다. 닫으면 90일 동안 다시 묻지 않습니다.
· 수정: 무료 크레딧을 받은 뒤 카드에 「직접 넣은 키 사용 중」이라고 잘못 표시되고 「무료 크레딧으로 되돌리기」가 동작하지 않던 문제.
```

## 国际版 · de-DE

```
· Lehnt der Anbieter deinen API-Schlüssel ab (401/403), stoppt die Übersetzung sofort und die Seite sagt dir, dass du den Schlüssel in den Einstellungen prüfen sollst – kein Absatz-für-Absatz-Scheitern mehr.
· Der Startbildschirm der App führt klarer zum Aktivieren der Safari-Erweiterung: drei bebilderte Schritte, ein Tipp zur Prüfseite und „Ich habe sie aktiviert“ zum Ausblenden.
· Nach ein paar übersetzten Seiten fragt eine Zeile am Ende der Übersetzung einmal nach einer Bewertung; weggeklickt bleibt sie 90 Tage fern.
· Behoben: Nach dem Abholen des Gratis-Guthabens behauptete die Karte fälschlich, du nutzt deinen eigenen Schlüssel, und „Zurück zum Gratis-Guthaben“ tat nichts.
```

## 国际版 · fr-FR

```
· Si le fournisseur rejette votre clé API (401/403), la traduction s'arrête aussitôt et la page vous invite à vérifier la clé dans les réglages — plus d'échecs paragraphe par paragraphe.
· L'écran d'accueil de l'app guide mieux vers l'activation de l'extension Safari : trois étapes illustrées, un accès direct à la page de vérification et « Je l'ai activée » pour fermer.
· Après quelques pages traduites, une ligne en fin de traduction demande une seule fois si vous souhaitez noter l'app ; fermée, elle ne revient pas avant 90 jours.
· Correctif : après l'obtention du crédit gratuit, la carte indiquait à tort que vous utilisiez votre propre clé, et « Revenir au crédit gratuit » ne faisait rien.
```

## 国际版 · es-ES

```
· Si el proveedor rechaza tu clave API (401/403), la traducción se detiene al instante y la página te indica revisar esa clave en Ajustes; ya no falla párrafo a párrafo.
· La pantalla de inicio de la app guía mejor para activar la extensión de Safari: tres pasos ilustrados, un salto a la página de comprobación y «Ya la activé» para cerrar.
· Tras traducir unas páginas, una línea al final de la traducción pregunta una sola vez si quieres valorar la app; si la cierras, no vuelve en 90 días.
· Corregido: tras obtener el crédito gratis, la tarjeta decía erróneamente que usabas tu propia clave y «Volver al crédito gratis» no hacía nada.
```

## 国际版 · pt-BR

```
· Se o provedor rejeitar sua chave de API (401/403), a tradução para na hora e a página avisa para conferir a chave em Ajustes — sem mais falhas parágrafo por parágrafo.
· A tela inicial do app orienta melhor a ativar a extensão do Safari: três passos ilustrados, um atalho para a página de verificação e “Já ativei” para fechar.
· Depois de traduzir algumas páginas, uma linha no fim da tradução pergunta uma vez se você quer avaliar o app; fechou, some por 90 dias.
· Correção: após receber o crédito grátis, o cartão dizia erradamente que você usava sua própria chave, e “Voltar ao crédito grátis” não fazia nada.
```

## 国际版 · ru

```
· Если провайдер отклонил ваш API-ключ (401/403), перевод сразу останавливается, а страница предлагает проверить ключ в настройках — больше никаких сбоев абзац за абзацем.
· Главный экран приложения понятнее ведёт к включению расширения Safari: три иллюстрированных шага, переход на страницу проверки и кнопка «Я включил(а)», чтобы скрыть подсказку.
· После перевода нескольких страниц строка в конце перевода один раз спросит об оценке; закройте — и она не появится 90 дней.
· Исправлено: после получения бесплатного лимита карточка ошибочно сообщала, что используется ваш ключ, а «Вернуться к бесплатному лимиту» не работала.
```

## 国际版 · ar-SA

```
· عندما يرفض المزوّد مفتاح API الخاص بك (401/403)، تتوقف الترجمة فورًا وتخبرك الصفحة بمراجعة المفتاح في الإعدادات — لا مزيد من الفشل فقرةً بعد فقرة.
· الشاشة الرئيسية للتطبيق ترشدك بوضوح أكبر لتفعيل إضافة Safari: ثلاث خطوات مصوّرة، انتقال بلمسة إلى صفحة التحقق، وزر «لقد فعّلتها» للإخفاء.
· بعد ترجمة بضع صفحات، يسألك سطر في نهاية الترجمة مرة واحدة إن كنت تودّ تقييم التطبيق؛ أغلقه ولن يظهر لمدة 90 يومًا.
· إصلاح: بعد الحصول على الرصيد المجاني كانت البطاقة تعرض خطأً أنك تستخدم مفتاحك الخاص، وزر «العودة إلى الرصيد المجاني» لا يعمل.
```
