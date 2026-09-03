# 1.7.12 发布说明 · macOS（国际版 11 份 + 中国版 1 份）

> 上一个真正上架的版本仍是 **1.6.7**（1.7.x 全程只在 TestFlight 与官网内测页）。
> 所以这份文案覆盖 1.7.0 → 1.7.12 的全部改动，而**头条是第三方登录** ——
> 它是这一轮唯一一件用户一眼就能感觉到的事。
>
> 中国版与国际版不是同一份：中国版的扩展没有编进同步，也不提 Google（那条路在
> 那个 flavor 里不成立）。
>
> ⚠️ 不写内部说法。用户关心的是「以前会怎样、现在会怎样」。
>
> 与 iOS 那份只差最后一条：界面在 Mac 上不再是放大的手机版式。

---

## 国际版 · zh-Hans

```
这一版最大的变化：**不用记密码、也不用等验证码邮件了**。

· 用 Apple 或 Google 一键登录。原来只有邮箱验证码那一条路，要切出去收信、再把六位
  数字抄回来 —— 现在按一下就完了。邮箱那条仍然在，不想用第三方账号可以继续用。
· 首次使用引导重做：一把 key 就能同时配好翻译、朗读和转写，填完当场自检告诉你通没通，
  不用等到翻第一页才发现配错了。
· 你真正停下来读完的句子会自动变成复习卡，装好就开着（快速滚过去的不算）。
· 换了另一个账号登录时，如果这台设备上还有原来账号的学习材料，会明确告诉你 ——
  那些卡没有丢，用原来的账号登录就会回来。
· 段落里的快捷键和代码（比如 Super + Return）不再从译文里消失。以前它们会被整段
  丢掉，句子读着通顺，意思却是错的。
· 在 Mac 上，设置和引导界面不再是被放大的手机版式：三步说明并排显示，按钮
  也是正常的按钮大小。
```

## 国际版 · zh-Hant

```
這一版最大的變化：**不用記密碼、也不用等驗證碼郵件了**。

· 用 Apple 或 Google 一鍵登入。原來只有電子郵件驗證碼那一條路，要切出去收信、再把
  六位數字抄回來 —— 現在按一下就完了。電子郵件那條仍然在。
· 首次使用引導重做：一把 key 就能同時配好翻譯、朗讀和轉寫，填完當場自檢告訴你通不通。
· 你真正停下來讀完的句子會自動變成複習卡，裝好就開著（快速滑過去的不算）。
· 換了另一個帳號登入時，如果這台裝置上還有原來帳號的學習材料，會明確告訴你 ——
  那些卡沒有丟，用原來的帳號登入就會回來。
· 段落裡的快捷鍵和程式碼（例如 Super + Return）不再從譯文裡消失。
· 在 Mac 上，設定與引導介面不再是被放大的手機版式。
```

## 国际版 · en-US

```
The big one: **no password to remember, no code to wait for.**

· Sign in with Apple or Google, in one tap. Until now the only way in was an emailed
  six-digit code — leave the app, find the mail, copy the digits back. Email still
  works if you would rather not use a third-party account.
· Rebuilt first-run setup. One API key now configures translation, read-aloud and
  transcription together, and it tests itself right there — you find out it works
  before your first page, not after.
· Sentences you actually stop and finish reading turn into review cards, and capture
  is on from the start (scrolling past does not count).
· If you sign in as a different account while this device still holds another
  account's material, it now says so — nothing was lost; sign back in and it returns.
· Keyboard shortcuts and inline code in a paragraph (Super + Return, for example) no
  longer vanish from the translation.
· On the Mac, the settings and setup screens are no longer a blown-up phone layout.
```

## 国际版 · ja

```
今回の目玉：**パスワードも、メールの確認コード待ちも要りません。**

· Apple または Google でワンタップログイン。これまではメールで届く6桁のコードだけ
  でした。メールでのログインも引き続き使えます。
· 初回セットアップを作り直しました。APIキー1つで翻訳・読み上げ・文字起こしをまとめて
  設定でき、その場で接続テストまで行います。
· 立ち止まって最後まで読んだ文は自動で復習カードになります（素早いスクロールは対象外）。
  しかも最初からオンです。
· 別のアカウントでログインしたとき、この端末に元のアカウントの学習素材が残っていれば
  はっきり知らせます。失われてはいません。
· 段落中のキーボードショートカットやコード（Super + Return など）が訳文から消えなく
  なりました。
· Mac では、設定と初回案内が「引き伸ばしたスマホ画面」ではなくなりました。
```

## 国际版 · ko

```
이번 핵심: **비밀번호도, 메일 인증 코드 기다림도 없습니다.**

· Apple 또는 Google로 한 번에 로그인. 지금까지는 메일로 오는 6자리 코드뿐이었습니다.
  이메일 로그인도 그대로 쓸 수 있습니다.
· 첫 실행 설정을 새로 만들었습니다. API 키 하나로 번역·읽어주기·받아쓰기를 한 번에
  설정하고 그 자리에서 연결까지 확인합니다.
· 멈춰서 끝까지 읽은 문장은 자동으로 복습 카드가 되며, 설치 직후부터 켜져 있습니다.
· 다른 계정으로 로그인했는데 이 기기에 이전 계정의 학습 자료가 남아 있으면 분명히
  알려 줍니다. 사라진 것이 아닙니다.
· 문단 안의 단축키나 코드(예: Super + Return)가 번역문에서 사라지지 않습니다.
· Mac에서는 설정과 시작 안내가 더 이상 확대된 휴대폰 화면이 아닙니다.
```

## 国际版 · fr-FR

```
L’essentiel : **plus de mot de passe, plus d’attente de code par e-mail.**

· Connexion en un geste avec Apple ou Google. Jusqu’ici il n’y avait que le code à six
  chiffres reçu par e-mail. L’e-mail reste disponible.
· Configuration initiale refaite : une seule clé API configure traduction, lecture à
  voix haute et transcription, et se teste sur place.
· Les phrases que vous vous arrêtez vraiment pour lire deviennent des cartes de
  révision, actif dès l’installation.
· Si vous vous connectez avec un autre compte alors que cet appareil contient encore
  le matériel du premier, c’est dit clairement — rien n’est perdu.
· Les raccourcis clavier et le code en ligne (Super + Return, par exemple) ne
  disparaissent plus de la traduction.
· Sur Mac, les écrans de réglages et de configuration ne sont plus une mise en page de téléphone agrandie.
```

## 国际版 · de-DE

```
Das Wichtigste: **kein Passwort, kein Warten auf einen Code per E-Mail.**

· Anmeldung mit Apple oder Google, ein Tipp. Bisher gab es nur den sechsstelligen Code
  per E-Mail. Der Weg über E-Mail bleibt.
· Ersteinrichtung neu: Ein API-Schlüssel richtet Übersetzung, Vorlesen und
  Transkription gemeinsam ein und prüft sich direkt selbst.
· Sätze, bei denen du wirklich stehen bleibst, werden automatisch zu Lernkarten —
  ab der Installation aktiv.
· Meldest du dich mit einem anderen Konto an, während auf diesem Gerät noch das
  Material des ersten liegt, wird das jetzt gesagt — nichts ist weg.
· Tastenkürzel und Inline-Code (etwa Super + Return) verschwinden nicht mehr aus der
  Übersetzung.
· Auf dem Mac sind Einstellungen und Einrichtung keine vergrößerte Handy-Ansicht mehr.
```

## 国际版 · es-ES

```
Lo principal: **sin contraseña y sin esperar un código por correo.**

· Inicia sesión con Apple o Google de un toque. Hasta ahora solo estaba el código de
  seis dígitos por correo. El correo sigue disponible.
· Configuración inicial rehecha: una sola clave de API configura traducción, lectura en
  voz alta y transcripción, y se comprueba allí mismo.
· Las frases que realmente te detienes a terminar de leer se convierten en tarjetas de
  repaso, activo desde la instalación.
· Si entras con otra cuenta mientras este dispositivo aún guarda el material de la
  primera, ahora se dice claramente: no se perdió nada.
· Los atajos de teclado y el código dentro de un párrafo (por ejemplo, Super + Return)
  ya no desaparecen de la traducción.
· En el Mac, los ajustes y la configuración inicial ya no son un diseño de teléfono ampliado.
```

## 国际版 · pt-BR

```
O principal: **sem senha e sem esperar código por e-mail.**

· Entre com a Apple ou o Google em um toque. Até agora só havia o código de seis
  dígitos por e-mail. O e-mail continua disponível.
· Configuração inicial refeita: uma única chave de API configura tradução, leitura em
  voz alta e transcrição, e testa a si mesma ali.
· As frases em que você realmente para e termina de ler viram cartões de revisão,
  ativo desde a instalação.
· Se você entrar com outra conta enquanto o aparelho ainda guarda o material da
  primeira, isso é dito claramente — nada se perdeu.
· Atalhos de teclado e código dentro de um parágrafo (Super + Return, por exemplo) não
  somem mais da tradução.
· No Mac, as telas de ajustes e de configuração deixaram de ser um layout de celular ampliado.
```

## 国际版 · ru

```
Главное: **никаких паролей и ожидания кода в почте.**

· Вход через Apple или Google в одно касание. Раньше был только шестизначный код на
  почту. Вход по почте остаётся.
· Первая настройка переделана: один API-ключ настраивает перевод, озвучивание и
  расшифровку сразу и тут же проверяет себя.
· Предложения, на которых вы действительно остановились и дочитали, сами становятся
  карточками — включено сразу после установки.
· Если вы вошли под другой учётной записью, а на устройстве осталось содержимое
  прежней, теперь об этом говорится прямо: ничего не потеряно.
· Сочетания клавиш и код внутри абзаца (например, Super + Return) больше не исчезают
  из перевода.
· На Mac настройки и первое знакомство больше не выглядят как растянутый экран телефона.
```

## 国际版 · ar-SA

```
الأهم: **لا كلمة مرور تُحفَظ، ولا انتظار لرمز في البريد.**

· تسجيل الدخول عبر Apple أو Google بنقرة واحدة. حتى الآن كان الرمز المكوَّن من ستة
  أرقام عبر البريد هو الطريق الوحيد. وخيار البريد ما زال متاحاً.
· إعداد أول مرة أُعيدت كتابته: مفتاح API واحد يضبط الترجمة والقراءة الصوتية والتفريغ
  معاً، ويختبر نفسه في المكان نفسه.
· الجمل التي تتوقّف فعلاً لتُنهي قراءتها تتحوّل إلى بطاقات مراجعة، ومُفعّل منذ التثبيت.
· إذا سجّلت الدخول بحساب آخر بينما لا يزال الجهاز يحتفظ بمواد الحساب الأول، يُقال لك
  ذلك بوضوح — لم يُفقد شيء.
· اختصارات لوحة المفاتيح والشيفرة داخل الفقرة (مثل Super + Return) لم تعد تختفي من
  الترجمة.
· على الـ Mac، لم تعد شاشات الإعدادات والتعريف تخطيطاً مكبَّراً لهاتف.
```

## 中国版 · zh-Hans

```
这一版最大的变化：**不用记密码、也不用等验证码邮件了**。

· 用 Apple 一键登录。原来只有邮箱验证码那一条路，要切出去收信、再把六位数字抄回来
  —— 现在按一下就完了。邮箱那条仍然在。
· 首次使用引导重做：一把 key 就能同时配好翻译、朗读和转写，填完当场自检告诉你通没通，
  不用等到翻第一页才发现配错了。
· 你真正停下来读完的句子会自动变成复习卡，装好就开着（快速滚过去的不算）。这些句子
  只存在你自己的设备上。
· 段落里的快捷键和代码（比如 Super + Return）不再从译文里消失。以前它们会被整段
  丢掉，句子读着通顺，意思却是错的。
· 在 Mac 上，设置和引导界面不再是被放大的手机版式：三步说明并排显示，按钮
  也是正常的按钮大小。
```
