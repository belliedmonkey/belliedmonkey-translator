# 1.9.2 发布说明（国际版 11 份 + 中国版 1 份 · iOS 与 macOS 同文）

> 补丁版，第九期（PR #231–#234）。两件事都来自用户反馈：① 实时转写的入口太深 —— 明明有视频却探测
> 不到时弹窗上什么都没有，叠层里的入口要等 15–20 秒；② 一键配置的默认平台没有实时转写接口，一键配好
> 的人碰到直播、流媒体或 App 的实时听译就卡住，且没有出口。中国版的一键平台自带实时接口，第二条不适用。
> 商店文案里不点名具体服务商。

---

## 国际版 · zh-Hans

```
· 弹窗里新增「实时转写 + 翻译」一行，只要页面上有视频或音频就能一键开始（包括网页组件里的播放器）；播放器在嵌入框架里时会告诉你并给出口。叠层里的转写入口不再要等十几秒。
· Safari 上从弹窗开始转写时，页面上会出现「点此开始」再点一次即可（Safari 需要在页面里点一下才能采集声音）。
· 一键配置里新增「实时转写（可选）」：默认平台没有实时接口时，另填一把带实时接口的 key 就能实时转写；转写引擎列表里带实时接口的会标出「· 实时」。
```

## 国际版 · en-US

```
· The popup now has a "Live transcription + translation" row that starts with one tap whenever the page has a video or audio element (players inside web components included); when the player lives in an embedded frame it says so and offers a way in. The in-overlay entry no longer waits 15 seconds.
· On Safari, starting from the popup shows a "Tap to start" button on the page — one more tap and capture begins (Safari only captures audio after a tap on the page itself).
· One-key setup gains "Live transcription (optional)": when the platform has no live interface, add one key from a provider that does; engines with a live interface are marked "· live" in the transcription list.
```

## 中国版 · zh-Hans

```
· 弹窗里新增「实时转写 + 翻译」一行，只要页面上有视频或音频就能一键开始（包括网页组件里的播放器）；播放器在嵌入框架里时会告诉你并给出口。叠层里的转写入口不再要等十几秒。
· Safari 上从弹窗开始转写时，页面上会出现「点此开始」再点一次即可（Safari 需要在页面里点一下才能采集声音）。
· 转写引擎列表里带实时接口的会标出「· 实时」。
```

## 国际版 · zh-Hant

```
· 彈窗裡新增「即時轉寫 + 翻譯」一行，只要頁面上有影片或音訊就能一鍵開始（包括網頁元件裡的播放器）；播放器在嵌入框架裡時會告訴你並給出口。疊層裡的轉寫入口不再要等十幾秒。
· Safari 上從彈窗開始轉寫時，頁面上會出現「點此開始」再點一次即可（Safari 需要在頁面裡點一下才能擷取聲音）。
· 一鍵設定裡新增「即時轉寫（可選）」：預設平台沒有即時介面時，另填一把帶即時介面的 key 就能即時轉寫；轉寫引擎清單裡帶即時介面的會標出「· 即時」。
```

## 国际版 · ja

```
· ポップアップに「リアルタイム文字起こし + 翻訳」の行を追加。ページに動画や音声があればワンタップで開始できます（Web コンポーネント内のプレーヤーも対象）。プレーヤーが埋め込みフレーム内にある場合はその旨を表示し、開く手段を案内します。オーバーレイ内の入口も十数秒待たなくなりました。
· Safari でポップアップから開始すると、ページ上に「タップして開始」が表示されます。もう一度タップすれば取り込みが始まります（Safari はページ内でのタップ後にのみ音声を取り込めます）。
· かんたん設定に「リアルタイム文字起こし（任意）」を追加。プラットフォームにリアルタイム API がない場合、対応プロバイダーのキーを 1 つ追加すれば使えます。認識エンジン一覧では対応エンジンに「· リアルタイム」と表示します。
```

## 国际版 · ko

```
· 팝업에 「실시간 받아쓰기 + 번역」 줄이 생겼어요. 페이지에 영상이나 오디오가 있으면 한 번에 시작할 수 있어요(웹 컴포넌트 안의 플레이어 포함). 플레이어가 임베드 프레임 안에 있으면 알려주고 들어갈 길을 열어 줘요. 오버레이 안의 입구도 더 이상 십몇 초를 기다리지 않아요.
· Safari에서 팝업으로 시작하면 페이지에 「눌러서 시작」이 나타나요. 한 번 더 누르면 캡처가 시작돼요(Safari는 페이지 안에서 누른 뒤에만 소리를 캡처해요).
· 원키 설정에 「실시간 받아쓰기(선택)」가 추가됐어요. 플랫폼에 실시간 인터페이스가 없으면 지원하는 제공업체의 키를 하나 더 넣으면 돼요. 받아쓰기 엔진 목록에서 실시간 지원 엔진에 「· 실시간」이 표시돼요.
```

## 国际版 · de-DE

```
· Das Popup hat jetzt die Zeile „Live-Transkription + Übersetzung“: Sobald die Seite ein Video oder Audio hat, startet sie mit einem Tipp (auch Player in Web-Komponenten). Sitzt der Player in einem eingebetteten Frame, sagt sie das und bietet einen Weg hinein. Der Einstieg im Overlay wartet nicht mehr 15 Sekunden.
· In Safari erscheint beim Start aus dem Popup ein „Tippen zum Starten“ auf der Seite – ein Tipp mehr und die Aufnahme beginnt (Safari nimmt Ton nur nach einem Tipp auf der Seite selbst auf).
· Die Ein-Schlüssel-Einrichtung bekommt „Live-Transkription (optional)“: Hat die Plattform keine Live-Schnittstelle, reicht ein Schlüssel eines Anbieters mit einer; Engines mit Live-Schnittstelle sind in der Transkriptionsliste mit „· Live“ markiert.
```

## 国际版 · fr-FR

```
· Le menu contient désormais une ligne « Transcription en direct + traduction » : dès que la page a une vidéo ou un audio, un seul geste suffit (lecteurs dans des composants web compris). Si le lecteur est dans un cadre intégré, elle le dit et propose un accès. L'entrée dans l'overlay n'attend plus quinze secondes.
· Sur Safari, démarrer depuis le menu affiche « Touchez pour démarrer » sur la page — un geste de plus et la capture commence (Safari ne capture le son qu'après un geste dans la page).
· La configuration en une clé gagne « Transcription en direct (facultatif) » : si la plateforme n'a pas d'interface en direct, ajoutez une clé d'un fournisseur qui en a une ; les moteurs concernés sont marqués « · direct » dans la liste.
```

## 国际版 · es-ES

```
· El menú tiene ahora una fila «Transcripción en vivo + traducción»: en cuanto la página tiene un vídeo o audio, empieza con un toque (incluidos los reproductores dentro de componentes web). Si el reproductor está en un marco incrustado, lo dice y ofrece una vía. La entrada en la superposición ya no espera quince segundos.
· En Safari, al empezar desde el menú aparece «Toca para iniciar» en la página: un toque más y comienza la captura (Safari solo captura audio tras un toque en la propia página).
· La configuración con una clave añade «Transcripción en vivo (opcional)»: si la plataforma no tiene interfaz en vivo, añade una clave de un proveedor que sí la tenga; en la lista, los motores con interfaz en vivo llevan «· en vivo».
```

## 国际版 · pt-BR

```
· O menu ganhou a linha «Transcrição ao vivo + tradução»: assim que a página tem um vídeo ou áudio, começa com um toque (inclusive players dentro de componentes web). Se o player estiver em um frame incorporado, ele avisa e oferece um caminho. A entrada na sobreposição não espera mais quinze segundos.
· No Safari, ao iniciar pelo menu aparece «Toque para iniciar» na página — mais um toque e a captura começa (o Safari só captura áudio após um toque na própria página).
· A configuração com uma chave ganhou «Transcrição ao vivo (opcional)»: se a plataforma não tem interface ao vivo, adicione uma chave de um provedor que tenha; na lista, os mecanismos com interface ao vivo aparecem com «· ao vivo».
```

## 国际版 · ru

```
· В меню появилась строка «Живая транскрипция + перевод»: как только на странице есть видео или аудио, она запускается одним нажатием (включая плееры внутри веб-компонентов). Если плеер во встроенном фрейме, об этом сообщается и предлагается путь. Вход в оверлее больше не ждёт пятнадцать секунд.
· В Safari при запуске из меню на странице появляется «Нажмите, чтобы начать» — ещё одно нажатие, и захват начинается (Safari захватывает звук только после нажатия на самой странице).
· В быстрой настройке добавлено «Транскрипция в реальном времени (необязательно)»: если у платформы нет интерфейса реального времени, добавьте ключ провайдера, у которого он есть; такие движки помечены «· живой» в списке.
```

## 国际版 · ar-SA

```
· أُضيف إلى القائمة سطر «نسخ مباشر + ترجمة»: ما إن تحتوي الصفحة على فيديو أو صوت يبدأ بضغطة واحدة (بما في ذلك المشغّلات داخل مكوّنات الويب). وإذا كان المشغّل داخل إطار مضمّن فسيخبرك ويوفّر طريقًا. لم يعد المدخل في الطبقة العلوية ينتظر خمس عشرة ثانية.
· في Safari، عند البدء من القائمة يظهر «اضغط للبدء» على الصفحة — ضغطة أخرى ويبدأ الالتقاط (لا يلتقط Safari الصوت إلا بعد ضغطة داخل الصفحة نفسها).
· أُضيف إلى الإعداد بمفتاح واحد «نسخ مباشر (اختياري)»: إن لم تملك المنصة واجهة مباشرة، أضف مفتاحًا من مزوّد يملكها؛ وتُميَّز المحركات ذات الواجهة المباشرة في القائمة بـ «· مباشر».
```
