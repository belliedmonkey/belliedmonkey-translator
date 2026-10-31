// shared/engine-fields.js — 「这个引擎该露出哪几个框」和「用注册表填下拉」的**唯一**实现。
//
// 抽出来的理由不是代码复用，是**它已经漂了**。同一条规则在仓库里有八份：
//
//   options.js  updateProviderUI / updateTtsUI 头部 / updateSttUI / updateNotesUI
//   src/app/settings-view.jsx  三处（tts / stt / notes，注释里明写「mirroring the extension
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
//   render()                   —— 连 markup 一起给。本文件只含纯规则；render 在
//                                 src/pages/engine-fields-view.jsx（PR7b 起）。两个
//                                 文件同一次编译进两宿主（§9.4 对账门）。
//
// 分两层是刻意的：options 的那 19 个 id 被 saveAll() 的 assertSaveFields 钉着、被
// smoke 里「改一个无关字段不许冲掉配置」钉着，所以 markup 的迁移风险和规则的收敛
// 完全不是一回事，得分开落地、分开验。render() 吐出的 id **就是 options 今天那一套**，
// 正是为了让那一步不需要任何覆盖。
//
// 形状照 sources-view.js / quick-setup.js：不碰 chrome.storage，不读全局 document，
// 需要什么由调用方传进来。
//
// PR7b：原 extension/learn/engine-fields.js（IIFE + window.MT_* 直读）收编为 ESM。
// SLOTS.registry 的键从生成注册表名（'MT_PROVIDERS'）改成 Registry 的 getter 名
// （'providers' / 'ttsEngines' / 'sttEngines'）—— 字符串里出现 MT_ 会红
// test/src-boundaries.test.js，而注册表名只该登记在 lib/registry.js 一处。

import Registry from '../lib/registry.js';

// 注册表条目的显示名。三份注册表（providers / tts / stt）同一套字段约定。
export function labelOf(e, t) {
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
// 本机引擎（设备内置转写 / 设备内置朗读）：由 type 推导，不加布尔字段（domain-design §7）。
export function isDevice(e) { return !!(e && typeof e.type === 'string' && e.type.indexOf('device-') === 0); }

export function visibility(entry) {
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
export function populate(sel, entries, opts) {
  if (!sel) return '';
  const o = opts || {};
  // `grantOnly` 的条目（免费额度的中继，§8.10）**不进任何下拉**：它没有可粘的
  // key，令牌是登录之后系统发的。手选它只会得到 401，而那是一个用户无法自己解决
  // 的失败。**例外是它正被选中时** —— 那时必须留在列表里，否则下拉会显示成空白，
  // 用户看到的是「我明明配好了，这里却什么都没有」（半配显示不出来那一类）。
  const all = Array.isArray(entries) ? entries : [];
  // 本机条目（type 以 device- 开头，§9.6.1）只在**桥在**的宿主里出现：调用方探过桥后把
  // `deviceOk` 传进来，组件自己不探（domain-design §5.3 规则 2）。扩展页从不传 true。
  // 同 grantOnly：正被选中时必须留在列表里，否则下拉显示成空白。
  const list = all.filter((e) => (!e.grantOnly || e.id === o.selected)
    && (!isDevice(e) || o.deviceOk || e.id === o.selected));
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
    // 2026-09-11 → 09-17 这里给带实时接口的转写条目加过「· 实时」后缀；实时转写固定为设备内置
    // 之后注册表里没有实时档，后缀连同它的判据一起删除（domain-design §7 2026-09-17 修订）。
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
//
// registry 键存的是 lib/registry.js 的 getter 名（不再是生成注册表的全局名）；
// entries 视图层解析：Registry[spec.registry]() —— 归 lib/registry.js 独家摸全局。
export const SLOTS = {
  chat: {
    registry: 'providers',
    keys: { engine: 'provider', key: 'apiKey', baseUrl: 'apiBaseUrl', model: 'apiModel' },
    ids: { engine: 'provider', key: 'api-key', baseUrl: 'api-base-url', model: 'api-model' },
    labelKey: 'qs_slot_chat',
    sentinelKey: null,
  },
  tts: {
    registry: 'ttsEngines',
    keys: { engine: 'ttsEngine', key: 'ttsApiKey', baseUrl: 'ttsBaseUrl', model: 'ttsModel' },
    ids: { engine: 'tts-engine', key: 'tts-api-key', baseUrl: 'tts-base-url', model: 'tts-model' },
    labelKey: 'qs_slot_tts',
    // '' 是**有语义的空**：未配置 ⇒ 不朗读。2026-09-04 起语音不再默认走系统自带
    // （效果撑不起这个产品的核心体验），所以它和 stt 一样需要一个哨兵项，
    // 而不是让下拉默默停在第一个引擎上。
    sentinelKey: 'tts_engine_none',
  },
  // 解析（「解析这句」用的对话引擎）。条目不是整张 providers 表，而是
  // LearnNotes.chatEngines() 过滤后的那一份 —— 由 host 通过 opts.entries 传进来，
  // 组件不认识 LearnNotes。
  notes: {
    registry: 'providers',
    keys: { engine: 'notesProvider', key: 'notesApiKey', baseUrl: 'notesBaseUrl', model: 'notesModel' },
    ids: { engine: 'notes-provider', key: 'notes-api-key', baseUrl: 'notes-base-url', model: 'notes-model' },
    labelKey: 'notes_engine',
    // '' = 跟随翻译引擎的**整组**配置。选了别的就只用解析自己这一组 —— 全有或全无，
    // 因为借翻译引擎的 key 去配另一家的端点，就是「把 key 和一个不是发给它的端点
    // 配在一起」。所以这个空值是语义，不是占位符。
    sentinelKey: 'notes_follow',
  },
  stt: {
    registry: 'sttEngines',
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
export function fieldLabels(slot, t) {
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
      sentinel: t('tts_engine_none', '未配置（不朗读）'),
    };
  }
  if (slot === 'notes') {
    return {
      engine: t('notes_engine', '解析引擎'),
      key: t('notes_api_key', '解析 API Key'),
      baseUrl: t('notes_base_url', '解析 API 地址'),
      model: t('notes_model', '解析模型'),
      head: t('notes_engine', '解析引擎'),
      sentinel: t('notes_follow', '跟随翻译引擎（默认）'),
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

export const STYLE = `
  .ef-slot { display:flex; flex-direction:column; gap:6px; }
  .ef-test { display:flex; flex-direction:column; gap:6px; margin-top:8px; }
  .ef-test-btn { align-self:flex-start; }
  .ef-test-note { margin:0; font-size:.86rem; color:var(--text-secondary); }
  .ef-test-note.ok { color:var(--sage-strong); }
  .ef-test-note.bad { color:var(--danger); }
  .ef-slot + .ef-slot { margin-top:14px; }
  .ef-head { font-weight:600; font-size:.95em; }
  .ef-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .ef-row label { flex:0 0 auto; font-size:.85em; opacity:.75; min-width:5.5em; }
  .ef-row input, .ef-row select { flex:1 1 8em; min-width:0; }
  .ef-row .input-row { flex:1 1 8em; min-width:0; display:flex; gap:6px; align-items:center; }
  .ef-row .input-row input { flex:1 1 auto; }
  .ef-field-note { flex:1 0 100%; margin:2px 0 0; font-size:.82rem; color:var(--danger); }
`;

let styled = false;
export function injectStyle(doc) {
  if (styled || !doc || !doc.head) return;
  const el = doc.createElement('style'); el.textContent = STYLE; doc.head.appendChild(el);
  styled = true;
}

export default { labelOf, visibility, populate, SLOTS, isDevice, fieldLabels, STYLE, injectStyle };
