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
  const ADV_KEYS = ['reqTemperature', 'reqMaxTokens', 'reqTimeoutSec', 'reqConcurrency',
    'reqCustomParams'];

  // ─── 自定义请求参数：给能力表的一个**用户可控的逃生口** ──────────────────
  //
  // 这张表的默认态是「表外 = 最小必要」，那对私域端点是安全的，但也意味着用户**没有
  // 任何办法**告诉我们「我这个内网网关其实收 thinking」。而我们永远测不到那些端点 ——
  // 没有 key、打不到、也不该要求用户把内网地址交出来。
  //
  // 所以开一个口子，规则三条（用户裁定 2026-08-21）：
  //   · 自由 JSON —— 固定下拉覆盖不到「我们没见过的字段」，而那正是它存在的理由
  //   · **冲突时用户赢** —— 表的权威来自实测，而对一个我们根本没测过的 host，用户的
  //     了解胜过我们的表；写错的代价是一个带服务端原话的 400，可见、可恢复
  //   · **按引擎条目存** —— 为 A 网关写的字段不该在切到 B 引擎时跟着发出去
  //
  // ⚠️ 这个口子**不改变表本身的准入规则**：没填自定义时，表外 host 的请求体仍然只有
  // {model, messages}。逃生口是显式的、按引擎的、后果由用户自己承担的。
  const CUSTOM_FORBIDDEN = ['model', 'messages', 'system', 'input', 'instructions',
    'stream', 'translation_options'];
  // 为什么这几个不许覆盖：
  //   model/messages/system/input/instructions —— 改了它们不是「调参数」，是把请求换成
  //     另一个请求，之后的解析与渲染全部对不上。
  //   stream —— sseMerge 已随 #159 删除。打开它换来的是一段解析不了的正文，也就是
  //     **静默错误**；而我们这套设计的全部努力就是把静默错误换成可见失败。
  //   translation_options —— 它是 translate-compat 的**定义**而非可选项。缺了它服务端
  //     答 200 并把原文原样吐回来（实测，domain-design §7），又一个静默错误。
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
      if (k === 'reqCustomParams') { out[k] = raw; continue; }   // 不是数值，见下
      const n = Number(raw);
      if (!isFinite(n)) continue;
      const [lo, hi] = CLAMP[k];
      out[k] = Math.max(lo, Math.min(hi, n));
    }
    return out;
  }

  // 自定义参数按引擎存：`{ [providerId]: "用户原样输入的字符串" }`。
  // **存字符串不存对象**：JSON 打了一半时用户的输入不能丢，设置页照样保存，只是运行时
  // 解析不了就当没填 —— 与上面「空即未设」同一条规矩，安全方向。
  function customFor(providerId) {
    const map = _prefs.reqCustomParams;
    if (!map || typeof map !== 'object' || !providerId) return null;
    const raw = map[providerId];
    if (typeof raw !== 'string' || !raw.trim()) return null;
    let obj;
    try { obj = JSON.parse(raw); } catch (_) { return null; }
    // 必须是普通对象。数组/字符串/数字合并进请求体只会产生一个畸形的 body。
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const out = {};
    for (const k of Object.keys(obj)) {
      if (CUSTOM_FORBIDDEN.indexOf(k) >= 0) continue;
      if (obj[k] === undefined) continue;
      out[k] = obj[k];
    }
    return Object.keys(out).length ? out : null;
  }

  // 合并进请求体。**放在最后**，所以用户覆盖表 —— 这是「用户赢」的落点。
  // 只对 chat 家族生效：speech / transcribe 是另一种能力，对话参数进去只会 400。
  function applyCustom(body, providerId) {
    const c = customFor(providerId);
    if (!c) return body;
    for (const k of Object.keys(c)) body[k] = c[k];
    return body;
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
  // 有一类模型把思考**写进正文**，用 <think>…</think> 包着，而不是放进单独的
  // reasoning_content 字段。实测 2026-08-21：MiniMax-M2 经 api.minimax.io 的 chat-compat
  // 那条口就是这样 —— 261 字符的输入换回 693 字符，其中大半是一段英文思考独白。
  // （这个文件进出货包，中国合规门连注释一起逐行扫，所以这里只写协议名不写厂商名。）
  //
  // 不剥的话，那整块会被当成译文渲染到页面上（isTranslated 只看非空，刻意如此），
  // **没有任何一方会报错**。这是这套设计里最坏的一种失败：看起来成功，实际全错。
  //
  // 剥干净之后若只剩空串，就落到 callChatAPI 的空正文分支 —— 那是一条具名失败，
  // 正是我们要的：思考被截断而没吐出答案，跟「预算被吃光」是同一种病。
  function stripThink(text) {
    const t = String(text == null ? '' : text);
    if (t.indexOf('<think') < 0) return t.trim();
    // 未闭合也要处理：被 max_tokens 截断时只有开标签，此时后面全是思考，一并丢掉。
    return t.replace(/<think[^>]*>[\s\S]*?<\/think\s*>/gi, '')
      .replace(/<think[^>]*>[\s\S]*$/i, '')
      .trim();
  }

  function extractChat(d) {
    return stripThink((d && d.choices && d.choices[0] && d.choices[0].message
      && d.choices[0].message.content) || '');
  }

  // 与上面方向相反的同一个毛病：这条形状把思考放在**独立的块**里，而思考块排在第 0 位。
  // 原来写的是 content[0].text —— 于是带 thinking 的响应一律取到空串，翻译「失败」。
  // 实测 2026-08-21（api.minimax.io/anthropic，MiniMax-M2）：块序 thinking → text，
  // 旧实现取到 ""，正确实现取到「间隔重复有效。」。Anthropic 自家模型一旦打开
  // extended thinking 也是同样的块序。
  //
  // 这条教训在下面 extractResponses 的注释里已经写过一次（「NEVER output[0]」），
  // 只是当时没有同时用到这条形状上。
  function extractMessages(d) {
    const blocks = (d && Array.isArray(d.content)) ? d.content : [];
    // 收所有文本块。对 `type` 宽容（缺省也算文本）——中转网关未必带上它，而缺了 type
    // 的思考块没有 `text` 字段，所以宽容不会把思考误当正文。
    return blocks.filter((b) => b && typeof b.text === 'string'
        && (b.type === undefined || b.type === 'text'))
      .map((b) => b.text).join('').trim();
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

  // 把表里的推理片段合并进请求体。只有一条形状差异需要翻译（见下），其余原样带过去。
  // 白名单在 registry.test.js 那一侧钉住 —— 这里不做校验，是因为运行时悄悄丢掉一个
  // 字段比发出去更难查：发错了服务端会说话，丢掉了没有任何一方会说话。
  function applyReasoning(body, frag, shape) {
    if (!frag || typeof frag !== 'object') return;
    for (const k of Object.keys(frag)) {
      const v = frag[k];
      if (v === undefined) continue;
      if (shape === 'responses' && k === 'reasoning_effort') { body.reasoning = { effort: v }; continue; }
      body[k] = v;
    }
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
        body: applyCustom(put({
          model: o.model, max_tokens: budget, system: o.system,
          messages: [{ role: 'user', content: o.user }],
        }, 'temperature', optional(caps.temperature, p.reqTemperature, DEFAULT_TEMPERATURE)),
        o.providerId),
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
      // 表存的是 chat-compat 的写法，这条形状只有一处不同：reasoning_effort 要写成
      // 嵌套的 reasoning.effort，顶层写法会 400，原话为证：「In the Responses API,
      // this parameter has moved to 'reasoning.effort'」（实测）。其余字段原样带过去。
      applyReasoning(body, caps.reasoning, 'responses');
      return { headers: bearer, body: applyCustom(body, o.providerId), extract: extractResponses, caps };
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
      return { headers: bearer, body: applyCustom(body, o.providerId), extract: extractChat, caps };
    }

    if (fmt === 'speech-compat') {
      const body = { model: o.model, input: o.input, voice: o.voice };
      // response_format 只在调用方给了值时才发。今天 tts.js 恒传它自己 DEFAULTS 里的
      // 'mp3'，所以线上行为不变；这里不替它兜一个默认值，是为了让「不发」将来成为一个
      // 可选项 —— tts.js 已经从响应的 content-type 读真实类型（tts.js:204），不依赖
      // 自己点的那个格式。
      put(body, 'response_format', o.format || undefined);
      // **不合并自定义参数**：那是对话能力的旋钮，朗读是另一种能力。把 thinking 之类的
      // 字段发给语音端点，最好的结果是被忽略，最坏的是 400 打断一条本来能用的路。
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
      // 同上：转写也不合并。而且这条是 multipart，往里塞任意 JSON 字段无从谈起。
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
    // 把思考压下去。表存的就是这条形状的写法，所以这里原样合并。
    //
    // 为什么翻译要主动压它：推理开销**不随输入变小而变小**，而它算在同一个输出预算里。
    // 实测 2026-08-20：gpt-5-mini 对一段 870 字正文 27.8 秒烧光 2000 预算、正文 0 字；
    // glm-4.6 同一种坏法（24 秒、1995 tok、0 字）；连不以推理著称的 deepseek-v4-flash
    // 也在为每个段落思考 278 tok。三家的字段各不相同，所以表里存的是字段本身。
    applyReasoning(body, caps.reasoning, 'chat');
    const budgetName = (typeof caps.budget === 'string') ? caps.budget : 'max_tokens';
    put(body, budgetName,
      optional(caps.budget === undefined ? undefined : caps.budget !== false,
        p.reqMaxTokens, o.budget));
    // 最后合并 ⇒ 用户覆盖表。这一行就是「用户赢」。
    return { headers: bearer, body: applyCustom(body, o.providerId), extract: extractChat, caps };
  }

  return {
    paramsFor, build, ready, refresh, prefs, timeoutMs, maxConcurrent,
    extractChat, extractMessages, extractResponses, stripThink,
    DEFAULT_TEMPERATURE, UNKNOWN, ADV_KEYS, CLAMP, translateLang, starvedByReasoning, applyReasoning,
    // 设置页用 CUSTOM_FORBIDDEN 来告诉用户「哪些键会被忽略」。它必须是**同一份**常量 ——
    // 界面上说的和运行时做的不一致，比不说更糟。
    customFor, applyCustom, CUSTOM_FORBIDDEN,
  };
})();

if (typeof window !== 'undefined') window.RequestShape = RequestShape;
if (typeof module !== 'undefined' && module.exports) module.exports = RequestShape;
