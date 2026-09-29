// cli/entry.js — 命令行宿主引擎的入口。`build/cli-bundle.js` 把它拼在 engine.js 的**最后**
// （前面那些模块都已挂好全局），Node `require('engine.js')` 拿到的就是这里的 `MTCli`。
//
// 这一层与 app/ext-entry.js 同一条纪律：**只做三件事** —— 读配置、调 TranslationAPI、
// 把失败翻译成调用方能直接渲染的 `{ok, code}`。一切与「怎么发请求」有关的判断（四种
// wire format、可选字段、停机码、重试）都在下面那几个模块里，三个宿主同一份字节 ——
// 这里多一行判断，就是第二份实现的开始。
'use strict';

var MTCli = (function () {
  // 配置快照（node-shim 从 global.__mtSeed 拷来，同步可读）。
  function settings() {
    return (typeof globalThis !== 'undefined' && globalThis.__mtStore) || {};
  }

  // 引擎三元组的唯一解析处与扩展 / App 同一个（LearnNotes.resolveConfig），
  // 「能不能用」的判据与设置页同一个（EngineState.needsSetup），不重判一遍。
  function resolveConfig() {
    var s = settings();
    var tr = LearnNotes.resolveConfig(s);
    return {
      provider: TranslationAPI.resolveProvider(tr.provider),
      apiKey: tr.apiKey || '',
      baseUrl: tr.baseUrl || '',
      model: tr.model || '',
      needsSetup: EngineState.needsSetup({
        provider: tr.provider, apiKey: tr.apiKey, apiBaseUrl: tr.baseUrl, engineChosen: !!s.engineChosen,
      }),
    };
  }

  // 注册表原样透出（cli/providers 命令用）。字段取渲染需要的那些，不重排、不新增。
  function providers() {
    var list = (typeof globalThis !== 'undefined' && globalThis.MT_PROVIDERS) || [];
    return list.map(function (p) {
      return {
        id: p.id,
        label: p.label,
        type: p.type,
        needsKey: !!p.needsKey,
        defaultModel: p.defaultModel || '',
        vision: !!p.vision,
        grantOnly: !!p.grantOnly,
      };
    });
  }

  function targetLang(opts) {
    var o = opts || {};
    if (o.lang) return String(o.lang);
    return AppTargetLang.resolve(settings(), o.uiLang || '', 'zh-CN');
  }

  // 与 ext-entry 的成功判据一致（domain-design §5.3）：非空，而不是「与原文不同」。
  async function translate(text, opts) {
    var o = opts || {};
    var src = String(text == null ? '' : text);
    if (!src.trim()) return { ok: false, code: 'empty' };
    var cfg = resolveConfig();
    if (cfg.needsSetup) return { ok: false, code: 'needs_setup' };
    var lang = targetLang(o);
    var t0 = Date.now();
    try {
      var out = await TranslationAPI.translate(
        src, lang, cfg.provider, cfg.apiKey, cfg.baseUrl, cfg.model, o.translateOpts);
      if (!out || !String(out).trim()) return { ok: false, code: 'empty_result' };
      return { ok: true, text: out, lang: lang, provider: cfg.provider, ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, code: (e && e.code) || 'unknown', status: (e && e.status) || 0 };
    }
  }

  async function detectLanguage(text) {
    var cfg = resolveConfig();
    if (cfg.needsSetup) return { ok: false, code: 'needs_setup' };
    try {
      var code = await TranslationAPI.detectLanguage(
        String(text || ''), cfg.provider, cfg.apiKey, cfg.baseUrl, cfg.model);
      return { ok: true, lang: code || '' };
    } catch (e) {
      return { ok: false, code: (e && e.code) || 'unknown' };
    }
  }

  // 供启动器确认这一份包真的起来了（与 MTExt.ready 同形）。
  function ready() {
    return {
      ok: typeof TranslationAPI !== 'undefined' && typeof TranslationAPI.translate === 'function',
      host: (typeof globalThis !== 'undefined' && globalThis.MT_HOST) || 'cli',
      provider: resolveConfig().provider,
    };
  }

  return { translate: translate, detectLanguage: detectLanguage, providers: providers,
    resolveConfig: resolveConfig, targetLang: targetLang, ready: ready };
}());

// Node：require('engine.js') 拿到 MTCli。同时挂一个全局名，方便在 vm 里读（测试同 ext-bundle）。
if (typeof module !== 'undefined' && module.exports) module.exports = MTCli;
if (typeof globalThis !== 'undefined') globalThis.MTCli = MTCli;
