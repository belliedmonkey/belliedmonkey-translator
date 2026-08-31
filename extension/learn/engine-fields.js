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
// 两层，可以只用上面那层：
//
//   visibility() / populate()  —— 纯规则，不碰 DOM。options 的四处调它，各自保留
//                                 自己的 id 与 display/hidden 习惯。
//   render()                   —— 连 markup 一起给。引导页用它，options 以后也会。
//
// 分两层是刻意的：options 的那 19 个 id 被 saveAll() 的 assertSaveFields 钉着、被
// smoke 里「改一个无关字段不许冲掉配置」钉着，所以 markup 的迁移风险和规则的收敛
// 完全不是一回事，得分开落地、分开验。render() 吐出的 id **就是 options 今天那一套**，
// 正是为了让那一步不需要任何覆盖。
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


  // ── 三个能力槽的规格表 ──────────────────────────────────────────────────────
  //
  // id 用的是 **options 今天那一套**，不是新造的。两个理由：
  //   1. options 的 saveAll() 按字面量读这些 id，且开头就断言它们都在。组件照旧吐出
  //      同样的 id，第 3 步把 options 迁过来时不需要任何覆盖，saveAll 一个字不改。
  //   2. 两个页面渲染出来的是**同一批控件**，而不是「长得像的两套」。用户在设置页学会
  //      的东西，在引导页原样成立。
  //
  // 同一个文档里三个槽的 id 互不重叠；两个文档之间重名无所谓（各自的 document）。
  const SLOTS = {
    chat: {
      registry: 'MT_PROVIDERS',
      keys: { engine: 'provider', key: 'apiKey', baseUrl: 'apiBaseUrl', model: 'apiModel' },
      ids: { engine: 'provider', key: 'api-key', baseUrl: 'api-base-url', model: 'api-model' },
      labelKey: 'qs_slot_chat',
      sentinelKey: null,
    },
    tts: {
      registry: 'MT_TTS_ENGINES',
      keys: { engine: 'ttsEngine', key: 'ttsApiKey', baseUrl: 'ttsBaseUrl', model: 'ttsModel' },
      ids: { engine: 'tts-engine', key: 'tts-api-key', baseUrl: 'tts-base-url', model: 'tts-model' },
      labelKey: 'qs_slot_tts',
      sentinelKey: null,
    },
    stt: {
      registry: 'MT_STT_ENGINES',
      keys: { engine: 'sttEngine', key: 'sttApiKey', baseUrl: 'sttBaseUrl', model: 'sttModel' },
      ids: { engine: 'stt-engine', key: 'stt-api-key', baseUrl: 'stt-base-url', model: 'stt-model' },
      labelKey: 'qs_slot_stt',
      // '' 是**有语义的空**：未配置 ⇒ 不出「说」题。「录音去哪儿必须是一次显式选择」
      // 那条裁定的落点就是这个哨兵项。
      sentinelKey: 'stt_engine_none',
    },
  };

  // 标签写成 t() 调用，不是 [key, 兜底串] 的表。放进数据结构里，
  // test/no-hardcoded-copy.test.js 认不出那是兜底位（它只认紧跟在 `t('key',` 后面的
  // 那一个字面量），于是一整张表的中文会变成谁都翻译不到的硬编码。
  function fieldLabels(slot, t) {
    if (slot === 'chat') {
      return {
        engine: t('options_engine_label', '引擎'),
        key: t('extob_key_label', 'API Key'),
        baseUrl: t('label_custom_api', '接口地址（完整）'),
        model: t('label_custom_model', '模型'),
        head: t('qs_slot_chat', '翻译'),
        sentinel: '',
      };
    }
    if (slot === 'tts') {
      return {
        engine: t('tts_engine', '语音引擎'),
        key: t('tts_api_key', '语音 API Key'),
        baseUrl: t('tts_base_url', '语音端点地址'),
        model: t('tts_model', '语音模型'),
        head: t('qs_slot_tts', '朗读'),
        sentinel: '',
      };
    }
    return {
      engine: t('stt_engine', '转写引擎'),
      key: t('stt_api_key', '转写 API Key'),
      baseUrl: t('stt_base_url', '转写端点地址'),
      model: t('stt_model', '转写模型'),
      head: t('qs_slot_stt', '转写'),
      sentinel: t('stt_engine_none', '未配置（不出「说」题）'),
    };
  }

  const STYLE = `
    .ef-slot { display:flex; flex-direction:column; gap:6px; }
    .ef-slot + .ef-slot { margin-top:14px; }
    .ef-head { font-weight:600; font-size:.95em; }
    .ef-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .ef-row label { flex:0 0 auto; font-size:.85em; opacity:.75; min-width:5.5em; }
    .ef-row input, .ef-row select { flex:1 1 8em; min-width:0; }
    .ef-row .input-row { flex:1 1 8em; min-width:0; display:flex; gap:6px; align-items:center; }
    .ef-row .input-row input { flex:1 1 auto; }
  `;
  let styled = false;
  function injectStyle(doc) {
    if (styled || !doc || !doc.head) return;
    const el = doc.createElement('style'); el.textContent = STYLE; doc.head.appendChild(el);
    styled = true;
  }

  // render(container, { slot, t, entries?, values, onChange })
  //
  // **不碰 chrome.storage**（同 quick-setup.js / sources-view.js）：把当前值传进来，
  // 改动通过 onChange(patch) 交回去，patch 的键是**存储键**而不是 DOM id —— host 拿到
  // 就能直接写盘，不必再翻译一次。
  //
  // 一次渲染一个槽。三个槽连着渲染就是「三引擎分别配」，单独渲染一个就是 options 的
  // 一张卡。两者是同一段代码。
  function render(container, opts) {
    if (!container) return null;
    const o = opts || {};
    const spec = SLOTS[o.slot];
    if (!spec) return null;
    const t = o.t || ((k, fb) => fb);
    const doc = container.ownerDocument || document;
    const w = (typeof window !== 'undefined') ? window : {};
    const entries = o.entries || w[spec.registry] || [];
    const values = o.values || {};
    injectStyle(doc);

    const el = (tag, cls, txt) => {
      const n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (txt != null) n.textContent = txt;
      return n;
    };
    const emit = (patch) => { if (typeof o.onChange === 'function') o.onChange(patch); };

    const L = fieldLabels(o.slot, t);
    const box = el('div', 'ef-slot');
    // head:false 给设置页用 —— 那边每个槽已经有一张卡的标题，再来一行「转写」是重复。
    // 引导页三个槽连着排，没有小标题就分不清哪三行属于哪一样。
    if (o.head !== false) box.append(el('div', 'ef-head', L.head));

    // 引擎行
    const engineRow = el('div', 'ef-row');
    const engineLabel = el('label', null, L.engine);
    engineLabel.setAttribute('for', spec.ids.engine);
    const sel = doc.createElement('select');
    sel.id = spec.ids.engine;
    populate(sel, entries, {
      t,
      selected: values[spec.keys.engine] || '',
      sentinel: spec.sentinelKey ? { value: '', text: L.sentinel } : null,
    });
    engineRow.append(engineLabel, sel);
    box.append(engineRow);

    // 其余三行。每一行都**始终建出来**，只切 hidden —— 与 options 同一条规矩：
    // 藏可以，删不行（删掉之后读它的地方会拿到 null，而 null 会被当成「用户清空了」）。
    const rows = {};
    for (const f of ['key', 'baseUrl', 'model']) {
      const row = el('div', 'ef-row');
      const lab = el('label', null, L[f]);
      lab.setAttribute('for', spec.ids[f]);
      const inp = doc.createElement('input');
      inp.id = spec.ids[f];
      inp.type = f === 'key' ? 'password' : (f === 'baseUrl' ? 'url' : 'text');
      inp.autocomplete = 'off';
      inp.spellcheck = false;
      inp.value = values[spec.keys[f]] || '';
      // input 而不是 change：change 只在失焦时触发，用户填完直接点「继续」就丢了。
      // 2026-08-30 在 options.js 上修过的同一个缺陷，不要在新代码里重犯。
      inp.addEventListener('input', () => emit({ [spec.keys[f]]: inp.value.trim() }));
      // 输入框外面套一层 .input-row，是为了让 host 能往它**旁边**挂东西（设置页的
      // 「显示/隐藏」眼睛按钮就贴在 Key 输入框右边）。给组件加一堆 `eye:true`
      // `hint:'…'` 参数是另一条路，但那会让组件替每个 host 猜它想要什么；交回句柄，
      // host 自己挂，组件只管那四个框本身。
      const wrap = el('div', 'input-row');
      wrap.append(inp);
      row.append(lab, wrap);
      box.append(row);
      rows[f] = { row, input: inp, inputRow: wrap };
    }

    function paint() {
      const cur = entries.find((e) => e.id === sel.value) || null;
      const v = visibility(cur);
      rows.key.row.hidden = !v.key;
      rows.baseUrl.row.hidden = !v.baseUrl;
      rows.model.row.hidden = !v.model;
      rows.baseUrl.input.placeholder = v.basePlaceholder;
      rows.model.input.placeholder = v.modelPlaceholder;
    }

    // 换引擎时清端点。**两个 host 都要**，所以放在组件里而不是各自的 change 处理器里
    // —— options.js 原来为 stt 单独写过一份 clearEndpointOnEngineSwitch。
    sel.addEventListener('change', () => {
      // 换引擎清空端点：把一个引擎的地址留给另一个引擎，正是 notes.js 明文禁止的
      // 「把 key 和一个不是发给它的端点配在一起」。清空 = 走注册表默认 = 能工作。
      rows.baseUrl.input.value = '';
      paint();
      emit({ [spec.keys.engine]: sel.value, [spec.keys.baseUrl]: '' });
    });

    paint();
    container.append(box);
    // rows 交回去：host 想往某一行里加提示、按钮，就往 rows[f].row / .inputRow 里挂。
    // 挂在行内**而不是行外**是构成要件 —— 行按 visibility 收起时，挂在里面的东西
    // 跟着一起收；挂在外面就会出现「字段藏了、它的提示还在」。
    return { el: box, paint, rows, ids: spec.ids, keys: spec.keys };
  }

  return { labelOf, visibility, populate, render, SLOTS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EngineFields;
