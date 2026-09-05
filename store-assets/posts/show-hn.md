# Show HN

**去处**：https://news.ycombinator.com/submit  ·  **时间**：周二–周四，美西 7–9 点
**规则**：标题以 `Show HN:` 开头；URL 填 GitHub 仓库（不是官网 —— HN 读者要看代码）；
正文（text）留空，第一条评论由作者自己写「为什么做它」。**不要**在标题里放形容词。

## 标题（≤ 80 字符，二选一）

```
Show HN: Open-source bilingual web/video translator for Safari iOS, bring your own LLM key
```
```
Show HN: BelliedMonkey – read the web in two languages at once, no server in the middle
```

## URL

```
https://github.com/belliedmonkey/belliedmonkey-translator
```

## 作者第一条评论（发帖后立刻贴）

Hi HN. I built this because every "immersive" translator I tried on iPhone was a subscription
that routed page text through the vendor's server. I wanted the same reading experience —
original paragraph, translation right under it — with my own API key and nothing of the
author's in between.

What it does:

- Web pages: every paragraph keeps its original with the translation beneath it. Zero site
  selectors — the segmenter works from HTML semantics only, so most sites need no per-site code.
- Video and podcasts: dual subtitles (YouTube, Substack video, anything with a WebVTT/SRT
  track or a Podcasting 2.0 transcript). No speech recognition — if there's no transcript,
  it says so instead of guessing.
- Optional: sentences you actually read (not skimmed past) become review cards on a
  forgetting curve. Off by default, local unless you turn on sync.

What it deliberately doesn't do: no telemetry, no analytics, no account required. Translation
goes straight from your browser to the engine you picked (Google's free endpoint with no key,
or OpenAI / Claude / DeepSeek / GLM / any OpenAI-compatible endpoint with yours). Keys stay on
device. GPL-3.0. Same codebase ships to iOS/macOS Safari, Chrome, Firefox.

The hard part was Safari iOS: the extension's service worker goes permanently undefined
after the device locks, so every fetch lives in the content script; and YouTube's caption
endpoint is token-gated, so we let YouTube fetch it and read the URL back from the Resource
Timing API. Details in the README and docs/domain-design.md.

Happy to answer anything. Bugs and "it breaks on site X" reports are the most useful thing
you can give me.

## 常见追问的备答

- **"How is this different from Immersive Translate?"** — Same reading model. Differences:
  GPL open source, no subscription, no account, no server of ours in the translation path,
  bring your own key. They have more site adapters and a hosted plan; we have neither.
- **"Why not just use Safari's built-in translation?"** — It replaces the page; this keeps
  both languages visible. Built-in also doesn't do subtitles.
- **"Free?"** — The tool is. Google's endpoint is free without a key but unreliable under load;
  an LLM engine costs whatever your provider charges (a Wikipedia article on DeepSeek is
  well under a cent).
- **"Firefox on iOS?"** — Not possible; iOS only allows extensions in Safari.
