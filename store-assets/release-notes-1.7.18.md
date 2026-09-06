# 1.7.18 发布说明（国际版 11 份 + 中国版 1 份 · iOS 与 macOS 同文）

> 三件 2026-09-06 报障同源（PR #203）：①App 里配好语音引擎后播客入口与 ▶ 要重启才出现
> （根因：App 侧没有设置总线，review.js 只在启动时读一次设置）；②App 复习页头长出了给浏览器
> 用的「在 App 里继续复习」；③深色模式下引导页/设置页的「去申请 key」链接是浏览器默认蓝，
> 1.9:1 看不清 —— 顺带把浅色偏淡的次要文字与按钮底色调到 WCAG AA。扩展页也受 ③ 影响，
> 所以扩展两店同发。说明只写用户看得见的三句 + 一句 1.7.17 回顾。

---

## 国际版 · zh-Hans

```
修复三处：
· App 里配好语音引擎后，「播客模式」入口和卡片上的「听一遍」现在立刻出现，不用重启 App。
· App 复习页顶部不再出现「在 App 里继续复习」按钮（那是给浏览器扩展用的）。
· 深色模式下看不清的链接与浅灰文字（例如设置里的「去申请 key」）全部调到可读；浅色模式的按钮与次要文字也略加深了一档。

1.7.17 的修复仍在：一键配置粘贴 key 后不再消失。
```

## 国际版 · en-US

```
Three fixes:
· In the app, once you set up a speech engine, Podcast Mode and the card's "Listen" button now appear right away — no relaunch needed.
· The app's review screen no longer shows a "Continue in the app" button (that one belongs to the browser extension).
· Links and light grey text that were hard to read in Dark Mode (for example "Get a key" in Settings) are now legible; light-mode buttons and secondary text are a shade darker too.

The 1.7.17 fix is still here: your API key no longer disappears after one-tap setup.
```

## 中国版 · zh-Hans

```
修复三处：
· App 里配好语音引擎后，「播客模式」入口和卡片上的「听一遍」现在立刻出现，不用重启 App。
· App 复习页顶部不再出现「在 App 里继续复习」按钮（那是给浏览器扩展用的）。
· 深色模式下看不清的链接与浅灰文字（例如设置里的「去申请 key」）全部调到可读；浅色模式的按钮与次要文字也略加深了一档。

1.7.17 的修复仍在：一键配置粘贴 key 后不再消失。
```

## 国际版 · zh-Hant

```
修復三處：
· App 裡設定好語音引擎後，「播客模式」入口和卡片上的「聽一遍」現在立刻出現，不用重啟 App。
· App 複習頁頂部不再出現「在 App 裡繼續複習」按鈕（那是給瀏覽器擴充功能用的）。
· 深色模式下看不清的連結與淺灰文字（例如設定裡的「去申請 key」）全部調到可讀；淺色模式的按鈕與次要文字也略加深了一階。

1.7.17 的修復仍在：一鍵設定貼上 key 後不再消失。
```

## 国际版 · ja

```
3 件の修正：
· アプリで音声エンジンを設定すると、「ポッドキャストモード」とカードの「聞く」ボタンがすぐに表示されます。再起動は不要になりました。
· アプリの復習画面に「アプリで続ける」ボタンが表示されなくなりました（ブラウザ拡張機能向けのものです）。
· ダークモードで読みにくかったリンクや薄いグレーの文字（設定の「キーを取得」など）を読める色に調整。ライトモードのボタンと補助テキストも一段濃くしました。

1.7.17 の修正も引き続き有効です：ワンタップ設定で貼り付けた API キーが消えなくなりました。
```

## 国际版 · ko

```
세 가지 수정:
· 앱에서 음성 엔진을 설정하면 「팟캐스트 모드」와 카드의 「듣기」 버튼이 바로 나타납니다. 앱을 다시 시작할 필요가 없습니다.
· 앱의 복습 화면 상단에 「앱에서 계속하기」 버튼이 더 이상 표시되지 않습니다(브라우저 확장 프로그램용 버튼입니다).
· 다크 모드에서 잘 보이지 않던 링크와 연한 회색 글자(예: 설정의 「키 발급받기」)를 읽을 수 있게 조정했고, 라이트 모드의 버튼과 보조 텍스트도 한 단계 진하게 했습니다.

1.7.17의 수정은 그대로입니다: 원탭 설정에서 붙여넣은 API 키가 더 이상 사라지지 않습니다.
```

## 国际版 · de-DE

```
Drei Korrekturen:
· Sobald in der App eine Sprachausgabe eingerichtet ist, erscheinen der Podcast-Modus und die Schaltfläche „Anhören“ auf der Karte sofort – kein Neustart mehr nötig.
· Der Wiederholungsbildschirm der App zeigt keine Schaltfläche „In der App weitermachen“ mehr (die gehört zur Browser-Erweiterung).
· Links und hellgrauer Text, die im Dunkelmodus schwer lesbar waren (z. B. „Schlüssel holen“ in den Einstellungen), sind jetzt gut lesbar; Schaltflächen und Nebentext im Hellmodus sind eine Stufe dunkler.

Die Korrektur aus 1.7.17 bleibt: Der API-Schlüssel verschwindet nach der Ein-Klick-Einrichtung nicht mehr.
```

## 国际版 · fr-FR

```
Trois correctifs :
· Dans l'app, dès qu'un moteur vocal est configuré, le mode Podcast et le bouton « Écouter » de la carte apparaissent immédiatement — plus besoin de relancer l'app.
· L'écran de révision de l'app n'affiche plus le bouton « Continuer dans l'app » (il appartient à l'extension de navigateur).
· Les liens et textes gris clair difficiles à lire en mode sombre (par ex. « Obtenir une clé » dans les réglages) sont maintenant lisibles ; les boutons et textes secondaires du mode clair sont aussi un peu plus foncés.

Le correctif de 1.7.17 est toujours là : la clé API ne disparaît plus après la configuration en un geste.
```

## 国际版 · es-ES

```
Tres correcciones:
· En la app, en cuanto configuras un motor de voz, el modo Podcast y el botón «Escuchar» de la tarjeta aparecen al momento, sin reiniciar la app.
· La pantalla de repaso de la app ya no muestra el botón «Continuar en la app» (ese es de la extensión del navegador).
· Los enlaces y textos gris claro que costaba leer en modo oscuro (por ejemplo «Obtener una clave» en Ajustes) ahora se leen bien; los botones y textos secundarios del modo claro también son un punto más oscuros.

La corrección de 1.7.17 sigue aquí: la clave API ya no desaparece tras la configuración con un toque.
```

## 国际版 · pt-BR

```
Três correções:
· No app, assim que você configura um mecanismo de voz, o modo Podcast e o botão "Ouvir" do cartão aparecem na hora — sem precisar reabrir o app.
· A tela de revisão do app não mostra mais o botão "Continuar no app" (ele pertence à extensão do navegador).
· Links e textos cinza-claro difíceis de ler no modo escuro (por exemplo "Obter uma chave" em Ajustes) agora ficam legíveis; botões e textos secundários do modo claro também estão um tom mais escuros.

A correção da 1.7.17 continua: a chave de API não some mais após a configuração com um toque.
```

## 国际版 · ru

```
Три исправления:
· В приложении после настройки голосового движка «Режим подкаста» и кнопка «Прослушать» на карточке появляются сразу — перезапуск больше не нужен.
· На экране повторения в приложении больше нет кнопки «Продолжить в приложении» (она относится к браузерному расширению).
· Ссылки и светло-серый текст, которые плохо читались в тёмной теме (например «Получить ключ» в настройках), теперь читаемы; кнопки и второстепенный текст светлой темы стали на тон темнее.

Исправление из 1.7.17 на месте: ключ API больше не исчезает после настройки в одно касание.
```

## 国际版 · ar-SA

```
ثلاثة إصلاحات:
· في التطبيق، بمجرد إعداد محرك الصوت يظهر «وضع البودكاست» وزر «استمع» على البطاقة فورًا — دون الحاجة إلى إعادة تشغيل التطبيق.
· لم تعد شاشة المراجعة في التطبيق تعرض زر «المتابعة في التطبيق» (فهو خاص بإضافة المتصفح).
· الروابط والنصوص الرمادية الفاتحة التي كانت صعبة القراءة في الوضع الداكن (مثل «احصل على مفتاح» في الإعدادات) أصبحت مقروءة؛ كما أصبحت الأزرار والنصوص الثانوية في الوضع الفاتح أغمق بدرجة.

إصلاح 1.7.17 لا يزال موجودًا: لم يعد مفتاح API يختفي بعد الإعداد بلمسة واحدة.
```
