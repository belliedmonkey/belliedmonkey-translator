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

  // 「现在点下去会不会白点」。判不了就**不拦** —— 注册表还没加载时把人拦在门外，
  // 比让他撞一次失败更糟：失败还有具名提示，被拦住则什么都不会发生。
  function needsSetup(settings) {
    const p = entry(settings);
    if (!p) return false;
    return !!p.needsKey && !String((settings && settings.apiKey) || '').trim();
  }

  // 「当前走的是不需要 key 的免费通道」。它与 needsSetup 不是互补关系：
  // 需要 key 且填了 key 的时候两者都是 false。
  function freeChannel(settings) {
    const p = entry(settings);
    return !!p && !p.needsKey;
  }

  return { byId, defaultId, resolve, entry, needsSetup, freeChannel };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EngineState;
