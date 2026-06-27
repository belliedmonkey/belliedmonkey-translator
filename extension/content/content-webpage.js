// content-webpage.js — Bilingual webpage translation

var WebpageTranslator = (() => {
  let settings = {};
  let mutationObserver = null;
  let intersectionObserver = null;
  let progressBar = null;
  let totalNodes = 0;
  let doneNodes = 0;
  let active = false;

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

    try {
      const translated = await TranslationAPI.translate(
        text,
        settings.targetLang || 'zh-CN',
        settings.provider || 'google',
        settings.apiKey || '',
        settings.apiBaseUrl || ''
      );
      if (translated && translated !== text) {
        DOMProcessor.markProcessed(node, translated);
      }
    } catch (e) {
      console.warn('[MT] translate node failed:', e.message);
    }

    doneNodes++;
    updateProgress(doneNodes, totalNodes);
  }

  // ─── Batch translate with IntersectionObserver priority ───────────────

  async function translateAll() {
    if (!active) return;
    const nodes = DOMProcessor.collectParagraphs();
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
          const nodes = DOMProcessor.collectParagraphs(root);
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
    startObserver();
    await translateAll();
  }

  function disable() {
    active = false;
    stopObserver();
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
