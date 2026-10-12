// src/app/asr-quota.js — 识别语言名额的**本机记忆**（第 5 轮 A / 改稿 H）。
//
// 系统只告诉我们「此刻占着名额的语言」(`AssetInventory.reservedLocales`)，不会告诉我们
// 「这门以前装过、只是名额被让出去了」。而改稿 H 要求把这两种情况分开显示（可补回 vs 未下载），
// 所以这里持久化两件事：
//   · installed —— 见过 `.installed` 的短码（让出后仍在，显示「未就绪·可补回」）；
//   · lastUsed  —— 每门最后一次**听译使用**的时间（满员时默认让出最久没用的那门）。
// 系统资产本身不会被我们删除（`release` 只是把状态打回 .supported），所以「补回」通常 1–2 秒。
//
// 不碰 DOM；storage 读不到就退回空记忆（宁可少显示「可补回」，也不误报）。

const KEY_INSTALLED = 'listenAsrInstalled';
const KEY_LASTUSED = 'listenAsrLastUsed';

function base(x) {
  return String(x || '').split(/[-_]/)[0].toLowerCase();
}

/** 读本机记忆 { installed: {code:true}, lastUsed: {code:ms} }。 */
export function readMemory() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([KEY_INSTALLED, KEY_LASTUSED], (v) => {
        const installed = {};
        for (const c of ((v && v[KEY_INSTALLED]) || [])) { const b = base(c); if (b) installed[b] = true; }
        const lastUsed = {};
        const raw = (v && v[KEY_LASTUSED]) || {};
        for (const k of Object.keys(raw)) {
          const b = base(k); const n = Number(raw[k]);
          if (b && Number.isFinite(n) && n > 0) lastUsed[b] = n;
        }
        resolve({ installed, lastUsed });
      });
    } catch (_) { resolve({ installed: {}, lastUsed: {} }); }
  });
}

/** 把这几门标成「装过」。就地改 memory，返回是否有变化。 */
export function markInstalled(memory, codes) {
  const m = memory || { installed: {} };
  if (!m.installed) m.installed = {};
  let changed = false;
  for (const c of (codes || [])) {
    const b = base(c);
    if (b && !m.installed[b]) { m.installed[b] = true; changed = true; }
  }
  return changed;
}

export function saveInstalled(memory) {
  try { chrome.storage.local.set({ [KEY_INSTALLED]: Object.keys((memory && memory.installed) || {}) }); } catch (_) {}
}

/** 记一次「这门被用于听译」。就地改 lastUsed，并落盘。 */
export function noteUsed(lastUsed, codes, at) {
  const t = Number(at) || Date.now();
  for (const c of (codes || [])) {
    const b = base(c);
    if (b) lastUsed[b] = t;
  }
  try { chrome.storage.local.set({ [KEY_LASTUSED]: lastUsed }); } catch (_) {}
  return lastUsed;
}

export const QUOTA_KEYS = { KEY_INSTALLED, KEY_LASTUSED };
