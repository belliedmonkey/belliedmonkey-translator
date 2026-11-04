// src/shared/quota.js — 免费额度余额的**唯一运行时来源**（P1-1，2026-11-04）。
//
// 背景（真机口径）：设置页画的是「剩余 / 上限」（$0.06 / $0.20），对话/字幕的
// 额度条画的是「已用 / 上限」（$0.14 / $0.20）。同一个 grantBalance、同一分钟，
// 两处数字却对不上 —— 不是缓存不同步，而是**同一个字段被两套口径解释**。
// 更糟的是设置页只在 claim（领取/改回额度）时刷新，会话里余额往前走时它停在旧值。
//
// 这里收口两件事：
//   1. 一个 formatter（grant.js 的 spentText）：两处都只显示 spent / limit；
//   2. 一个刷新入口（本文件）：进设置 / 回前台时从 `GET bt-relay/balance` 拉一次，
//      成功写回 `grantBalance`，所有宿主经 `subscribe` / `watch` 看同一份快照。
//
// 断网 / 失败时的纪律与 grant.js 的 fresh() 一致：**保留上次的值，标注未刷新**，
// 不把旧数字冒充当前值。`grantBalance.at` 仍是「最后一次成功」的时间；失败只加
// `stale: true` / `staleReason` / `staleAt`，不把 at 刷新成现在。
//
// 与 grant.js 同一条分工：纯逻辑模块不写存储的说法在这里不适用 —— 余额缓存是
// **事件记录**，不是设置；它没有宿主保存路径（claim 的宿主 saveAll 也只是顺带
// 写一次）。刷新结果必须立刻落到同一个键，否则两个宿主各留一份内存快照，又会
// 长回今天的病。写入只碰 grantBalance 一个键。

import Registry from '../lib/registry.js';
import * as LearnGrant from './grant.js';

export const KEYS = ['grantBalance', 'grantTail', 'apiKey', 'ttsApiKey', 'sttApiKey'];

let last = null;               // 最后一次已知快照（含 stale 标记）
let inflight = null;           // 合并同一次进前台的并发刷新
let watching = false;
const subscribers = new Set();

function defaultStorage() {
  try {
    const c = (typeof chrome !== 'undefined') ? chrome : null;
    return (c && c.storage && c.storage.local) ? c.storage.local : null;
  } catch (_) { return null; }
}

function read(storage, keys) {
  const s = storage || defaultStorage();
  return new Promise((resolve) => {
    if (!s || typeof s.get !== 'function') { resolve({}); return; }
    try { s.get(keys, (v) => resolve(v || {})); } catch (_) { resolve({}); }
  });
}

function write(storage, items) {
  const s = storage || defaultStorage();
  return new Promise((resolve) => {
    if (!s || typeof s.set !== 'function') { resolve(false); return; }
    try { s.set(items, () => resolve(true)); } catch (_) { resolve(false); }
  });
}

// 只留下余额字段；storage 里可能混着旧版本写进来的别的键。
export function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (Object.prototype.hasOwnProperty.call(raw, 'limitUsd')) out.limitUsd = Number(raw.limitUsd);
  if (Object.prototype.hasOwnProperty.call(raw, 'spentUsd')) out.spentUsd = Number(raw.spentUsd || 0);
  if (Object.prototype.hasOwnProperty.call(raw, 'at')) out.at = Number(raw.at) || 0;
  if (raw.stale === true) out.stale = true;
  if (raw.staleReason) out.staleReason = String(raw.staleReason);
  if (raw.staleAt) out.staleAt = Number(raw.staleAt) || 0;
  return Object.keys(out).length ? out : null;
}

// 两处共用的 formatter 在 grant.js（spentText）；这里只是把「刷新回来的余额」
// 交给订阅者，避免每个宿主自己再解释一遍字段。
export function current() {
  if (!last) return null;
  return Object.assign({}, last);
}

export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  subscribers.add(fn);
  if (last) { try { fn(current()); } catch (_) {} }
  return () => subscribers.delete(fn);
}

function notify(balance, meta) {
  last = balance ? Object.assign({}, balance) : null;
  for (const fn of subscribers) {
    try { fn(current(), meta || {}); } catch (_) {}
  }
}

// 任何宿主（设置页写入、扩展设置页领取）直接改 storage 时，内存快照也跟着走。
// 这样「两处订阅同一状态」不依赖谁先刷新：storage 是持久总线，本模块是内存总线。
export function watch(opts) {
  if (watching) return;
  const o = opts || {};
  let bus = o.storageEvents;
  if (!bus) {
    try {
      const c = (typeof chrome !== 'undefined') ? chrome : null;
      bus = c && c.storage && c.storage.onChanged;
    } catch (_) { bus = null; }
  }
  if (!bus || typeof bus.addListener !== 'function') return;
  watching = true;
  try {
    bus.addListener((changes, area) => {
      if (area && area !== 'local') return;
      if (!changes || !changes.grantBalance) return;
      const next = normalize(changes.grantBalance.newValue);
      if (!next) return;
      notify(next, { source: 'storage' });
    });
  } catch (_) { /* 宿主没有 storage 事件：refresh/subscribe 仍然可用 */ }
}

// 中继余额端点。两种构建的 claimUrl 形状不同，但都只差最后一段：
//   全球版  https://<host>/functions/v1/bt-grant   → .../bt-relay/balance
//   中国版  https://<relay>/claim                  → https://<relay>/balance
// 退化路径用 grant 注册表里的 chat 端点（.../chat/completions → .../balance）。
export function balanceUrl(spec) {
  const sp = spec || Registry.grant();
  if (!sp) return '';
  const claim = String(sp.claimUrl || '').replace(/\/+$/, '');
  if (/\/bt-grant$/i.test(claim)) return claim.replace(/\/bt-grant$/i, '/bt-relay/balance');
  if (/\/claim$/i.test(claim)) return claim.replace(/\/claim$/i, '/balance');
  try {
    const p = (Registry.providers() || []).find((x) => x.id === 'grant');
    const ep = String((p && p.defaultEndpoint) || '').replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(ep)) return ep.replace(/\/chat\/completions$/i, '/balance');
  } catch (_) {}
  return claim ? claim + '/balance' : '';
}

function noopResult(balance, code, extra) {
  return Object.assign({ ok: false, code: code || '', balance: balance || null }, extra || {});
}

// refresh({ settings?, storage?, fetch?, now?, force? })
//   settings 省略时现读 storage（listen 的常见路径）。
//   force=true 时忽略 10 分钟缓存 —— 进设置 / 回前台用。
//   返回 { ok, code, balance }；失败时 balance 是保留的旧值（带 stale 标记）。
export function refresh(opts) {
  const o = opts || {};
  const storage = o.storage || null;
  const now = typeof o.now === 'function' ? o.now : Date.now;
  if (inflight) return inflight;
  inflight = (async () => {
    const settings = o.settings || await read(storage, KEYS);
    const prev = normalize(settings && settings.grantBalance) || current();

    // 没有额度规格（中国版官方额度 / 关闭的构建）或翻译槽不是额度：没有可刷的。
    if (!LearnGrant.enabled()) return noopResult(prev, 'grant_unavailable');
    if (!LearnGrant.activeIn(settings || {}, 'chat')) return noopResult(prev, 'not_active');

    const token = String((settings && settings.apiKey) || '');
    if (!token) return noopResult(prev, 'signed_out');

    if (!o.force && prev && LearnGrant.fresh(prev, now())) {
      notify(prev, { source: 'cache' });
      return { ok: true, code: 'fresh', balance: current() };
    }

    const url = o.balanceUrl || balanceUrl();
    if (!url) return noopResult(prev, 'grant_misconfigured');

    const fetchFn = o.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchFn) return noopResult(prev, 'no_fetch');

    let res;
    try {
      res = await fetchFn(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
      });
    } catch (_) {
      return markStale(storage, prev, 'offline', now);
    }
    if (!res || !res.ok) return markStale(storage, prev, 'http_' + ((res && res.status) || 0), now);
    let body = {};
    try { body = await res.json(); } catch (_) { return markStale(storage, prev, 'bad_json', now); }
    const spent = Number(body && body.spent_usd);
    const limit = Number(body && body.limit_usd);
    if (!Number.isFinite(spent) || !Number.isFinite(limit) || !(limit > 0)) {
      return markStale(storage, prev, 'bad_body', now);
    }
    const bal = { spentUsd: spent, limitUsd: limit, at: now() };
    await write(storage, { grantBalance: bal });
    notify(bal, { source: 'refresh' });
    return { ok: true, code: '', balance: current() };
  })().finally(() => { inflight = null; });
  return inflight;
}

async function markStale(storage, prev, code, now) {
  const at = now();
  if (!prev) return noopResult(null, code);
  const bal = Object.assign({}, prev, { stale: true, staleReason: code, staleAt: at });
  await write(storage, { grantBalance: bal });
  notify(bal, { source: 'stale', code });
  return noopResult(current(), code, { stale: true });
}

// 退出登录 / 清本机数据时由宿主清掉内存快照，避免下一次 refresh 用另一个账号的余额。
export function clear() {
  last = null;
  inflight = null;
  notify(null, { source: 'clear' });
}

export default {
  KEYS, normalize, current, subscribe, watch, balanceUrl, refresh, clear,
  // 两处共用的数字口径（与设置卡 / 字幕条同一个函数）。
  spentText: LearnGrant.spentText,
};
