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
    sameLeft(node, trans, arg) {
      const tol = parseFloat(arg) || TOL;
      const d = Math.abs(rectOf(trans).left - rectOf(node).left);
      return d <= tol || `trans.left off by ${d.toFixed(1)}px (tol ${tol})`;
    },
    sameWidth(node, trans, arg) {
      const tol = parseFloat(arg) || TOL;
      const d = Math.abs(rectOf(trans).width - rectOf(node).width);
      return d <= tol || `trans.width off by ${d.toFixed(1)}px (tol ${tol})`;
    },
    maxWidthLE(node, trans) {
      const mw = csOf(trans).maxWidth;
      if (mw === 'none') return 'translation has no max-width';
      // Units matter: parseFloat('100%') is 100 and would compare as "100px" — the
      // exact vacuous-green this assertion exists to catch. Require a px cap AND
      // verify the USED width (the observable contract) against the original.
      if (!/px$/.test(mw)) return `max-width "${mw}" is not a px cap`;
      const ow = baseline.get(node) ? baseline.get(node).rect.width : rectOf(node).width;
      const used = rectOf(trans).width;
      if (parseFloat(mw) > ow + 2) return `max-width ${mw} exceeds original width ${ow}px`;
      return used <= ow + 2 || `used width ${used.toFixed(1)} exceeds original width ${ow}px`;
    },
    sameRight(node, trans, arg) {
      const tol = parseFloat(arg) || TOL;
      const d = Math.abs(rectOf(trans).right - rectOf(node).right);
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

  window.__mtLayout = { captureBaseline, runAsserts };
})();
