// content/engine-state.js — 「这一刻能不能翻译」的**唯一**判据。
//
// 2026-09-01 画完引导与配置的全流程图之后建的。图上数出来：同一个问题在扩展里被算了
// 四遍，而它们互相不一致：
//
//   popup.js:233   needsKey && !apiKey   —— provider **未归一化**   → 弹窗要不要只留一个入口
//   popup.js:88    同一件事，另算一遍                                → 弹窗那条提示显示哪一支
//   options.js:124 同上，但 provider **已归一化**                    → 设置页那条提示
//   content-main.js:137 TranslationAPI.needsKey()（已归一化）        → 悬浮球跳不跳引导
//
// 归一化与否，在一个**注册表不认识的 provider id** 上会给出相反的结论：
// `providerById(x) || {}` 的 `needsKey` 是 undefined ⇒ 假 ⇒ 「已配好，免费通道」；
// 先归一化则落到注册表第一条 ⇒ 可能 ⇒ 「没配好」。真实触发场景不是假想的：中国版带着
// 遗留的 `provider:'google'`（background.js 的 DEFAULT_SETTINGS 写的），而 google 的
// flavors 是 ['global'] —— 那个 id 在中国版的注册表里根本不存在。同一台设备上，
// 弹窗说「免费通道，一切正常」并保留完整界面，悬浮球却判成未配置直接跳走。
//
// 所以这里定死一条：**任何人问「配好了没有」，都先把 provider 归一化。** 归一化本身
// 也只有这一份实现 —— translation-api.js 的 providerById / defaultProvider /
// resolveProvider 现在都转调它，options.js 与 popup.js 的同名局部函数也是。
//
// ⚠️ 这个文件回答的是「能不能翻译」，**不是**「一键卡该不该覆盖某一路」。后者是
// quick-setup.js 的 state()，判据是 `has(apiKey)` 而不是 `needsKey && !apiKey` ——
// 两者对免费通道结论相反，而那是**对的**：免费通道对「能不能用」是能用，对「要不要
// 被一键配置覆盖」是可以覆盖。不要把它们并成一个。

var EngineState = (() => {
  'use strict';

  const list = () => ((typeof window !== 'undefined' && window.MT_PROVIDERS) || []);

  function byId(id) { return list().find((p) => p.id === id) || null; }

  // 「本次构建的默认引擎」只有一个来源：注册表的第一条。**不写死任何 id** ——
  // options.js 原来在这里兜底成 'google'，而那个 id 在中国版里不存在。
  function defaultId() { const l = list(); return (l[0] && l[0].id) || ''; }

  // 存值本次构建不认识 ⇒ 回落到默认。返回值与入参不同就是「需要自愈」的信号，
  // 调用方据此把存储改正，免得界面写着 A、实际发的是 B。
  function resolve(id) { return byId(id) ? id : defaultId(); }

  // 归一化之后的那个注册表条目。注册表还没加载时是 null。
  function entry(settings) { return byId(resolve(settings && settings.provider)); }

  // 「配好了没有」。
  //
  // 2026-09-01 用户裁定：**决策不再为免费通道开特例**，第一优先级是一键配置。
  // 所以判据从「当前引擎需不需要 key」改成「有没有配过」——旧判据把**出厂默认**的
  // 免费引擎算成已配好，于是全球版全新安装的人永远不会被推去配一次，而那正是要改的。
  //
  // 但不能只写 `!has(apiKey)`：那样**故意选了免费引擎的人永远满足不了它**，悬浮球会
  // 一直把他弹回引导页。所以第二个出口是 engineChosen —— 用户**主动点选过**引擎。
  // 出厂默认不算选择，用户自己点的才算，这正是这次要区分开的那件事。
  function needsSetup(settings) {
    const s = settings || {};
    if (String(s.apiKey || '').trim()) return false;      // 配过 key
    const p = entry(s);
    if (!p) return false;                                 // 注册表还没加载 ⇒ 不拦
    // 主动选过一个不需要 key 的引擎 ⇒ 那是一次选择，不是「还没配」。
    return !(s.engineChosen && !p.needsKey);
  }

  return { byId, defaultId, resolve, entry, needsSetup };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EngineState;
