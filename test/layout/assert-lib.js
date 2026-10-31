// assert-lib.js — IN-PAGE assertion library for the layout regression suite.
// NOT a Node module: run-layout.js reads this file as text and evaluates it in
// the extension's ISOLATED world (so it can see node.__mtTrans / __mtLayoutCss
// and the real geometry). Everything lives under window.__mtLayout.
//
// Vocabulary (manifest `#mt-expect` JSON):
//   unitCount   — expected number of .mt-translation nodes once stable
//   targets     — [{ sel, card?, assert: ["name" | "name:arg"] }]
//   mutations   — parents the renderer is EXPECTED to mutate:
//                 [{ sel, prop, to, marker }]  (absence of the mutation = FAIL)
//   skipUniversal — { invariantName: [selector, ...] } opt-outs
//   rerender    — true → runner re-runs asserts after a settings-change re-render
//   resize      — { width, height, mobile?, settleMs? } → runner changes the
//                 viewport mid-fixture, re-baselines, and re-runs the asserts
//   resizeManifest — manifest fields to OVERRIDE for that post-resize pass
//                 (e.g. `mutations: []` once a media query flipped the row away)
(() => {
  'use strict';

  const TOL = 2; // default px tolerance

  const rectOf = (el) => el.getBoundingClientRect();
  const csOf = (el) => getComputedStyle(el);
  const PARENT_PROPS = ['display', 'flexDirection', 'flexWrap', 'gridTemplateColumns', 'textAlign'];

  function transOf(node) {
    if (node.__mtTrans && node.__mtTrans.isConnected) return node.__mtTrans;
    const s = node.nextElementSibling;
    return (s && s.classList && s.classList.contains('mt-translation')) ? s : null;
  }

  // Content box of an element (border + padding excluded) — the frame the
  // renderer's layoutCss mirrors against.
  function contentBox(el) {
    const r = rectOf(el);
    const cs = csOf(el);
    const left = r.left + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
    const right = r.right - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderRightWidth) || 0);
    return { left, right, width: right - left };
  }

  const baseline = new Map(); // element -> { rect, props }
  let baselineScrollWidth = 0;

  // keepScrollWidth defaults to true (the pre-enable capture: the page's own
  // natural scrollWidth is the honest cap). The runner passes `false` when
  // re-baselining AFTER a mid-fixture resize — at that moment a stale, too-wide
  // translation may itself be causing overflow, and baking it into the cap would
  // turn noHorizontalOverflow vacuously green for exactly the bug under test.
  function captureBaseline(keepScrollWidth) {
    baseline.clear();
    for (const el of document.body.querySelectorAll('*')) {
      const r = rectOf(el);
      const cs = csOf(el);
      const props = {};
      for (const p of PARENT_PROPS) props[p] = cs[p];
      baseline.set(el, { rect: { left: r.left, width: r.width, top: r.top, bottom: r.bottom }, props });
    }
    baselineScrollWidth = (keepScrollWidth === false) ? 0 : document.scrollingElement.scrollWidth;
    return baseline.size;
  }

  // ─── Named per-target assertions ─────────────────────────────────────
  // Each: (node, trans, arg, ctx) => true | failure-detail-string
  const ASSERTS = {
    // 参照系随放置方式走。译文挂在原文**里面**时（2026-08-23 起的默认），它贴的是原文
    // 的**内容盒**；拿边框盒去比，原文只要有 padding 就必然差一个 padding 值 —— 那不是
    // 对不齐，是量错了地方（fixture 31 的 15px 就是它的 padding-left）。不变量没变：
    // 译文和原文的正文边缘对齐。
    sameLeft(node, trans, arg) {
      const tol = parseFloat(arg) || TOL;
      const d = Math.abs(rectOf(trans).left - (node.contains(trans) ? contentBox(node).left : rectOf(node).left));
      return d <= tol || `trans.left off by ${d.toFixed(1)}px (tol ${tol})`;
    },
    sameWidth(node, trans, arg) {
      const tol = parseFloat(arg) || TOL;
      const d = Math.abs(rectOf(trans).width - (node.contains(trans) ? contentBox(node).width : rectOf(node).width));
      return d <= tol || `trans.width off by ${d.toFixed(1)}px (tol ${tol})`;
    },
    // 契约是**用出来的宽度不超过原文**；`max-width` 只是兄弟放置达成它的手段。译文挂进
    // 原文之后手段消失了 —— 它就在原文的盒子里，宽度上界是结构给的，不是声明给的。所以
    // 那个 px 上限只在兄弟放置时要求；两种放置都验最终宽度，那一条才是人能看见的东西。
    maxWidthLE(node, trans) {
      const ow = baseline.get(node) ? baseline.get(node).rect.width : rectOf(node).width;
      const used = rectOf(trans).width;
      if (!node.contains(trans)) {
        const mw = csOf(trans).maxWidth;
        if (mw === 'none') return 'translation has no max-width';
        // Units matter: parseFloat('100%') is 100 and would compare as "100px" — the
        // exact vacuous-green this assertion exists to catch. Require a px cap AND
        // verify the USED width (the observable contract) against the original.
        if (!/px$/.test(mw)) return `max-width "${mw}" is not a px cap`;
        if (parseFloat(mw) > ow + 2) return `max-width ${mw} exceeds original width ${ow}px`;
      }
      return used <= ow + 2 || `used width ${used.toFixed(1)} exceeds original width ${ow}px`;
    },
    sameRight(node, trans, arg) {
      const tol = parseFloat(arg) || TOL;
      const d = Math.abs(rectOf(trans).right - (node.contains(trans) ? contentBox(node).right : rectOf(node).right));
      return d <= tol || `trans.right off by ${d.toFixed(1)}px (tol ${tol})`;
    },
    centeredInParent(node, trans, arg) {
      const tol = parseFloat(arg) || 3;
      const cb = contentBox(trans.parentElement);
      const r = rectOf(trans);
      const gapL = r.left - cb.left, gapR = cb.right - r.right;
      return Math.abs(gapL - gapR) <= tol || `gaps L=${gapL.toFixed(1)} R=${gapR.toFixed(1)} differ > ${tol}`;
    },
    textAlignCopied(node, trans, arg) {
      const got = csOf(trans).textAlign;
      return got === arg || `text-align "${got}" != expected "${arg}"`;
    },
    ownRow(node, trans) {
      // Nothing may sit BESIDE the translation (it must occupy its own full row;
      // in a wrapped flex row originals legitimately continue BELOW it).
      const t = rectOf(trans);
      for (const sib of trans.parentElement.children) {
        if (sib === trans) continue;
        const s = rectOf(sib);
        if (s.height < 1 || s.width < 1) continue;
        const overlapY = Math.min(t.bottom, s.bottom) - Math.max(t.top, s.top);
        if (overlapY > 2) return `<${sib.tagName.toLowerCase()}.${sib.className}> sits beside the translation (y-overlap ${overlapY.toFixed(0)}px)`;
      }
      return true;
    },
    fullRowWidth(node, trans, arg) {
      const tol = parseFloat(arg) || 4;
      const cb = contentBox(trans.parentElement);
      const w = rectOf(trans).width;
      return w >= cb.width - tol || `trans width ${w.toFixed(1)} < parent content ${cb.width.toFixed(1)} - ${tol}`;
    },
    gridSpansAllColumns(node, trans, arg) { return ASSERTS.fullRowWidth(node, trans, arg); },
    noOverlapWithSiblings(node, trans) {
      const kids = [...trans.parentElement.children];
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = rectOf(kids[i]), b = rectOf(kids[j]);
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 1 && oy > 1) return `<${kids[i].tagName}#${i}> overlaps <${kids[j].tagName}#${j}> by ${ox.toFixed(0)}x${oy.toFixed(0)}px`;
        }
      }
      return true;
    },
    withinCardBounds(node, trans, arg, ctx) {
      const tol = parseFloat(arg) || 2;
      const card = ctx.card ? node.closest(ctx.card) : trans.parentElement;
      if (!card) return `card selector "${ctx.card}" matches nothing above node`;
      const c = rectOf(card), r = rectOf(trans);
      return (r.left >= c.left - tol && r.right <= c.right + tol)
        || `trans [${r.left.toFixed(0)},${r.right.toFixed(0)}] outside card [${c.left.toFixed(0)},${c.right.toFixed(0)}]`;
    },
    parentNotMutated(node, trans) {
      const p = node.parentElement;
      if (p.hasAttribute('data-mt-flow-fix')) return 'parent carries data-mt-flow-fix (unexpected mutation)';
      const base = baseline.get(p);
      if (base && csOf(p).flexWrap !== base.props.flexWrap) {
        return `parent flex-wrap changed ${base.props.flexWrap} -> ${csOf(p).flexWrap}`;
      }
      return true;
    },
    leftGapPreserved(node, trans, arg) {
      const tol = parseFloat(arg) || 3;
      const cb = contentBox(node.parentElement);
      const base = baseline.get(node);
      const origGap = (base ? base.rect.left : rectOf(node).left) - cb.left;
      const transGap = rectOf(trans).left - cb.left;
      const d = Math.abs(transGap - origGap);
      return d <= tol || `trans left-gap ${transGap.toFixed(1)} vs original ${origGap.toFixed(1)} (tol ${tol})`;
    },
    holderReplacesOriginal(node, trans) {
      if (!node.hasAttribute('data-mt-hidden')) return 'original not marked data-mt-hidden';
      if (csOf(node).display !== 'none') return 'original still visible';
      if (trans.dataset.interleave !== '1') return 'sibling is not an interleave holder';
      if (trans.children.length < 4) return `holder has ${trans.children.length} rows, expected >= 4 (2 paragraph pairs)`;
      return true;
    },
    // The flex-row flow fix (`flex-basis:100%`) must not survive onto a container
    // that a media query has since flipped to `column` — there `basis` means
    // HEIGHT, so a stranded 100% stretches the translation over the whole column.
    flexBasisAuto(node, trans) {
      const b = csOf(trans).flexBasis;
      return b === 'auto' || `translation still carries flex-basis:${b} (stranded row fix)`;
    },
    // Geometry check for the INTERLEAVE holder, whose original is display:none —
    // its baseline rect is 0×0, so maxWidthLE/sameWidth can't be used. Briefly
    // restore the original's display to read its real flow geometry and compare.
    // Synchronous (unhide → measure → re-hide inside one task), so nothing paints.
    hiddenOriginalMirrored(node, trans, arg) {
      const tol = parseFloat(arg) || 3;
      const prev = node.style.display;
      node.style.display = '';
      const r = rectOf(node);           // forced layout: original back in flow
      node.style.display = prev;
      const t = rectOf(trans);          // forced layout again: original hidden as before
      const dl = Math.abs(t.left - r.left), dw = Math.abs(t.width - r.width);
      return (dl <= tol && dw <= tol)
        || `holder [left ${t.left.toFixed(1)} w ${t.width.toFixed(1)}] vs original [left ${r.left.toFixed(1)} w ${r.width.toFixed(1)}]`;
    },
    // Text already in the target language must render NOTHING — not a duplicate, not a
    // placeholder, not an error chip. Checks both sides, since placement follows visual
    // order, and `__mtTrans` too, in case a holder exists but was moved.
    noTranslationSibling(node) {
      if (node.__mtTrans && node.__mtTrans.isConnected) {
        return `node kept a translation holder: "${node.__mtTrans.textContent.slice(0, 40)}"`;
      }
      for (const sib of [node.previousElementSibling, node.nextElementSibling]) {
        if (sib && sib.classList && sib.classList.contains('mt-translation')) {
          return `adjacent .mt-translation exists: "${sib.textContent.slice(0, 40)}"`;
        }
      }
      return true;
    },
    // The spec rule is "never a whole block of originals followed by a whole block of
    // translations" — a PAIRING property, which no geometry assertion can see. The
    // holder's rows must alternate original / translation / original / translation.
    // Rows are classified by COLOUR, not by the canned 【译】 marker: the harness's
    // fake translator prefixes the marker per blank-line paragraph, so line-wise
    // slices would not each carry one. Colour is the renderer's own signal (original
    // rows take the source colour, translation rows take the configured one) and it
    // checks the styling at the same time. `minRows` guards against a vacuous pass.
    interleaveAlternates(node, trans, arg) {
      if (trans.dataset.interleave !== '1') return 'sibling is not an interleave holder';
      const rows = [...trans.children];
      const minRows = parseFloat(arg) || 4;
      if (rows.length < minRows) return `holder has ${rows.length} rows, expected >= ${minRows}`;
      const origColor = csOf(node).color;
      const colors = rows.map((r) => csOf(r).color);
      if (colors.every((c) => c === colors[0])) {
        return `every row is ${colors[0]} — original and translation are indistinguishable`;
      }
      const kind = colors.map((c) => (c === origColor ? 'O' : 'T'));
      // Each translation must sit directly under ITS OWN original. A same-language slice
      // draws no translation row at all, so an unpaired O is legitimate and the sequence
      // is not strictly O/T/O/T — but a T may never lead, and two T in a row still means
      // the block was split into all-originals-then-all-translations.
      const seq = kind.join('');
      if (kind[0] === 'T') return `row order ${seq} starts with a translation`;
      const dbl = seq.indexOf('TT');
      if (dbl >= 0) return `row order ${seq} has adjacent translations at ${dbl} — rows are not interleaved`;
      return true;
    },
    // No row may repeat the row above it. A slice whose "translation" came back as the
    // original text is not a translation — showing it doubles the line for the reader.
    // Spacing adjacent to a CJK character is typography, not language — a provider that
    // hands the line back re-typeset ("一个 Obsidian 文档" → "一个Obsidian文档") has still
    // said nothing new, and drawing it doubles the line for the reader. So compare with
    // that spacing ignored; raw equality alone missed this on macOS Safari.
    noDuplicateRow(node, trans) {
      if (trans.dataset.interleave !== '1') return 'sibling is not an interleave holder';
      const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}';
      const norm = (s) => s.replace(/\s+/g, ' ')
        .replace(new RegExp(`\\s+(?=[${CJK}])`, 'gu'), '')
        .replace(new RegExp(`([${CJK}])\\s+`, 'gu'), '$1').trim();
      const rows = [...trans.children].map((r) => norm(r.textContent));
      for (let i = 1; i < rows.length; i++) {
        if (rows[i] && rows[i] === rows[i - 1]) return `row ${i} repeats row ${i - 1}: "${rows[i]}"`;
      }
      return true;
    },
    // The interleave holder re-draws the ORIGINAL paragraphs itself. The holder is a
    // .mt-translation element, which carries the translation colour — so an original
    // row that sets no colour of its own inherits it and the bilingual pair becomes
    // one solid colour, breaking the one property interaction-spec keeps distinct.
    interleaveRowColors(node, trans) {
      if (trans.dataset.interleave !== '1') return 'sibling is not an interleave holder';
      const rows = [...trans.children];
      if (rows.length < 2) return `holder has ${rows.length} rows, expected >= 2`;
      const want = csOf(node).color;              // the hidden original's own colour
      const gotOrig = csOf(rows[0]).color;
      const gotTrans = csOf(rows[1]).color;
      if (gotOrig !== want) return `original row is ${gotOrig}, original element is ${want}`;
      if (gotTrans === gotOrig) return `translation row shares the original colour ${gotTrans}`;
      return true;
    },
    cachedLayoutCss(node, trans, arg) {
      const v = node.__mtLayoutCss || '';
      return new RegExp(arg).test(v) || `__mtLayoutCss "${v}" !~ /${arg}/`;
    },
    translationMarked(node, trans) {
      return trans.textContent.includes('【译】') || 'translation text lacks the 【译】 marker';
    },
    // Interaction rule (interaction-spec): a blob containing interactive or
    // non-text content must NOT interleave — the redraw is plain text and the
    // original is hidden, so its links/buttons/media would die. The fallback
    // shape is the plain sibling: original visible, sibling not a holder.
    siblingNotInterleaved(node, trans) {
      if (node.hasAttribute('data-mt-hidden')) return 'original is data-mt-hidden (interleaved)';
      if (csOf(node).display === 'none') return 'original is display:none';
      if (trans.dataset.interleave === '1') return 'sibling is an interleave holder';
      return true;
    },
    // Timestamp→seek anchors are a YouTube-only feature: on any other host a
    // translation must contain no <a> at all (bare-URL linkification would also
    // fail this — the target text must therefore carry no URLs).
    noAnchorsInTranslation(node, trans) {
      const a = trans.querySelector('a');
      return !a || `translation contains <a> "${a.textContent.slice(0, 20)}"`;
    },
    // The data-mt-hidden attribute VALUE carries the page's prior inline
    // `display` ('1' = none). Asserting it equals the fixture's inline value
    // proves the record-and-restore contract across the phases that re-run it:
    // after the RERENDER phase (disable→enable), the value re-recorded from
    // the RESTORED inline style is only correct if disable put the original
    // back; after the RESIZE phase, invalidateGeometry re-renders the unit
    // WHILE HIDDEN — that is the double-hide that would clobber the record
    // with 'none' without hideOriginal's hasAttribute guard (verified
    // empirically: removing the guard reds THIS assert in the resize phase,
    // not at base settle — base-settle renders hide only once).
    hiddenAttrEquals(node, trans, arg) {
      const v = node.getAttribute('data-mt-hidden');
      return v === arg || `data-mt-hidden="${v}", expected "${arg}"`;
    },
    // A page that scrolls ITSELF (no native scrolling anywhere) measures the content
    // ONCE, writes that number as an inline pixel height onto a sizer, and moves the
    // content with `transform` — its travel limit comes from that recorded number and
    // nothing else. Insert translations and the tail becomes unreachable: no
    // scrollbar, no error, the page just stops. Real iPhone, Gmail's mobile web
    // client, 2026-08-30: 9356px of content behind a 6363px record, 2993px lost, while
    // document.scrollingElement.scrollHeight stayed pinned at innerHeight throughout —
    // which is why no scrollHeight-based assertion anywhere else in this corpus can
    // see it. `arg` is the sizer's selector.
    scrollerReconciled(node, trans, arg) {
      const box = document.querySelector(arg);
      if (!box) return `no sizer matched "${arg}"`;
      const short = box.scrollHeight - box.clientHeight;
      if (short <= 4) return true;
      return `sizer "${arg}" records ${box.clientHeight}px but holds ${box.scrollHeight}px`
        + ` — ${short}px of content cannot be reached`;
    },
  };

  // Assertions whose subject is the ABSENCE of a translation — they must still run
  // when there is no sibling, so they bypass the generic targetHasTranslation guard.
  const ABSENCE_ASSERTS = new Set(['noTranslationSibling']);

  // ─── Universal invariants (every unit, every fixture) ────────────────
  function skipped(manifest, name, node) {
    const sels = (manifest.skipUniversal || {})[name];
    return !!sels && sels.some((s) => s === '*' || node.matches(s));
  }

  function runAsserts(manifest) {
    const failures = [];
    const fail = (name, sel, detail) => failures.push({ name, sel, detail });
    const units = [...document.querySelectorAll('[data-mt-processed]')]
      .filter((n) => !n.classList.contains('mt-translation'));

    // universals
    for (const node of units) {
      const sel = `${node.tagName.toLowerCase()}#${node.id || node.className || '?'}`;
      const trans = transOf(node);
      if (!skipped(manifest, 'translationVisible', node)) {
        if (!trans) { fail('translationVisible', sel, 'no sibling .mt-translation'); continue; }
        const r = rectOf(trans);
        if (csOf(trans).display === 'none' || r.width < 1 || r.height < 1) {
          fail('translationVisible', sel, `display=${csOf(trans).display} rect=${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
        }
      }
      if (!trans) continue;
      // Universal CONTENT check: a pending/error placeholder is also a counted
      // .mt-translation sibling with the same geometry CSS — without this, a broken
      // fetch intercept turns every geometry fixture vacuously green. The canned
      // runner responses always carry the 【译】 marker. (Error-path fixtures opt
      // out via skipUniversal.translationContent.)
      if (!skipped(manifest, 'translationContent', node)) {
        if (!trans.textContent.includes('【译】')) {
          fail('translationContent', sel, `not a real translation: "${trans.textContent.slice(0, 40)}"`);
        }
      }
      if (!skipped(manifest, 'belowOriginal', node)) {
        // A table cell takes its translation as a CHILD, because a sibling inside the
        // <tr> would become an extra table column (issue #59). "Below" then cannot be
        // measured against the original's own box — that box now CONTAINS the
        // translation, so the naive check is true by construction and the invariant
        // would silently stop testing anything. Measure against the original content
        // that precedes the translation instead.
        let refBottom;
        if (node.contains(trans)) {
          const r = document.createRange();
          r.selectNodeContents(node);
          r.setEndBefore(trans);
          const rr = r.getBoundingClientRect();
          refBottom = rr.height ? rr.bottom : rectOf(node).top;
        } else {
          refBottom = rectOf(node).bottom;
        }
        if (rectOf(trans).top < refBottom - 1) {
          fail('belowOriginal', sel, `trans.top ${rectOf(trans).top.toFixed(1)} < original content bottom ${refBottom.toFixed(1)}`);
        }
      }
      if (!skipped(manifest, 'originalGeometryStable', node)) {
        const base = baseline.get(node);
        if (base) {
          const r = rectOf(node);
          // A declared parent mutation (flex-row nowrap->wrap) legitimately moves
          // the original onto a new row — then only its WIDTH must survive.
          const parentMutated = (manifest.mutations || []).some((m) => node.parentElement.matches(m.sel));
          const leftMoved = !parentMutated && Math.abs(r.left - base.rect.left) > 1;
          if (leftMoved || Math.abs(r.width - base.rect.width) > 1) {
            fail('originalGeometryStable', sel,
              `left ${base.rect.left.toFixed(1)}->${r.left.toFixed(1)}, width ${base.rect.width.toFixed(1)}->${r.width.toFixed(1)}`);
          }
        }
      }
      if (!skipped(manifest, 'parentStyleUnchanged', node)) {
        const p = node.parentElement;
        const declared = (manifest.mutations || []).find((m) => p.matches(m.sel));
        const base = baseline.get(p);
        if (declared) {
          const cur = csOf(p)[declared.prop];
          if (cur !== declared.to) fail('expectedMutation', sel, `${declared.prop}="${cur}", expected "${declared.to}"`);
          if (declared.marker && !p.hasAttribute(declared.marker)) fail('expectedMutation', sel, `parent lacks ${declared.marker}`);
        } else if (base) {
          for (const prop of PARENT_PROPS) {
            if (csOf(p)[prop] !== base.props[prop]) {
              fail('parentStyleUnchanged', sel, `parent ${prop} "${base.props[prop]}" -> "${csOf(p)[prop]}"`);
            }
          }
        }
      }
    }
    if (manifest.requireFab) {
      const fab = document.getElementById('mt-fab');
      if (!fab || !fab.isConnected) {
        fail('fabMounted', '#mt-fab', fab ? 'exists but disconnected' : 'not in the DOM (hydration sweep not survived — issue #30)');
      } else {
        // Two-state mascot contract (2026-08 rebrand): the state switch is purely
        // CSS keyed on .mt-fab-active — a class-name drift between the SVG's
        // <g class="mt-fab-off|on"> (floating-button.js) and floating-button.css
        // stacks both monkeys (or shows neither) while everything else stays green.
        const gOff = fab.querySelector('.mt-fab-off'), gOn = fab.querySelector('.mt-fab-on');
        if (!gOff || !gOn) {
          fail('fabStates', '#mt-fab', 'missing .mt-fab-off / .mt-fab-on group(s) in the FAB SVG');
        } else {
          const vis = (el) => getComputedStyle(el).display !== 'none';
          const wasActive = fab.classList.contains('mt-fab-active');
          const check = (activeExpected, label) => {
            if (vis(gOn) !== activeExpected || vis(gOff) === activeExpected) {
              fail('fabStates', '#mt-fab',
                `${label}: off visible=${vis(gOff)} on visible=${vis(gOn)} — exactly one state must show`);
            }
          };
          check(wasActive, wasActive ? 'active state' : 'idle state');
          fab.classList.toggle('mt-fab-active');   // drive the OTHER state…
          check(!wasActive, 'after toggle');
          fab.classList.toggle('mt-fab-active');   // …and restore exactly what was there
        }
      }
    }
    // Document-scoped invariant — opt out with skipUniversal.noHorizontalOverflow: ["*"]
    // (selector lists are meaningless here; anything else is a fixture-author error).
    const nhoSkip = (manifest.skipUniversal || {}).noHorizontalOverflow;
    if (nhoSkip && !nhoSkip.includes('*')) fail('noHorizontalOverflow', 'document', 'skip list must be ["*"] (document-scoped)');
    if (!nhoSkip) {
      const sw = document.scrollingElement.scrollWidth;
      const cap = Math.max(window.innerWidth, baselineScrollWidth) + 1;
      if (sw > cap) fail('noHorizontalOverflow', 'document', `scrollWidth ${sw} > ${cap} (innerWidth/baseline)`);
    }

    // per-target named assertions
    for (const t of (manifest.targets || [])) {
      const nodes = [...document.querySelectorAll(t.sel)];
      if (!nodes.length) { fail('targetSelector', t.sel, 'matches no elements'); continue; }
      // A target asserting ABSENCE (text already in the target language renders
      // nothing) must not be pre-empted by the generic "has a translation" guard —
      // that guard is what every other target wants, and the absence assertion is
      // precisely its inverse.
      const assertsAbsence = t.assert.some((s) => ABSENCE_ASSERTS.has(s.split(':')[0]));
      for (const node of nodes) {
        const trans = transOf(node);
        if (!trans && !assertsAbsence) { fail('targetHasTranslation', t.sel, 'no translation sibling'); continue; }
        for (const spec of t.assert) {
          const i = spec.indexOf(':');
          const name = i === -1 ? spec : spec.slice(0, i);
          const arg = i === -1 ? undefined : spec.slice(i + 1);
          const impl = ASSERTS[name];
          if (!impl) { fail('unknownAssertion', t.sel, name); continue; }
          const res = impl(node, trans, arg, t);
          if (res !== true) fail(name, t.sel, res);
        }
      }
    }

    return {
      pass: failures.length === 0,
      failures,
      counts: {
        units: units.length,
        translations: document.querySelectorAll('.mt-translation').length,
        baselineElements: baseline.size,
      },
    };
  }

  // ─── Selection-preservation phase (manifest key `selection`) ───────────
  // Two load-bearing waits, named because they are CROSS-FILE contracts, not
  // arbitrary settles: SNAPSHOT_SETTLE_MS must outlast the renderer's
  // selectionchange task (the keeper snapshots in a task, not synchronously);
  // SPA_STORM_SETTLE_MS must outlast the fixture reconciler's commit delay
  // (~30ms) plus its re-render rounds plus the pre-paint repair. Tightening a
  // fixture or the keeper without revisiting these turns the phase flaky.
  const SNAPSHOT_SETTLE_MS = 300;
  const SPA_STORM_SETTLE_MS = 500;
  const settle = (ms) => new Promise((r) => setTimeout(r, ms));

  // Async on purpose: the check must span the fixture's SPA commit (a task ~30ms
  // out) plus the renderer's pre-paint repair microtask. Drives a real
  // programmatic selection (fires `selectionchange` exactly like a drag) from
  // `spec.from`'s first text node to `spec.to`'s, waits for the storm, then
  // requires the selection to still cover EXACTLY what it covered (a clamp onto
  // an ancestor can make the selection LONGER — a length-only oracle would wave
  // that damage through). The moves guard keeps the fixture honest: if the
  // reconciler never moved a node, the pass would be vacuous.
  async function checkSelectionPreserved(spec) {
    const failures = [];
    const from = document.querySelector(spec.from);
    const to = document.querySelector(spec.to);
    if (!from || !to || !from.firstChild || !to.firstChild) {
      return { pass: false, failures: [{ name: 'selectionPreserved', sel: spec.from, detail: 'selection endpoints missing' }] };
    }
    const sel = getSelection();
    sel.setBaseAndExtent(from.firstChild, 0, to.firstChild, Math.min(10, to.firstChild.textContent.length));
    const beforeText = sel.toString();
    if (beforeText.length < 1) {
      return { pass: false, failures: [{ name: 'selectionPreserved', sel: spec.from, detail: 'programmatic selection failed to take' }] };
    }
    await settle(SPA_STORM_SETTLE_MS);
    const afterText = getSelection().toString();
    // Cross-world signal: the fixture's reconciler mirrors its move counter onto
    // a DOM attribute — this code runs in the ISOLATED world and cannot read the
    // page world's `window.__moves`. The container is spec-declared
    // (`movesFrom`, default '#article') so the shared library isn't coupled to
    // one fixture's DOM.
    const movesEl = document.querySelector(spec.movesFrom || '#article');
    const moves = parseInt((movesEl && movesEl.dataset.moves) || '0', 10);
    if (!moves) {
      failures.push({ name: 'selectionPreserved', sel: spec.from, detail: 'fixture reconciler never moved a node — vacuously green' });
    }
    if (afterText !== beforeText) {
      failures.push({ name: 'selectionPreserved', sel: spec.from,
        detail: `selection "${afterText.slice(0, 40)}" (${afterText.length}) != "${beforeText.slice(0, 40)}" (${beforeText.length}) after the SPA re-render (moves=${moves})` });
    }
    return { pass: failures.length === 0, failures };
  }

  // ─── Interaction-preservation phase (manifest key `interaction`) ────────
  // The page's own content must keep behaving as the page wrote it after the
  // translation is injected (interaction-spec: 翻译文字插入后不要影响网页原有内容
  // 的交互动作). Outcomes cross the world boundary via body.dataset counters
  // written by the fixture's MAIN-world listeners (fixture 33's dataset.moves
  // pattern). Anti-vacuous guard: the fixture seeds every counter with a
  // pre-enable self-test, so a counter still at 0 means the fixture itself is
  // broken — fail loudly, never pass on a listener that never fired.
  async function checkInteractionPreserved(spec) {
    const failures = [];
    const fail = (name, sel, detail) => failures.push({ name, sel, detail });
    const count = (key) => parseInt(document.body.dataset[key] || '0', 10);
    for (const key of (spec.counters || [])) {
      if (count(key) < 1) fail('interactionCounters', key, 'pre-enable self-test never incremented this counter — fixture is vacuous');
    }
    for (const c of (spec.clicks || [])) {
      const el = document.querySelector(c.sel);
      if (!el) { fail('interactionClick', c.sel, 'matches no element'); continue; }
      // el.click() dispatches even inside display:none — visibility is the
      // actual user-facing contract and is asserted separately.
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) { fail('interactionClick', c.sel, `target is invisible (${r.width.toFixed(1)}x${r.height.toFixed(1)})`); continue; }
      const before = count(c.counter);
      el.click();
      await new Promise((res) => setTimeout(res, 50));
      const after = count(c.counter);
      if (after <= before) fail('interactionClick', c.sel, `click did not reach the page's listener (${c.counter}: ${before} -> ${after})`);
    }
    for (const c of (spec.contextmenu || [])) {
      const el = document.querySelector(c.sel);
      if (!el) { fail('interactionContextmenu', c.sel, 'matches no element'); continue; }
      const before = count(c.counter);
      const ok = el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await new Promise((res) => setTimeout(res, 50));
      if (!ok) fail('interactionContextmenu', c.sel, 'contextmenu was defaultPrevented on page content');
      if (count(c.counter) <= before) fail('interactionContextmenu', c.sel, `page's contextmenu listener never fired (${c.counter})`);
    }
    // 病因断言，不是症状断言。真实症状（点击被重定向到祖先、click 干脆不发）只在
    // 真实鼠标输入下出现，而这里的 el.click() 是合成事件、永远直达目标 —— 用它去测
    // 「链接还能不能点」会永远绿。所以测因：**页面自己的框架有没有为了对齐子节点而
    // 搬动它自己的节点**。搬了就说明我们插进了它管辖的容器，剩下的（选区被杀、点击
    // 被吞）都是它的必然推论。
    if (spec.frameworkChurn) {
      const fc = spec.frameworkChurn;
      const el = document.querySelector(fc.select);
      if (!el || !el.firstChild) {
        fail('frameworkChurn', fc.select, 'selection target missing');
      } else {
        const before = count(fc.counter);
        const rg = document.createRange();
        rg.selectNodeContents(el);
        getSelection().removeAllRanges();
        getSelection().addRange(rg);
        await settle(SPA_STORM_SETTLE_MS);
        const moved = count(fc.counter) - before;
        getSelection().removeAllRanges();
        const max = fc.max || 0;
        if (moved > max) {
          fail('frameworkChurn', fc.select,
            `一次选区变化，框架搬动了 ${moved} 个它自己的子节点（上限 ${max}）—— 我们的节点插在了它管辖的容器里`);
        }
      }
    }
    if (spec.pageSelection) {
      const ps = spec.pageSelection;
      const from = document.querySelector(ps.from), to = document.querySelector(ps.to);
      const trigger = document.querySelector(ps.trigger);
      if (!from || !to || !trigger || !from.firstChild || !to.firstChild) {
        fail('pageSelection', ps.trigger, 'selection endpoints or trigger missing');
      } else {
        getSelection().setBaseAndExtent(from.firstChild, 0, to.firstChild, Math.min(10, to.firstChild.textContent.length));
        await settle(SNAPSHOT_SETTLE_MS); // snapshot settles (selectionchange is a task)
        trigger.click();  // main-world handler: moves a page node AND sets the page's own selection, same task
        await settle(SPA_STORM_SETTLE_MS);
        if (document.body.dataset.pageSelSet !== '1') {
          fail('pageSelection', ps.trigger, 'fixture trigger never ran — vacuous');
        } else {
          const want = document.body.dataset.pageSelExpected || '';
          const got = String(getSelection());
          if (got !== want) fail('pageSelection', ps.trigger, `page-set selection was overridden: "${got.slice(0, 40)}" != "${want}"`);
        }
      }
    }
    return { pass: failures.length === 0, failures };
  }

  // ─── Selection-keeper guard phase (manifest key `keeperGuards`) ─────────
  // Pins the keeper's LOAD-BEARING NON-behaviors and its partial-kill repair
  // (fixture 36). Each case is sequential in one tab; the waits between cases
  // double as the gesture/batch quiet windows the keeper's drop logic needs.
  async function checkKeeperGuards(spec) {
    const failures = [];
    const $ = (s) => document.querySelector(s);
    const selectText = (fromSel, toSel) => {
      const f = $(fromSel), t = $(toSel);
      getSelection().setBaseAndExtent(f.firstChild, 0, t.firstChild, Math.min(10, t.firstChild.textContent.length));
    };
    // 1. Partial kill repaired EXACTLY: the trigger remove+reinserts the FOCUS
    //    endpoint's paragraph at the same position (Chrome clamps the endpoint —
    //    the half-kill damage shape). The keeper must restore the identical text.
    selectText(spec.from, spec.to);
    await settle(SNAPSHOT_SETTLE_MS);
    const want = String(getSelection());
    $(spec.movePartial).click();
    await settle(SPA_STORM_SETTLE_MS);
    const got = String(getSelection());
    if (got !== want) {
      failures.push({ name: 'keeperPartialKill', sel: spec.movePartial,
        detail: `"${got.slice(0, 40)}" (${got.length}) != "${want.slice(0, 40)}" (${want.length})` });
    }
    // 2. Editors are off-limits: a selection inside contenteditable is never
    //    snapshotted, so when the editor node itself is moved (killing the
    //    selection) the keeper must NOT restore into it — editor frameworks
    //    manage their own selection.
    const ed = $(spec.editor);
    getSelection().setBaseAndExtent(ed.firstChild, 0, ed.firstChild, Math.min(5, ed.firstChild.textContent.length));
    await settle(SNAPSHOT_SETTLE_MS);
    $(spec.moveEditor).click();
    await settle(SPA_STORM_SETTLE_MS);
    if (!getSelection().isCollapsed && String(getSelection()).length) {
      failures.push({ name: 'keeperEditorMeddled', sel: spec.editor,
        detail: `selection "${String(getSelection()).slice(0, 30)}" survived an editor move — keeper restored inside an editor` });
    }
    // 3. A deliberate deselect (gesture, then collapse) is honored across a
    //    later real mutation batch.
    selectText(spec.from, spec.to);
    await settle(SNAPSHOT_SETTLE_MS);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    getSelection().removeAllRanges();
    $(spec.moveOther).click();
    await settle(SPA_STORM_SETTLE_MS);
    if (!getSelection().isCollapsed) {
      failures.push({ name: 'keeperGestureDeselect', sel: 'body', detail: `selection resurrected after a gesture deselect: "${String(getSelection()).slice(0, 30)}"` });
    }
    // 4. A quiet programmatic removeAllRanges (no batch, no gesture in the
    //    keeper's suppression windows) drops the snapshot: a later unrelated
    //    batch must not resurrect the cleared selection.
    selectText(spec.from, spec.to);
    await settle(1000); // exceed GESTURE_RECENT_MS since case 3's pointerdown AND BATCH_ADJACENT_MS since its batch
    getSelection().removeAllRanges();
    await settle(SNAPSHOT_SETTLE_MS);
    $(spec.moveOther2).click();
    await settle(SPA_STORM_SETTLE_MS);
    if (!getSelection().isCollapsed) {
      failures.push({ name: 'keeperQuietClear', sel: 'body', detail: 'selection resurrected after a programmatic removeAllRanges' });
    }
    return { pass: failures.length === 0, failures };
  }

  window.__mtLayout = { captureBaseline, runAsserts, checkSelectionPreserved, checkInteractionPreserved, checkKeeperGuards };
})();
