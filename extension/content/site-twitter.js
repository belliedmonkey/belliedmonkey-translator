// site-twitter.js — x.com / twitter.com SITE ADAPTER (DOM/text dimension).
//
// See docs/domain-design.md §3 (the data-mt-skip-region marker) and §2 (the split
// is "is the source DOM?", not "which site"). x.com's tweet text is just DOM and
// flows through the generic DomSegmenter + webpage renderer unchanged — this
// adapter contributes ONLY site knowledge, and only through the generic marker:
// it feature-detects the tweet UI and marks the large non-content chrome regions
// (right-rail trends / who-to-follow / footer, the left nav, the per-tweet
// engagement bar) with `data-mt-skip-region`. DomSegmenter.computeSkipRegions
// honors that marker generically, so the segmenter itself never learns a
// data-testid. Without this, that chrome's long letter-bearing text
// ("Trending in Technology", "Subscribe to Premium", footer link farm) passes
// minLen/isUntranslatable and clutters the page with translations nobody reads.
//
// Mirrors content-podcast.js markSubstackPlayerShells: host-agnostic, self-gating
// on a stable DOM signal, idempotent, and re-asserted (here via a MutationObserver
// + slow backstop) because X's virtualized feed re-renders and recycles nodes.
// Marking is UNCONDITIONAL — it runs whether or not translation is on, because the
// webpage path pollutes whenever it collects, independent of the subtitle path.

var TwitterSite = (() => {
  const SKIP_ATTR = 'data-mt-skip-region';

  // Non-content chrome to exclude. All are stable X test ids / ARIA landmarks;
  // scoped so the actual tweet column ([data-testid="primaryColumn"] tweets) is
  // never touched. Engagement bars are scoped to articles so unrelated role=group
  // elsewhere is left alone.
  const CHROME_SELECTORS = [
    '[data-testid="sidebarColumn"]',            // right rail: trends, who-to-follow, search, footer
    'header[role="banner"]',                    // left nav (desktop) / top bar
    'article[role="article"] [role="group"]',   // per-tweet engagement bar (reply/repost/like/views)
    '[data-testid="User-Name"]',                // tweet author line (name + @handle + ·timestamp) —
                                                // one leaf block of metadata; translating it yields an
                                                // ugly "Name @handle · 2h" blob, not content.
    '[data-testid="inlinePrompt"]',             // inline promos/prompts ("turn on notifications", etc.)
    '[data-testid^="tweetTextarea"]',           // inline composer: input container + placeholder
                                                // ("有什么新鲜事？" / "发布你的回复") — never translate a draft box.
    'article[role="article"] a[href$="/quotes"]', // "view quotes" UI action link.
  ];

  // The tweet UI is present. Used both as the mark-time self-gate and (with the
  // host check) to decide whether to install the observer at all — so on a random
  // non-Twitter site in the <all_urls> stack this module stays completely dormant.
  function isTwitterDom() {
    return !!document.querySelector('[data-testid="tweetText"], [data-testid="primaryColumn"], article[role="article"]');
  }
  function isTwitterHost() { return /(^|\.)(x\.com|twitter\.com)$/.test(location.hostname); }
  function shouldRun() { return isTwitterHost() || isTwitterDom(); }

  function markEl(el) {
    if (el && el.setAttribute && !el.hasAttribute(SKIP_ATTR)) el.setAttribute(SKIP_ATTR, '1');
  }

  // The single-tweet (status) page shows a metadata row BELOW the tweet body —
  // "上午6:53 · 2026年7月18日 · 13.8万 查看" (time · date · views). It has no stable
  // test id, but it is pure date/number metadata (translating it yields a near-
  // identical green duplicate, not content). It is absent from the feed, so it only
  // clutters status pages. Anchor structurally: a standalone <time> inside an
  // article that is NOT the author line (User-Name) and NOT the tweet body
  // (tweetText), plus the views/analytics link — mark their enclosing row. The
  // `!row.querySelector(tweetText)` guard guarantees we never mark a container that
  // holds the tweet body.
  function markStatusMeta() {
    for (const t of document.querySelectorAll('article[role="article"] time')) {
      if (t.closest('[data-testid="User-Name"]') || t.closest('[data-testid="tweetText"]')) continue;
      const cell = t.closest('a') || t;
      const row = cell.parentElement;
      if (row && !row.querySelector('[data-testid="tweetText"]')) markEl(row);
    }
    for (const a of document.querySelectorAll('article[role="article"] a[href*="/analytics"]')) {
      const row = a.parentElement;
      if (row && !row.querySelector('[data-testid="tweetText"]')) markEl(row);
    }
  }

  // Set the marker on every known chrome region that lacks it. Idempotent: setting
  // an attribute is invisible to a childList MutationObserver, so this can never
  // self-trigger the observer below.
  function markChrome() {
    if (!isTwitterDom()) return;
    for (const sel of CHROME_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) markEl(el);
    }
    markStatusMeta();
  }

  // ─── Driver: MutationObserver (marks newly-mounted tweets as you scroll) +
  //     a slow interval backstop (rides out any observer miss / recycle). ────────
  let obs = null;
  let backstop = null;
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // Coalesce a burst of feed mutations into one mark pass, before paint.
    queueMicrotask(() => { scheduled = false; markChrome(); });
  }
  function start() {
    if (obs || !shouldRun()) return;
    markChrome();
    obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true });
    backstop = setInterval(markChrome, 2000);
  }

  // Auto-start (covers the layout fixture, which has no content-main host routing,
  // and is robust if content-main's isTwitter branch ever changes). Idempotent
  // with the explicit content-main init() call.
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });

  return { init: start, markChrome };
})();
