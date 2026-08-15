<h1 align="center">BelliedMonkey Translator</h1>

<p align="center">
  <b>Read the world's web — both languages at once. And actually remember it.</b><br>
  Bilingual pages, plus dual subtitles for video and podcasts.<br>
  Sentences you actually read become review cards — on your phone too, if you turn on sync.<br>
  Bring your own LLM key. No servers of ours in the middle.
</p>

<p align="center">
  <a href="https://github.com/belliedmonkey/belliedmonkey-translator/actions/workflows/test.yml"><img alt="tests" src="https://github.com/belliedmonkey/belliedmonkey-translator/actions/workflows/test.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-GPL--3.0-blue"></a>
  <a href="https://belliedmonkey.cc"><img alt="website" src="https://img.shields.io/badge/site-belliedmonkey.cc-c67139"></a>
</p>

<p align="center">
  <b>English</b> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="docs/media/hero-bilingual.gif" alt="A Substack podcast page: every paragraph carries a translation beneath it, and a bilingual subtitle pair tracks the audio at the bottom of the screen." width="720">
</p>

<p align="center"><sub>Page text and audio subtitles at the same time. The original stays; the translation goes underneath.</sub></p>

---

## Install

Install from a store — building from source is for contributors, not for using it.

| Platform | |
|---|---|
| **iPhone · iPad · Mac** (Safari) | [**App Store**](https://apps.apple.com/app/belliedmonkey-translator/id6787190032) — one app record covers all three |
| **Chrome · Edge** (desktop) | [**Chrome Web Store**](https://chromewebstore.google.com/detail/ilnmffeejeohomjelipejdldhkjeoinf) — or skip the store-review lag and grab the [**latest ZIP**](https://github.com/belliedmonkey/belliedmonkey-translator/releases/latest/download/belliedmonkey-translator-chrome.zip) (currently v1.4.2); steps below |
| **Firefox** (desktop · Android) | [**Firefox Add-ons**](https://addons.mozilla.org/firefox/addon/%E5%A4%A7%E8%82%9A%E7%8C%B4%E7%BF%BB%E8%AF%91/) |
| **iPhone Chrome / Firefox** | Not possible — iOS forbids browser extensions outside Safari. This is a platform rule, not a gap in this project |

Then open the extension's settings and pick a translation engine. Nothing else is required.

<details>
<summary><b>Installing the ZIP directly (Chrome / Edge)</b></summary>

Chrome Web Store review can lag a version behind; the [latest ZIP](https://github.com/belliedmonkey/belliedmonkey-translator/releases/latest/download/belliedmonkey-translator-chrome.zip) is always the newest release, built from the same source submitted to the store. Illustrated guide: [belliedmonkey.cc/#install](https://belliedmonkey.cc/#install).

1. Unzip the download. You get a folder — keep it; Chrome runs the extension from that folder.
2. Open `chrome://extensions` (`edge://extensions` on Edge) and switch on **Developer mode** in the top corner.
3. Click **Load unpacked** and pick the unzipped folder.
4. Pin the icon from the puzzle menu 🧩. Direct installs don't auto-update — grab new versions from [Releases](https://github.com/belliedmonkey/belliedmonkey-translator/releases), or use the store build for automatic updates.

</details>

<details>
<summary><b>Building from source</b></summary>

Zero dependencies — no `npm install`. Node.js ≥ 16.

```bash
node build.js                     # Chrome / Safari  → dist/  + belliedmonkeytranslator.zip
node build.js firefox             # Firefox          → dist-firefox/ + .xpi
node build.js --flavor china      # China flavor     → dist-china/
```

Load `dist/` via `chrome://extensions` → Developer mode → Load unpacked.

For Safari you additionally need macOS with a full Xcode install:

```bash
bash build-safari.sh                  # generates the iOS Xcode project
bash build-safari.sh global macos     # …or the macOS one
BUILD_NUMBER=11 bash build-safari.sh global macos   # explicit build number for uploads
```

In Xcode: set your Team on **both** targets → select your device → Run. Then on the phone,
**设置 → Safari → 扩展** and allow access to all websites.

Two things that surprise people: an app installed with a free Apple ID **expires after 7
days** (re-run from Xcode to renew), and on macOS the *Allow Unsigned Extensions* switch
**resets every time Safari restarts**. Neither applies to a store install.

`build-safari.sh` re-applies version, bundle id, display name and the Info.plist keys on
**every** run. That is deliberate: `safari-project*/` is gitignored local state, so without
re-applying it drifts silently ([#51](https://github.com/belliedmonkey/belliedmonkey-translator/issues/51)).

</details>

---

## What it does

**Bilingual pages.** Every paragraph keeps its original text, with the translation directly
beneath it in a distinct colour. No tab switching, no losing your place. The translation
inherits the original's font, size, weight and alignment — only the colour differs — and
re-measures when the window resizes, so it never breaks out of the column it belongs to.

**Dual subtitles for video.** The full transcript is fetched **once, up front**, merged into
whole sentences, and translated **ahead of the playhead in a 60-second sliding window**.
Because the work runs ahead of playback, translation latency is invisible — you get matched
whole-sentence pairs, never word-by-word fragments, and no stutter even with a slow model.

**Dual subtitles for podcasts and audio.** The same engine, with no video frame at all:
a viewport-anchored overlay tracks the audio clock.

**Any LLM you want, or none.** Transport is keyed by request *format* rather than by vendor —
Google, OpenAI-compatible chat completions, and Anthropic-compatible messages — so any
endpoint speaking one of those shapes works, including your own. The list of built-in engines
lives in the extension's settings page; the single source of truth in this repo is
[`build/providers.config.js`](build/providers.config.js), and it is deliberately not
duplicated here — every copy of it is one more thing that goes stale.

---

## Supported sites

Most of the web needs no per-site code: the segmenter uses only standard HTML semantics and
has **zero site selectors**. What follows is the awkward 20% — sites whose markup defeats the
general rules, or whose media needs a transcript path of its own.

| Site | Page text | Video subtitles | Audio subtitles |
|---|:---:|:---:|:---:|
| **YouTube** — incl. `m.youtube.com`, `youtube-nocookie.com` embeds | generic | ✅ | — |
| **x.com / twitter.com** | ✅ de-cluttered | ⚠️ needs a real caption track | — |
| **Substack** — incl. custom domains | ✅ | ✅ video posts | ✅ |
| **Spotify** — episode pages | generic | — | ⚠️ fragile |
| **Wikipedia** — and any page with a data table | ✅ incl. infobox cells | — | — |
| **Apple Podcasts (web)** · **小宇宙** | generic | — | ❌ impossible |
| **Anything else** | ✅ | — | ✅ if the page has a transcript |

**generic** — works through the general rules, with no site-specific code.
**⚠️** — see [Known limitations](#known-limitations).
**❌ impossible** — those two sites expose no timed transcript anywhere on the web, so there is
nothing to translate. They fall back to page text.

"Anything else" is not a hedge. Any page carrying a WebVTT/SRT file or a `<track>`, and any
podcast publishing a Podcasting 2.0 `<podcast:transcript>`, gets subtitles with no adapter at
all. Web components are handled too — open shadow roots are traversed, which is why sites
that keep their content in custom elements work without special-casing.

### Adapted sites don't regress

Two mechanisms, each covering half of that promise:

- **Page text and layout** — every site-specific layout fix ships with a new regression
  fixture distilled from that site's minimal markup pattern, and **that fixture must fail
  before the fix**, with the red run recorded in the issue. Pre-existing fixtures are never
  edited to accommodate a new one. 30 fixtures today, run against a real headless Chrome.

  Worked example, issue #59: on Wikipedia the translations inside a floated infobox became an
  extra table column, doubling the table's width and collapsing the prose beside it to ~115px.
  The fix is generic — no hostname or selector entered the segmenter — but Wikipedia now has a
  fixture of its own, so that page cannot silently break again.
- **Video and audio subtitles** — once a device or browser is adapted it is **permanently
  added to the verification matrix** and exercised on every future change, during actual
  playback. Subtitles are deliberately *not* covered by the layout fixtures; that gate is
  scoped to renderer logic in Chromium and says so.

The rules are written down in [`docs/verification-spec.md`](docs/verification-spec.md), not
just practised.

---

## Why bring your own key

- **No servers of ours.** Translation requests go from your browser straight to the provider
  you chose. There is nothing in between to log, store, or resell — because there is nothing
  in between.
- **Your key stays local.** It lives in `chrome.storage.local` and never leaves your device.
- **You control the cost.** Which engine, which model, how much you spend — all yours. A free
  engine is available if you'd rather not configure anything, though a real model is
  noticeably better.
- **Auditable.** Every claim above is a line of source you can read. That is the point of
  publishing it.

On **iPhone and iPad this works exactly as it does on desktop**, which is harder than it
sounds and is why the architecture looks unusual. See
[Safari iOS, and why the service worker does nothing](#safari-ios-and-why-the-service-worker-does-nothing).

---

## Known limitations

Stated up front, because finding them yourself is worse.

- **iOS has no subtitles in video fullscreen.** iOS hands fullscreen playback to the system's
  native player, which a web overlay cannot draw on. On iPhone and iPad, subtitles are an
  inline-playback feature. This is a platform boundary, not a to-do.
- **No speech recognition, ever.** If a video or podcast has no existing timed transcript, you
  get an honest `字幕不可用` notice and the page-text translation as the floor — never a
  word-by-word guess. Running ASR would mean either a backend of ours or something infeasible
  on Safari iOS, and both are refused.
- **x.com video usually has no caption track.** Captions on X are typically *burned into the
  video image*, which no translator can read. Of four candidate videos sampled while
  preparing demo material, three had burned-in captions and one had none — only a long-form
  upload with a real CC track worked. If the player shows a working CC button, so will we.
- **Traditional and Simplified Chinese are not distinguished.** A Traditional Chinese
  paragraph under a Simplified Chinese target is skipped and shows nothing (and vice versa).
  Browser language detectors report both as plain `zh`; separating them needs
  character-repertoire analysis, which isn't built yet. This is a gap, not intended behaviour.
- **Spotify's transcript scraping is structurally fragile.** Spotify's cue classes are hashed,
  so the code anchors on the seek button plus the `m:ss` timestamp pattern instead. It works,
  and it needs periodic re-verification. Episode pages only.
- **Browsers are not identical, on purpose.** The "don't re-translate text already in your
  target language" check uses the browser's own language detector, which Safari does not
  implement. On Safari the request is still made. Holding every browser down to Safari's floor
  would mean permanently spending your quota on answers that get discarded, so the asymmetry
  was chosen deliberately and written down.
- **Sentence notes (解析) want a chat model, not a reasoning model.** The notes feature asks
  your configured chat engine for a small JSON answer in the message body. Thinking/reasoner
  models spend their output budget on a reasoning phase first and can come back with no answer
  text at all — the failure line names this when it happens. Pick a plain chat model for the
  engine you use with notes.

---

## Privacy

- **No servers of ours in the translation path.** Requests go from your browser to the engine
  you picked.
- **Your API key never leaves your device.** It is stored in `chrome.storage.local`.
- **No tracking, no telemetry — and no account unless you want one.** Syncing your learning
  material between your own devices needs a free account; everything else works without one.
- **Learning material is built on your device.** If you turn on the learning feature, the
  extension keeps the sentences you actually read — with the page URL, its title, and how long
  the text was on screen — in local storage on that device, so it can show them to you again
  later. It is off until you turn it on, it stays on your device **unless you turn on sync**,
  and one button erases all of it.
- **Speaking practice sends your recording only where you point it.** If you configure a
  transcription engine and use the speaking exercise, your recording is sent to that endpoint
  you chose — and nowhere else — then discarded once the transcript comes back. It is never
  stored, never synced, and never touches a server of ours. No engine configured means the
  speaking exercise simply doesn't appear.
- **What is sent for translation** is the text, and nothing else — not the URL, not the page
  title, not the referrer, not any identifier. **What sync sends, if you turn it on, is
  different and larger: every sentence the extension kept, the page URL and title it came
  from, and when you reviewed it — in readable form on our servers.** Deleting learning
  material by source is account-wide: the deletion syncs to all your devices. This is also
  what the extension declares to Firefox under `data_collection_permissions`:
  `websiteContent`, `browsingActivity`, and `personallyIdentifyingInfo` (your account email).

Full policy: [belliedmonkey.cc/privacy.html](https://belliedmonkey.cc/privacy.html)

---

## For developers

### Safari iOS, and why the service worker does nothing

On Safari iOS the background service worker becomes permanently `undefined` after the device
locks, and `chrome.runtime.sendMessage()` from a content script then fails **silently** — no
exception, no rejection. The extension appears to work, you pocket your phone, and translation
is dead until Safari is force-quit.

So the standard MV3 architecture is inverted here: **every provider `fetch()` runs in the
content script** ([`extension/content/translation-api.js`](extension/content/translation-api.js)),
and content scripts read settings straight from `chrome.storage.local` rather than asking the
worker. [`extension/background.js`](extension/background.js) is 64 lines that handle defaults,
badge text and cache clearing — it is never on the critical path.

### How subtitles are acquired

Never word-by-word, and never by scraping the rendered captions. The transcript is fetched
whole, merged into sentences, and translated ahead of playback.

Getting the transcript is the hard part and differs per source. YouTube gates
`/api/timedtext` behind a proof-of-origin token that only its own player can mint — a forged
request returns **HTTP 200 with an empty body**, the worst possible failure mode. So the
extension lets YouTube fetch it, then reads YouTube's own request URL out of the **Resource
Timing API** and re-fetches that exact URL. Because that buffer evicts, a 28-line
`document_start` script exists purely to record those URLs before they vanish. x.com is easier
— its subtitle segments are not token-gated — and podcasts use in-page WebVTT/SRT or the
podcast feed's `<podcast:transcript>`.

### Build and test

```bash
npm test              # pure-logic suite, zero dependencies, Node ≥18
npm run test:layout   # 29 layout fixtures against real headless Chrome (Node ≥22)
```

`npm run test:layout` is **mandatory** before any push touching `extension/content/**` or
`extension/styles/**`. CI runs the unit tests and all three builds; it deliberately does not
run the layout corpus or the device matrix, and the workflow says so rather than letting a
green badge imply coverage it doesn't have.

### Where the rules live

| Document | What it owns |
|---|---|
| [`docs/domain-design.md`](docs/domain-design.md) | The domain model: `source → Extractor → units → Engine → Renderer`, the zero-site-selectors rule, provider registry. **Changes here need human review first.** |
| [`docs/verification-spec.md`](docs/verification-spec.md) | How anything is verified. The full-matrix rule, per-surface traps, honesty rules. |
| [`docs/interaction-spec.md`](docs/interaction-spec.md) | User-facing interaction and layout constraints. |
| [`docs/regression-tests.md`](docs/regression-tests.md) | The manual device checklist. |
| [`AGENTS.md`](AGENTS.md) | Conventions for both humans and AI agents working here. |

### Code layout

```
extension/
├── manifest.json           Manifest V3 — Chrome / Safari / Firefox
├── background.js           State only. Never translation. (See above.)
├── content/
│   ├── translation-core.js Platform-agnostic engine: subtitle state machine,
│   │                       60s sliding window, sentence merge, paging, i18n
│   ├── translation-api.js  Every provider fetch() — runs in the content script
│   ├── dom-processor.js    DomSegmenter — standard HTML semantics, zero site selectors
│   ├── content-webpage.js  Bilingual page rendering
│   ├── content-youtube.js  ├─ subtitle sources, one adapter each
│   ├── content-podcast.js  │
│   ├── content-twitter.js  │
│   ├── site-twitter.js     └─ x.com chrome de-cluttering
│   └── content-main.js     Entry point: reads settings, routes
├── popup/ · options/       Settings UI
└── _locales/               11 languages
```

---

## Contributing

Bug reports and site requests both have a form — the fields on them are the ones that
actually determine whether something can be reproduced. If you want a specific site to work
properly, [open a site request](https://github.com/belliedmonkey/belliedmonkey-translator/issues/new?template=site_adaptation.yml);
that is how the roadmap gets decided.

Every change is recorded in an issue capturing the problem, the fix, **and the reasoning** —
so the thinking survives, not just the diff. See [`AGENTS.md`](AGENTS.md).

## License

[GNU General Public License v3.0 or later](LICENSE). Use it, study it, change it, share it —
derivative works stay GPL-3.0.

Copyright © 2026 belliedmonkey and contributors.
