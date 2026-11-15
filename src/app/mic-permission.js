// src/app/mic-permission.js — BEL-273：进入听译前的麦克风权限状态机（纯逻辑）。
//
// 这里只回答「现在该画哪一屏、能不能开麦、用户这一下点了之后去哪里」，
// 不碰 DOM、不碰原生桥、不碰存储 —— 桥的副作用留在 listen-model.js。
//
// 为什么要单独一个状态机：以前只有「点了开始 → 原生要权限 → 失败后显示拒绝」这一条路。
// 用户在看到任何解释之前就被系统框问一次；拒绝之后只在失败文案里看到一句「去设置」，
// 没有任何可点的动作，也没有「从设置回来再试一次」的路径。BEL-273 把这三步拆开：
//
//   unknown / not_determined ──(进入听译)──> explain ──(继续)──> requesting
//                                              │                     │
//                                              │              ┌──────┴──────┐
//                                              │          granted        denied/restricted
//                                              │              │              │
//                                              │              ▼              ▼
//                                              │            start          denied
//                                              │                              │
//                                              └──────────────────────(重试/去设置)
//
// 状态只有下面这些；未知状态一律不猜。`unknown` 不是「没权限」，是「还没读到」——
// 老壳不认 mic-perm-read 时它保持 unknown，开始流程退回 BEL-273 之前的原生请求路径。
'use strict';

export const STATES = ['unknown', 'not_determined', 'prompted', 'granted', 'denied', 'restricted'];
export const GATES = ['', 'explain', 'requesting', 'denied'];

/** 当前是否是可以开麦的状态。unknown 放行（老壳没有预检，只能让原生去问）。 */
export function canStart(m) {
  const s = m && m.state;
  if (s === 'granted' || s === 'unknown') return true;
  if (s === 'not_determined') return !!(m && m.explained);
  return false;   // prompted（请求在飞）/ denied / restricted
}

/** 进入听译页时的门：已拒绝就直接给「去设置」，没问过就先解释。 */
export function enter(m, state) {
  const next = Object.assign({}, m);
  if (state) next.state = norm(state);
  const s = next.state;
  if (s === 'granted' || s === 'unknown') next.gate = '';
  else if (s === 'denied' || s === 'restricted') next.gate = 'denied';
  else if (s === 'not_determined') next.gate = next.explained ? 'requesting' : 'explain';
  else if (s === 'prompted') next.gate = 'requesting';
  return next;
}

/** 原生回报（预检读或系统框之后）：只做状态迁移，返回新对象。 */
export function observe(m, state) {
  const s = norm(state);
  if (!s) return m;
  const next = Object.assign({}, m, { state: s });
  if (s === 'granted') next.gate = '';
  else if (s === 'denied' || s === 'restricted') next.gate = 'denied';
  else if (s === 'prompted') next.gate = 'requesting';
  else if (s === 'not_determined') next.gate = next.explained ? 'requesting' : 'explain';
  return next;
}

/** 用户点了「继续」：先解释过，下一次开麦才会触发系统框。 */
export function explain(m) {
  if (!m || m.gate !== 'explain') return m;
  return Object.assign({}, m, { explained: true, gate: 'requesting' });
}

/** 用户点了「去设置」：只记一笔，状态等原生回读；不在这里假装 granted。 */
export function openSettings(m) {
  return Object.assign({}, m, { settingsOpened: true });
}

/** 从设置回来后的显式「重试」：授权了就清门，没授权就留在拒绝门。 */
export function retry(m) {
  if (m && m.state === 'granted') return Object.assign({}, m, { gate: '' });
  return m;
}

export function initial() {
  return { state: 'unknown', gate: '', explained: false, settingsOpened: false };
}

export function norm(state) {
  const s = String(state || '');
  return STATES.indexOf(s) >= 0 ? s : '';
}
