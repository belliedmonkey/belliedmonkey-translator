# 1.6.8 发布说明（六个面）

> **这一轮和 1.6.7 相反：两类用户都拿到了真东西。**
> 扩展用户拿到的是两个真 bug 的修复（永远转圈的「翻译中」、会被静默丢弃的 API Key）——
> 都是他们可能真的撞到过、而且撞到时无从判断的那种。App 用户拿到的是整套首次运行引导。
> 所以下面两份文案都不是凑数的，各写各的。
>
> ⚠️ 文案里**不写**「我们修了一个 promise 不落地的 bug」这类内部说法。用户关心的是
> 「以前会怎样、现在会怎样」，不是我们内部怎么称呼它。

---

## Apple 四条线（iOS / macOS × 国际版 / 中国版）

### iOS · 简体中文

```
第一次打开 App 会有一段引导，带你把翻译真正用起来：选语言、配好翻译引擎、启用
Safari 扩展、然后当场翻一页看看效果。

· 不登录也能进来看。登录只在你想把复习进度同步到别的设备时才需要。
· 在 iPhone 上装好之后，官网上多了一页 belliedmonkey.cc/setup.html：照着上面三步
  去系统设置里启用扩展，回到那一页它会自己变绿告诉你「成功了」——这是以前一直
  没有答案的问题。
· 修好了两处会让人白等的地方：翻译如果失败，现在会明确告诉你并给一个可以点的
  重试，而不是一直停在「翻译中」；在设置里填完 API Key 之后直接锁屏或切走，Key
  也不会再丢了。
```

### iOS · English

```
The first launch now walks you through actually getting translation working: pick
your languages, set up an engine, enable the Safari extension, then translate a
page right there to see it work.

· You can look around without signing in. An account is only needed when you want
  review progress synced to another device.
· After installing on iPhone, there's a new page at belliedmonkey.cc/setup.html:
  follow the three steps to enable the extension in Settings, come back, and it
  turns green by itself to confirm it worked — a question that previously had no
  answer anywhere.
· Two places that used to leave you waiting are fixed: a failed translation now
  says so and offers a retry you can tap, instead of sitting at "Translating…"
  forever; and an API Key you type in Settings is no longer lost if you lock the
  screen or switch apps before leaving the field.
```

### macOS · 简体中文

```
第一次打开 App 会有一段引导，带你把翻译真正用起来：选语言、配好翻译引擎、启用
Safari 扩展、然后当场翻一页看看效果。扩展没启用时，App 里可以一键跳到 Safari 的
扩展设置。

· 不登录也能进来看。登录只在你想把复习进度同步到别的设备时才需要。
· 修好了两处会让人白等的地方：翻译如果失败，现在会明确告诉你并给一个可以点的
  重试，而不是一直停在「翻译中」；在设置里填完 API Key 之后直接切走，Key 也不会
  再丢了。
```

### macOS · English

```
The first launch now walks you through actually getting translation working: pick
your languages, set up an engine, enable the Safari extension, then translate a
page right there to see it work. When the extension is off, the app can jump
straight to Safari's extension settings.

· You can look around without signing in. An account is only needed when you want
  review progress synced to another device.
· Two places that used to leave you waiting are fixed: a failed translation now
  says so and offers a retry you can click, instead of sitting at "Translating…"
  forever; and an API Key you type in Settings is no longer lost if you switch
  away before leaving the field.
```

---

## 浏览器扩展三面（Chrome Web Store / Firefox AMO / GitHub + 官网）

> 扩展用户没有那个 App，所以**不提引导**；他们拿到的是两个修复，而且都是真的会咬人的。

### 中文

```
修好了两处会让人白等的地方：

· 翻译失败时会明确告诉你，并给一个可以点的重试 —— 以前有些情况下会一直停在
  「翻译中…」，不出结果也不报错，没有任何办法判断发生了什么。
· 在设置里填完 API Key 之后直接切走或关掉页面，Key 不会再被丢掉了。以前只有在
  输入框失去焦点时才保存，于是「明明填了却还是不能用」。

另外，商店里的名字和简介改了，更能说清这个扩展到底是做什么的。
```

### English

```
Two places that used to leave you waiting are fixed:

· A failed translation now says so and offers a retry you can click. Previously it
  could sit at "Translating…" indefinitely — no result, no error, no way to tell
  what had happened.
· An API Key typed in Settings is no longer lost if you switch away or close the
  page before leaving the field. It used to save only on blur, so a key could look
  entered and still not work.

The store name and summary were also reworded to say more clearly what this does.
```
