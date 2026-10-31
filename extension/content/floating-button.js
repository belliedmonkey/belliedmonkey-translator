// floating-button.js — Mobile-friendly floating action button

var FloatingButton = (() => {
  const FAB_ID = 'mt-fab';
  let fab = null;
  let onToggle = null;
  let _enabled = false;

  // SVG 走 createElementNS 逐节点构建（旧的内联 SVG 字符串的逐字翻译：同一棵树、
  // 同一批类名/属性）。YouTube 页有 Trusted Types（domain-design §2.1），字符串内联
  // HTML 是 FAB 注入面唯一的 TT 隐患 —— PR8a 消掉它（content-ui 结构门连注释里的
  // 字面量都咬：负向断言曾被自己的注释绊倒，见 test/content-ui.test.js）。FAB 是
  // 一次性静态子树，不值得为它引框架；真正有状态的菜单在
  // subtitle-adapter.js → content/sub-menu.bundle.js。
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs = {}, kids = []) {
    const el = document.createElementNS(SVG_NS, name);
    for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
    for (const kid of kids) el.appendChild(kid);
    return el;
  }
  function mascotSvg() {
    return svgEl('svg', { width: 52, height: 52, viewBox: '0 0 64 64', xmlns: SVG_NS }, [
      svgEl('circle', { class: 'mt-fab-ear', cx: 13, cy: 13, r: 8, 'stroke-width': 2 }),
      svgEl('circle', { class: 'mt-fab-ear', cx: 51, cy: 13, r: 8, 'stroke-width': 2 }),
      svgEl('circle', { class: 'mt-fab-ear-inner', cx: 13, cy: 13, r: 3.4 }),
      svgEl('circle', { class: 'mt-fab-ear-inner', cx: 51, cy: 13, r: 3.4 }),
      svgEl('circle', { class: 'mt-fab-disc', cx: 32, cy: 36, r: 26 }),
      svgEl('circle', { class: 'mt-fab-cream', cx: 32, cy: 30, r: 15 }),
      svgEl('path', { class: 'mt-fab-stroke', d: 'M28.5 33c2 1.9 5 1.9 7 0' }),
      svgEl('circle', { class: 'mt-fab-cream', cx: 32, cy: 50, r: 10 }),
      svgEl('g', { class: 'mt-fab-off' }, [
        svgEl('circle', { class: 'mt-fab-ink', cx: 27, cy: 28, r: 2.2 }),
        svgEl('circle', { class: 'mt-fab-ink', cx: 37, cy: 28, r: 2.2 }),
        svgEl('g', { class: 'mt-fab-glyph', transform: 'translate(32 50.5) scale(0.22) translate(-45 -51)' }, [
          svgEl('rect', { x: 28, y: 34, width: 34, height: 7, rx: 2 }),
          svgEl('rect', { x: 41.5, y: 26, width: 7, height: 11, rx: 2 }),
          svgEl('path', { d: 'M45 41c0 13-6 22-17 29l5 6c8-6 13-13 15-21 2 8 7 15 15 21l5-6c-11-7-17-16-17-29z' }),
        ]),
      ]),
      svgEl('g', { class: 'mt-fab-on' }, [
        svgEl('path', { class: 'mt-fab-stroke', d: 'M23.5 28c1.3-1.9 3.9-1.9 5.2 0M35.3 28c1.3-1.9 3.9-1.9 5.2 0' }),
        svgEl('rect', { class: 'mt-fab-ink', x: 26, y: 46.5, width: 12, height: 2.8, rx: 1.4 }),
        svgEl('rect', { class: 'mt-fab-accent', x: 26, y: 51.5, width: 8.5, height: 2.8, rx: 1.4 }),
      ]),
    ]);
  }

  function create(initialEnabled, toggleCallback) {
    if (document.getElementById(FAB_ID)) return;
    _enabled = initialEnabled;
    onToggle = toggleCallback;

    fab = document.createElement('button');
    fab.id = FAB_ID;
    fab.setAttribute('translate', 'no'); // own UI — dom-processor hardSkip
    fab.title = TranslationCore.t('fab_translate', '翻译');
    fab.setAttribute('aria-label', TranslationCore.t('fab_toggle', '切换翻译'));
    // 大肚猴 mascot, design/handoff.md §4 (定稿 2b). ONE shared geometry (ears /
    // disc / face / mouth / belly) whose colours live entirely in
    // floating-button.css keyed on .mt-fab-active — recolouring the brand never
    // touches this file again. Only what genuinely DIFFERS between states stays
    // in the two toggled <g>s: 关 = round awake eyes + 文 in the belly;
    // 开 = smiling eye arcs + the bilingual pair (ink line over terracotta line).
    fab.appendChild(mascotSvg());

    fab.addEventListener('click', handleClick);
    // Prevent text selection / link activation on long press (mobile)
    fab.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

    document.body.appendChild(fab);
    updateState(_enabled);
    makeDraggable(fab);
    watchRemount();
  }

  // A hydrating SPA (Next.js/React — anthropic.com) reconciles body children
  // AFTER our document_idle injection and sweeps the FAB out of the DOM. That is
  // why the FAB "never shows" on Chrome/iOS Safari, whose injection precedes the
  // sweep, while Firefox/macOS Safari inject after it and survive (issue #30).
  // Re-append the SAME element when someone else removes it (drag position and
  // handlers survive); remove() disconnects first so our own teardown never
  // remounts. Bounded so a page that keeps fighting wins after 20 rounds.
  let remountObs = null;
  let remountCount = 0;
  function watchRemount() {
    if (remountObs) remountObs.disconnect();
    remountCount = 0;
    remountObs = new MutationObserver(() => {
      if (!fab || fab.isConnected || !document.body) return; // O(1) early exit on unrelated mutations
      if (++remountCount > 20) { remountObs.disconnect(); remountObs = null; return; }
      document.body.appendChild(fab);
    });
    remountObs.observe(document.documentElement, { childList: true, subtree: true });
  }

  function handleClick() {
    _enabled = !_enabled;
    updateState(_enabled);
    if (onToggle) onToggle(_enabled);
  }

  function updateState(enabled) {
    _enabled = enabled;
    if (!fab) return;
    if (enabled) {
      fab.classList.add('mt-fab-active');
      fab.title = TranslationCore.t('fab_disable', '关闭翻译');
    } else {
      fab.classList.remove('mt-fab-active');
      fab.title = TranslationCore.t('fab_enable', '开启翻译');
    }
  }

  function setEnabled(enabled) {
    _enabled = enabled;
    updateState(enabled);
  }

  function remove() {
    if (remountObs) { remountObs.disconnect(); remountObs = null; }
    if (fab) { fab.remove(); fab = null; }
  }

  // ─── Drag to reposition ────────────────────────────────────────────────
  function makeDraggable(el) {
    let startX, startY, startLeft, startBottom, dragging = false;

    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      const rect = el.getBoundingClientRect();
      startLeft = rect.left;
      startBottom = window.innerHeight - rect.bottom;
      dragging = false;
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dragging = true;
      if (!dragging) return;
      e.preventDefault();
      const newLeft = Math.max(0, Math.min(window.innerWidth - 56, startLeft + dx));
      const newBottom = Math.max(0, Math.min(window.innerHeight - 56, startBottom - dy));
      el.style.left = `${newLeft}px`;
      el.style.right = 'auto';
      el.style.bottom = `${newBottom}px`;
    }, { passive: false });

    el.addEventListener('touchend', (e) => {
      if (dragging) e.preventDefault();
    });
  }

  // Show translate chip near a tapped element (tap-to-translate)
  function showTranslateChip(target, touch, onTranslate) {
    document.querySelector('.mt-translate-chip')?.remove();
    const chip = document.createElement('button');
    chip.className = 'mt-translate-chip';
    chip.setAttribute('translate', 'no'); // own UI — dom-processor hardSkip
    chip.textContent = TranslationCore.t('fab_translate', '翻译');
    chip.style.left = `${Math.min(touch.clientX, window.innerWidth - 80)}px`;
    chip.style.top = `${touch.clientY - 44}px`;
    chip.addEventListener('click', () => { chip.remove(); onTranslate(target); });
    setTimeout(() => chip.remove(), 3000);
    document.body.appendChild(chip);
  }

  return { create, setEnabled, remove, showTranslateChip };
})();
