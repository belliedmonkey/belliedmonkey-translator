// learn-driving.js — pure logic for 驾车模式 (driving mode, 记忆层).
// See docs/learning-design.md §9.5 and docs/interaction-spec.md 「驾车模式」.
//
// PURE, like learn-exercises.js: the playlist order (`buildOrder` / `advance`), the
// per-card plan, the notes-to-speech rendering and the session state machine
// (`reduce`) are all deterministic functions of their inputs — the app orchestrator
// (app/driving.js) executes the effects and feeds events back. That split is what lets
// the vm harness walk the whole session without a DOM or a voice.
//
// ─── What this mode is, and what it is NOT ──────────────────────────────────
// It is a PLAYER for the deck: it reads cards aloud, back to back, in one of four
// playback orders, and it **writes nothing at all** — no review row, no skill stamp,
// no `lastSeenAt`, no scheduler call. Nothing here can move a card's curve.
//
// That is a deliberate reversal. The first version asked 「有没有疑问？」 after every
// card and offered a 跟读 exercise, so that a driver could push real progress
// hands-free. Both are gone: a recording window has to interrupt continuous playback
// to exist, and continuous playback is the entire point of listening while driving.
// The learning layer's write paths stay where a user can see what they are grading
// (the review surface); this surface only exposes material. See §12 for the record.
//
// Depends only on LearnModel (nothing from LearnScheduler any more — no write path
// means no scheduler contact).

var LearnDriving = (() => {
  // Playback orders, in the order the toggle cycles them. `shuffle` leads because it
  // is the default: a driver revisiting the same deck daily hears the same opening
  // three cards forever under any in-order mode, and that is precisely the material
  // they already know best.
  const MODES = ['shuffle', 'sequential', 'loop', 'repeat-one'];
  const DEFAULT_MODE = 'shuffle';

  const DEFAULTS = {
    mode: DEFAULT_MODE,
    // Reading the notes aloud is OFF by default because it can COST MONEY: a card
    // that has never been parsed gets generated on the spot, against the user's own
    // key. §9.2's "one generation per card, ever" still holds — the charge happens
    // once and every later pass is cached — but a silent first charge while someone
    // is driving is not something to opt them into.
    playNotes: false,
  };

  function cfgOf(cfg) { return Object.assign({}, DEFAULTS, cfg || {}); }
  function nextMode(mode) {
    const i = MODES.indexOf(mode);
    return MODES[(i < 0 ? 0 : i + 1) % MODES.length];
  }

  // ─── Playlist order ────────────────────────────────────────────────────────
  // The order is materialised once rather than computed per step, so `shuffle` means
  // "every card once, in a random order" instead of "a random card each time" — the
  // latter replays cards while others never come up, which on a 15-card deck is
  // immediately noticeable and reads as a bug.
  //
  // `rand` is injected (defaults to Math.random) so a test can pin an exact order.
  function buildOrder(n, mode, rand) {
    const order = [];
    for (let i = 0; i < n; i++) order.push(i);
    if (mode !== 'shuffle') return order;
    const r = rand || Math.random;
    for (let i = order.length - 1; i > 0; i--) {          // Fisher-Yates
      const j = Math.floor(r() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    return order;
  }

  // Advance one step. Returns the new position, possibly a NEW order (shuffle
  // reshuffles when it wraps, so the second lap is not the first lap again), and
  // `done` — true only for `sequential`, the one mode that ends.
  //
  // `force` is what the 下一张 button passes: a manual skip moves on even in
  // repeat-one, because a player that ignores its own next button is broken.
  function advance(pos, order, mode, rand, force) {
    if (mode === 'repeat-one' && !force) return { pos, order, done: false };
    const at = order.indexOf(pos);
    const next = at + 1;
    if (next < order.length) return { pos: order[next], order, done: false };
    if (mode === 'sequential') return { pos, order, done: true };
    const reshuffled = buildOrder(order.length, mode, rand);
    return { pos: reshuffled[0], order: reshuffled, done: false };
  }

  // ─── Per-card plan ─────────────────────────────────────────────────────────
  // What gets read aloud for one card, in order. Media cards never reach this (the
  // orchestrator skips them — synthetic speech never replaces real speech, §11).
  function cardPlan(item, cfg) {
    const c = cfgOf(cfg);
    const segments = ['source'];
    if (item && item.tr) segments.push('tr');
    if (c.playNotes) segments.push('notes');
    return { segments };
  }

  // ─── Notes → one spoken paragraph ──────────────────────────────────────────
  // The notes object is built for the EYE (three labelled lists). Spoken, that
  // structure has to become sentences, and the labels have to come from the caller:
  // this file holds no copy, in any language.
  //
  // Returns '' when there is nothing worth saying, and the caller then skips the
  // segment rather than speaking an empty string — a silent "playing notes" state is
  // indistinguishable from a stall.
  function notesToSpeech(notes, labels) {
    if (!notes) return '';
    const L = labels || {};
    const parts = [];
    const words = (notes.words || []).filter((w) => w && w.w && w.g);
    const phrases = (notes.phrases || []).filter((p) => p && p.p && p.g);
    if (words.length) {
      parts.push((L.words || '') + words.map((w) => w.w + '，' + w.g).join('。'));
    }
    if (phrases.length) {
      parts.push((L.phrases || '') + phrases.map((p) => p.p + '，' + p.g).join('。'));
    }
    if (notes.grammar && String(notes.grammar).trim()) {
      parts.push((L.grammar || '') + String(notes.grammar).trim());
    }
    return parts.join('。');
  }

  // ─── The session state machine ─────────────────────────────────────────────
  // reduce(state, event, ctx) → { state, effects } — a deterministic transition
  // table. Effects are descriptors the orchestrator executes:
  //   speak(what) · fetch_notes · advance(force) · stop_tts · note(code) · done
  //
  // `ctx.plan.segments` is the current card's plan; the machine walks it by index so
  // that adding a segment later is a data change, not a new pair of states.
  const ACTIVE = { speaking: 1, fetching_notes: 1 };

  function S(name, effects, extra) {
    return Object.assign({ state: Object.assign({ name }, extra || {}) }, { effects: effects || [] });
  }

  // Start (or restart) the segment at `seg` of the current card. `notes` needs its
  // text fetched first; everything else is already in hand.
  function playSegment(ctx, seg) {
    const segments = (ctx && ctx.plan && ctx.plan.segments) || ['source'];
    if (seg >= segments.length) return S('advancing', [{ t: 'advance' }]);
    const what = segments[seg];
    if (what === 'notes') return S('fetching_notes', [{ t: 'fetch_notes' }], { seg });
    return S('speaking', [{ t: 'speak', what }], { seg });
  }

  function reduce(state, ev, arg, ctx) {
    const st = (state && state.name) || 'idle';
    const seg = (state && state.seg) || 0;

    // ── Controls that work from anywhere ────────────────────────────────────
    // Stop and pause are INTERRUPTS, not second triggers, so they are exempt from
    // the "IO in flight ⇒ controls disabled" rule (interaction-spec 「驾车模式」).
    if (ev === 'tap_stop') return S('idle', [{ t: 'stop_tts' }]);
    if (ev === 'hidden' || ev === 'tap_pause') {
      if (st === 'paused' || st === 'idle') return { state: state, effects: [] };
      return S('paused', [{ t: 'stop_tts' }], { seg });
    }
    if (ev === 'tap_resume' && st === 'paused') return playSegment(ctx, seg);
    // The mode toggle never interrupts audio — it only changes what happens at the
    // END of this card, which is the whole reason it is safe to press while moving.
    if (ev === 'tap_mode') return { state: state, effects: [{ t: 'mode_next' }] };

    if (ev === 'tap_next') return S('advancing', [{ t: 'stop_tts' }, { t: 'advance', force: true }]);
    if (ev === 'tap_repeat' && st !== 'idle') return playSegment(ctx, 0);

    switch (st) {
      case 'idle':
      case 'advancing':
        if (ev === 'card_ready') return playSegment(ctx, 0);
        if (ev === 'deck_done') return S('session_done', [{ t: 'done' }]);
        return { state: state, effects: [] };

      case 'speaking':
        if (ev === 'tts_done') return playSegment(ctx, seg + 1);
        if (ev === 'tts_fail') {
          // A whole-engine failure (autoplay blocked, no speech support) will fail on
          // every card, so stopping is the honest response. A per-CARD failure — no
          // voice for THIS language — must not end a session whose other cards are
          // readable: say which card was skipped and keep going. Never silent either
          // way; a card that vanishes with no explanation reads as data loss.
          const fatal = arg === 'blocked' || arg === 'unsupported';
          return fatal
            ? S('stopped_error', [{ t: 'stop_tts' }, { t: 'note', code: arg }])
            : S('advancing', [{ t: 'note', code: arg }, { t: 'advance' }]);
        }
        return { state: state, effects: [] };

      case 'fetching_notes':
        // Empty text is a skip, not a stall: speaking '' leaves the UI sitting in a
        // state that looks identical to a hang.
        if (ev === 'notes_ready') {
          return arg && String(arg).trim()
            ? S('speaking', [{ t: 'speak', what: 'notes', text: arg }], { seg })
            : playSegment(ctx, seg + 1);
        }
        if (ev === 'notes_fail') {
          // The card itself was already read; a missing analysis is a reason to move
          // on, not to end the drive. Named so the surface can say which one failed.
          return S('advancing', [{ t: 'note', code: arg || 'notes_failed' }, { t: 'advance' }]);
        }
        return { state: state, effects: [] };

      default:
        return { state: state, effects: [] };
    }
  }

  return {
    DEFAULTS, MODES, DEFAULT_MODE, nextMode,
    buildOrder, advance, cardPlan, notesToSpeech, reduce,
    ACTIVE,
  };
})();

if (typeof window !== 'undefined') window.LearnDriving = LearnDriving;
if (typeof module !== 'undefined' && module.exports) module.exports = LearnDriving;
