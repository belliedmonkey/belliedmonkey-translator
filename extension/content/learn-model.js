// learn-model.js — pure helpers for the learning layer (记忆层).
// See docs/learning-design.md §4 (model) and §6 (salience gate).
//
// PURE by construction: no DOM, no chrome.*, no ambient clock. Everything the
// caller needs to vary (now, config) is passed in. That is what makes the salience
// gate testable at all — and the gate's value is mostly NEGATIVE (things it refuses
// to capture), which is invisible unless a test can drive it directly.

var LearnModel = (() => {
  // One place for every tunable. Callers merge over this rather than passing a
  // partial literal, so a missing field can never silently read `undefined`
  // (verification-spec §3.1.1 blind spot 1).
  const DEFAULTS = {
    DWELL_MIN_MS: 2500,     // below this a segment was scrolled past, not read
    DWELL_FULL_MS: 6000,    // dwell score saturates here
    SALIENCE_MIN: 0.45,
    W: { dwell: 0.50, length: 0.28, repeat: 0.22 },
    // Script-aware length band, mirroring the segmenter's own script-aware floor.
    BAND: { dense: [8, 60], sparse: [40, 220] },
  };

  const OUTBOX_PREFIX = 'lq:';
  const OUTBOX_INDEX = 'lq:index';
  // Captures lost to outbox overflow. Law 2 lets us drop them; it does NOT let us
  // drop them without the user ever being able to find out.
  const OUTBOX_DROPPED = 'lq:dropped';
  const MAX_OUTBOX_SESSIONS = 40;

  // Dense scripts pack far more meaning per character, so they need their own band.
  const DENSE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯฀-๿]/;

  function cfgOf(cfg) {
    const c = Object.assign({}, DEFAULTS, cfg || {});
    c.W = Object.assign({}, DEFAULTS.W, (cfg && cfg.W) || {});
    c.BAND = Object.assign({}, DEFAULTS.BAND, (cfg && cfg.BAND) || {});
    return c;
  }

  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }

  function normText(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  // FNV-1a over UTF-16 code units, run twice with different offset bases and
  // concatenated → 16 hex chars. Deliberately NOT crypto.subtle: content scripts on
  // plain-http pages are not secure contexts, so SubtleCrypto is undefined there —
  // exactly the long tail of sites we care about (learning-design.md §4).
  function fnv32(str, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function hash16(s) {
    return fnv32(s, 0x811c9dc5).toString(16).padStart(8, '0')
         + fnv32(s, 0x7fffffff).toString(16).padStart(8, '0');
  }

  // Content-addressed: the same sentence met again — on another page, or on another
  // device once sync exists — collapses onto one item instead of duplicating.
  function itemId(lang, text) { return hash16(String(lang || 'und') + '\0' + normText(text)); }
  function sourceId(url) { return hash16(String(url || '')); }

  function isDense(text) { return DENSE.test(text); }

  function lengthScore(text, cfg) {
    const c = cfgOf(cfg);
    const n = normText(text).length;
    const band = isDense(text) ? c.BAND.dense : c.BAND.sparse;
    const lo = band[0], hi = band[1];
    if (n >= lo && n <= hi) return 1;
    if (n < lo) return clamp(n / lo, 0, 1);   // too short to be worth a card
    return clamp(hi / n, 0, 1);               // very long → taper, never zero
  }

  // 0..1. Deterministic, LLM-free, word-list-free, language-agnostic.
  function salience(draft, cfg) {
    const c = cfgOf(cfg);
    if (draft && draft.starred) return 1;
    // `playedThrough` IS the subtitle analogue of dwell — the playhead crossed the
    // whole sentence. Scoring it as zero dwell would put every subtitle permanently
    // below the threshold, since dwell carries half the weight: subtitles would be
    // silently uncapturable while every code path still looked correct.
    const dwell = draft.playedThrough
      ? 1
      : clamp((draft.dwellMs || 0) / c.DWELL_FULL_MS, 0, 1);
    const len = lengthScore(draft.text || '', c);
    const rep = clamp(((draft.seenCount || 1) - 1) / 3, 0, 1);
    return c.W.dwell * dwell + c.W.length * len + c.W.repeat * rep;
  }

  // The gate. Returns true only for things the user demonstrably consumed.
  // `playedThrough` is the subtitle analogue of dwell: the playhead actually
  // crossed the sentence, rather than the user seeking past it.
  function shouldCapture(draft, cfg) {
    const c = cfgOf(cfg);
    if (!draft || !normText(draft.text) || !normText(draft.tr)) return false;
    if (draft.starred) return true;
    const consumed = (draft.dwellMs || 0) >= c.DWELL_MIN_MS || !!draft.playedThrough;
    if (!consumed) return false;
    return salience(draft, c) >= c.SALIENCE_MIN;
  }

  // Build the stored shape. `now` is injected — never Date.now() in here.
  function makeItem(draft, now, cfg) {
    const text = normText(draft.text);
    const lang = draft.lang || 'und';
    return {
      id: itemId(lang, text),
      text,
      tr: normText(draft.tr),
      lang,
      targetLang: draft.targetLang || '',
      kind: draft.kind || 'sentence',
      sourceId: draft.sourceId || '',
      anchor: draft.anchor || null,
      createdAt: now,
      lastSeenAt: now,
      seenCount: draft.seenCount || 1,
      dwellMs: draft.dwellMs || 0,
      salience: Math.round(salience(draft, cfg) * 1000) / 1000,
      state: draft.starred ? 'learning' : 'candidate',
      starred: !!draft.starred,
      sched: null,   // set on first review by LearnScheduler
    };
  }

  // Merge a re-encounter into a stored item. Text/tr/anchor are IMMUTABLE — only
  // evidence-of-use accumulates. That immutability is what keeps sync conflict-free
  // later (learning-design.md §8.3).
  //
  // TWO CALLERS, TWO MEANINGS, and conflating them corrupts data:
  //
  //   a NEW OBSERVATION (the collector, `accumulate` default true) — the reader met
  //   this paragraph a second time, so dwell and count genuinely add up;
  //
  //   a COPY OF THE SAME FACT (sync replay, `accumulate: false`) — another device's
  //   record of the same encounters, or, routinely, OUR OWN chunk read back, since
  //   the pull cursor does not skip rows we wrote. Adding there inflates every
  //   accumulator on every sync round: measured live at 2× after a single replay.
  //   Sync's whole design rests on replay being idempotent (see the compaction note
  //   in sync.js), so `max` is the only merge that keeps that true.
  //
  // `sched` is merged by whichever side reviewed LAST, in both modes. It used to be
  // absent from the override list, so the stored schedule always won — meaning a card
  // reviewed on one device stayed due on the other forever. The review log synced and
  // the schedule did not, which is the one thing multi-device learning has to get
  // right. The collector's `incoming.sched` is null, so that path is unaffected.
  // `skills` merges per-key by MAX in BOTH modes (§4/§5.4): a skill verified
  // anywhere is verified everywhere, and the LATEST verification wins. Max is
  // idempotent and commutative, so replaying our own chunk cannot amplify it —
  // the same property that made the old boolean union safe to sync. Legacy `1`
  // values (pre-timestamp booleans) participate as ancient timestamps and lose
  // to any real one; non-numeric garbage counts as absent.
  function mergeSkills(a, b) {
    if (!a && !b) return undefined;
    const out = {};
    for (const src of [a, b]) {
      if (!src) continue;
      for (const k in src) {
        const v = Number(src[k]) || 0;
        if (v > (out[k] || 0)) out[k] = v;
      }
    }
    return out;
  }

  function mergeItem(existing, incoming, opts) {
    const accumulate = !opts || opts.accumulate !== false;
    const pick = accumulate
      ? (a, b) => (a || 0) + (b || 0)
      : (a, b) => Math.max(a || 0, b || 0);

    const es = existing.sched || null, is = incoming.sched || null;
    const sched = !is ? es : (!es ? is
      : ((is.lastReviewAt || 0) > (es.lastReviewAt || 0) ? is : es));
    // State follows whichever schedule won; a card the other device has graded is not
    // a candidate here any more.
    const state = (sched && sched === is && incoming.state) ? incoming.state : existing.state;
    const starred = !!(existing.starred || incoming.starred);

    const skills = mergeSkills(existing.skills, incoming.skills);

    return Object.assign({}, existing, {
      seenCount: pick(existing.seenCount || 1, incoming.seenCount || 1),
      dwellMs: pick(existing.dwellMs, incoming.dwellMs),
      lastSeenAt: Math.max(existing.lastSeenAt || 0, incoming.lastSeenAt || 0),
      salience: Math.max(existing.salience || 0, incoming.salience || 0),
      sched,
      starred,
      skills,
      state: starred ? (state === 'candidate' ? 'learning' : state) : state,
    });
  }

  // ─── §5.2 — the write tier's cloze, built from the sentence itself ────────
  //
  // PURE and DETERMINISTIC: no model, no randomness. A cloze that changes between
  // renders is untestable, and a reload would reroll an easier blank — the write
  // tier is the one objectively verified skill, so its exercise must be stable.
  //
  // Returns { parts: [{t:'text',v} | {t:'blank',answer}], blanks: n } with the
  // invariant that concatenating parts (answers included) reproduces the normalized
  // sentence EXACTLY — that is what lets the check compare against ground truth.

  const WORD_RE = /[\p{L}\p{N}''-]+/gu;

  function clozeFor(text, opts) {
    const s = normText(text);
    if (!s) return { parts: [{ t: 'text', v: '' }], blanks: 0 };
    // §5.4 — knowledge-point material: when the card carries parsed 生词/短语
    // (targets, verbatim-from-sentence by the notes contract), the blanks come
    // from THEM, rotated by `seed` (the card's reps) so every knowledge point
    // gets its turn across reviews — with zero knowledge-point bookkeeping.
    // Falls back to the classic selection when no target occurs in the sentence.
    if (opts && opts.targets && opts.targets.length) {
      const kp = clozeTargets(s, opts.targets, opts.seed || 0);
      if (kp) return kp;
    }
    return isDense(s) ? clozeDense(s) : clozeSparse(s);
  }

  // Blank ranges drawn from knowledge-point targets. Deterministic like the rest
  // of the cloze family: the same (sentence, targets, seed) always asks the same
  // question, and concatenating parts still reproduces the sentence exactly.
  function clozeTargets(s, targets, seed) {
    const lower = s.toLowerCase();
    const found = [];
    const seen = new Set();
    for (const t of targets) {
      const q = normText(t);
      if (!q) continue;
      const i = lower.indexOf(q.toLowerCase());
      if (i < 0) continue;                       // notes guarantee ≥1 hit overall, not per entry
      const key = i + ':' + q.length;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push([i, i + q.length]);
    }
    if (!found.length) return null;
    // Same blank-count band as the classic paths, capped by what actually occurs.
    const classic = isDense(s) ? clozeDense(s) : clozeSparse(s);
    const want = clamp(classic.blanks, 1, found.length);
    // Rotation: start at seed's position in the (stable, position-sorted) list
    // and walk forward, skipping overlaps — reps 0 and reps 1 blank different
    // points, and the cycle covers them all.
    const byPos = found.sort((a, b) => a[0] - b[0]);
    const start = (seed >>> 0) % byPos.length;
    const picked = [];
    for (let k = 0; k < byPos.length && picked.length < want; k++) {
      const r = byPos[(start + k) % byPos.length];
      if (picked.some(([a, e]) => r[0] < e && r[1] > a)) continue;
      picked.push(r);
    }
    return partsFrom(s, picked.sort((a, b) => a[0] - b[0]));
  }

  // Sparse scripts (word-separated): blank whole content words — longest first,
  // ties broken by position. Function words (< 4 chars) are never worth a blank.
  function clozeSparse(s) {
    const words = [];
    let m;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(s)) !== null) {
      words.push({ start: m.index, end: m.index + m[0].length, w: m[0] });
    }
    const want = clamp(1 + Math.floor(words.length / 8), 1, 3);
    const chosen = words
      .filter((x) => x.w.length >= 4)
      .sort((a, b) => (b.w.length - a.w.length) || (a.start - b.start))
      .slice(0, want)
      .sort((a, b) => a.start - b.start);
    // A sentence of nothing but short words still deserves ONE blank — take the
    // longest word there is rather than producing an exercise with nothing to do.
    if (!chosen.length && words.length) {
      chosen.push(words.slice().sort((a, b) => (b.w.length - a.w.length) || (a.start - b.start))[0]);
    }
    return partsFrom(s, chosen.map((x) => [x.start, x.end]));
  }

  // Dense scripts (CJK etc., no separators): blank 2-character runs of letter-class
  // characters, evenly spread — one per bucket, never adjacent to punctuation.
  function clozeDense(s) {
    const pos = [];
    for (let i = 0; i < s.length - 1; i++) {
      if (DENSE.test(s[i]) && DENSE.test(s[i + 1])) pos.push(i);
    }
    if (!pos.length) return clozeSparse(s);          // dense marker but no runs — fall through
    const want = clamp(1 + Math.floor(pos.length / 12), 1, 3);
    const ranges = [];
    for (let b = 0; b < want; b++) {
      const target = pos[Math.floor((b + 0.5) * pos.length / want)];
      // Skip anything overlapping an already-chosen run.
      const hit = ranges.some(([a, e]) => target < e && target + 2 > a);
      if (!hit) ranges.push([target, target + 2]);
    }
    return partsFrom(s, ranges.sort((a, b) => a[0] - b[0]));
  }

  function partsFrom(s, ranges) {
    const parts = [];
    let cur = 0;
    for (const [a, e] of ranges) {
      if (a > cur) parts.push({ t: 'text', v: s.slice(cur, a) });
      parts.push({ t: 'blank', answer: s.slice(a, e) });
      cur = e;
    }
    if (cur < s.length) parts.push({ t: 'text', v: s.slice(cur) });
    return { parts, blanks: ranges.length };
  }

  // §9.3 — the sentence's content units, as exercise material: whole words (≥ 2
  // chars) on sparse scripts, 2-character runs on dense scripts — the same split
  // clozeFor uses, exported so the exercise generators never re-invent it.
  function contentWords(text) {
    const s = normText(text);
    if (!s) return [];
    const out = [];
    if (isDense(s)) {
      for (let i = 0; i < s.length - 1; i++) {
        if (DENSE.test(s[i]) && DENSE.test(s[i + 1])) { out.push(s.slice(i, i + 2)); i++; }
      }
      if (out.length) return out;
    }
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(s)) !== null) { if (m[0].length >= 2) out.push(m[0]); }
    return out;
  }

  // §5.2 — the objective check. Case, punctuation and whitespace are typing noise,
  // not knowledge; everything else must match exactly. An empty expectation never
  // passes — a blank that accepts "" would let 检查 succeed on an untouched card.
  function clozeNorm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  }
  function clozeCheck(expected, input) {
    const e = clozeNorm(expected);
    return e.length > 0 && e === clozeNorm(input);
  }

  // When did anything about this card last move? Sync uses it to decide what to
  // upload, and `mergeBatch` stamps it into `syncedAt` on replay so that material
  // which arrived FROM the server is not immediately sent back TO it. Lives here
  // rather than in sync.js because both sides must compute it identically — two
  // copies of this three-field max is exactly how the echo would come back.
  function touchedAt(item) {
    const sched = (item && item.sched) || {};
    return Math.max(item.createdAt || 0, item.lastSeenAt || 0, sched.lastReviewAt || 0);
  }

  // ─── §4.2 sentence splitting at capture ───────────────────────────────────
  // The unit of study is the SENTENCE (learning-design §3), but the renderer hands
  // the Collector paragraphs. Split here, purely, before ids are computed.

  // Explicit \u escapes — curly vs straight quotes are indistinguishable to the
  // eye, and an invisible wrong character here silently disables a repair rule.
  // closers: ” ’ » › 」 』 ) ] "
  const STERM = /[.!?。！？…‽؟।](?=[”’»›」』)\]"]*$)/u;
  // A citation cluster AFTER the terminal also ends a sentence (`…uptake.[16][17][a]`).
  // Without this, the segment CITE_SPLIT just cut off fails the STERM check and
  // rule ② glues it straight back on (real-library regression: the espresso
  // etymology paragraph never split).
  // The cluster subpattern `(?:\[[^\[\]\s]{1,6}\])` is the canonical citation
  // shape; it also appears in CITE_SPLIT, CITE_HEAD and SOFT_SPLIT below — regex
  // literals cannot be composed (零硬编码 guard), so a cap change must edit all
  // four. `[` is excluded from the inner class on purpose: allowing it lets the
  // `+` loop restart INSIDE a unit and turns a `[.[aa]`-repeated page into a
  // quadratic scan (red-team measured 759ms at 48K chars).
  const CITE_TAIL = /[.!?。！？…‽؟।][”’»›」』)\]"]*(?:\[[^\[\]\s]{1,6}\])+$/u;
  // openers: “ ‘ 『 「 《 〈 ( [ « ‹ （ 【 "
  const OPENERS = /[“‘『「《〈(\[«‹（【"]+$/u;

  function splitSentences(text, lang) {
    const t = normText(text);
    if (!t) return [];
    let parts;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        const seg = new Intl.Segmenter(lang && lang !== 'und' ? lang : undefined, { granularity: 'sentence' });
        parts = Array.from(seg.segment(t), (x) => x.segment);
      } catch (_) { parts = null; }
    }
    if (!parts) {
      // Fallback: split after terminal(+closers) followed by whitespace.
      parts = t.split(/(?<=[.!?。！？…‽؟।][""''»›」』)\]]*)\s+/u);
    }
    // Wiki-style citation clusters glue sentences together in BOTH directions:
    // `seconds.[2] The result` may not break (or breaks INSIDE the bracket), and
    // a zh segment starting `[15] Dictionary.com…` carries the PREVIOUS
    // sentence's citation. Add a citation-aware split pass, then repair heads.
    // (regex literals, not string-built RegExps — the 零硬编码 guard exempts CJK
    // only inside regex literals, and these need CJK punctuation classes)
    const CITE_SPLIT = /(?<=[.!?。！？…][”’»›」』)\]"]*(?:\[[^\[\]\s]{1,6}\])+)\s*(?=[A-Z0-9"“‘『「《（(«一-鿿])/gu;
    const CITE_HEAD = /^\s*(?:\[[^\[\]\s]{1,6}\])+\s*/u;
    parts = parts.flatMap((p) => p.split(CITE_SPLIT));

    // Post-process the known segmenter faults (learning-design §4.2). All
    // merging operates on the RAW (untrimmed) segments and concatenates them
    // verbatim — the segmenter sometimes breaks at a NO-whitespace boundary
    // (`seconds.` | `[2] …`), so inserting even one joining space would put a
    // character into the sentence that the paragraph never had. Predicates look
    // at a trimmed view; only the final output trims.
    const out = [];   // entries: { raw, _carry?, _hand? }
    for (const part of parts) {
      let raw = part;
      if (!raw.trim()) continue;
      let prev = out.length ? out[out.length - 1] : null;
      // an orphan opener held by the previous entry (rule ③, or a segmenter cut
      // INSIDE `[2]`) reattaches to this segment FIRST — the head repair below
      // must see the reassembled bracket to route it to the right sentence.
      if (prev && prev._hand) { raw = prev._hand + raw; delete prev._hand; }
      // ⓪ a leading citation cluster belongs to the PREVIOUS sentence
      //    (`…。[15] Next`); a citations-only segment merges into it entirely.
      const head = prev && !prev._carry && raw.match(CITE_HEAD);
      if (head) {
        prev.raw += head[0].replace(/\s+$/, '');
        raw = raw.slice(head[0].length);
        if (!raw.trim()) continue;
      }
      // ① `Dr.` / `e.g.` — a SHORT whitespace-free fragment ending in '.' is
      //    abbreviation-shaped and belongs to what follows. The ≤5 cap keeps a
      //    genuine one-word sentence ('Apparently.') its own card.
      // ② a segment with no sentence terminal is a mid-token/mid-sentence cut.
      if (prev && prev._carry) { raw = prev.raw + raw; out.pop(); prev = out.length ? out[out.length - 1] : null; }
      const s = raw.trim();
      const dense = isDense(s);
      const carry = (!dense && !/\s/.test(s) && /\.$/.test(s) && s.length <= 5)
                 // German-style spaced abbreviations (`z. B.` / `d. h.`): a
                 // segment ENDING in a lone letter + '.' was cut mid-abbreviation.
                 // (Cost: a sentence genuinely ending "…plan B." merges forward —
                 // far rarer than z. B. in running German text.)
                 || (!dense && /\s[A-Za-z]\.$/.test(s))
                 || (!STERM.test(s) && !CITE_TAIL.test(s) && !OPENERS.test(s));
      // ②b a Latin segment STARTING lowercase continues the previous one
      //    (dialogue attribution: `"…?" asks Matthew.`) — merge backward.
      if (!carry && prev && !prev._carry && !dense && /^[a-z]/.test(s)) {
        prev.raw += raw;
        continue;
      }
      // ③ orphan opening quote/bracket at the tail (`他睡了。“`) is HELD and
      //    reattached to the next segment's head at the top of the next pass.
      const m = !carry && s.match(OPENERS);
      const entry = { raw, _carry: carry };
      if (m && m[0].length < s.length) {
        entry.raw = raw.replace(/[“‘『「《〈(\[«‹（【"]+\s*$/u, '');
        entry._hand = m[0];
      }
      out.push(entry);
    }
    // A trailing carry / hand never found a successor — keep it as-is.
    return out.map((e) => (e._hand ? e.raw + e._hand : e.raw).trim()).filter(Boolean);
  }

  // ─── §4.2b count reconciliation ────────────────────────────────────────────
  // When the two sides disagree by a small count, the cause is usually ONE of a
  // handful of KNOWN segmenter coin-flips, and the OTHER language's count is the
  // evidence that resolves the flip (real-library survey of every kept-whole
  // mismatch, 2026-08). Reconciliation stays inside the never-guess doctrine
  // three ways: operations happen only at these candidate boundaries (never an
  // arbitrary one), the op-subset must land counts EXACTLY equal with exactly
  // one surviving pairing, and a per-pair length-ratio guard rejects anything
  // that looks misaligned. Anything else keeps the pair whole, honestly.

  // Merge candidates — the boundary AFTER a part matching one of these:
  //  · terminal INSIDE a closing quote (`…发一次帖？”` + `这类问题的答案。`) — an
  //    embedded quoted question the zh segmenter over-eagerly ends the sentence at
  //  · a bare ellipsis tail (`…for a person ...` + `The first machines…`)
  // …unless the NEXT part opens with a quote/dash (then the break is likely real).
  const SOFT_MERGE_TAIL = /[!?。！？…][”’』」]$/u;
  const SOFT_MERGE_ELLIPSIS = /(?:\.\.\.|…)$/u;
  // same opener set as OPENERS plus dashes incl. the poor-typography ASCII `-`
  // (a dash also opens a new turn) — keep the shared characters in sync with
  // OPENERS and the rule-③ replace.
  const OPENER_HEAD = /^[“‘『「《〈(\[«‹（【"—–―-]/u;
  // Split candidates — positions INSIDE a part where the segmenter refused a
  // break it plausibly should have made (Latin terminals only — on the CJK side
  // the same evidence is ambiguous, see the doctrine note above):
  //  · before an @handle (`…lengthen. @jaminball says…`)
  //  · before a digit (`…in the blend. 2009 is one direction…`)
  //  · after a single-letter initial before a capital (`…one being Comando G. My
  //    cellar…`) — the exact ambiguity rule ①b resolves the other way
  const SOFT_SPLIT = /[.!?][”’)\]"]*(?:\[[^\[\]\s]{1,6}\])*\s+(?=@[A-Za-z0-9_]|\d)|\s[A-Za-z]\.\s+(?=[A-Z“"])/gu;

  // Parts are NEARLY always verbatim slices of the normalized whole (splitSentences
  // trims and re-concatenates raw segments) — merges/splits below are done by
  // SLICING the whole, so a joining character can never be invented. The one known
  // exception: rule ③'s hand reattachment drops the whitespace between an orphan
  // opener and its next segment; offsetsOf then fails to locate the part and
  // reconciliation bails to keep-whole — the safe direction.
  function offsetsOf(parts, whole) {
    const res = []; let cur = 0;
    for (const p of parts) {
      const i = whole.indexOf(p, cur);
      if (i < 0) return null;
      res.push([i, i + p.length]); cur = i + p.length;
    }
    return res;
  }

  function mergeCandidatesOf(parts) {
    const out = [];
    for (let i = 0; i + 1 < parts.length; i++) {
      if (OPENER_HEAD.test(parts[i + 1])) continue;
      // Quote-terminal candidates additionally require the continuation NOT to
      // start with an uppercase letter: in a bicameral script, `?” He said` is
      // a normally-cased REAL sentence break (the observed segmenter coin-flip
      // is the CJK `？”这类` continuation, which has no case). Without this,
      // an incidental `?”` boundary can bridge a translator-restructured gap
      // (the reviewers' poison family). Ellipsis candidates stay case-blind —
      // `... The first machines` is a real corpus win — and rely on the
      // internal-ellipsis corroboration instead.
      if (SOFT_MERGE_TAIL.test(parts[i]) && !/^\p{Lu}/u.test(parts[i + 1])) out.push(i);
      else if (SOFT_MERGE_ELLIPSIS.test(parts[i])) out.push(i);
    }
    return out;
  }

  function splitCandidatesOf(parts, offsets) {
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      for (const m of parts[i].matchAll(SOFT_SPLIT)) {
        out.push(offsets[i][0] + m.index + m[0].length); // global cut position
      }
    }
    return out;
  }

  // Apply a chosen op-subset: drop the cuts being merged over, add the new split
  // cuts, re-slice the whole. Returns trimmed parts.
  function resegment(whole, offsets, mergeSet, splitPts) {
    const cuts = [];
    for (let i = 0; i + 1 < offsets.length; i++) {
      if (!mergeSet.has(i)) cuts.push([offsets[i][1], offsets[i + 1][0]]);
    }
    for (const p of splitPts) cuts.push([p, p]);
    cuts.sort((x, y) => x[0] - y[0]);
    const parts = []; let cur = 0;
    for (const [from, to] of cuts) {
      parts.push(whole.slice(cur, from).trim());
      cur = to;
    }
    parts.push(whole.slice(cur).trim());
    return parts.filter(Boolean);
  }

  function subsetsOf(arr, k) {
    if (k === 0) return [[]];
    if (k > arr.length) return [];
    const out = [];
    const rec = (start, acc) => {
      if (acc.length === k) { out.push(acc.slice()); return; }
      for (let i = start; i <= arr.length - (k - acc.length); i++) {
        acc.push(arr[i]); rec(i + 1, acc); acc.pop();
      }
    };
    rec(0, []);
    return out;
  }

  // ─── op corroboration (cross-side evidence) ────────────────────────────────
  // A candidate op explains the count gap only if its footprint shows on BOTH
  // sides of the pairing it produces. Three independent adversarial reviews
  // (2026-08-15) each constructed a natural paragraph where translator
  // restructuring at a NON-candidate boundary was "uniquely" bridged by an
  // incidental candidate elsewhere — a wrong-but-unique pairing that passed the
  // ratio guard. Literal cross-lingual anchors (@handles, digit runs,
  // untranslated names) and same-shape punctuation echoes are evidence the op
  // is the true cause of the mismatch; their absence keeps the pair whole.
  function mergeCorroborated(tail, counterpart) {
    const m = tail.match(/([!?。！？…])[”’』」]$/u);
    if (m) {
      // quote-terminal merge: the counterpart must contain the SAME terminal
      // class inside a closing quote (`？”` ↔ `?”`; a `。”` does not vouch for
      // a `？”` — that mismatch was exactly the reviewers' poison case).
      const t = m[1];
      const cls = /[?？]/.test(t) ? /[?？](?=[”’』」"])/u
                : /[!！]/.test(t) ? /[!！](?=[”’』」"])/u
                : /[.。]/.test(t) ? /[.。](?=[”’』」"])/u
                : /…(?=[”’』」"])/u;
      return cls.test(counterpart);
    }
    // ellipsis merge: the counterpart must run the sentences together too — an
    // INTERNAL ellipsis. A sentence that merely ENDS with one proves nothing.
    for (const em of counterpart.matchAll(/(\.\.\.|…+)/gu)) {
      if (em.index > 0 && em.index + em[0].length < counterpart.length) return true;
    }
    return false;
  }
  // A merge candidate's punctuation evidence is not positional — an incidental
  // `？”`/`...` elsewhere in the paragraph can bridge a gap whose true cause is
  // translator restructuring at a NON-candidate boundary (three generations of
  // reviewer poison constructions, each passing echo corroboration + the ratio
  // guard). The separator that held on every real win vs every poison: in a
  // TRUE over-split the candidate boundary is the strictly BEST-fitting single
  // merge under the pair-ratio metric (real wins 1.05–1.60 at the candidate,
  // alternatives worse); in a poison the true, non-candidate boundary fits
  // better (1.04–1.16 vs the candidate's 1.42–1.59). So merges fly solo (only
  // in need=1 reconciliations) and must dominate EVERY alternative position.
  function mergeDominates(i, longP, longOff, shortP, longIsA, wholeA, wholeB) {
    const R = (wholeB.length + 20) / (wholeA.length + 20);
    const devFor = (x) => {
      let mx = 0;
      for (let s = 0; s < shortP.length; s++) {
        const ll = s < x ? longP[s].length
                 : s === x ? (longOff[x + 1][1] - longOff[x][0])
                 : longP[s + 1].length;
        const [al, bl] = longIsA ? [ll, shortP[s].length] : [shortP[s].length, ll];
        const r = ((bl + 8) / (al + 8)) / R;
        mx = Math.max(mx, r, 1 / r);
      }
      return mx;
    };
    const mine = devFor(i);
    for (let x = 0; x + 1 < longP.length; x++) {
      if (x !== i && devFor(x) <= mine) return false;
    }
    return true;
  }

  function splitCorroborated(shortW, p, before, after) {
    const at = shortW.slice(p);
    let m = at.match(/^@[A-Za-z0-9_]+/);
    if (m) return after.includes(m[0]);      // the handle survives translation
    m = at.match(/^\d+/);
    if (m) return after.includes(m[0]);      // so does the digit run (750/2009)
    m = shortW.slice(0, p).match(/(\S+)\s+[A-Za-z]\.\s*$/u);
    if (m) return before.includes(m[1]);     // initial split: `Comando G.` — the
    return false;                            // preceding name anchors the cut
  }

  // Per-pair length-ratio guard: in a correctly aligned pair, tr/text length
  // ratios cluster around the paragraph's own global ratio; an off-by-one
  // misalignment throws at least one pair far off it. Band calibrated on the
  // real library's 1300+ known-good sentence pairs (max observed deviation 2.37×,
  // a legitimately short `Why didn’t I?`; smoothing constants damp that noise).
  const RATIO_BAND = 3.2;
  function ratioGuardOk(as, bs, wholeA, wholeB) {
    const R = (wholeB.length + 20) / (wholeA.length + 20);
    for (let i = 0; i < as.length; i++) {
      const r = ((bs[i].length + 8) / (as[i].length + 8)) / R;
      if (r > RATIO_BAND || r < 1 / RATIO_BAND) return false;
    }
    return true;
  }

  // Beyond a 3-count gap the pair is translator restructuring, not segmenter
  // noise — every real-library coin-flip case was off by 1 or 2.
  const MAX_RECONCILE_DIFF = 3;
  function reconcile(a, b, wholeA, wholeB) {
    const diff = a.length - b.length;
    if (diff === 0 || Math.abs(diff) > MAX_RECONCILE_DIFF) return null;
    // longer side offers merges, shorter side offers splits
    const [longP, longW, shortP, shortW] = diff > 0 ? [a, wholeA, b, wholeB] : [b, wholeB, a, wholeA];
    const longOff = offsetsOf(longP, longW);
    const shortOff = offsetsOf(shortP, shortW);
    if (!longOff || !shortOff) return null;
    const merges = mergeCandidatesOf(longP);
    const splits = splitCandidatesOf(shortP, shortOff);
    // more than a few candidates means the paragraph is genuinely ambiguous
    if (merges.length > 4 || splits.length > 4) return null;
    const need = Math.abs(diff);
    // original short-side boundary positions — index math for split ops below
    const origFroms = shortOff.slice(0, -1).map((o) => o[1]);
    const seen = new Set(); let winner = null;
    for (let j = Math.min(need, merges.length); j >= 0; j--) {
      const k = need - j;
      if (j > 0 && need > 1) continue; // merges fly solo — see mergeDominates
      for (const ms of subsetsOf(merges, j)) {
        const L = resegment(longW, longOff, new Set(ms), []); // depends on ms only
        if (L.length !== longP.length - ms.length) continue;  // a slice trimmed empty — index math off, bail
        for (const ss of subsetsOf(splits, k)) {
          const S = resegment(shortW, shortOff, new Set(), ss);
          if (S.length !== shortP.length + ss.length) continue;
          if (L.length !== S.length || L.length < 2) continue;
          // every op must be corroborated by the pairing it produces
          let ok = true;
          for (const i of ms) {
            const q = i - ms.filter((x) => x < i).length;   // merged part's index in L
            if (!mergeCorroborated(longP[i], S[q])
                || !mergeDominates(i, longP, longOff, shortP, diff > 0, wholeA, wholeB)) { ok = false; break; }
          }
          if (ok) for (const p of ss) {
            const q1 = 1 + origFroms.filter((f) => f < p).length
                         + ss.filter((x) => x < p).length;  // part starting at p
            if (!splitCorroborated(shortW, p, L[q1 - 1], L[q1])) { ok = false; break; }
          }
          if (!ok) continue;
          const [as, bs] = diff > 0 ? [L, S] : [S, L];
          if (!ratioGuardOk(as, bs, wholeA, wholeB)) continue;
          const key = JSON.stringify([as, bs]);
          if (!seen.has(key)) { seen.add(key); winner = { as, bs }; }
          if (seen.size > 1) return null; // two survivors — already ambiguous
        }
      }
    }
    // exactly ONE surviving pairing, or nothing — two different survivors means
    // the count evidence cannot tell them apart, and picking one would be a guess
    return seen.size === 1 ? winner : null;
  }

  // ─── §4.2c externally-adjudicated grouping ────────────────────────────────
  // Applies a sentence grouping PROPOSED from outside (the LLM adjudicator in
  // learn/align.js). The proposal is data, not authority: both sides must
  // partition their sentence indices IN ORDER into the same number of groups,
  // pairs are built by SLICING the normalized paragraph (verbatim — the
  // proposer can group, never rewrite), and the result must pass the same
  // ratio guard as §4.2b. Anything else → null, caller keeps the pair whole.
  function alignByGroups(text, tr, lang, targetLang, groups) {
    const wholeA = normText(text);
    const wholeB = normText(tr);
    const a = splitSentences(text, lang);
    const b = splitSentences(tr, targetLang);
    const ga = groups && groups.a;
    const gb = groups && groups.b;
    const okPart = (g, n) => Array.isArray(g) && g.length >= 2
      && g.every((x) => Array.isArray(x) && x.length >= 1)
      && g.flat().length === n && g.flat().every((v, i) => v === i);
    if (!okPart(ga, a.length) || !okPart(gb, b.length) || ga.length !== gb.length) return null;
    const offA = offsetsOf(a, wholeA);
    const offB = offsetsOf(b, wholeB);
    if (!offA || !offB) return null;
    const cut = (whole, off, g) => g.map((idx) =>
      whole.slice(off[idx[0]][0], off[idx[idx.length - 1]][1]).trim());
    const as = cut(wholeA, offA, ga);
    const bs = cut(wholeB, offB, gb);
    if (!ratioGuardOk(as, bs, wholeA, wholeB)) return null;
    const pairs = [];
    for (let i = 0; i < as.length; i++) {
      if (!as[i] || !bs[i]) return null;
      pairs.push({ text: as[i], tr: bs[i] });
    }
    return pairs;
  }

  // Pair source/translation sentence-by-sentence — by COUNT EQUALITY only.
  // A count mismatch first gets ONE bounded reconciliation attempt (§4.2b above);
  // failing that the pair returns WHOLE: a long card is a nuisance, a misaligned
  // immutable (text, tr) is permanent corpus corruption. Never guess.
  // No sane card comes from a paragraph this long, and the citation regexes are
  // super-linear on pathological no-whitespace runs (red-team, 2026-08-15) —
  // cap the input before any regex touches it.
  const MAX_SPLIT_INPUT = 10000;
  function splitPair(text, tr, lang, targetLang) {
    const wholeA = normText(text);
    const wholeB = normText(tr);
    const whole = [{ text: wholeA, tr: wholeB }];
    if (wholeA.length > MAX_SPLIT_INPUT || wholeB.length > MAX_SPLIT_INPUT) return whole;
    let a = splitSentences(text, lang);
    let b = splitSentences(tr, targetLang);
    if (a.length !== b.length) {
      const fixed = reconcile(a, b, wholeA, wholeB);
      if (!fixed) return whole;
      a = fixed.as; b = fixed.bs;
    }
    if (a.length < 2) return whole;
    // Equal counts can still be a coincidence of translator restructuring — the
    // same ratio guard that protects reconciled pairings protects the fast path
    // (0 rejections across the 1300+-pair calibration library).
    if (!ratioGuardOk(a, b, wholeA, wholeB)) return whole;
    const pairs = [];
    for (let i = 0; i < a.length; i++) {
      if (!a[i] || !b[i]) return whole;
      pairs.push({ text: a[i], tr: b[i] });
    }
    return pairs;
  }

  return {
    DEFAULTS, OUTBOX_PREFIX, OUTBOX_INDEX, OUTBOX_DROPPED, MAX_OUTBOX_SESSIONS,
    normText, hash16, itemId, sourceId, isDense, lengthScore,
    salience, shouldCapture, makeItem, mergeItem, mergeSkills, touchedAt,
    clozeFor, clozeCheck, contentWords, splitSentences, splitPair, alignByGroups,
    MAX_SPLIT_INPUT,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnModel;
