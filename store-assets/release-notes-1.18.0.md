# 1.18.0 发布说明（**GitHub Release / 更新日志用这一份**）

> 这一份描述**整个版本**，每条行内标明是哪个面。生成器把每一行变成一个列表项，所以不要用分组标题。
> 评分触发点（#453）单独写在 1.17.0 那一份里，本版不重复。本版 = React 迁移落地 + 1.16.1 之后
> 漏网的用户可见修复（EF-1 #498、timeout 熔断 #475、迎新分叉 #493、横幅 #485、未登录复习 #481）。

## 国际版 · zh-Hans

```
· 浏览器扩展 · 修复：YouTube 字幕拿不到时不再反复重试 —— 反复请求恰好会触发 YouTube 对字幕的封锁，连原生字幕都会跟着失效；现在每个视频至多请求 3 次，拿不到就明确显示「字幕不可用」，不再拖垮你本来能用的字幕。
· App 与浏览器扩展 · 修复：网络一直超时时，连续 5 次超时就自动停下来（不再无限重试），点一下「重试」即恢复 —— 不再白白转圈。
· App（iPhone / iPad / Mac）· 新：第一屏先问你要什么 —— 「读网页」「听」或「都要」，按你的选择走不同的路；只想听的人不再被引导去装扩展。
· App（iPhone / iPad）· 修复：「在 Safari 里打开扩展」的横幅不再反复出现 —— 点过一次就算问过了；也不再因为还没抓到句子，就把你已经装好的扩展当成没打开。
· App 与浏览器扩展 · 改进：没有登录也能进复习页；复习收尾更明确（评过一张就算完成）；去掉了几乎没人用的「检测页」入口。
· App 与浏览器扩展 · 内部：界面层整体迁移到了 React —— 行为与外观不变，为的是后面把界面改得更快更稳。
```

## 国际版 · en-US

```
· Browser extension · Fixed: When a YouTube transcript can't be fetched, the extension no longer retries the same request over and over — repeated requests are exactly what triggers YouTube's transcript blocking, which takes down even the native captions that still worked. At most 3 requests per video now, with a clear "subtitles unavailable" instead of a broken pipeline.
· App & browser extension · Fixed: When the network keeps timing out, translation stops by itself after 5 consecutive timeouts instead of retrying forever — tap "Retry" to resume. No more endless spinning.
· App (iPhone / iPad / Mac) · New: The first screen asks what you came for — "read web pages", "listen", or "both" — and picks the path to match; if you only want listening, it no longer pushes you toward the extension.
· App (iPhone / iPad) · Fixed: The "open the extension in Safari" banner no longer keeps coming back — one tap counts as asked; and an extension you already set up is no longer treated as missing just because it hasn't captured sentences yet.
· App & browser extension · Improved: Review opens without signing in; finishing a session ends more clearly (one graded card completes it); the hardly-used "check page" link is gone.
· App & browser extension · Internal: The entire UI layer now runs on React — same behavior, same look — so future interface work moves faster.
```

## 中国版 · zh-Hans

```
· 浏览器扩展 · 修复：YouTube 字幕拿不到时不再反复重试 —— 反复请求恰好会触发 YouTube 对字幕的封锁，连原生字幕都会跟着失效；现在每个视频至多请求 3 次，拿不到就明确显示「字幕不可用」，不再拖垮你本来能用的字幕。
· App 与浏览器扩展 · 修复：网络一直超时时，连续 5 次超时就自动停下来（不再无限重试），点一下「重试」即恢复 —— 不再白白转圈。
· App（iPhone / iPad / Mac）· 新：第一屏先问你要什么 —— 「读网页」「听」或「都要」，按你的选择走不同的路；只想听的人不再被引导去装扩展。
· App（iPhone / iPad）· 修复：「在 Safari 里打开扩展」的横幅不再反复出现 —— 点过一次就算问过了；也不再因为还没抓到句子，就把你已经装好的扩展当成没打开。
· App 与浏览器扩展 · 改进：没有登录也能进复习页；复习收尾更明确（评过一张就算完成）；去掉了几乎没人用的「检测页」入口。
· App 与浏览器扩展 · 内部：界面层整体迁移到了 React —— 行为与外观不变，为的是后面把界面改得更快更稳。
```

## 国际版 · zh-Hant

```
· 瀏覽器擴充功能 · 修復：YouTube 字幕拿不到時不再反覆重試 —— 反覆請求恰好會觸發 YouTube 對字幕的封鎖，連原生字幕都會跟著失效；現在每個影片至多請求 3 次，拿不到就明確顯示「字幕無法使用」，不再拖垮你本來能用的字幕。
· App 與瀏覽器擴充功能 · 修復：網路一直逾時時，連續 5 次逾時就自動停下來（不再無限重試），點一下「重試」即恢復 —— 不再白白轉圈。
· App（iPhone / iPad / Mac）· 新增：第一屏先問你要什麼 —— 「讀網頁」「聽」或「都要」，按你的選擇走不同的路；只想聽的人不再被引導去裝擴充功能。
· App（iPhone / iPad）· 修復：「在 Safari 裡打開擴充功能」的橫幅不再反覆出現 —— 點過一次就算問過了；也不再因為還沒抓到句子，就把你已經裝好的擴充功能當成沒打開。
· App 與瀏覽器擴充功能 · 改進：沒有登入也能進複習頁；複習收尾更明確（評過一張就算完成）；去掉了幾乎沒人用的「檢測頁」入口。
· App 與瀏覽器擴充功能 · 內部：介面層整體遷移到了 React —— 行為與外觀不變，為的是後面把介面改得更快更穩。
```

## 国际版 · ja

```
· ブラウザ拡張機能 · 修正：YouTube の字幕を取得できないとき、同じリクエストを繰り返さなくなりました —— 繰り返しのリクエストこそが YouTube の字幕ブロックを引き起こし、本来使えたはずの字幕まで使えなくなっていました。動画ごとに最大 3 回まで。取得できない場合は「字幕を利用できません」と明示し、パイプラインを壊しません。
· App とブラウザ拡張機能 · 修正：ネットワークがタイムアウトし続けるとき、5 回連続でタイムアウトしたら自動的に停止（無制限の再試行をやめ）、「再試行」をタップすれば再開 —— 無駄にくるくる回すのをやめました。
· App（iPhone / iPad / Mac）· 新機能：最初の画面で目的を聞きます —— 「ウェブを読む」「聞く」「両方」から選択し、それに合わせた道案内。聞くだけの人を拡張機能のインストールへ誘導しなくなりました。
· App（iPhone / iPad）· 修正：「Safari で拡張機能を開く」バナーが繰り返し表示されなくなりました —— 一度タップすれば尋ねたことに。また、文をまだ取得していないだけで、インストール済みの拡張機能を「開いていない」と扱わなくなりました。
· App とブラウザ拡張機能 · 改善：サインインしなくても復習ページに入れるように。セッションの終了がより明確に（1 枚採点すれば完了）。ほとんど使われていなかった「確認ページ」へのリンクを削除。
· App とブラウザ拡張機能 · 内部：UI レイヤー全体を React に移行 —— 挙動と見た目はそのまま、今後の UI 開発をより速く安定に。
```

## 国际版 · ko

```
· 브라우저 확장 기능 · 수정: YouTube 자막을 가져올 수 없을 때 같은 요청을 반복하지 않습니다 —— 반복 요청이야말로 YouTube의 자막 차단을 유발해 원래 작동하던 자막까지 망가뜨렸습니다. 이제 동영상당 최대 3회만 요청하고, 가져올 수 없으면 "자막을 사용할 수 없음"으로 명확히 표시합니다.
· App 및 브라우저 확장 기능 · 수정: 네트워크가 계속 타임아웃될 때 5번 연속 타임아웃되면 자동으로 중지(무한 재시도 없음)하고 "재시도"를 한 번 누르면 재개합니다 —— 헛되이 빙글빙글 돌리지 않습니다.
· App(iPhone / iPad / Mac) · 새 기능: 첫 화면에서 목적을 묻습니다 —— "웹 읽기", "듣기", "둘 다" 중에서 선택하면 그에 맞는 길로 안내합니다. 듣기만 원하는 사람을 확장 기능 설치로 유도하지 않습니다.
· App(iPhone / iPad) · 수정: "Safari에서 확장 기능 열기" 배너가 반복해서 나타나지 않습니다 —— 한 번 누르면 물어본 것으로 간주합니다. 문장을 아직 못 모았다는 이유로 설치된 확장 기능을 꺼진 것으로 취급하지도 않습니다.
· App 및 브라우저 확장 기능 · 개선: 로그인하지 않아도 복습 페이지에 들어갈 수 있습니다. 세션 종료가 더 명확해졌고(한 장 채점하면 완료) 거의 쓰이지 않던 "확인 페이지" 링크를 없앴습니다.
· App 및 브라우저 확장 기능 · 내부: UI 레이어 전체를 React로 이전 —— 동작과 모습은 그대로, 앞으로의 UI 작업이 더 빠르고 안정적으로.
```

## 国际版 · de-DE

```
· Browser-Erweiterung · Behoben: Wenn ein YouTube-Transkript nicht abrufbar ist, wiederholt die Erweiterung dieselbe Anfrage nicht mehr endlos — wiederholte Anfragen lösen genau die YouTube-Transkriptsperre aus, die sogar die ursprünglich funktionierenden Untertitel mitnimmt. Jetzt höchstens 3 Anfragen pro Video, danach klar "Untertitel nicht verfügbar" statt einer kaputten Pipeline.
· App & Browser-Erweiterung · Behoben: Wenn das Netzwerk ständig Timeout lief, stoppt die Übersetzung nach 5 aufeinanderfolgenden Timeouts von selbst (kein endloses Wiederholen) — "Erneut versuchen" antippen genügt. Kein sinnloses Drehen mehr.
· App (iPhone / iPad / Mac) · Neu: Der erste Bildschirm fragt, wofür du da bist — "Webseiten lesen", "zu hören" oder "beides" — und wählt den passenden Weg; wer nur hören will, wird nicht mehr zur Erweiterung geschickt.
· App (iPhone / iPad) · Behoben: Das Banner "Erweiterung in Safari öffnen" kommt nicht mehr zurück — einmal getippt zählt als gefragt; und eine installierte Erweiterung gilt nicht mehr als fehlend, nur weil noch keine Sätze gesammelt wurden.
· App & Browser-Erweiterung · Verbessert: Wiederholen geht auch ohne Anmeldung; ein Sitzungsende ist eindeutiger (eine bewertete Karte schließt sie ab); der kaum genutzte "Prüfseite"-Link ist weg.
· App & Browser-Erweiterung · Intern: Die gesamte UI-Schicht läuft jetzt auf React — gleiches Verhalten, gleicher Look — damit künftige Interface-Arbeiten schneller und stabiler werden.
```

## 国际版 · fr-FR

```
· Extension navigateur · Corrigé : quand la transcription YouTube est introuvable, l'extension ne relance plus la même requête en boucle — ces relances déclenchent précisément le blocage des transcriptions par YouTube, qui emporte même les sous-titres qui fonctionnaient. Désormais 3 requêtes maximum par vidéo, puis un clair « sous-titres indisponibles » au lieu d'un pipeline cassé.
· App et extension · Corrigé : quand le réseau tombe en timeout en boucle, la traduction s'arrête d'elle-même après 5 timeouts consécutifs (fini les retries infinis) — un tap sur « Réessayer » suffit. Plus de compteur qui tourne pour rien.
· App (iPhone / iPad / Mac) · Nouveau : le premier écran demande ce que vous venez faire — « lire des pages », « écouter » ou « les deux » — et adapte le parcours ; qui ne veut qu'écouter n'est plus dirigé vers l'extension.
· App (iPhone / iPad) · Corrigé : la bannière « ouvrir l'extension dans Safari » ne revient plus — un tap vaut question posée ; et une extension installée n'est plus traitée comme absente sous prétexte qu'aucune phrase n'a encore été capturée.
· App et extension · Amélioré : la révision s'ouvre sans connexion ; la fin d'une session est plus nette (une carte évaluée la clôt) ; le lien « page de vérification » presque jamais utilisé disparaît.
· App et extension · Interne : toute la couche interface passe sous React — même comportement, même apparence — pour des évolutions d'interface plus rapides et plus stables.
```

## 国际版 · es-ES

```
· Extensión del navegador · Corregido: cuando no se puede obtener la transcripción de YouTube, la extensión ya no reintenta la misma petición una y otra vez — esos reintentos son justo lo que activa el bloqueo de transcripciones de YouTube, que se lleva por delante incluso los subtítulos que sí funcionaban. Ahora, 3 peticiones como máximo por vídeo y, si no hay nada, un claro «subtítulos no disponibles».
· App y extensión · Corregido: si la red se queda en timeouts, la traducción se detiene sola tras 5 timeouts seguidos (se acabaron los reintentos infinitos) — toca «Reintentar» y sigue. Nada de dar vueltas para nada.
· App (iPhone / iPad / Mac) · Nuevo: la primera pantalla pregunta a qué vienes — «leer páginas», «escuchar» o «ambas» — y elige el camino adecuado; quien solo quiere escuchar ya no es empujado a instalar la extensión.
· App (iPhone / iPad) · Corregido: el banner «abrir la extensión en Safari» ya no reaparece — un toque cuenta como preguntado; y una extensión ya instalada deja de darse por ausente solo porque aún no haya capturado frases.
· App y extensión · Mejorado: la repaso se abre sin iniciar sesión; el cierre de una sesión es más claro (una tarjeta evaluada la completa); fuera el enlace a la «página de comprobación» que casi nadie usaba.
· App y extensión · Interno: toda la capa de interfaz pasa a React — mismo comportamiento, mismo aspecto — para que el trabajo futuro de interfaz sea más rápido y estable.
```

## 国际版 · pt-BR

```
· Extensão do navegador · Corrigido: quando a transcrição do YouTube não pode ser obtida, a extensão não repete mais a mesma requisição — essas repetições são exatamente o que dispara o bloqueio de transcrições do YouTube, que derruba até as legendas que ainda funcionavam. Agora, no máximo 3 requisições por vídeo e, se não der, um claro "legendas indisponíveis".
· App e extensão · Corrigido: quando a rede vive em timeout, a tradução para sozinha após 5 timeouts seguidos (chega de repetir infinito) — toque em "Tentar de novo" e continue. Chega de girar à toa.
· App (iPhone / iPad / Mac) · Novo: a primeira tela pergunta o que você veio fazer — "ler páginas", "ouvir" ou "os dois" — e escolhe o caminho certo; quem só quer ouvir não é mais empurrado para a extensão.
· App (iPhone / iPad) · Corrigido: o banner "abrir a extensão no Safari" não volta mais — um toque já conta como perguntado; e uma extensão instalada não é mais tratada como ausente só porque ainda não capturou frases.
· App e extensão · Melhorado: a revisão abre sem login; o fim de uma sessão ficou mais claro (um cartão avaliado a completa); fora o link da "página de verificação" que quase ninguém usava.
· App e extensão · Interno: toda a camada de interface migrou para React — mesmo comportamento, mesmo visual — para o trabalho futuro de interface ser mais rápido e estável.
```

## 国际版 · ru

```
· Расширение браузера · Исправлено: когда расшифровка YouTube недоступна, расширение больше не повторяет один и тот же запрос — именно повторы запускают блокировку расшифровок на YouTube, которая ломает даже работавшие субтитры. Теперь не более 3 запросов на видео, а дальше честное «субтитры недоступны».
· Приложение и расширение · Исправлено: при постоянных таймаутах сети перевод останавливается сам после 5 подряд — без бесконечных повторов; нажмите «Повторить» и продолжайте. Никакого впустую крутящегося счётчика.
· Приложение (iPhone / iPad / Mac) · Новое: первый экран спрашивает, зачем вы пришли — «читать страницы», «слушать» или «и то и другое» — и ведёт нужной дорогой; кто хочет только слушать, больше не отправляется ставить расширение.
· Приложение (iPhone / iPad) · Исправлено: баннер «откройте расширение в Safari» больше не возвращается — одного нажатия достаточно; и установленное расширение больше не считается отсутствующим только потому, что ещё не собрало предложения.
· Приложение и расширение · Улучшено: повторение открывается без входа; конец сессии стал яснее (одна оценённая карточка завершает её); убрали почти не используемую ссылку на «страницу проверки».
· Приложение и расширение · Внутреннее: весь слой интерфейса переведён на React — поведение и вид прежние — чтобы дальнейшая работа над интерфейсом была быстрее и надёжнее.
```

## 国际版 · ar-SA

```
· إضافة المتصفح · إصلاح: عندما يتعذّر جلب نص YouTube، لم تعد الإضافة تعيد الطلب نفسه مرارًا — فالتكرار هو بالضبط ما يفعّل حجب YouTube للنصوص، ويُعطّل حتى الترجمات التي كانت تعمل. الآن 3 طلبات كحد أقصى لكل فيديو، ثم رسالة واضحة «الترجمة غير متوفرة».
· التطبيق والإضافة · إصلاح: عند استمرار انتهاء مهلة الشبكة، يتوقف الترجمة تلقائيًا بعد 5 انتهاءات متتالية (بدون إعادة محاولة لا نهائية) — المس «إعادة المحاولة» لتستأنف. لا مزيد من الانتظار الدوّار بلا جدوى.
· التطبيق (iPhone / iPad / Mac) · جديد: الشاشة الأولى تسألك عن هدفك — «قراءة الصفحات» أو «الاستماع» أو «كلاهما» — وتختار المسار المناسب؛ من يريد الاستماع فقط لم يعد يُوجَّه لتثبيت الإضافة.
· التطبيق (iPhone / iPad) · إصلاح: لافتة «افتح الإضافة في Safari» لم تعد تتكرر — لمسة واحدة تُحتسب سؤالًا؛ ولم تعد الإضافة المثبَّتة تُعتبر غير مفتوحة لمجرد أنها لم تلتقط جُملًا بعد.
· التطبيق والإضافة · تحسين: صفحة المراجعة تُفتح دون تسجيل دخول؛ نهاية الجلسة أوضح (بطاقة واحدة مُقيَّمة تُنهيها)؛ وأُزيل رابط «صفحة الفحص» الذي لم يكن أحد يستخدمه.
· التطبيق والإضافة · داخلي: انتقلت طبقة الواجهة بالكامل إلى React — السلوك والمظهر كما هما — لتصبح تطويرات الواجهة أسرع وأكثر ثباتًا.
```

## 国际版 · it

```
· Estensione del browser · Corretto: quando la trascrizione di YouTube non è recuperabile, l'estensione non ripete più la stessa richiesta — sono proprio i ripetuti a innescare il blocco delle trascrizioni di YouTube, che si porta via anche i sottotitoli che funzionavano. Ora al massimo 3 richieste per video, poi un chiaro "sottotitoli non disponibili".
· App ed estensione · Corretto: se la rete va in timeout di continuo, la traduzione si ferma da sola dopo 5 timeout consecutivi (niente retry infiniti) — tocchi "Riprova" e riparte. Basta girare a vuoto.
· App (iPhone / iPad / Mac) · Novità: la prima schermata chiede cosa sei venuto a fare — "leggere pagine", "ascoltare" o "entrambi" — e sceglie il percorso giusto; chi vuole solo ascoltare non viene più spinto verso l'estensione.
· App (iPhone / iPad) · Corretto: il banner "apri l'estensione in Safari" non torna più — un tocco vale come domanda fatta; e un'estensione installata non è più data per assente solo perché non ha ancora catturato frasi.
· App ed estensione · Migliorato: il ripasso si apre senza accesso; la fine di una sessione è più netta (una scheda valutata la completa); via il link alla "pagina di verifica" quasi mai usato.
· App ed estensione · Interno: l'intero livello interfaccia passa a React — stesso comportamento, stesso aspetto — perché il lavoro futuro sull'interfaccia sia più rapido e stabile.
```

## 国际版 · tr

```
· Tarayıcı eklentisi · Düzeltildi: YouTube dökümü alınamadığında eklenti artık aynı isteği tekrar tekrar yollamıyor — tekrarlar tam da YouTube'un döküm engelini tetikleyen şey ve çalışan altyazıları bile etkisiz bırakıyordu. Artık video başına en fazla 3 istek; olmazsa net bir "altyazılar kullanılamıyor".
· Uygulama ve eklenti · Düzeltildi: ağ sürekli zaman aşımına düşünde çeviri 5 ardışık zaman aşımından sonra kendiliğinden duruyor (sonsuz yeniden deneme yok) — "Yeniden dene"ye dokun yeter. Boşuna dönen çark yok.
· Uygulama (iPhone / iPad / Mac) · Yeni: ilk ekran ne için geldiğini soruyor — "sayfa okumak", "dinlemek" veya "ikisi de" — ve yolu ona göre seçiyor; sadece dinlemek isteyen artık eklentiye yönlendirilmiyor.
· Uygulama (iPhone / iPad) · Düzeltildi: "Eklentiyi Safari'de aç" bandı artık geri gelmiyor — bir kez dokunmak sorulmuş sayılıyor; ve henüz cümle toplamamış diye kurulu eklenti artık açık değil sayılmıyor.
· Uygulama ve eklenti · İyileştirildi: tekrar sayfası oturum açmadan girilebiliyor; oturum sonu daha net (bir kart puanlanınca tamamlanıyor); neredeyse hiç kullanılmayan "denetim sayfası" bağlantısı kaldırıldı.
· Uygulama ve eklenti · İç: arayüz katmanının tamamı React'e taşındı — davranış ve görünüm aynı — böylece gelecekteki arayüz çalışmaları daha hızlı ve sağlam olacak.
```

## 国际版 · vi

```
· Tiện ích mở rộng trình duyệt · Đã sửa: khi không lấy được phụ đề YouTube, tiện ích không còn thử lại cùng một yêu cầu — chính việc thử lại mới kích hoạt việc YouTube chặn phụ đề, kéo theo cả những phụ đề vốn vẫn hoạt động. Giờ tối đa 3 yêu cầu mỗi video, rồi hiện rõ "phụ đề không khả dụng".
· Ứng dụng và tiện ích · Đã sửa: khi mạng liên tục hết thời gian chờ, dịch tự dừng sau 5 lần chờ liên tiếp (hết thử lại vô hạn) — chạm "Thử lại" là tiếp tục. Hết vòng quay vô ích.
· Ứng dụng (iPhone / iPad / Mac) · Mới: màn hình đầu tiên hỏi bạn đến để làm gì — "đọc trang", "nghe" hay "cả hai" — rồi dẫn đúng lộ trình; ai chỉ muốn nghe không còn bị dắt đi cài tiện ích.
· Ứng dụng (iPhone / iPad) · Đã sửa: băng rôn "mở tiện ích trong Safari" không còn xuất hiện lại — chạm một lần là coi như đã hỏi; tiện ích đã cài không còn bị coi là chưa mở chỉ vì chưa bắt được câu nào.
· Ứng dụng và tiện ích · Cải thiện: trang ôn tập mở được mà không cần đăng nhập; kết thúc buổi ôn rõ hơn (chấm xong một thẻ là hoàn tất); bỏ liên kết "trang kiểm tra" gần như chẳng ai dùng.
· Ứng dụng và tiện ích · Nội bộ: toàn bộ lớp giao diện chuyển sang React — hành vi và diện mạo giữ nguyên — để các thay đổi giao diện sau này nhanh và ổn hơn.
```

## 国际版 · pl

```
· Rozszerzenie przeglądarki · Naprawione: gdy transkrypcja YouTube jest nieosiągalna, rozszerzenie nie powtarza w kółko tego samego żądania — to właśnie powtórki wyzwalają blokadę transkrypcji na YouTube, która psuje nawet napisy, które działały. Teraz maksymalnie 3 żądania na film, a potem wyraźne "napisy niedostępne".
· Aplikacja i rozszerzenie · Naprawione: gdy sieczka ciągle przekracza czas, tłumaczenie zatrzymuje się samo po 5 kolejnych przekroczeniach (koniec z nieskończonymi ponownymi próbami) — dotknij "Ponów" i jedzie dalej. Koniec z jałowym kręceniem się.
· Aplikacja (iPhone / iPad / Mac) · Nowość: pierwszy ekran pyta, po co przychodzisz — "czytać strony", "słuchać" czy "oboje" — i dobiera ścieżkę; kto chce tylko słuchać, nie jest już pchany do instalowania rozszerzenia.
· Aplikacja (iPhone / iPad) · Naprawione: baner "otwórz rozszerzenie w Safari" nie wraca — jedno dotknięcie liczy się jako pytanie; a zainstalowane rozszerzenie nie jest już traktowane jako nieobecne tylko dlatego, że nie zdążyło zebrać zdań.
· Aplikacja i rozszerzenie · Lepiej: powtórki otwierają się bez logowania; koniec sesji jest wyraźniejszy (jedna oceniona karta ją kończy); zniknął prawie nieużywany link do "strony sprawdzania".
· Aplikacja i rozszerzenie · Wewnętrzne: cała warstwa interfejsu przeszła na React — zachowanie i wygląd bez zmian — żeby przyszła praca nad interfejsem szła szybciej i stabilniej.
```
