// app/target-lang.js — App 里「译成什么语言」的唯一出口（docs/domain-design.md §2.6 规则 1）。
//
// App 一直没有目标语言设置：文档翻译与播客补译文各自默默回落到界面语言（verification-spec 记为
// 已知缺口）。2026-09-19 补上「译成」（存储键 targetLang，与扩展同名但两边存储不通）。
// 默认值是**空** = 跟随界面语言 —— 就是此前的实际行为，老用户升级后什么都不变；
// 不往存储里播种默认值，播种了用户以后改界面语言这一项就不会跟着动（同 listen.js 的 myLang）。
//
// 它不管「对话 · 实时字幕」：那里有自己的一对语言（listenMyLang / listenOtherLang / subtitleVideoLang）。
(function (root) {
  'use strict';
  // 界面语言的取值是 Chrome 的 locale 码（zh_CN / pt_BR），目标语言是 BCP-47 风格（zh-CN / pt）。
  // 只归一到注册表里有的值；认不出的原样返回（引擎提示词里会直接用它）。
  function fromLocale(code) {
    const c = String(code || '').replace('_', '-');
    if (!c) return '';
    const low = c.toLowerCase();
    if (low === 'zh-tw' || low === 'zh-hk' || low === 'zh-hant' || low.indexOf('zh-hant') === 0) return 'zh-TW';
    if (low === 'zh' || low.indexOf('zh-') === 0) return 'zh-CN';
    return c.split('-')[0];
  }
  // resolve(settings, navLang, fallback) → 目标语言码
  function resolve(s, navLang, fallback) {
    s = s || {};
    if (s.targetLang) return String(s.targetLang);
    const ui = s.uiLang && s.uiLang !== 'auto' ? s.uiLang : '';
    return fromLocale(ui) || fromLocale(navLang) || fallback || 'zh-CN';
  }
  const api = { resolve: resolve, fromLocale: fromLocale };
  root.AppTargetLang = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
