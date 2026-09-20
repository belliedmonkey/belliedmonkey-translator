// app/ext-entry.js — 系统翻译扩展（iOS）在 JavaScriptCore 里的入口。
//
// `build/ext-bundle.js` 把它拼在 ExtEngine.js 的**最后**（前面那些模块都已挂好全局）。
// 原生侧只认这一个名字：`MTExt.translate(text, opts) -> Promise<结果>`。
//
// 这一层**只做三件事**：读配置、调 TranslationAPI、把失败翻译成原生能直接渲染的形状。
// 一切与「怎么发请求」有关的判断（四种 wire format、发哪些可选字段、中继、停机码）
// 都在下面那几个模块里，两个宿主同一份字节 —— 这里多一行判断，就是第二份实现的开始。
//
// 与 Mac 快速翻译面板（app/quick.js）同形：同样先 resolveConfig、同样先问 needsSetup、
// 同样用 AppTargetLang 决定译入语言。那边是 WKWebView，这边是 JSC，形状一致是有意的。
'use strict';

var MTExt = (function () {
  // 弹层里要展示的失败形状。**不把原始错误抛给原生** —— 原生只会把它原样画在屏幕上，
  // 而用户看到 `TypeError: undefined is not an object` 学不到任何东西。错误码是既有那套
  // （translation-api 的 e.code），文案与出口由原生按码查表，和 Mac 面板同一张表。
  function fail(code, status) {
    return { ok: false, code: code || 'unknown', status: status || 0 };
  }

  // 未配置态：弹层要给的是「打开大肚猴翻译」而不是一句错误。
  // 判据用 EngineState.needsSetup —— 与设置页、Mac 面板同一个函数，不重判一遍。
  function needsSetup(s, tr) {
    return EngineState.needsSetup({ provider: tr.provider, apiKey: tr.apiKey, apiBaseUrl: tr.baseUrl });
  }

  // opts.lang：这一次弹层里用户改过的目标语言（只在本次有效 —— 扩展回写不了 App 的设置）。
  // 不传就按设置里的「译成」，再不然跟随系统界面语言。
  async function translate(text, opts) {
    const o = opts || {};
    const src = String(text == null ? '' : text);
    if (!src.trim()) return fail('empty');

    let s;
    try {
      s = await new Promise((r) => chrome.storage.local.get(null, (v) => r(v || {})));
    } catch (_) {
      return fail('no_settings');
    }

    const tr = LearnNotes.resolveConfig(s);   // 引擎三元组的唯一解析处，与设置页 / Mac 面板同一个
    if (needsSetup(s, tr)) return fail('needs_setup');

    // 回落值写死在这里而不是取 TranslationCore.DEFAULT_TARGET_LANG：这一份包**不带**
    // translation-core（33 KB 的字幕引擎，翻一段文字用不上），而 AppTargetLang.resolve
    // 本来就要一个显式的 fallback 参数。
    const lang = o.lang || AppTargetLang.resolve(s, o.uiLang || '', 'zh-CN');

    const t0 = Date.now();
    try {
      const out = await TranslationAPI.translate(
        src, lang,
        TranslationAPI.resolveProvider(tr.provider),
        tr.apiKey, tr.baseUrl || '', tr.model || '',
      );
      // 成功的判据与别处一致（§5.3）：**非空**，而不是「与原文不同」——
      // 同语言、专有名词、数字，译文本来就可能与原文逐字相同。
      // 这里直接写这一行而不是调 TranslationCore.isTranslated：那个模块没进这一份包。
      if (!out || !String(out).trim()) return fail('empty_result');
      return { ok: true, text: out, lang, provider: TranslationAPI.resolveProvider(tr.provider), ms: Date.now() - t0 };
    } catch (e) {
      return fail(e && e.code, e && e.status);
    }
  }

  // 原生在建上下文之后会调一次，确认这一份包真的起来了（就绪 3–10 ms，尖刺 T1）。
  // 返回值里不带任何设置 —— 探活就是探活，不顺便泄漏 key 的长度之类。
  function ready() {
    return {
      ok: typeof TranslationAPI !== 'undefined' && typeof TranslationAPI.translate === 'function',
      host: MT_HOST,
    };
  }

  return { translate, ready };
}());

// JSC 里 `var` 挂不到全局对象上（取决于求值方式），显式挂一次，原生按名字取。
if (typeof globalThis !== 'undefined') globalThis.MTExt = MTExt;
