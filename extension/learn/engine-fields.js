// learn/engine-fields.js — 「这个引擎该露出哪几个框」和「用注册表填下拉」的**唯一**实现。
//
// 抽出来的理由不是代码复用，是**它已经漂了**。同一条规则在仓库里有八份：
//
//   options.js  updateProviderUI / updateTtsUI 头部 / updateSttUI / updateNotesUI
//   app/settings.js  三处（tts / stt / notes，注释里明写「mirroring the extension
//                    options page」）
//   onboard.js  syncKeyRow（退化版：只有引擎 + Key）
//
// 四处可观察的漂移，每一处都是一个静默的行为差异：
//
//   1. `supportsKey ?? needsKey` 只在 tts / stt 有，chat / notes 只看 needsKey。
//      （对今天的数据两者等价 —— build.js:540 已经把 supportsKey 归一化过了 ——
//       但两种写法并存意味着下一个加字段的人要猜哪份是对的。）
//   2. `endpointPlaceholder` 只在 chat / stt 用了，tts / notes 的地址框没有示例地址。
//   3. 一半用 `style.display = 'none'`，一半用 `hidden`。后者会被任何一条 display
//      声明压掉 —— 那正是 test/hidden-guard.test.js 存在的理由。
//   4. chat 把 Key / 地址 / 模型三个框裹在一个 `#apikey-fields` 里，所以「不需要 Key」
//      会连地址和模型一起藏掉；tts / stt 是各藏各的。
//
// **这个文件只回答「显示什么」，不碰 DOM 结构。** 各调用点保留自己的 id 与
// display/hidden 习惯 —— 抽的是规则，不是 markup。markup 的收敛是另一步，风险完全
// 不同：options 的那 19 个 id 被 saveAll() 的 assertSaveFields 钉着，被 smoke 里
// 「改一个无关字段不许冲掉配置」那条钉着，动它要另配门禁。
//
// 形状照 sources-view.js / quick-setup.js：不碰 chrome.storage，不读全局 document，
// 需要什么由调用方传进来。

var EngineFields = (() => {
  'use strict';

  // 注册表条目的显示名。三份注册表（providers / tts / stt）同一套字段约定。
  function labelOf(e, t) {
    if (!e) return '';
    const fb = e.label || e.id || '';
    return e.labelKey && typeof t === 'function' ? t(e.labelKey, fb) : fb;
  }

  // 「这个条目要露哪几个框」。**纯函数**，给一个注册表条目，回一份判据。
  //
  // key 的判据写成 `supportsKey === undefined ? needsKey : supportsKey`，而不是
  // `supportsKey ?? needsKey`：两者对 null 的处理不同，而生成物里 providers 是
  // **整个字段不存在**（undefined），tts/stt 是 build.js 归一化过的布尔。写死
  // undefined 这一个判据，两边都对，且不依赖 `??` 的空值语义。
  //
  // needsKey ≠ supportsKey：`stt.config.js:36` 明写过这一句 ——「needsKey=false 是
  // 『不强制』，supportsKey=true 是『可以填』，两件事」。自建端点就是这一类。
  function visibility(entry) {
    const e = entry || null;
    if (!e) return { key: false, baseUrl: false, model: false, basePlaceholder: '', modelPlaceholder: '' };
    return {
      key: e.supportsKey === undefined ? !!e.needsKey : !!e.supportsKey,
      baseUrl: !!e.supportsBaseUrl,
      model: !!e.supportsModel,
      // 示例地址的来源顺序与 options.js 原来的 endpointPlaceholder 逐字一致：
      // 默认端点 → 注册表给的示例 → 一个兜底。registry 的 `placeholder` 字段存在的
      // 理由就是这个（domain-design §7：让 UI 能给出示例而不必抄一份地址）。
      basePlaceholder: e.defaultEndpoint || e.placeholder || 'https://…',
      modelPlaceholder: e.defaultModel || '',
    };
  }

  // 用注册表填一个 <select>。七份抄写的差异只有两点，所以只开两个口子：
  //
  //   sentinel  —— 置顶的哨兵项。notes 的 '' 是「跟随翻译引擎」，stt 的 '' 是
  //                「未配置（不出说题）」。两者都是**有语义的空**，不是占位符。
  //   fallback  —— 存着的 id 注册表不认识时选谁。chat 落到第一项（浏览器默认行为），
  //                tts 落到第一个引擎，notes/stt 落回哨兵。
  //
  // 不认识存着的 id 是常见情况而不是异常：换 flavor、降级安装、厂商下架，都会让
  // 一个合法保存过的 id 消失。落到一个能用的选项，比留一个空 select 好。
  function populate(sel, entries, opts) {
    if (!sel) return '';
    const o = opts || {};
    const list = Array.isArray(entries) ? entries : [];
    const doc = sel.ownerDocument || document;
    sel.innerHTML = '';
    if (o.sentinel) {
      const s = doc.createElement('option');
      s.value = o.sentinel.value === undefined ? '' : o.sentinel.value;
      s.textContent = o.sentinel.text || '';
      sel.appendChild(s);
    }
    for (const e of list) {
      const opt = doc.createElement('option');
      opt.value = e.id;
      opt.textContent = labelOf(e, o.t);
      sel.appendChild(opt);
    }
    const known = list.some((e) => e.id === o.selected);
    const fallback = o.fallback !== undefined ? o.fallback
      : (o.sentinel ? (o.sentinel.value === undefined ? '' : o.sentinel.value)
        : (list[0] ? list[0].id : ''));
    sel.value = known ? o.selected : fallback;
    return sel.value;
  }

  return { labelOf, visibility, populate };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EngineFields;
