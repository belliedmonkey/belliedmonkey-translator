# Interaction Spec (交互效果规范)

Single source of truth for all **user-facing interaction / layout constraints**.
Anything about how translations look or behave on screen is maintained HERE — not
scattered across code comments or AGENTS.md. When changing interaction behavior,
update this file in the same commit.

Verify every item here with a **screenshot** of the built, loaded extension — a DOM
element existing is not proof the user sees it (see AGENTS.md).

---

## YouTube bilingual subtitles

### Controls & activation
- **Default OFF on every page load.** Nothing is translated until the user turns it
  on. No persisted auto-start — a refresh always starts off.
- **Two independent controls:** the in-player **译 button** controls VIDEO SUBTITLES
  (menu: 开启/关闭, plus 双语/仅译文/仅原文, .srt, settings); the page **FAB** controls
  WEBPAGE TEXT (title / description / comments). They never affect each other.

### Source & timing
- **Preload + translate-ahead.** Capture YouTube's own `/api/timedtext` transcript
  (via the `world:MAIN` hook), translate ahead of playback, and display by matching
  `video.currentTime`. There must be **no per-caption translation lag** — a slow LLM
  (e.g. DeepSeek) must not delay display, because the work is done in advance.
- **Whole sentences, together.** Show the **original as a complete sentence** (merged
  from cues), not YouTube's word-by-word rollup. Original line + translation line
  appear **at the same time**, both driven by the current sentence.
- **Sentence merge.** Cues are merged into sentences (break on sentence-ending
  punctuation or a long pause) so the engine translates with context → fluent output,
  not choppy fragments.

### Layout (hard constraints)
- **Self-rendered overlay.** We draw our OWN caption overlay and **hide YouTube's
  native caption rendering** (`.ytp-caption-window-container { opacity:0 }`). Do NOT
  render into YouTube's `.caption-window` (it rolls word-by-word and YouTube moves it).
- **Fixed position.** The overlay is anchored to the player at a **constant** position
  (`bottom: 11%`). It MUST NOT move when the cursor moves or the controls show/hide.
- **Centered.** Horizontally centered (`left:50%; translateX(-50%)`), `text-align:center`.
- **Max 1 line per language.** Each language line is capped at **a single line**.
  Longer text is split into 1-line **pages** shown in sequence over the sentence's
  time span. Line capping is **measured** at the current width (responsive — works on
  desktop and narrow mobile alike), never a fixed character count.
- **Width cap.** `max-width: ~82%` of the player so it never covers too much of the frame.
- Translation line color follows the `ytTextColor` setting (default white).

### Loading state
- When the active sentence's translation is **not ready yet**, show a hint
  (**`⏳ 译文准备中…`**) in the translation line, dimmed/italic. When the translation
  arrives, the next tick **auto-swaps** it in. Never show a blank or stuck line.

### In-player control button + menu
- A **`译` button** sits in the player control bar (`.ytp-right-controls`).
- Clicking opens a menu with:
  - **字幕显示类型**: 双语字幕 / 仅译文 / 仅原文 (current mode checked)
  - **下载字幕 (.srt)** — exports the transcript + translation as `.srt`
    (bilingual / translation-only / original depending on the current mode)
  - **设置** — opens the extension options page
- 仅译文 hides the original line; 仅原文 hides the translation line.

### Requirements / fallback
- **Captions (CC) must be on** so YouTube fetches `/api/timedtext` for the hook to
  capture. `enable()` turns CC on automatically.
- If no transcript is captured (CC unavailable / hook blocked), **fall back** to
  translating the live caption text into the same overlay (still 1-line paged + hint).

### Known tradeoff
- A 1-line cap is tight, so pages can break mid-phrase (a page may end on a stray
  word or start with punctuation). This is the accepted cost of "max 1 line". If it
  reads too choppy, the line cap can be raised to 2 (more coverage, more natural breaks).

---

## Webpage bilingual translation
- **Off by default**; starts only when the FAB is turned on (per page load).
- Translation is injected **under each original paragraph** (original kept above,
  translation below), in the configured text color.
- **Paragraph by paragraph.** Each paragraph shows a **`⏳ 翻译中…`** placeholder until
  its translation arrives, so the page fills in incrementally as it loads.
- **At most 5 paragraphs translate in parallel** (`TranslationAPI` concurrency cap).
- Skip non-content regions (nav/header/footer/aside, buttons, code). Idempotent
  injection (never duplicate if the content script runs twice).

### On YouTube (title / description / comments)
- These live in Polymer custom elements that re-render and strip injected children,
  so the translation is inserted as a **SIBLING** right after the original (original
  above, translation below — same style) and re-applied on a ~1.5s poll (idempotent
  via `data-src`).
- **Translate only what's visible.** The description keeps both a collapsed snippet
  and the expanded full text in the DOM; translate only the visible one
  (`offsetParent !== null`) and drop the hidden one's translation. Never translate
  text the user hasn't expanded.
- **Preserve structure.** Multi-line text (description, multi-line comments) is
  translated **line by line** and rendered with `white-space: pre-wrap`, keeping the
  original line breaks / blank lines (URLs and timestamps stay intact).

---

## General
- **Screenshot-verify** every visual change against the built/loaded extension.
- Don't cover more of the frame/page than necessary.
- Branding: the product is「大肚猴翻译 / BelliedMonkey Translator」. Never reference the
  reference extension's name anywhere in code, docs, or UI.
