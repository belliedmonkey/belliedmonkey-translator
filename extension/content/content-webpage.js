// content-webpage.js — Bilingual webpage translation

var WebpageTranslator = (() => {
  let settings = {};
  let mutationObserver = null;
  let intersectionObserver = null;
  let progressBar = null;
  let totalNodes = 0;
  let doneNodes = 0;
  let active = false;

  const IS_YOUTUBE = /youtube\.com/.test(location.hostname);
  const IS_MOBILE_YT = /m\.youtube\.com/.test(location.hostname);
  function collectNodes(root) { return DOMProcessor.collectParagraphs(root); }

  // ─── YouTube page text (title / description / comments) ───────────────
  // YouTube renders these in Polymer custom elements that re-render and STRIP
  // any children we inject (and the description re-renders on expand). So we
  // insert the translation as a SIBLING right after the original (original
  // above, translation below — same bilingual style) and re-apply on a poll.
  // Idempotent via data-src so unchanged text isn't re-translated.
  let ytPoll = null;
  // Desktop and mobile (m.youtube.com) have different DOMs. Mobile comment /
  // description selectors aren't confirmed yet, so mobile only translates the
  // title for now (avoids breaking the mobile layout with wrong injections).
  const YT_TARGETS = IS_MOBILE_YT
    ? [
        '.slim-video-information-title',  // mobile video title (h2)
        '.YtmCommentRendererText',        // mobile comment text (<p> inside ytm-comment-renderer)
      ].join(', ')
    : [
        'ytd-watch-metadata #title h1',                          // desktop video title
        '#description-inline-expander #attributed-snippet-text', // desktop description snippet
        '#content-text',                                         // desktop comment text
      ].join(', ');
  // The expanded description (#expanded) is one text blob; it gets a dedicated
  // interleaved re-render (ytRenderDescription) so each paragraph is followed by
  // its translation, with clickable URLs and seekable chapter timestamps.

  function ytTranslateText(el) {
    const next = el.nextElementSibling;
    const existing = next && next.classList && next.classList.contains('mt-yt-pagetrans') ? next : null;
    // Skip hidden elements (the collapsed/expanded description swap keeps both in
    // the DOM). Only translate the visible one; drop the hidden one's translation
    // so we never translate text the user can't see and never leave a stray line.
    if (el.offsetParent === null) { if (existing) existing.remove(); return; }
    // Keep the original line breaks (don't collapse \n to spaces) so multi-line
    // descriptions can be translated line by line and rendered with structure.
    const src = (el.textContent || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (src.length < 2) return;
    let node = existing;
    if (!node) {
      node = document.createElement('div');
      node.className = 'mt-yt-pagetrans';
      el.insertAdjacentElement('afterend', node);
    }
    if (node.dataset.src === src) return; // already handled for this exact text
    node.dataset.src = src;
    // loading state (pre-wrap so the translated structure shows)
    node.style.cssText = 'color:#888;margin-top:3px;font-size:.9em;line-height:1.4;display:block;font-style:italic;white-space:pre-wrap;';
    node.textContent = '⏳ 翻译中…';
    // Translate line by line, preserving blank lines / line breaks → a
    // multi-paragraph description keeps its structure instead of one blob.
    const lines = src.split('\n');
    Promise.all(lines.map((line) => {
      const t = line.trim();
      if (t.length < 2) return Promise.resolve(line); // keep blank/short lines
      return TranslationAPI.translate(
        t, settings.targetLang || 'zh-CN', settings.provider || 'google',
        settings.apiKey || '', settings.apiBaseUrl || ''
      ).then((zh) => (zh && zh !== t ? zh : line)).catch(() => line);
    })).then((zhLines) => {
      if (node.dataset.src !== src) return;
      const out = zhLines.join('\n').trim();
      if (out && out !== src) {
        node.style.cssText = `color:${settings.textColor || '#0a7a3c'};margin-top:3px;font-size:.95em;line-height:1.4;display:block;white-space:pre-wrap;`;
        node.textContent = out;
      } else { node.style.display = 'none'; node.textContent = ''; }
    }).catch(() => { node.dataset.src = ''; }); // clear so the next poll retries
  }

  // Render text into el with clickable URLs and seekable timestamps (Trusted
  // Types safe — only createElement/textContent, no innerHTML). Used for both the
  // original and translated description paragraphs.
  function tsToSeconds(ts) {
    const p = ts.split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  }
  function buildRichText(text, el) {
    el.textContent = '';
    text.split(/(https?:\/\/[^\s]+)/g).forEach((part) => {
      if (/^https?:\/\//.test(part)) {
        const a = document.createElement('a');
        a.href = part; a.target = '_blank'; a.rel = 'noopener'; a.textContent = part;
        a.style.color = '#3ea6ff';
        el.appendChild(a);
        return;
      }
      let last = 0;
      const re = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
      let m;
      while ((m = re.exec(part))) {
        if (m.index > last) el.appendChild(document.createTextNode(part.slice(last, m.index)));
        const ts = m[0];
        const a = document.createElement('a');
        a.textContent = ts; a.style.cssText = 'color:#3ea6ff;cursor:pointer;';
        a.addEventListener('click', (e) => {
          e.preventDefault();
          const v = document.querySelector('video'); if (v) v.currentTime = tsToSeconds(ts);
        });
        el.appendChild(a);
        last = m.index + ts.length;
      }
      if (last < part.length) el.appendChild(document.createTextNode(part.slice(last)));
    });
  }

  // Interleaved render for the expanded description: each original paragraph is
  // followed by its translation. Hides YouTube's own #expanded and draws our own.
  function ytRenderDescription() {
    let exp, visible;
    if (IS_MOBILE_YT) {
      // Mobile description lives in an engagement panel. Gate on the PANEL's
      // visibility (not exp's) — we set exp to display:none, which would null its
      // offsetParent and cause a flicker.
      const panel = document.querySelector('ytm-structured-description-content-renderer');
      exp = document.querySelector('.expandable-video-description-container');
      visible = !!(panel && panel.offsetParent !== null && exp);
    } else {
      const expander = document.querySelector('ytd-text-inline-expander');
      exp = document.querySelector('#description-inline-expander #expanded');
      visible = !!(exp && expander && expander.hasAttribute('is-expanded'));
    }
    const holderEl = document.getElementById('mt-yt-desc');
    if (!visible) { if (holderEl) holderEl.remove(); if (exp) exp.style.display = ''; return; }
    buildDescHolder(exp);
  }

  // Interleaved render of a single-blob description (desktop #expanded or mobile
  // .expandable-video-description-container): hide the original, draw paragraphs
  // each followed by its translation.
  function buildDescHolder(exp) {
    let holder = document.getElementById('mt-yt-desc');
    const src = (exp.textContent || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (src.length < 2) return;
    if (holder && holder.dataset.src === src) return; // unchanged
    exp.style.display = 'none';
    if (!holder) {
      holder = document.createElement('div');
      holder.id = 'mt-yt-desc';
      exp.insertAdjacentElement('afterend', holder);
    }
    holder.dataset.src = src;
    holder.textContent = '';
    src.split(/\n{2,}/).forEach((para) => {
      const p = para.trim();
      if (!p) return;
      const o = document.createElement('div');
      o.style.cssText = 'white-space:pre-wrap;line-height:1.4;';
      buildRichText(p, o);
      holder.appendChild(o);
      const t = document.createElement('div');
      t.className = 'mt-yt-pagetrans';
      t.style.cssText = `color:${settings.textColor || '#0a7a3c'};margin:2px 0 12px;white-space:pre-wrap;line-height:1.4;font-style:italic;`;
      t.textContent = '⏳ 翻译中…';
      holder.appendChild(t);
      const lines = p.split('\n');
      Promise.all(lines.map((line) => {
        const x = line.trim();
        if (x.length < 2) return Promise.resolve(line);
        return TranslationAPI.translate(x, settings.targetLang || 'zh-CN', settings.provider || 'google', settings.apiKey || '', settings.apiBaseUrl || '')
          .then((zh) => (zh && zh !== x ? zh : line)).catch(() => line);
      })).then((zhLines) => {
        if (holder.dataset.src !== src) return;
        t.style.fontStyle = 'normal';
        buildRichText(zhLines.join('\n'), t);
      });
    });
  }

  function ytScan() {
    if (!active) return;
    document.querySelectorAll(YT_TARGETS).forEach(ytTranslateText);
    ytRenderDescription();
  }
  function startYtPoll() { ytScan(); if (!ytPoll) ytPoll = setInterval(ytScan, 1500); }
  function stopYtPoll() {
    if (ytPoll) { clearInterval(ytPoll); ytPoll = null; }
    document.querySelectorAll('.mt-yt-pagetrans').forEach((e) => e.remove());
    document.getElementById('mt-yt-desc')?.remove();
    const exp = document.querySelector('#description-inline-expander #expanded');
    if (exp) exp.style.display = '';
  }

  // ─── Progress bar ─────────────────────────────────────────────────────

  function showProgress() {
    if (!progressBar) {
      progressBar = document.createElement('div');
      progressBar.className = 'mt-progress-bar';
      document.body.appendChild(progressBar);
    }
    progressBar.style.width = '0%';
    progressBar.style.opacity = '1';
  }

  function updateProgress(done, total) {
    if (!progressBar) return;
    const pct = total > 0 ? Math.round((done / total) * 100) : 100;
    progressBar.style.width = `${pct}%`;
    if (pct >= 100) {
      setTimeout(() => {
        if (progressBar) progressBar.style.opacity = '0';
      }, 500);
    }
  }

  // ─── Translate a single node ───────────────────────────────────────────

  async function translateNode(node) {
    if (DOMProcessor.isAlreadyTranslated(node)) return;
    const text = DOMProcessor.getTextContent(node);
    if (!text || text.length < 10) return;

    // Show a loading placeholder immediately, then fill it in when ready (so the
    // page translates paragraph by paragraph and shows progress per paragraph).
    DOMProcessor.markProcessed(node, '⏳ 翻译中…');
    const div = node.querySelector(`:scope > .${DOMProcessor.TRANSLATION_CLASS}`);
    try {
      const translated = await TranslationAPI.translate(
        text,
        settings.targetLang || 'zh-CN',
        settings.provider || 'google',
        settings.apiKey || '',
        settings.apiBaseUrl || ''
      );
      if (translated && translated !== text) { if (div) div.textContent = translated; }
      else if (div) div.remove();
    } catch (e) {
      if (div) div.remove();
      console.warn('[MT] translate node failed:', e.message);
    }

    doneNodes++;
    updateProgress(doneNodes, totalNodes);
  }

  // ─── Batch translate with IntersectionObserver priority ───────────────

  async function translateAll() {
    if (!active) return;
    const nodes = collectNodes();
    if (!nodes.length) return;

    totalNodes = nodes.length;
    doneNodes = 0;
    showProgress();

    // Split: visible first, rest deferred
    const visible = [], deferred = [];
    nodes.forEach(n => {
      const rect = n.getBoundingClientRect();
      if (rect.top < window.innerHeight * 2 && rect.bottom > -100) visible.push(n);
      else deferred.push(n);
    });

    // Translate visible nodes in batches of 5 (parallel)
    const BATCH = 5;
    for (let i = 0; i < visible.length; i += BATCH) {
      if (!active) return;
      const chunk = visible.slice(i, i + BATCH);
      await Promise.all(chunk.map(translateNode));
    }

    // Observe deferred nodes with IntersectionObserver
    if (deferred.length > 0 && active) {
      intersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            intersectionObserver.unobserve(e.target);
            translateNode(e.target);
          }
        });
      }, { rootMargin: '200px 0px' });
      deferred.forEach(n => intersectionObserver.observe(n));
    }
  }

  // ─── MutationObserver for dynamic content ─────────────────────────────

  function startObserver() {
    if (mutationObserver) return;
    mutationObserver = new MutationObserver((mutations) => {
      if (!active) return;
      const addedNodes = [];
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof Element) addedNodes.push(node);
        }
      }
      if (addedNodes.length === 0) return;

      // Debounce
      clearTimeout(mutationObserver._timer);
      mutationObserver._timer = setTimeout(() => {
        addedNodes.forEach(root => {
          const nodes = collectNodes(root);
          nodes.forEach(translateNode);
          totalNodes += nodes.length;
        });
      }, 500);
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function stopObserver() {
    if (mutationObserver) { mutationObserver.disconnect(); mutationObserver = null; }
    if (intersectionObserver) { intersectionObserver.disconnect(); intersectionObserver = null; }
  }

  // ─── Tap-to-translate (mobile) ────────────────────────────────────────

  function initTapToTranslate() {
    document.addEventListener('touchend', (e) => {
      if (!active) return;
      const target = e.target?.closest(`[${DOMProcessor.TRANSLATABLE_ATTR}]`);
      if (target && !DOMProcessor.isAlreadyTranslated(target)) {
        const touch = e.changedTouches[0];
        FloatingButton.showTranslateChip(target, touch, (node) => {
          translateNode(node);
        });
      }
    }, { passive: true });
  }

  // ─── Public API ───────────────────────────────────────────────────────

  async function enable(cfg) {
    settings = cfg;
    active = true;
    if (IS_YOUTUBE) { startYtPoll(); return; } // YouTube page text via sibling-injection poll
    startObserver();
    await translateAll();
  }

  function disable() {
    active = false;
    stopObserver();
    stopYtPoll();
    DOMProcessor.removeTranslations();
    if (progressBar) { progressBar.remove(); progressBar = null; }
    doneNodes = 0;
    totalNodes = 0;
  }

  function updateSettings(cfg) {
    settings = cfg;
    if (active) {
      disable();
      enable(cfg);
    }
  }

  function init(cfg) {
    settings = cfg;
    initTapToTranslate();
    if (cfg.enabled) enable(cfg);
  }

  return { init, enable, disable, updateSettings };
})();
