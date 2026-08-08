// learn-scheduler.js — Ebbinghaus forgetting-curve scheduler (记忆层).
// See docs/learning-design.md §5. PURE: `now` is always injected, never read from
// the ambient clock — a scheduler that reads Date.now() internally is untestable.

var LearnScheduler = (() => {
  const DAY = 86400000;

  // Stability `s` is in DAYS and uses the FSRS convention R(s) = 0.9, i.e. an item
  // reviewed exactly `s` days ago has ~90% recall probability.
  const DEFAULTS = {
    targetR: 0.90,
    S0: [0.15, 0.7, 1.5, 4.0],      // first-grade → initial stability (days)
    FACTOR: [0.35, 1.15, 2.4, 3.6],
    DELTA_D: [1.2, 0.35, 0, -0.5],  // difficulty increment per grade
    S_MIN: 0.02, S_MAX: 365,        // ~29 min … 1 year
    KNOWN_S: 180,                   // s ≥ this ⇒ state 'known'
    SPACING_GAIN: 1.0,              // a late-but-correct review earns extra
    dailyNew: 15,
    deckSize: 20,
    MAX_PER_SOURCE_RUN: 3,          // no more than N consecutive cards from one page
    KNOWN_RESURFACE_R: 0.95,
    MIX: { due: 0.7, fresh: 0.2, known: 0.1 },
  };

  function cfgOf(cfg) {
    const c = Object.assign({}, DEFAULTS, cfg || {});
    c.MIX = Object.assign({}, DEFAULTS.MIX, (cfg && cfg.MIX) || {});
    return c;
  }
  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }

  function freshSched(now) {
    return { s: 0, d: 5, lastReviewAt: now, dueAt: now, reps: 0, lapses: 0 };
  }

  // R(t) = 0.9 ^ (t / s). An item never reviewed has no retention to model — treat
  // it as fully forgotten so it sorts ahead of everything in the due queue.
  function retrievability(sched, now) {
    if (!sched || !sched.s || !sched.lastReviewAt) return 0;
    const days = Math.max(0, (now - sched.lastReviewAt) / DAY);
    return Math.pow(0.9, days / sched.s);
  }

  function nextDue(sched, cfg) {
    const c = cfgOf(cfg);
    if (!sched || !sched.s) return sched ? sched.lastReviewAt : 0;
    const factor = Math.log(c.targetR) / Math.log(0.9);
    return sched.lastReviewAt + sched.s * factor * DAY;
  }

  // grade: 0 again · 1 hard · 2 good · 3 easy
  function applyReview(sched, grade, now, cfg) {
    const c = cfgOf(cfg);
    const g = clamp(Math.round(grade), 0, 3);
    const prev = sched && sched.s ? sched : null;

    let s, d;
    if (!prev) {
      s = c.S0[g];
      // A first answer of "again" means it is hard for this user; "easy" the reverse.
      d = clamp(5 + (2 - g) * 0.9, 1, 10);
    } else {
      const R = retrievability(prev, now);
      d = clamp(prev.d + c.DELTA_D[g], 1, 10);
      if (g === 0) {
        s = prev.s * 0.35;
      } else {
        const diffMod = (11 - prev.d) / 10;            // harder items grow slower
        const spacing = 1 + (1 - R) * c.SPACING_GAIN;  // reviewing late earns more
        s = prev.s * (1 + (c.FACTOR[g] - 1) * diffMod * spacing);
      }
    }
    s = clamp(s, c.S_MIN, c.S_MAX);

    const out = {
      s, d,
      lastReviewAt: now,
      dueAt: 0,
      reps: (prev ? prev.reps : 0) + 1,
      lapses: (prev ? prev.lapses : 0) + (g === 0 ? 1 : 0),
    };
    out.dueAt = nextDue(out, c);
    return out;
  }

  // §5.1 — every grade button previews its own consequence. This runs the SAME
  // applyReview the button would run, so the label can never drift from the act:
  // preview[g] is exactly the interval the user gets by pressing g.
  function previewIntervals(sched, now, cfg) {
    const c = cfgOf(cfg);
    const out = [];
    for (let g = 0; g <= 3; g++) {
      const next = applyReview(sched, g, now, c);
      out.push(Math.max(0, next.dueAt - now));
    }
    return out;
  }

  function stateFor(item, cfg) {
    const c = cfgOf(cfg);
    if (item.state === 'muted') return 'muted';
    if (!item.sched || !item.sched.s) return item.starred ? 'learning' : (item.state || 'candidate');
    return item.sched.s >= c.KNOWN_S ? 'known' : 'learning';
  }

  // Interleave so a session is never one article read back to itself.
  //
  // The greedy "take the first card that doesn't extend the run" is not enough: it
  // drains one source faster than the other and leaves a long single-source tail
  // (8+8 cards produced a run of 6). Always drawing from the source with the MOST
  // cards remaining keeps the drain rates balanced, which is what actually bounds
  // the run. A run longer than maxRun is then only possible when a single source is
  // all that is left — at which point interleaving is impossible and dropping cards
  // would be worse.
  function spreadBySource(cards, maxRun) {
    const buckets = new Map();
    for (const c of cards) {
      const k = c.sourceId || '';
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(c);
    }
    const out = [];
    let lastSrc = null, run = 0;
    while (out.length < cards.length) {
      let best = null, bestN = -1;
      for (const [k, arr] of buckets) {
        if (!arr.length) continue;
        if (k === lastSrc && run >= maxRun) continue;
        if (arr.length > bestN) { best = k; bestN = arr.length; }
      }
      if (best === null) {
        for (const [k, arr] of buckets) if (arr.length) { best = k; break; }
        if (best === null) break;
      }
      const c = buckets.get(best).shift();
      run = best === lastSrc ? run + 1 : 1;
      lastSrc = best;
      out.push(c);
    }
    return out;
  }

  // The queue. Sorting by R ascending means "closest to being forgotten first" —
  // one continuous ranking, rather than a binary due/not-due bucket.
  //
  // `newToday` is how many brand-new cards were already introduced today, so the
  // daily cap survives across sessions. Callers that don't track it pass 0.
  function buildDeck(items, now, cfg, newToday) {
    const c = cfgOf(cfg);
    const size = c.deckSize;
    const introduced = newToday || 0;

    const learning = [], fresh = [], known = [];
    for (const it of items) {
      const st = stateFor(it, c);
      if (st === 'muted') continue;
      if (st === 'candidate') { fresh.push(it); continue; }
      const R = retrievability(it.sched, now);
      if (st === 'known') { if (R < c.KNOWN_RESURFACE_R) known.push({ it, R }); continue; }
      if (R <= c.targetR) learning.push({ it, R });
    }

    learning.sort((a, b) => a.R - b.R);
    known.sort((a, b) => a.R - b.R);
    fresh.sort((a, b) => (b.salience || 0) - (a.salience || 0));

    const nFresh = Math.min(
      fresh.length,
      Math.max(0, c.dailyNew - introduced),
      Math.round(size * c.MIX.fresh));
    const nKnown = Math.min(known.length, Math.round(size * c.MIX.known));
    const nDue = Math.min(learning.length, size - nFresh - nKnown);

    const picked = []
      .concat(learning.slice(0, nDue).map((x) => x.it))
      .concat(fresh.slice(0, nFresh))
      .concat(known.slice(0, nKnown).map((x) => x.it));

    // Backfill from whatever is left if a bucket came up short, so a user with only
    // new cards still gets a full deck.
    if (picked.length < size) {
      const taken = new Set(picked.map((x) => x.id));
      const rest = []
        .concat(learning.map((x) => x.it), fresh, known.map((x) => x.it))
        .filter((x) => !taken.has(x.id));
      for (const x of rest) {
        if (picked.length >= size) break;
        // The daily cap is a real limit, not a suggestion: never backfill with new cards.
        if (stateFor(x, c) === 'candidate') continue;
        picked.push(x);
      }
    }

    return spreadBySource(picked, c.MAX_PER_SOURCE_RUN);
  }

  // How many cards are waiting right now (for the popup / options counter).
  function dueCount(items, now, cfg) {
    const c = cfgOf(cfg);
    let n = 0;
    for (const it of items) {
      const st = stateFor(it, c);
      if (st !== 'learning') continue;
      if (retrievability(it.sched, now) <= c.targetR) n++;
    }
    return n;
  }

  return {
    DEFAULTS, DAY,
    freshSched, retrievability, nextDue, applyReview, previewIntervals, stateFor,
    buildDeck, dueCount, spreadBySource,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnScheduler;
