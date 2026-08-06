// learn/i18n.js — the shared extension-page i18n block.
//
// `options.js` and `popup.js` each carry a byte-identical copy of this logic. The
// review page is the third page, and a third copy is exactly the drift the provider
// registry rule warns about — so it is extracted here instead. Migrating the other
// two onto this file is a separate, mechanical change, deliberately not bundled with
// the learning feature.
//
// Why not chrome.i18n alone: getMessage is locked to the browser/OS locale and
// cannot be switched at runtime, but the UI language is user-selectable (`uiLang`).
// So we consult the bundled MT_I18N_MESSAGES table first, then chrome.i18n, then the
// in-markup fallback — a missing key never blanks the UI.

var PageI18n = (() => {
  let uiLang = 'auto';

  function normalizeLocale(tag) {
    const T = window.MT_I18N_MESSAGES || {};
    if (!tag) return '';
    const s = String(tag).replace(/-/g, '_');
    if (T[s]) return s;
    const base = s.split('_')[0];
    if (base === 'zh') return T.zh_CN ? 'zh_CN' : (T.zh_TW ? 'zh_TW' : '');
    if (T[base]) return base;
    for (const k of Object.keys(T)) if (k.split('_')[0] === base) return k;
    return '';
  }

  function effectiveLocale() {
    if (uiLang && uiLang !== 'auto') { const n = normalizeLocale(uiLang); if (n) return n; }
    try { const n = normalizeLocale(chrome.i18n.getUILanguage()); if (n) return n; } catch (_) {}
    return 'zh_CN';
  }

  function t(key, fb) {
    try {
      const T = window.MT_I18N_MESSAGES;
      if (T) { const loc = effectiveLocale(); const m = T[loc] && T[loc][key]; if (m) return m; }
      const cm = chrome.i18n.getMessage(key); if (cm) return cm;
    } catch (_) {}
    return fb;
  }

  function applyI18n(titleKey) {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const m = t(el.dataset.i18n, ''); if (m) el.textContent = m;
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const m = t(el.dataset.i18nTitle, ''); if (m) el.title = m;
    });
    if (titleKey) { const dt = t(titleKey, ''); if (dt) document.title = dt; }
  }

  function setUiLang(v) { uiLang = v || 'auto'; }

  return { t, applyI18n, setUiLang, effectiveLocale, normalizeLocale };
})();
