// floating-button.js — Mobile-friendly floating action button

var FloatingButton = (() => {
  const FAB_ID = 'mt-fab';
  let fab = null;
  let onToggle = null;
  let _enabled = false;

  function create(initialEnabled, toggleCallback) {
    if (document.getElementById(FAB_ID)) return;
    _enabled = initialEnabled;
    onToggle = toggleCallback;

    fab = document.createElement('button');
    fab.id = FAB_ID;
    fab.title = TranslationCore.t('fab_translate', '翻译');
    fab.setAttribute('aria-label', TranslationCore.t('fab_toggle', '切换翻译'));
    fab.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" fill="white"/>
    </svg>`;

    fab.addEventListener('click', handleClick);
    // Prevent text selection / link activation on long press (mobile)
    fab.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

    document.body.appendChild(fab);
    updateState(_enabled);
    makeDraggable(fab);
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
    chip.textContent = TranslationCore.t('fab_translate', '翻译');
    chip.style.left = `${Math.min(touch.clientX, window.innerWidth - 80)}px`;
    chip.style.top = `${touch.clientY - 44}px`;
    chip.addEventListener('click', () => { chip.remove(); onTranslate(target); });
    setTimeout(() => chip.remove(), 3000);
    document.body.appendChild(chip);
  }

  return { create, setEnabled, remove, showTranslateChip };
})();
