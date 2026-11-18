// src/app/mic-permission.js — BEL-273：听译页的麦克风权限状态机（纯逻辑）。
//
// 这里只回答「现在是什么状态、能不能开麦、用户点去设置之后记什么」，
// 不碰 DOM、不碰原生桥、不碰存储 —— 桥的副作用留在 listen-model.js。
//
// 方案 B（2026-11-18 用户过审）把 #701 的「先解释、再继续」整步拿掉了：
// 页面里只有一颗「开始」，第一次点在 not_determined 上**直接**触发原生
// mic-start（系统框只弹一次），同时由 listen-model 画一行 first-hint。
// 因此这里不再有 explain 门，not_determined 的 canStart 是 true。
//
//   unknown ────────────────► 放行（老壳没有预检，让原生去问）
//   not_determined ─────────► 放行 + 行内 first-hint（本页只画一次）
//   granted ────────────────► 放行
//   prompted ───────────────► 挡住（系统框在飞）
//   denied / restricted ────► 挡住（行内 denied + 文本链「去设置」）
//
// `unknown` 不是「没权限」，是「还没读到」。未知状态一律不猜。
'use strict';

export const STATES = ['unknown', 'not_determined', 'prompted', 'granted', 'denied', 'restricted'];
export const GATES = ['', 'requesting', 'denied'];

/** 当前是否是可以开麦的状态。 */
export function canStart(m) {
  const s = m && m.state;
  if (s === 'granted' || s === 'unknown' || s === 'not_determined') return true;
  return false;   // prompted（请求在飞）/ denied / restricted
}

function gateFor(s) {
  if (s === 'denied' || s === 'restricted') return 'denied';
  if (s === 'prompted') return 'requesting';
  return '';
}

/** 进入听译页时的门：只记录状态与派生 gate，不再有解释步。 */
export function enter(m, state) {
  const next = Object.assign({}, m);
  if (state) next.state = norm(state);
  next.gate = gateFor(next.state);
  return next;
}

/** 原生回报（预检读或系统框之后）：只做状态迁移，返回新对象。 */
export function observe(m, state) {
  const s = norm(state);
  if (!s) return m;
  return Object.assign({}, m, { state: s, gate: gateFor(s) });
}

/** 用户点了文本链「去设置」：只记一笔，状态等原生回读；不在这里假装 granted。 */
export function openSettings(m) {
  return Object.assign({}, m, { settingsOpened: true });
}

/** 从设置回来后的显式重读：授权了就清门，没授权就留在 gate。 */
export function retry(m) {
  if (m && (m.state === 'granted' || m.state === 'unknown' || m.state === 'not_determined')) {
    return Object.assign({}, m, { gate: '' });
  }
  return m;
}

export function initial() {
  return { state: 'unknown', gate: '', settingsOpened: false };
}

export function norm(state) {
  const s = String(state || '');
  return STATES.indexOf(s) >= 0 ? s : '';
}
