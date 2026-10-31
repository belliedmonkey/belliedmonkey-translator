// store/hooks.js — the React binding layer, and the only file in src/store that
// imports React.
//
// useSyncExternalStore against SettingsStore/ViewStore: the store's getSnapshot
// returns a frozen object that only changes identity when something actually
// changed, which is the stability contract this hook requires.
//
// Deliberately thin. Testable logic (default fallback, echo dedup, rollback)
// lives in the stores and is unit-tested there through test/harness.js loadSrc;
// these hooks carry no logic a test could miss. Component rendering is verified
// by the real-browser gates (test:layout, CDP end-to-end), not in a DOM emulator
// — domain-design §10.2.

import { useSyncExternalStore, useMemo, useCallback } from 'react';
import SettingsStore from './settings-store.js';
import ViewStore from './view-store.js';
import SETTINGS_SCHEMA from './schema.js';
import PageText from '../lib/i18n.js';

// One setting's effective value: storage value, else schema default (or the
// caller's override — for page-local defaults the schema cannot know).
function useSetting(key, fallback) {
  const snapshot = useSyncExternalStore(SettingsStore.subscribe, SettingsStore.getSnapshot, SettingsStore.getSnapshot);
  const v = snapshot.values[key];
  if (v !== undefined) return v;
  return fallback !== undefined ? fallback : SETTINGS_SCHEMA.defaultFor(key);
}

// Several settings at once, as a stable object — memoized on the snapshot
// identity, so a component reading five keys re-renders once per change, not
// five times.
function useSettings(keys) {
  const snapshot = useSyncExternalStore(SettingsStore.subscribe, SettingsStore.getSnapshot, SettingsStore.getSnapshot);
  const sig = keys.join('\u0000');
  return useMemo(() => {
    const out = {};
    for (const k of keys) {
      const v = snapshot.values[k];
      out[k] = v === undefined ? SETTINGS_SCHEMA.defaultFor(k) : v;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sig tracks keys identity
  }, [snapshot, sig]);
}

// Current view + navigation. `current` is '' until ViewStore.boot() ran.
function useView() {
  const snapshot = useSyncExternalStore(ViewStore.subscribe, ViewStore.getSnapshot, ViewStore.getSnapshot);
  const navigate = useCallback((view, opts) => ViewStore.navigate(view, opts), []);
  const back = useCallback(() => ViewStore.back(), []);
  return { current: snapshot.current, depth: snapshot.depth, navigate, back };
}

// settings-store 的 status（'loading' | 'ok' | 'error'）。原始值快照，
// useSyncExternalStore 拿它当 React 的状态源是安全的。首帧门控用：读回前页面不猜
// （popup 的 setup-note、onboard 的全部文案都是这个语义）。原是 popup.jsx 的就地
// 定义；onboard 出现第二份拷贝时收编到这里（第三份出现前不再动）。
function useSettingsStatus() {
  return useSyncExternalStore(SettingsStore.subscribe,
    () => SettingsStore.getSnapshot().status,
    () => SettingsStore.getSnapshot().status);
}

// uiLang as a reactive value — i18n's useT() is built on this.
function useUiLang() {
  return useSyncExternalStore(PageText.subscribe, PageText.getUiLang, PageText.getUiLang);
}

export { useSetting, useSettings, useSettingsStatus, useView, useUiLang };
