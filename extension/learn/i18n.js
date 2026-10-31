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

  // 把用户在设置里选的 `uiLang` 灌进来，然后回调（回调总是「把这一页重画一遍」）。
  //
  // **每一个会画字的页面都要在启动时调它一次。** 存储是异步的，所以页面必然先按
  // 系统语言画了一遍；不补这一次重画，那一页就**永远**停在系统语言上 —— 而症状
  // 不是「少了一句翻译」，是整块 UI 说错语言，偏偏另一块又是对的，看着像随机。
  //
  // 2026-09-25 真机实测（系统语言中文、界面语言设成 English、杀掉 App 重开）：
  // 设置页是英文（它经 review.js 调过 setUiLang），而**首页整块**与**快速翻译面板**
  // 还是中文 —— 这两条启动路径上一次都没调过。词条一个不缺，缺的是这一次调用。
  function applyStoredUiLang(repaint) {
    let done = false;
    const fire = () => { if (done) return; done = true; try { repaint && repaint(); } catch (_) {} };
    try {
      chrome.storage.local.get(['uiLang'], (v) => { setUiLang((v && v.uiLang) || 'auto'); fire(); });
    } catch (_) { fire(); }   // 没有 chrome.storage 的宿主：按系统语言画的那一遍就是最终结果
  }

  return { t, applyI18n, setUiLang, applyStoredUiLang, effectiveLocale, normalizeLocale };
})();
