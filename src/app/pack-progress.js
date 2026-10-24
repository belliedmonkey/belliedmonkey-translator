// src/app/pack-progress.js — 识别包下载的进度与超时（2026-10-11，改稿 G 真机）。
//
// 听译页切语言、开会话补包，都走这里再交给 NativeSpeech.ensureAssets。
// 不读存储、不碰 DOM：名字和百分比在回调到来之前就换成这一门，
// 回调的 locale 对不上就丢掉，超时把这一门标成 stalled 而不是一直等。

/** 与首启 downloadAsr 同一个上限。系统资产没回执就停，不许无限等。 */
export const ASR_PACK_TIMEOUT_MS = 120000;

function baseOf(x) {
  return String(x || '').split(/[-_]/)[0].toLowerCase();
}

/** 下一门开始时的进度。名字是这门的本名，百分比从 0 起，不沿用上一门。 */
export function beginLangProgress(code, name) {
  const base = baseOf(code);
  const label = String(name || base || '').trim();
  if (!label) {
    const err = new Error('progress-name-required');
    err.code = 'progress-name-required';
    throw err;
  }
  return { code: base, name: label, pct: 0, stalled: false };
}

/**
 * 把一条进度回调写进当前这门。locale 对不上就原样返回（同一引用），
 * 调用方据此知道「这不是这一门的进度」。名字保持 begin 时的本名，不用回调里的 locale 字符串。
 */
export function applyLangProgress(state, msg) {
  if (!state) return state;
  const got = baseOf(msg && msg.locale);
  if (got && state.code && got !== state.code) return state;
  const fraction = Number(msg && msg.fraction);
  const pct = Number.isFinite(fraction) ? Math.max(0, Math.min(100, Math.round(fraction * 100))) : state.pct;
  return { code: state.code, name: state.name, pct, stalled: false };
}

export function stallLangProgress(state) {
  const s = state || { code: '', name: '', pct: 0, stalled: false };
  return { code: s.code, name: s.name, pct: s.pct, stalled: true };
}

/**
 * 首启屏「下载中 · 还剩 N 项」的计数（F12）：数**界面上这一屏画出来的、且选中的行**
 * 里还没就绪的项。判据必须与画面同源（`rowPhase()`）—— 一行在 `packRows` 里还没有
 * `phase`、界面靠 `packPhase==='downloading'` 现推成「排队中」时，也要算未就绪；
 * 只 filter `packRows` 已有键会漏掉它（真机就是这么写成「还剩 1 项」的）。
 * `phaseOf(id)` 回 `{ phase, pct? }`；'ready' 与 'unselected' 都不算。
 */
/**
 * N24v2 D-02：首启下载中总进度。
 * `phaseOf(id)` → `{ phase, pct? }`；`weightOf(id)` → 已知字节（0=未知）。
 * 有任一行在下/已就绪则给出 0–100 的均权百分比；全未知且无有效 pct 时 indeterminate。
 * `totalBytes` 用于「约 N MB」标签（调用方传入本批总字节，不含「已装不计入」的缩水）。
 */
export function aggregatePackProgress(ids, phaseOf, opts) {
  const o = opts || {};
  const list = ids || [];
  let sumPct = 0;
  let n = 0;
  let anyActive = false;
  let anyKnownWeight = false;
  for (const id of list) {
    const row = (typeof phaseOf === 'function') ? phaseOf(id) : null;
    const phase = row && row.phase;
    if (phase === 'unselected') continue;
    let pct = 0;
    if (phase === 'ready') pct = 100;
    else if (phase === 'downloading') pct = Math.max(0, Math.min(100, Math.round(Number(row && row.pct) || 0)));
    else if (phase === 'queued') pct = 0;
    else if (phase) pct = Math.max(0, Math.min(100, Math.round(Number(row && row.pct) || 0)));
    else continue;
    sumPct += pct;
    n++;
    if (phase === 'ready' || phase === 'downloading') anyActive = true;
    const w = (typeof o.weightOf === 'function') ? (Number(o.weightOf(id)) || 0) : 0;
    if (w > 0) anyKnownWeight = true;
  }
  const pct = n ? Math.round(sumPct / n) : 0;
  const totalBytes = Number(o.totalBytes) || 0;
  const indeterminate = !!o.forceIndeterminate || (n === 0) || (!anyActive && pct === 0 && !anyKnownWeight && totalBytes <= 0);
  return { pct, indeterminate, totalBytes, count: n };
}

export function pendingRowCount(ids, phaseOf) {
  let n = 0;
  for (const id of (ids || [])) {
    const row = (typeof phaseOf === 'function') ? phaseOf(id) : null;
    const phase = row && row.phase;
    if (phase === 'ready' || phase === 'unselected') continue;
    n++;
  }
  return n;
}

/**
 * 按顺序下识别包。每一门先复位进度，再把 toLocale 给出的完整 locale 交给 ensureAssets
 * （与开会话那条路同一个函数、同一种 locale）。generation 变了就停，不把旧回调写进新进度。
 * 超时或失败：这一门 stalled，不再往下，也不把没装上的记成已就绪。
 * `cancelled` 是更新的一轮把这一轮的请求撤掉了，不当成失败。
 */
export async function downloadAsrLangs(codes, deps) {
  const d = deps || {};
  const gen = d.generation;
  const current = typeof d.current === 'function' ? d.current : (() => gen);
  const timeoutMs = (typeof d.timeoutMs === 'number') ? d.timeoutMs : ASR_PACK_TIMEOUT_MS;
  const toLocale = typeof d.toLocale === 'function' ? d.toLocale : ((c) => c);
  const out = [];
  for (const code of (codes || [])) {
    if (current() !== gen) return out;
    const base = baseOf(code);
    if (!base) continue;
    let state = beginLangProgress(base, d.nameOf ? d.nameOf(base) : base);
    if (d.onState) d.onState(state);
    const locale = toLocale(base) || base;
    let timer = null;
    let alive = true;
    const timeout = new Promise((_res, rej) => {
      timer = setTimeout(() => {
        const e = new Error('stt-timeout');
        e.mtSttTimeout = true;
        e.reason = 'timeout';
        rej(e);
      }, timeoutMs);
    });
    let pending = null;
    try {
      pending = d.ensureAssets('stt', [locale], (m) => {
        if (!alive || current() !== gen) return;
        const next = applyLangProgress(state, m);
        if (next === state) return;
        state = next;
        if (d.onState) d.onState(state);
      }, timeoutMs);
      if (d.track) d.track(pending);
      await Promise.race([pending, timeout]);
      if (current() !== gen) return out;
      state = { code: state.code, name: state.name, pct: 100, stalled: false };
      if (d.onState) d.onState(state);
      out.push({ code: base, ok: true, locale, state });
    } catch (e) {
      alive = false;
      if (current() !== gen) return out;
      if (e && e.reason === 'cancelled') return out;
      state = stallLangProgress(state);
      if (d.onState) d.onState(state);
      out.push({
        code: base, ok: false, locale, stalled: !!(e && (e.mtSttTimeout || e.reason === 'timeout')),
        state, reason: (e && (e.reason || e.message)) || 'download',
      });
      return out;
    } finally {
      alive = false;
      if (timer) clearTimeout(timer);
    }
  }
  return out;
}
