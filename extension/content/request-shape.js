// content/request-shape.js — 请求体的两个问题：**发哪些字段**，和**怎么解回来**。
//
// `wire-format.js` 回答「打哪个地址、用哪种形状」；这里回答形状定下之后剩下的那个：
// 可选字段发不发。四条传输（翻译 / 解析 / 朗读 / 转写）全部经过这里，所以「我们发了
// 什么」在整个产品里只有一份实现——在此之前它有两份逐字重复的（translation-api 的
// 三个 adapter 与 notes.js 的 buildRequest），连 extractResponses 的注释都一样。
//
// ── 为什么不塞进 wire-format.js ────────────────────────────────────────────
// 那个文件刻意零依赖、纯函数，测试把它当依赖直接注入而不是打桩。本模块要读
// chrome.storage（用户的高级参数），塞进去会毁掉那个性质。
//
// ── 三态：这是本模块最要紧的一处 ────────────────────────────────────────────
//
// `temperature` / `budget` 各有三种状态，**「表里没有」不等于「表说不支持」**：
//
//   表         用户明确设了值            用户没设
//   ─────────  ────────────────────────  ──────────────────────
//   false      **不发**（表赢）           不发
//   true       发用户的值                 发我们的调优默认（0.3）
//   缺省/表外   **发用户的值**             **不发**（最小必要集）
//
// 左下角那格（表赢）是产品决定：一个已知会被拒的字段发出去只会让整页翻不了。
// 右下角那格是这次改动的主命题：陌生端点只发协议要求的最小必要字段。
//
// 而**左中那格**（不知道 + 用户明说 ⇒ 发）不是在稀释「表赢」，它是 wire-format.js
// 既有教义的同一条：「`type` 是我们对一个 id 的猜测，URL 是用户对端点的陈述」。
// 用户在高级面板填的值同样是他对自己端点的陈述。若把它也压成「表外一律不发」，这个
// 面板对唯一真正需要它的人群（填 custom_chat 用企业网关的人）就是死的 —— 而那正是
// 2026-08-20 促成这次改动的那个用户。

var RequestShape = (() => {
  // 唯一的一份。原来 translation-api.js 与 notes.js 各写了一个 0.3。
  const DEFAULT_TEMPERATURE = 0.3;

  // 表外 = 三个字段全是「不知道」，**不是「不支持」**。这个区别撑起上面那张三态表。
  const UNKNOWN = Object.freeze({
    id: null, temperature: undefined, budget: undefined, systemRole: undefined,
    reasoning: undefined, matched: false,
  });

  // ─── 表：host + 模型前缀 ────────────────────────────────────────────────
  function paramsFor(url, model) {
    const rows = (typeof window !== 'undefined' && window.MT_MODEL_PARAMS) || [];
    const host = (typeof WireFormat !== 'undefined' ? WireFormat.hostOf(url) : '');
    if (!host) return UNKNOWN;
    const m = String(model == null ? '' : model).trim().toLowerCase();

    let best = null;
    let bestLen = -1;
    for (const row of rows) {
      if (!row.hosts || row.hosts.indexOf(host) < 0) continue;
      const prefixes = row.models || [];
      if (!prefixes.length) {                       // host 通行行，特异度 0
        if (bestLen < 0) { best = row; bestLen = 0; }
        continue;
      }
      if (!m) continue;                             // 模型名未知 ⇒ 只有通行行能命中
      for (const p of prefixes) {
        // `>` 而不是 `>=`：等长时文件顺序在先者赢，于是「表的顺序」是一个可读、可
        // review 的优先级，而不是取决于遍历实现。
        if (m.indexOf(p) === 0 && p.length > bestLen) { best = row; bestLen = p.length; }
      }
    }
    if (!best) return UNKNOWN;
    return Object.freeze({
      id: best.id,
      temperature: best.temperature,
      budget: best.budget,
      systemRole: best.systemRole,
      reasoning: best.reasoning,
      matched: true,
    });
  }

  // ─── 高级参数（用户设的；未设 = 键不存在）────────────────────────────────
  const ADV_KEYS = ['reqTemperature', 'reqMaxTokens', 'reqTimeoutSec', 'reqConcurrency'];
  const CLAMP = {
    // 下限 0.01 而不是 0：至少一家（minimax）拒收 0，而「0」在数值输入框里是用户最
    // 容易打出来的边界值。
    reqTemperature: [0.01, 2],
    reqMaxTokens: [16, 32000],
    reqTimeoutSec: [5, 120],
    reqConcurrency: [1, 16],
  };
  let _prefs = {};
  let _ready = null;

  // 「空即未设」在这一个函数里判定，别处不许再判一次。'' / null / undefined / NaN /
  // 越界 一律 ⇒ 该键不出现在 _prefs 里 ⇒ 三态里的「用户没设」。
  function normalizePrefs(res) {
    const out = {};
    for (const k of ADV_KEYS) {
      const raw = res[k];
      if (raw === '' || raw == null) continue;
      const n = Number(raw);
      if (!isFinite(n)) continue;
      const [lo, hi] = CLAMP[k];
      out[k] = Math.max(lo, Math.min(hi, n));
    }
    return out;
  }

  function readOnce() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(ADV_KEYS, (res) => {
          // try 必须包住**回调体**，不只是 get 调用。Safari 会把 res 交成 undefined，
          // 在回调里抛的异常外面那层 try 永远看不到，promise 于是永不 settle ——
          // 那正是 translation-api.js 的 cacheGetStorage 留下的疤（整页卡在「翻译中…」）。
          try { _prefs = normalizePrefs(res || {}); } catch (_) { _prefs = {}; }
          resolve(_prefs);
        });
      } catch (_) {
        // 读失败 = 空 = 「用户什么都没设」= 最小必要集。安全方向。
        _prefs = {};
        resolve(_prefs);
      }
    });
  }

  function ready() { return _ready || (_ready = readOnce()); }
  function refresh() { _ready = readOnce(); return _ready; }
  function prefs() { return _prefs; }

  try {
    chrome.storage.onChanged.addListener((changes) => {
      if (ADV_KEYS.some((k) => k in changes)) refresh();
    });
  } catch (_) { /* 无 chrome（测试/Node）时不装监听 */ }

  // 传输层的两个常量现在由用户可调。取值函数而不是常量：调高要立刻生效，不能等下次
  // 加载。（并发调低无法抢占已经在飞的请求——那点写在设置页的 hint 里。）
  function timeoutMs() { return (_prefs.reqTimeoutSec || 20) * 1000; }
  function maxConcurrent() { return _prefs.reqConcurrency || 5; }

  // ─── 解析：三份逐字重复合并成三个函数 ──────────────────────────────────
  // 一律 null-safe。translation-api 原来是裸 `d.choices[0].message.content`，一个畸形
  // 响应就抛 TypeError，被上层当成「网络错误」——空正文该由调用方具名成 empty_output。
  function extractChat(d) {
    return (d && d.choices && d.choices[0] && d.choices[0].message
      && d.choices[0].message.content) || '';
  }
  function extractMessages(d) {
    return (d && d.content && d.content[0] && d.content[0].text) || '';
  }
  // NEVER output[0]：推理模型把 `{type:'reasoning'}` 放在第 0 位、答案在其后，所以
  // 索引 0 在人们最常用的那批模型上恰好是空的。`output_text` 是扁平便利字段，可能
  // 不存在于原始 HTTP 正文里，所以遍历才是实现、它只是快路径。
  function extractResponses(d) {
    if (d && typeof d.output_text === 'string' && d.output_text.trim()) return d.output_text;
    let out = '';
    for (const it of (d && Array.isArray(d.output) ? d.output : [])) {
      if (!it || it.type !== 'message') continue;
      for (const c of (Array.isArray(it.content) ? it.content : [])) {
        if (c && (c.type === 'output_text' || typeof c.text === 'string')) out += (c.text || '');
      }
    }
    return out;
  }

  // ─── 请求体 ────────────────────────────────────────────────────────────
  // 可选字段的**唯一**决策点。三态在这一个函数里判，别处不许再判一次。
  // 这个形状的语言词汇表跟我们的语言代码不是一回事。实测 2026-08-20（19 个取值）：
  //
  //   zh / en / ja / ko / fr / de / es / ar / pt / ru / it   ⇒ 200
  //   zh-CN · zh_CN · zh-TW · zh-Hant                        ⇒ 400 暂时不支持当前设置的语种！
  //   Traditional Chinese                                    ⇒ 200，且输出确实是繁体
  //
  // 所以**不能**用「去掉地区后缀」这个想当然的写法：`zh-TW` 那样会变成 `zh`，服务端
  // 照常 200，而繁体用户拿到的是简体 —— 又一个静默出错。只显式映射我们确知的两条，
  // 其余原样透传：一个没见过的代码会换来那句可见的 400，而不是一段悄悄错掉的译文。
  const TRANSLATE_LANG = { 'zh-cn': 'zh', 'zh-tw': 'Traditional Chinese' };
  function translateLang(code) {
    const k = String(code == null ? '' : code).trim().toLowerCase();
    if (!k) return 'zh';
    return TRANSLATE_LANG[k] || String(code).trim();
  }

  // 「模型把预算全用在思考上了」。两条形状各有各的信号，但后果一样：HTTP 200、
  // 正文为空。不认出来的话它只是一个泛泛的「翻译失败」，而用户重试多少次都一样失败 ——
  // 那是这套设计里最坏的一种失败：看起来可恢复，实际上永远不会恢复。
  function starvedByReasoning(d) {
    if (!d || typeof d !== 'object') return false;
    const c = d.choices && d.choices[0];
    if (c && c.finish_reason === 'length') return true;           // chat-compat
    if (d.status === 'incomplete') return true;                    // responses-compat
    const ic = d.incomplete_details;
    if (ic && ic.reason === 'max_output_tokens') return true;
    return false;
  }

  function optional(cap, want, tuned) {
    if (cap === false) return undefined;                    // 表明确否决 ⇒ 无条件不发
    if (want !== undefined && want !== null && want !== '') return want;  // 用户明说
    if (cap === true) return tuned;                          // 表明确许可 ⇒ 调优默认
    return undefined;                                        // 不知道且没人要求 ⇒ 不发
  }
  const put = (obj, k, v) => { if (v !== undefined) obj[k] = v; return obj; };

  // build(fmt, o) → { headers, body, extract, caps, isForm? }
  //   o.budget  调用方给的输出预算（翻译 2000 / 解析 3000 —— 真实的产品差异，各自
  //             待在它们的论证旁边，是这次归并里唯一不该归并的东西）
  //   o.prefs   省略则用模块缓存（ready() 读过的）
  function build(fmt, o) {
    const p = o.prefs || _prefs;
    const caps = paramsFor(o.url, o.model);
    const bearer = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + o.apiKey };

    if (fmt === 'messages-compat') {
      const budget = (p.reqMaxTokens > 0) ? p.reqMaxTokens : o.budget;
      return {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': o.apiKey,
          // 协议头，不是品牌引用（build.js 的合规门注释里写明了这一点）。
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        // max_tokens 在这条链路上是**协议必填**，不是可选字段：表说 false 也照发。
        // 一行观测表不能推翻一条 API 契约。
        body: put({
          model: o.model, max_tokens: budget, system: o.system,
          messages: [{ role: 'user', content: o.user }],
        }, 'temperature', optional(caps.temperature, p.reqTemperature, DEFAULT_TEMPERATURE)),
        extract: extractMessages, caps,
      };
    }

    if (fmt === 'responses-compat') {
      const body = { model: o.model, instructions: o.system, input: o.user };
      put(body, 'temperature', optional(caps.temperature, p.reqTemperature, DEFAULT_TEMPERATURE));
      // 名字由**形状**决定：Responses 只认 max_output_tokens。表的改名权只在
      // chat-compat 内部生效——那是唯一真有名字分裂的形状。
      put(body, 'max_output_tokens',
        optional(caps.budget === undefined ? undefined : caps.budget !== false,
          p.reqMaxTokens, o.budget));
      // 推理档位：表只存档位，拼法由形状决定。这条形状要嵌套写法，写成顶层字符串会 400，
      // 原话为证：「In the Responses API, this parameter has moved to 'reasoning.effort'」。
      if (caps.reasoning) body.reasoning = { effort: caps.reasoning };
      return { headers: bearer, body, extract: extractResponses, caps };
    }

    // 翻译专用形状（qwen-mt 家族）。三条硬约束全部来自 2026-08-20 的实测：
    //   · 只能有**一条** user 消息 —— 多一条 400，system 角色 400。
    //   · 目标语言走 `translation_options`，不走提示词。
    //   · **漏了 translation_options 不会报错**：服务端 200，把原文原样吐回来。
    //
    // 最后一条决定了这里的写法：那个字段是**按构造存在**的，不经过 put()、不看用户
    // 设置、没有任何分支能把它拿掉。它不是可选字段表的一员，它是这个形状的定义本身。
    if (fmt === 'translate-compat') {
      const body = {
        model: o.model,
        messages: [{ role: 'user', content: o.user }],
        translation_options: {
          source_lang: o.sourceLang || 'auto',
          target_lang: translateLang(o.targetLang),
        },
      };
      // 可选字段仍然按能力表走 —— dashscope 那一行说收 temperature 与 max_tokens，
      // 实测也确实收（带上二者 200）。系统提示词在这个形状里**没有位置**，调用方给了
      // 也丢掉：模型的任务由 translation_options 定义，不由提示词定义。
      put(body, 'temperature', optional(caps.temperature, p.reqTemperature, DEFAULT_TEMPERATURE));
      if (caps.budget !== false) {
        put(body, 'max_tokens', optional(true, p.reqMaxTokens, o.budget));
      }
      return { headers: bearer, body, extract: extractChat, caps };
    }

    if (fmt === 'speech-compat') {
      const body = { model: o.model, input: o.input, voice: o.voice };
      // response_format 只在调用方给了值时才发。今天 tts.js 恒传它自己 DEFAULTS 里的
      // 'mp3'，所以线上行为不变；这里不替它兜一个默认值，是为了让「不发」将来成为一个
      // 可选项 —— tts.js 已经从响应的 content-type 读真实类型（tts.js:204），不依赖
      // 自己点的那个格式。
      put(body, 'response_format', o.format || undefined);
      return {
        headers: Object.assign({ 'Content-Type': 'application/json' },
          o.apiKey ? { Authorization: 'Bearer ' + o.apiKey } : {}),
        body, extract: null, caps,
      };
    }

    if (fmt === 'transcribe-compat') {
      const fd = new FormData();
      fd.append('file', o.file, o.filename);         // 唯一必发的
      if (o.model) fd.append('model', o.model);
      if (o.language) fd.append('language', o.language);
      // **不设 Content-Type**：multipart 的 boundary 只有浏览器自己知道，手写这个头
      // 会让服务端解不出分段。这是一个经典坑，所以写在这里而不是靠调用方记得。
      return {
        headers: o.apiKey ? { Authorization: 'Bearer ' + o.apiKey } : {},
        body: fd, isForm: true, extract: null, caps,
      };
    }

    // 默认 chat-compat。它面对整个兼容动物园，所以是三态规则唯一真正吃劲的地方。
    const body = {
      model: o.model,
      messages: [
        { role: caps.systemRole || 'system', content: o.system },
        { role: 'user', content: o.user },
      ],
    };
    put(body, 'temperature', optional(caps.temperature, p.reqTemperature, DEFAULT_TEMPERATURE));
    // 推理档位。这条形状用顶层字符串（Responses 那条要嵌套，见上）。
    //
    // 为什么翻译要主动把它压到最低：推理开销**不随输入变小而变小**。实测 2026-08-20
    // （gpt-5-mini，真 key）：不发这个字段时，一段 870 字的正文 27.8 秒把 2000 的预算
    // 全部烧在思考上，finish_reason=length、正文 0 字 —— 用户看到的是「翻译失败」，
    // 而重试永远同样失败。加上 minimal 后同一段 5.6 秒成功、推理 0 tok。
    put(body, 'reasoning_effort', caps.reasoning || undefined);
    const budgetName = (typeof caps.budget === 'string') ? caps.budget : 'max_tokens';
    put(body, budgetName,
      optional(caps.budget === undefined ? undefined : caps.budget !== false,
        p.reqMaxTokens, o.budget));
    return { headers: bearer, body, extract: extractChat, caps };
  }

  return {
    paramsFor, build, ready, refresh, prefs, timeoutMs, maxConcurrent,
    extractChat, extractMessages, extractResponses,
    DEFAULT_TEMPERATURE, UNKNOWN, ADV_KEYS, CLAMP, translateLang, starvedByReasoning,
  };
})();

if (typeof window !== 'undefined') window.RequestShape = RequestShape;
if (typeof module !== 'undefined' && module.exports) module.exports = RequestShape;
