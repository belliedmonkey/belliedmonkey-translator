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
  function collectNodes(root) { return DOMProcessor.collectParagraphs(root); }

  // ─── YouTube page text (title / description / comments) ───────────────
  // YouTube renders these in Polymer custom elements that re-render and STRIP
  // any children we inject (and the description re-renders on expand). So we
  // insert the translation as a SIBLING right after the original (original
  // above, translation below — same bilingual style) and re-apply on a poll.
  // Idempotent via data-src so unchanged text isn't re-translated.
  let ytPoll = null;
  const YT_TARGETS = [
    'ytd-watch-metadata #title h1',                           // video title
    '#description-inline-expander #attributed-snippet-text',  // collapsed description snippet
    '#description-inline-expander #expanded',                 // expanded full description
    'ytd-comment-view-model #content-text',                   // each comment
  ].join(', ');

  function ytTranslateText(el) {
    const next = el.nextElementSibling;
    const existing = next && next.classList && next.classList.contains('mt-yt-pagetrans') ? next : null;
    // Skip hidden elements (the collapsed/expanded description swap keeps both in
    // the DOM). Only translate the visible one; drop the hidden one's translation
    // so we never translate text the user can't see and never leave a stray line.
    if (el.offsetParent === null) { if (existing) existing.remove(); return; }
    const src = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (src.length < 2) return;
    let node = existing;
    if (!node) {
      node = document.createElement('div');
      node.className = 'mt-yt-pagetrans';
      el.insertAdjacentElement('afterend', node);
    }
    if (node.dataset.src === src) return; // already handled for this exact text
    node.dataset.src = src;
    // loading state
    node.style.cssText = 'color:#888;margin-top:3px;font-size:.9em;line-height:1.4;display:block;font-style:italic;';
    node.textContent = '⏳ 翻译中…';
    TranslationAPI.translate(
      src, settings.targetLang || 'zh-CN', settings.provider || 'google',
      settings.apiKey || '', settings.apiBaseUrl || ''
    ).then((zh) => {
      if (node.dataset.src !== src) return;
      if (zh && zh !== src) {
        node.style.cssText = `color:${settings.textColor || '#0a7a3c'};margin-top:3px;font-size:.95em;line-height:1.4;display:block;`;
        node.textContent = zh;
      } else {
        node.style.display = 'none'; node.textContent = '';
      }
    }).catch(() => { node.dataset.src = ''; }); // clear so the next poll retries
  }

  function ytScan() {
    if (!active) return;
    document.querySelectorAll(YT_TARGETS).forEach(ytTranslateText);
  }
  function startYtPoll() { ytScan(); if (!ytPoll) ytPoll = setInterval(ytScan, 1500); }
  function stopYtPoll() {
    if (ytPoll) { clearInterval(ytPoll); ytPoll = null; }
    document.querySelectorAll('.mt-yt-pagetrans').forEach((e) => e.remove());
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
