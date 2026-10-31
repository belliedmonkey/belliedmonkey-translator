// app/translate-fill.js — 补译文 (§9.5): give a card captured WITHOUT a translation
// one, so 播客模式 has something to read in the second pass.
//
// ─── Why this exists, and why it is app-only ────────────────────────────────
// `item.tr` is captured, never fetched: the Collector snapshots what the renderer
// already put on the page (§3 law 1). A card starred from a page that was never
// translated therefore has no `tr` at all, and 播客模式 reads such a card three times
// in the source language and nothing else. On a phone in a cradle that is not a
// degenerate case worth living with — it is half the material missing.
//
// It lives in `app/` rather than `extension/learn/` because 播客模式 is app-only by
// capability (§9.5: the extension page cannot autoplay on iOS Safari), and shipping
// bytes into `dist/` that nothing there loads is dead weight on every user.
//
// ─── The three boundaries this must not cross ───────────────────────────────
// 1. **It never writes `item.tr`.** That field records what the page actually showed,
//    and §4.2d is still the ONE place a stored `tr` may deviate from it. There is also
//    a mechanical reason: `LearnModel.touchedAt` is max(createdAt, lastSeenAt,
//    lastReviewAt), so filling `tr` would not lift the sync watermark and the value
//    could never reach another device — it would only fork the corpus silently.
// 2. **It is a derived artifact**, the same tier as the audio cache (§9.1), the notes
//    cache (§9.2) and the exercise packs (§9.3): device-local, regenerable, never
//    synced. Each device pays for it once, exactly like the other three.
// 3. **It is never automatic.** Generation happens only inside the 出发前预载 button,
//    which prices the whole batch before spending anything (§9.2 as amended
//    2026-08-23). Playback reads `cached()` and nothing else — the player must never
//    stall on a network round-trip, nor bill a driver who cannot see the bill.
//
// Storage rides the existing `notes` store under `itemId + "\0tr"`, the trick §9.3
// already uses for packs: no new object store, no index change, no DB_VERSION bump.
//
// The engine is §9.2's group (`LearnNotes.resolveConfig`) because that is the only
// chat engine the app's settings expose — the app has no translation-engine fields of
// its own, and inventing a second credential group for one button would be a worse
// trade than sharing the one the user already filled in.

var LearnTranslateFill = (() => {
  // Bumping this invalidates every cached fill and re-charges once per card. Same
  // discipline as §9.2's PROMPT_VERSION: bump only to correct WRONG output.
  const TR_VERSION = 1;

  // NUL cannot occur in an item id (ids are hex digests), so the suffix can never
  // collide with a real note record — nor with §9.3's `\0pack`.
  function keyFor(id) { return String(id) + '\u0000tr'; }

  let cfg = { provider: '', apiKey: '', baseUrl: '', model: '' };

  function configure(c) { cfg = Object.assign({}, cfg, c || {}); }

  // Deliberately NOT a second copy of the resolution rule — §9.2 owns it, and two
  // copies would drift the first time the follow/override semantics change.
  function resolveConfig(s) { return LearnNotes.resolveConfig(s); }

  // Same gate as the notes engine, evaluated against OUR config rather than
  // delegating: `LearnNotes.capable()` reads notes.js's own module-level cfg, which is
  // configured separately and may legitimately differ (a caller can configure one and
  // not the other). Asking about the wrong config is exactly the kind of "works in the
  // test, silent on the device" bug §9.5 already paid for once.
  function providerInfo() {
    const list = (typeof window !== 'undefined' && window.MT_PROVIDERS) || [];
    return list.find((p) => p.id === cfg.provider) || null;
  }
  function capable() {
    const p = providerInfo();
    return !!(p && (p.type === 'chat-compat' || p.type === 'messages-compat') && cfg.apiKey);
  }

  // Concurrent callers get one promise, so the price-then-spend pass and a warm-up
  // that overlaps it cannot both charge for the same card (notes.js:234's rule).
  const inflight = new Map();

  // Cache-first. Resolves { tr, cached }, or rejects with a `code` the caller names.
  async function get(item, targetLang) {
    if (inflight.has(item.id)) return inflight.get(item.id);
    const hit = await cached(item.id);
    if (hit) return { tr: hit.data, cached: true };
    if (inflight.has(item.id)) return inflight.get(item.id);
    const p = (async () => {
      if (!capable()) { const e = new Error('no engine'); e.code = 'no_engine'; throw e; }
      const out = await TranslationAPI.translate(
        item.text, targetLang, cfg.provider, cfg.apiKey, cfg.baseUrl, cfg.model);
      const tr = String(out || '').trim();
      if (!tr) { const e = new Error('empty translation'); e.code = 'empty_output'; throw e; }
      // The charge already happened; a failed cache write must not surface as a
      // failure and bait a second charge (same stance as notes.js and putAudio).
      try {
        await LearnStore.putNote(keyFor(item.id), tr, { provider: cfg.provider, v: TR_VERSION });
      } catch (_) {}
      return { tr, cached: false };
    })();
    inflight.set(item.id, p);
    try { return await p; } finally { inflight.delete(item.id); }
  }

  // Read-only, never charges — this is what playback is allowed to call.
  function cached(id) {
    return LearnStore.getNote(keyFor(id))
      .then((h) => (h && h.data && h.v === TR_VERSION ? h : null))
      .catch(() => null);
  }

  return { configure, resolveConfig, capable, get, cached, keyFor, TR_VERSION };
})();

if (typeof window !== 'undefined') window.LearnTranslateFill = LearnTranslateFill;
if (typeof module !== 'undefined' && module.exports) module.exports = LearnTranslateFill;
