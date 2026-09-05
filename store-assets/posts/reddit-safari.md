# r/Safari（工具向；同一份稍改后发 r/iphone、r/chrome_extensions）

**规则要点**：r/Safari 与 r/iphone 对开发者自荐较宽容，但要求 flair 选「Extension」/「App」
并在正文里说明「我是作者」。r/chrome_extensions 是开发者社区，可以更技术。
**隔一天发一个 sub。**

## 标题

```
[Extension] Open-source bilingual translation for Safari on iPhone/iPad/Mac — original and translation side by side, bring your own key
```

## 正文

Developer here. This is a Safari extension (one App Store listing covers iPhone, iPad and
Mac) that translates a page without replacing it: each paragraph keeps its original, with the
translation right beneath in a distinct color. YouTube gets dual subtitles the same way.

Why I made it instead of using what's out there: the existing options on iOS are subscriptions
that route the page text through their own servers. This one is GPL open source, has no
account, no telemetry, and no server of mine in the translation path. Google's free endpoint
works with zero setup; or paste your own OpenAI / Claude / DeepSeek / GLM key and use that.

Safari-iOS specifics people here may care about:

- The extension's background worker dies permanently after the device locks (a known Safari
  behavior), so everything runs from the content script — it keeps working after you unlock.
- YouTube's caption endpoint is token-gated on iOS. We don't fight it: YouTube fetches its own
  captions, we read the URL back from the Resource Timing API. No word-by-word fallback.
- Optional learning mode: sentences you actually read become review cards. Off by default.

App Store: https://apps.apple.com/app/belliedmonkey-translator/id6787190032
Source: https://github.com/belliedmonkey/belliedmonkey-translator

Tell me what breaks — site names are the most useful thing you can give me.
