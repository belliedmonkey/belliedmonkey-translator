# r/languagelearning（也可改动词后发 r/LearnJapanese、r/ChineseLanguage、r/Spanish）

**规则要点**：r/languagelearning 允许自荐但要求「说明你是作者」且帖子本身有内容，
纯链接会被删。周一有「Tools & Resources」类主题时优先挂那里。**不要**同一天多个 sub 群发
—— Reddit 会按相同 URL 判 spam；隔一天一个。

## 标题

```
I made an open-source Safari/Chrome extension that shows both languages at once — and turns sentences you actually read into review cards
```

## 正文

I've been reading foreign-language news and watching YouTube in my target language for years,
and the thing that always broke my flow was switching: translate the page, lose the original;
read the original, keep a dictionary tab open. So I built the reading mode I wanted and
open-sourced it.

**What it does**

- Every paragraph keeps its original text, with the translation right under it in a
  different color. You read at your own pace and only glance down when you need to.
- YouTube (and any video/podcast with a transcript) gets dual subtitles — original on top,
  translation below, matched sentence by sentence.
- If you turn it on, the sentences you actually read — not the ones you scrolled past —
  become spaced-repetition cards. Reading, listening, and writing tiers, read-aloud, notes.
  Off by default. Stays on your device unless you enable sync.

**What it costs**

The extension is free and GPL-licensed. Google translation works with no key. If you want an
LLM (better with idioms and long sentences), you paste your own OpenAI / Claude / DeepSeek /
GLM key and pay your provider directly — nothing goes through a server of mine, there's no
account unless you want sync, and there's no telemetry at all.

**Where**: iPhone/iPad/Mac Safari (one App Store listing), Chrome, Firefox.
Links in the first comment so this doesn't get filtered.

I'd honestly rather hear what's wrong with it than what's right. Which sites break? Which
language pairs read badly? I'm the only developer, and the fixes usually ship within days.

## 第一条评论（链接）

App Store: https://apps.apple.com/app/belliedmonkey-translator/id6787190032
Chrome: https://chromewebstore.google.com/detail/ilnmffeejeohomjelipejdldhkjeoinf
Firefox: https://addons.mozilla.org/firefox/addon/%E5%A4%A7%E8%82%9A%E7%8C%B4%E7%BF%BB%E8%AF%91/
Source: https://github.com/belliedmonkey/belliedmonkey-translator
