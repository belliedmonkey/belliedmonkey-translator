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

  function captureBaseline() {
    baseline.clear();
    for (const el of document.body.querySelectorAll('*')) {
      const r = rectOf(el);
      const cs = csOf(el);
      const props = {};
      for (const p of PARENT_PROPS) props[p] = cs[p];
      baseline.set(el, { rect: { left: r.left, width: r.width, top: r.top, bottom: r.bottom }, props });
    }
    baselineScrollWidth = document.scrollingElement.scrollWidth;
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
    cachedLayoutCss(node, trans, arg) {
      const v = node.__mtLayoutCss || '';
      return new RegExp(arg).test(v) || `__mtLayoutCss "${v}" !~ /${arg}/`;
    },
    translationMarked(node, trans) {
      return trans.textContent.includes('【译】') || 'translation text lacks the 【译】 marker';
    },
  };

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
        if (rectOf(trans).top < rectOf(node).bottom - 1) {
          fail('belowOriginal', sel, `trans.top ${rectOf(trans).top.toFixed(1)} < orig.bottom ${rectOf(node).bottom.toFixed(1)}`);
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
      for (const node of nodes) {
        const trans = transOf(node);
        if (!trans) { fail('targetHasTranslation', t.sel, 'no translation sibling'); continue; }
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
