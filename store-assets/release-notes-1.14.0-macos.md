# 1.14.0 发布说明 · macOS 两线（国际版 15 份 + 中国版 1 份）

> **不提系统翻译** —— macOS 没有 TranslationUIProvider 这个扩展点（Apple 至今没有对应物），那是 iOS 那份的主角。
> 中国版没有 Discord（大陆打不开，社区入口是 Discussions / 微信群），所以中国版那段不提它 —— 同一件事在两条线上说得不一样，正是这份文件分两段的理由。
> 提到「对话 · 实时听译」时紧跟系统要求，是 docs/release-checklist.md §3 的硬要求。
> 用法：`node scripts/asc.js notes com.belliedmonkeytranslator MAC_OS 1.14.0 store-assets/release-notes-1.14.0-macos.md`（中国版把 bundleId 换成 .cn）

## 国际版 · zh-Hans

```
· 新：配好引擎之后当场测一遍并把结果摆出来 —— 通了才说「可以用了」，没通会指出是哪一项、错在哪。
· 新：Discord 社区入口，在「讨论」里。
· 修复：「对话 · 实时听译」中途切换耳机或扬声器之后不再收不到声音（需要 macOS 26）。
```

## 国际版 · en-US

```
· New: after you set up an engine, it is tested right there and the result is shown — it only says “Ready” once the test passes, and names the item that failed if one does.
· New: Discord community link, under “Discuss.”
· Fixed: Conversation · Live interpreting no longer goes silent after switching between headphones and speaker (requires macOS 26).
```

## 中国版 · zh-Hans

```
· 新：配好引擎之后当场测一遍并把结果摆出来 —— 通了才说「可以用了」，没通会指出是哪一项、错在哪。
· 修复：「对话 · 实时听译」中途切换耳机或扬声器之后不再收不到声音（需要 macOS 26）。
```

## 国际版 · zh-Hant

```
· 新：配好引擎之後當場測一遍並把結果擺出來 —— 通了才說「可以用了」，沒通會指出是哪一項、錯在哪。
· 新：Discord 社群入口，在「討論」裡。
· 修復：「對話 · 即時口譯」中途切換耳機或喇叭之後不再收不到聲音（需要 macOS 26）。
```

## 国际版 · ja

```
· 新機能：エンジンを設定するとその場でテストし、結果を表示します。通ったときだけ「使えます」と表示し、失敗した項目はその場で示します。
· 新機能：Discordコミュニティへの入口（「ディスカッション」内）。
· 修正：「会話・リアルタイム通訳」でイヤホンとスピーカーを切り替えた後に音声が届かなくなる問題（macOS 26が必要）。
```

## 国际版 · ko

```
· 신규: 엔진을 설정하면 그 자리에서 한 번 테스트하고 결과를 보여 줍니다. 통과했을 때만 ‘사용할 수 있습니다’라고 표시하며, 실패한 항목은 그 자리에서 알려 줍니다.
· 신규: Discord 커뮤니티 입구(‘토론’ 안).
· 수정: ‘대화 · 실시간 통역’에서 이어폰과 스피커를 전환한 뒤 소리가 들어오지 않던 문제(macOS 26 필요).
```

## 国际版 · de-DE

```
· Neu: Nach dem Einrichten einer Engine wird sie direkt getestet und das Ergebnis angezeigt — „Einsatzbereit“ steht erst da, wenn der Test besteht; andernfalls wird genannt, was fehlschlug.
· Neu: Zugang zur Discord-Community unter „Diskussion“.
· Behoben: „Gespräch · Live-Dolmetschen“ verstummt nicht mehr nach dem Wechsel zwischen Kopfhörer und Lautsprecher (erfordert macOS 26).
```

## 国际版 · fr-FR

```
· Nouveau : une fois le moteur configuré, il est testé sur place et le résultat s’affiche — « Prêt » n’apparaît qu’après un test réussi, sinon l’élément en échec est nommé.
· Nouveau : accès à la communauté Discord, dans « Discussion ».
· Correction : « Conversation · interprétation en direct » ne devient plus muet après un basculement entre écouteurs et haut-parleur (nécessite macOS 26).
```

## 国际版 · es-ES

```
· Nuevo: tras configurar un motor se prueba ahí mismo y se muestra el resultado: solo dice «Listo» si la prueba pasa; si no, indica qué falló.
· Nuevo: acceso a la comunidad de Discord, en «Debate».
· Corregido: «Conversación · interpretación en directo» ya no se queda sin sonido al cambiar entre auriculares y altavoz (requiere macOS 26).
```

## 国际版 · pt-BR

```
· Novo: depois de configurar um motor, ele é testado ali mesmo e o resultado aparece — só diz “Pronto” quando o teste passa; caso contrário, aponta o item que falhou.
· Novo: entrada para a comunidade no Discord, em “Discussão”.
· Corrigido: “Conversa · interpretação ao vivo” não fica mais sem som ao alternar entre fones e alto-falante (requer macOS 26).
```

## 国际版 · ru

```
· Новое: после настройки движка он сразу проверяется, и результат виден — «Готово» появляется только при успешной проверке, иначе названа неудавшаяся часть.
· Новое: вход в сообщество Discord — в разделе «Обсуждение».
· Исправлено: «Диалог · синхронный перевод» больше не теряет звук после переключения между наушниками и динамиком (требуется macOS 26).
```

## 国际版 · ar-SA

```
· جديد: بعد إعداد المحرّك يُختبر في مكانه وتظهر النتيجة — لا يُقال «جاهز» إلا بعد نجاح الاختبار، وإلا فيُسمّى البند الذي أخفق.
· جديد: مدخل إلى مجتمع Discord ضمن «النقاش».
· إصلاح: «المحادثة · الترجمة الفورية» لم يعد الصوت ينقطع بعد التبديل بين السماعة ومكبر الصوت (يتطلب macOS 26).
```

## 国际版 · it

```
· Novità: dopo aver configurato un motore viene provato sul posto e il risultato è mostrato — «Pronto» compare solo se la prova riesce, altrimenti viene indicato l’elemento fallito.
· Novità: accesso alla comunità Discord, in «Discussione».
· Corretto: «Conversazione · interpretariato dal vivo» non resta più senza audio dopo il passaggio tra auricolari e altoparlante (richiede macOS 26).
```

## 国际版 · tr

```
· Yeni: bir motoru kurduktan sonra hemen orada sınanır ve sonuç gösterilir — yalnızca sınama geçerse “Hazır” yazar, geçmezse başarısız olan madde belirtilir.
· Yeni: “Tartışma” içinde Discord topluluğu girişi.
· Düzeltildi: “Konuşma · canlı çeviri”, kulaklıkla hoparlör arasında geçiş yapıldıktan sonra artık sessiz kalmıyor (macOS 26 gerekir).
```

## 国际版 · vi

```
· Mới: sau khi cấu hình công cụ, nó được thử ngay tại chỗ và hiện kết quả — chỉ báo “Dùng được” khi thử đạt; nếu không, nêu rõ mục nào hỏng.
· Mới: lối vào cộng đồng Discord, trong mục “Thảo luận”.
· Sửa: “Hội thoại · phiên dịch trực tiếp” không còn mất tiếng sau khi chuyển giữa tai nghe và loa (cần macOS 26).
```

## 国际版 · pl

```
· Nowość: po skonfigurowaniu silnika jest on od razu sprawdzany i widać wynik — „Gotowe” pojawia się dopiero po udanym teście, w przeciwnym razie wskazana jest pozycja, która zawiodła.
· Nowość: wejście do społeczności Discord w sekcji „Dyskusja”.
· Poprawiono: „Rozmowa · tłumaczenie na żywo” nie milknie już po przełączeniu między słuchawkami a głośnikiem (wymaga macOS 26).
```
