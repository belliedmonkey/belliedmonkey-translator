// lib/i18n.js — the one successor of the five t()/applyI18n copies.
//
// popup.js and options.js each carried a byte-identical copy; review.js was the
// third (extracted as extension/learn/i18n.js PageI18n, whose logic this follows
// verbatim); the app shell and quick panel hold the remaining copies. Pages
// migrate onto this module one PR at a time — PageI18n stays until the last
// consumer is gone, then both retire.
//
// Why not chrome.i18n alone: getMessage is locked to the browser/OS locale and
// cannot be switched at runtime, but the UI language is user-selectable (uiLang).
// Lookup order: bundled MT_I18N_MESSAGES table (through Registry — the table is a
// standalone gen script, 1.19 MB, never bundled) → chrome.i18n → the in-markup
// fallback. A missing key never blanks the UI.
//
// React: setUiLang() notifies subscribers, useT() re-renders on change — change
// uiLang once anywhere and the whole tree re-renders in the new language. No
// page-level repaint choreography. ("整块 UI 说错语言，偏偏另一块又是对的" — the
// 2026-09-25 incident that motivated the migration.)

import { useSyncExternalStore } from 'react';
import Registry from './registry.js';

const PageText = (() => {
  let uiLang = 'auto';
  const subscribers = new Set();

  function normalizeLocale(tag) {
    const T = Registry.messages();
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
      const T = Registry.messages();
      if (T) { const loc = effectiveLocale(); const m = T[loc] && T[loc][key]; if (m) return m; }
      const cm = chrome.i18n.getMessage(key); if (cm) return cm;
    } catch (_) {}
    return fb;
  }

  // Feed the stored uiLang in. Same value is a no-op — settings-store echoes are
  // already deduped, but pages call this on boot as well as on change.
  function setUiLang(v) {
    const next = v || 'auto';
    if (next === uiLang) return;
    uiLang = next;
    for (const fn of [...subscribers]) {
      try { fn(uiLang); }
      catch (e) { try { console.error('[i18n] subscriber threw', e); } catch (_) {} }
    }
  }

  function getUiLang() { return uiLang; }
  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  // The string uiLang is a stable snapshot value, so useSyncExternalStore cannot
  // loop; the returned t is the same module function every render — it reads the
  // module locale at call time, and the re-render is what makes callers re-run it.
  function useT() {
    useSyncExternalStore(subscribe, getUiLang, getUiLang);
    return t;
  }

  return { t, useT, setUiLang, getUiLang, subscribe, effectiveLocale, normalizeLocale };
})();

export default PageText;
