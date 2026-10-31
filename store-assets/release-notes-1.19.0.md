# 1.19.0 发布说明（**GitHub Release / 更新日志用这一份**）

> 这一份描述**整个版本**，每条行内标明是哪个面。生成器把每一行变成一个列表项，所以不要用分组标题。

## 国际版 · zh-Hans

```
· App（iPhone / iPad / Mac）· 新：首次打开改成三步 —— 先登录，再把两个语音包下到本机，最后才是引导。以前这两样是「第一次用到才下」，失败正好发生在你已经开始用的那一刻；现在它在门口一次说清，可重试、有进度。
· App（iPhone / iPad / Mac）· 变化：App 现在要先登录才给用 —— 引擎随登录到账、两个语音包要下到本机，登录是「配好了」的前提。浏览器扩展不受影响：仍然免登录、自带 key 可用。
· App（iPhone / iPad / Mac）· 新：系统翻译弹层的字号可以调了 —— 小 / 标准 / 大三档，叠在你系统的文字大小之上。在「设置 › 系统翻译」里选，选完下次弹出生效。
· App（iPhone / iPad / Mac）· 修复：退出重开后，首页有时会显示「未登录」，而同一次运行里设置页还是已登录 —— 两处现在读同一个状态；存储的一次瞬时读失败也不再被当成「已退出登录」。
· App（iPhone / iPad / Mac）· 修复：设备上留着一把旧 key（失效的、或写错的）时，登录可能整个跳过领取免费额度，而「领取」还会回你一句「已配好」—— 翻译其实仍在用那把旧 key。现在领取一定会发生、你自己填的 key 一个字都不会被动、回执说的是实际发生的事。
· App（iPhone / iPad / Mac）· 改进：实时字幕入口灰掉时那句过时的「需要 macOS 14.4 或更新」删了 —— 那条要求早已被设备内置识别器的 iOS / macOS 26 下限取代，现在只说真的那一句。
· App 与浏览器扩展 · 新：界面字体换成了设计稿的那两个字族 —— 拉丁字母用 Figtree（正文）与 Caprasimo（标题）；中文仍是系统字，所以中文的观感一点没变。
· App 与浏览器扩展 · 无障碍：用键盘 Tab 走一遍时，焦点环现在每个面都有 —— 此前只有设置页一处，弹窗、复习页与 App 里都看不出自己在哪。
· 扩展 · 改进：网页里的字幕条与字幕控制菜单并进全站形态语言 —— 圆角统一到三档（小元件 / 面板 / 胶囊），控制菜单里那个勾选号原先是一种不属于本站配色的绿，现在是品牌绿。
```

## 国际版 · en-US

```
· App (iPhone / iPad / Mac) · New: First launch is now three steps — sign in, download the two speech packs to this device, then onboarding. Those packs used to download the first time you needed them, which meant a failure landed exactly when you had started using the app; now it happens at the door, with progress and a retry.
· App (iPhone / iPad / Mac) · Changed: The app now requires signing in before it can be used — the engine arrives with your account and the two speech packs have to live on this device, so signing in is what "set up" means. The browser extension is unaffected: it still works signed-out with your own key.
· App (iPhone / iPad / Mac) · New: The system translation sheet now has three text sizes — Small, Standard, Large — on top of your system text size. Pick it in Settings › System translation; it takes effect the next time the sheet opens.
· App (iPhone / iPad / Mac) · Fixed: After quitting and reopening, the home screen could show "not signed in" while Settings still showed you signed in. Both now read the same state, and a momentary storage hiccup is no longer treated as a sign-out.
· App (iPhone / iPad / Mac) · Fixed: If the device still had an old (expired or mistyped) API key, signing in could skip claiming the free credit entirely — and the claim toast could still say "ready" while translation kept using that old key. Claiming now always happens, your own key is never touched, and the message says what actually happened.
· App (iPhone / iPad / Mac) · Improved: The greyed-out Live Subtitles entry no longer mentions macOS 14.4 — that requirement was replaced by the on-device recognizer's iOS / macOS 26 floor.
· App and browser extension · New: The interface now uses the two type families from our design system — Figtree for body text and Caprasimo for headings. Latin script only; CJK keeps the system font, so Chinese looks exactly as before.
· App and browser extension · Accessibility: Tabbing through the UI now shows a focus ring on every surface — before this only the settings page had one, so the popup, the review page and the app gave no clue where you were.
· Extension · Improved: The in-page subtitle line and its control menu now follow the shape language the rest of the product uses — radii collapsed onto the same three steps, and the menu's checkmark is no longer a green that belongs to nobody.
```

## 国际版 · ja

```
· App（iPhone / iPad / Mac）· 新：初回起動を 3 ステップに —— サインイン、2 つの音声パックを端末にダウンロード、そしてガイド。以前は初めて使うときに落ちていました。
· App（iPhone / iPad / Mac）· 変更：App はサインインが前提になりました（ブラウザ拡張は対象外 —— 従来どおり未ログインで使えます）。
· App とブラウザ拡張 · 新：書体をデザインシステムの 2 ファミリーに、キーボード操作時のフォーカスリングを全面に。
```

## 国际版 · ko

```
· App(iPhone / iPad / Mac) · 새 기능: 첫 실행이 3단계로 — 로그인, 두 음성 팩 내려받기, 안내. 예전에는 처음 쓸 때 내려받다 실패했습니다.
· App(iPhone / iPad / Mac) · 변경: 이제 로그인이 필요합니다(브라우저 확장은 해당 없음 — 로그인 없이 그대로 사용).
· App 및 브라우저 확장 · 새 기능: 디자인 시스템 서체 두 종, 키보드 사용 시 모든 화면에 포커스 링.
```

## 国际版 · zh-Hant

```
· App（iPhone / iPad / Mac）· 新：首次開啟改成三步 —— 先登入，再把兩個語音包下到本機，最後才是引導。以前是第一次用到才下，失敗正好發生在你已經開始用的那一刻。
· App（iPhone / iPad / Mac）· 變化：App 現在要先登入才給用（瀏覽器擴充功能不受影響，仍然免登入、自帶 key 可用）。
· App 與瀏覽器擴充功能 · 新：介面字體換成設計系統的兩個字族；用鍵盤 Tab 走一遍時，每個面都有焦點環。
```

## 国际版 · de-DE

```
· App (iPhone / iPad / Mac) · Neu: Der erste Start hat jetzt drei Schritte — anmelden, die zwei Sprachpakete laden, dann Onboarding. Vorher luden sie beim ersten Bedarf, also genau dann, wenn du schon angefangen hattest.
· App (iPhone / iPad / Mac) · Geändert: Die App setzt jetzt eine Anmeldung voraus (die Browser-Erweiterung nicht — sie läuft weiterhin ohne Anmeldung mit eigenem Schlüssel).
· App und Browser-Erweiterung · Neu: Die Schriften des Designsystems, und ein Fokusring auf jeder Oberfläche beim Tabben.
```

## 国际版 · fr-FR

```
· App (iPhone / iPad / Mac) · Nouveau : le premier lancement se fait en trois étapes — connexion, téléchargement des deux packs vocaux, puis l'accueil. Avant, ils se téléchargeaient au premier usage, donc au pire moment.
· App (iPhone / iPad / Mac) · Changement : l'app demande désormais une connexion (l'extension de navigateur, non — elle fonctionne toujours sans connexion avec votre clé).
· App et extension de navigateur · Nouveau : les deux familles de polices du design system, et un anneau de focus sur chaque écran au clavier.
```

## 国际版 · es-ES

```
· App (iPhone / iPad / Mac) · Nuevo: el primer arranque ahora son tres pasos — iniciar sesión, descargar los dos paquetes de voz y la guía. Antes se descargaban al primer uso, justo cuando ya habías empezado.
· App (iPhone / iPad / Mac) · Cambio: la app ahora requiere iniciar sesión (la extensión del navegador no — sigue funcionando sin sesión con tu clave).
· App y extensión del navegador · Nuevo: las dos familias tipográficas del sistema de diseño y un anillo de foco en cada pantalla al usar el teclado.
```

## 国际版 · ru

```
· App (iPhone / iPad / Mac) · Новое: первый запуск теперь три шага — вход, загрузка двух голосовых пакетов, затем знакомство. Раньше они качались при первом использовании — то есть когда вы уже начали.
· App (iPhone / iPad / Mac) · Изменение: приложению теперь нужен вход (расширение браузера — нет, оно по-прежнему работает без входа со своим ключом).
· App и расширение браузера · Новое: два семейства шрифтов дизайн-системы и кольцо фокуса на каждом экране при работе с клавиатурой.
```

## 国际版 · pt-BR

```
· App (iPhone / iPad / Mac) · Novo: a primeira abertura agora tem três passos — entrar, baixar os dois pacotes de voz e a introdução. Antes eles baixavam no primeiro uso, bem quando você já tinha começado.
· App (iPhone / iPad / Mac) · Mudança: o app agora exige entrar (a extensão do navegador não — continua funcionando sem login com a sua chave).
· App e extensão do navegador · Novo: as duas famílias tipográficas do design system e um anel de foco em todas as telas pelo teclado.
```

## 国际版 · ar-SA

```
· App (iPhone / iPad / Mac) · جديد: التشغيل الأول صار ثلاث خطوات — تسجيل الدخول، تنزيل حزمتي الصوت، ثم التعريف. سابقًا كانتا تُنزَّلان عند أول استخدام، أي بعد أن تبدأ فعلًا.
· App (iPhone / iPad / Mac) · تغيير: التطبيق الآن يتطلب تسجيل الدخول (إضافة المتصفح لا — ما زالت تعمل دون تسجيل بمفتاحك).
· App وإضافة المتصفح · جديد: عائلتا الخطوط في نظام التصميم، وحلقة تركيز في كل شاشة عند استخدام لوحة المفاتيح.
```

## 国际版 · it

```
· App (iPhone / iPad / Mac) · Novità: il primo avvio ora ha tre passaggi — accedi, scarica i due pacchetti vocali, poi l'introduzione. Prima si scaricavano al primo uso, cioè quando avevi già iniziato.
· App (iPhone / iPad / Mac) · Cambiamento: l'app ora richiede l'accesso (l'estensione del browser no — continua a funzionare senza accesso con la tua chiave).
· App ed estensione del browser · Novità: le due famiglie di caratteri del design system e un anello di focus su ogni schermata da tastiera.
```

## 国际版 · tr

```
· App (iPhone / iPad / Mac) · Yeni: ilk açılış artık üç adım — giriş yap, iki ses paketini indir, sonra tanıtım. Eskiden ilk kullanımda indiriliyordu, yani tam başladığın anda.
· App (iPhone / iPad / Mac) · Değişiklik: uygulama artık giriş istiyor (tarayıcı uzantısı değil — kendi anahtarınla girişsiz çalışmaya devam ediyor).
· App ve tarayıcı uzantısı · Yeni: tasarım sisteminin iki yazı tipi ailesi ve klavyeyle gezinirken her ekranda odak halkası.
```

## 国际版 · vi

```
· App (iPhone / iPad / Mac) · Mới: lần mở đầu tiên nay gồm ba bước — đăng nhập, tải hai gói giọng nói, rồi phần giới thiệu. Trước đây chúng tải ở lần dùng đầu tiên, đúng lúc bạn đã bắt đầu.
· App (iPhone / iPad / Mac) · Thay đổi: ứng dụng nay yêu cầu đăng nhập (tiện ích trình duyệt thì không — vẫn dùng được khi chưa đăng nhập với key của bạn).
· App và tiện ích trình duyệt · Mới: hai họ chữ của hệ thống thiết kế và vòng lấy nét trên mọi màn hình khi dùng bàn phím.
```

## 国际版 · pl

```
· App (iPhone / iPad / Mac) · Nowość: pierwsze uruchomienie to teraz trzy kroki — zaloguj się, pobierz dwa pakiety głosu, potem wprowadzenie. Wcześniej pobierały się przy pierwszym użyciu, czyli gdy już zacząłeś.
· App (iPhone / iPad / Mac) · Zmiana: aplikacja wymaga teraz zalogowania (rozszerzenie przeglądarki nie — nadal działa bez logowania z Twoim kluczem).
· App i rozszerzenie przeglądarki · Nowość: dwie rodziny krojów z systemu projektowego i obwódka fokusu na każdym ekranie przy pracy z klawiaturą.
```

## 中国版 · zh-Hans

```
· App（iPhone / iPad / Mac）· 新：中国版也有了免费额度 —— 登录后自动到账（每账号 0.2 美元，够翻几百页）。不用先去阿里云申请 key 就能开始翻。请求经境内中继转发到阿里云百炼，我们不保存原文；用完回到「自带密钥」这条路，功能一个不少。
· App（iPhone / iPad / Mac）· 新：首次打开改成三步 —— 先登录，再把两个语音包下到本机，最后才是引导。以前这两样是「第一次用到才下」，失败正好发生在你已经开始用的那一刻；现在它在门口一次说清，可重试、有进度。
· App（iPhone / iPad / Mac）· 变化：App 现在要先登录才给用 —— 引擎随登录到账、两个语音包要下到本机，登录是「配好了」的前提。
· App（iPhone / iPad / Mac）· 新：系统翻译弹层的字号可以调了 —— 小 / 标准 / 大三档，叠在你系统的文字大小之上。在「设置 › 系统翻译」里选，选完下次弹出生效。
· App（iPhone / iPad / Mac）· 修复：退出重开后，首页有时会显示「未登录」，而同一次运行里设置页还是已登录 —— 两处现在读同一个状态；存储的一次瞬时读失败也不再被当成「已退出登录」。
· App（iPhone / iPad / Mac）· 修复：设备上留着一把旧 key（失效的、或写错的）时，登录可能整个跳过领取免费额度，而「领取」还会回你一句「已配好」—— 翻译其实仍在用那把旧 key。现在领取一定会发生、你自己填的 key 一个字都不会被动、回执说的是实际发生的事。
· App（iPhone / iPad / Mac）· 改进：实时字幕入口灰掉时那句过时的「需要 macOS 14.4 或更新」删了 —— 那条要求早已被设备内置识别器的 iOS / macOS 26 下限取代，现在只说真的那一句。
· App 与浏览器扩展 · 新：界面字体换成了设计稿的那两个字族 —— 拉丁字母用 Figtree（正文）与 Caprasimo（标题）；中文仍是系统字，所以中文的观感一点没变。
· App 与浏览器扩展 · 无障碍：用键盘 Tab 走一遍时，焦点环现在每个面都有 —— 此前只有设置页一处，弹窗、复习页与 App 里都看不出自己在哪。
· 扩展 · 改进：网页里的字幕条与字幕控制菜单并进全站形态语言 —— 圆角统一到三档（小元件 / 面板 / 胶囊），控制菜单里那个勾选号原先是一种不属于本站配色的绿，现在是品牌绿。
```
