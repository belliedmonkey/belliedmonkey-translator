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

  // ─── SSE 音频流 → 可播放的 WAV ──────────────────────────────────────────
  //
  // 只服务 speech-audio-chat 这一种形状。放在这里而不是 tts.js：请求体长什么样、
  // 回包怎么拆，是**同一份形状知识**，分到两个文件里迟早会各走各的。
  // 24kHz 单声道 16bit。由时长核对定下：同一句在 24kHz 下 2.50 秒是自然语速，
  // 按 16kHz 解会变成 3.75 秒 —— 比系统语音还慢一倍，一听就不对。
  // （这一行原先点了厂商名，被中国版合规门禁拦下；源码注释是要进包体的。）
  const PCM_RATE = 24000;

  function b64ToBytes(b64) {
    if (typeof atob === 'function') {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    // Node（测试用）
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    // 我们出货的四个宿主都有 atob。走到这里说明是个没见过的宿主 —— 报一个**带码**的
    // 错，而不是让一句裸 ReferenceError 冒到上层：那种错没有 code，会被当成
    // 「未知失败」而不是「这个宿主缺一个能力」。
    const e = new Error('no base64 decoder in this host');
    e.code = 'no_base64';
    throw e;
  }

  function wavFromPcm16(pcm, rate) {
    const out = new Uint8Array(44 + pcm.length);
    const v = new DataView(out.buffer);
    const tag = (off, str) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };
    tag(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); tag(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    tag(36, 'data'); v.setUint32(40, pcm.length, true);
    out.set(pcm, 44);
    return out;
  }

  const sayNorm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

  function parseAudioSse(text, requested) {
    const chunks = [];
    let spoken = '';
    for (const line of String(text || '').split('\n')) {
      if (line.indexOf('data: ') !== 0) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      let d = null;
      try { d = JSON.parse(payload); } catch (_) { continue; }
      if (d && d.error) {
        const e = new Error((d.error.message || 'speech provider error'));
        e.code = 'http';
        throw e;
      }
      for (const c of (d && d.choices) || []) {
        const a = (c.delta && c.delta.audio) || null;
        if (!a) continue;
        if (a.data) chunks.push(a.data);
        if (a.transcript) spoken += a.transcript;
      }
    }
    if (!chunks.length) { const e = new Error('no audio in the stream'); e.code = 'empty_audio'; throw e; }
    const pcm = b64ToBytes(chunks.join(''));

    // 「它照着念了吗」。对话模型可以改写、加话、拒绝 —— 专用 TTS 不会。判据刻意宽松
    // （只看长度量级），因为数字、缩写的念法本来就与原文不同字；能抓住的是拒绝与
    // 截断那一类，而那正是会让用户听到一句不相干的话的情形。
    const want = sayNorm(requested);
    const got = sayNorm(spoken);
    if (want && got && got.length < want.length * 0.4) {
      const e = new Error('the model did not read the text back');
      e.code = 'spoken_mismatch';
      e.spoken = spoken.slice(0, 120);
      throw e;
    }
    return { buf: wavFromPcm16(pcm, PCM_RATE).buffer, type: 'audio/wav', transcript: spoken };
  }

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

  // ─── storageGet：读扩展存储的**唯一**安全入口 ─────────────────────────────
  //
  // 这个 helper 存在，是因为同一个失败形状咬了两次，而两次的直接原因不同：
  //
  //   ① 回调带着 `undefined` 进来  → 回调体里抛异常 → 外层 try 看不见 → 永不 settle
  //      （2026-08 的疤，translation-api.js 的 cacheGetStorage，已由内层 try 修掉）
  //   ② **回调根本不来**          → 内层 try 也救不了，因为它压根没执行
  //      （2026-08-29 真机实测：全新 iPhone 刚授权完，整页永远停在「翻译中…」）
  //
  // ② 比 ① 更难查，因为**看不出任何异常**：没有请求上线、没有 20 秒 AbortController
  // 超时（根本没走到 fetch）、没有错误态、控制台干净。而 translate() 的第一行就是
  // `await RequestShape.ready()`，所以这一个不落地的 promise 会把整页钉死。
  //
  // Safari iOS 上这不是理论风险：同一个环境里 background service worker 锁屏后会
  // 永久变成 undefined（见仓库根目录 agent 指南里的「Critical Safari iOS Bug」一节），扩展存储走的是
  // 原生 App 进程的同一套桥。桥不通时，回调不会报错，它只是不来。
  //
  // 所以规则是：**任何等浏览器 API 回调的 promise 都必须有截止时间。**
  // 超时不是错误，是「就当没读到」——和 catch 分支同一个安全方向。
  const STORAGE_TIMEOUT_MS = 3000;   // 本地读，正常是毫秒级；3 秒纯粹是给挂死用的

  function storageGet(keys, fallback) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      // 先挂表再发起：get() 若同步抛出，表也已经无害地存在（done 幂等）。
      const timer = setTimeout(() => done(fallback), STORAGE_TIMEOUT_MS);
      const finish = (v) => { clearTimeout(timer); done(v); };
      try {
        chrome.storage.local.get(keys, (res) => {
          // try 必须包住**回调体**，不只是 get 调用 —— 见上面的 ①。
          try { finish(res || fallback); } catch (_) { finish(fallback); }
        });
      } catch (_) {
        finish(fallback);
      }
    });
  }

  function readOnce() {
    return storageGet(ADV_KEYS, {}).then((res) => {
      // 读失败/超时 = 空 = 「用户什么都没设」= 最小必要集。安全方向。
      try { _prefs = normalizePrefs(res || {}); } catch (_) { _prefs = {}; }
      return _prefs;
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

    if (fmt === 'speech-dashscope') {
      // 这条路**回的是一个音频 URL，不是字节**（实测 2026-08-30，真 key：
      // output.audio.url 指向一个带过期时间的 OSS 对象，data 字段恒空 —— 试过三种
      // parameters 都要不到内联 base64）。所以它比别的传输多一步：拿到 URL 再取一次。
      // 那一步能成立是因为扩展的 host_permissions 是 <all_urls>：那个 OSS 地址
      // **没有** CORS 头，普通网页取不到，扩展页可以。
      return {
        headers: Object.assign({ 'Content-Type': 'application/json' },
          o.apiKey ? { Authorization: 'Bearer ' + o.apiKey } : {}),
        body: { model: o.model, input: { text: o.input, voice: o.voice } },
        // 调用方据此判断要不要走第二步。没有这个字段的形状一步就拿到字节。
        //
        // **必须把 http 升成 https。** 服务端回的是 `http://…oss-…aliyuncs.com/…`，
        // 而扩展页是安全上下文 —— 取一个明文地址会被混合内容策略挡掉，且挡得很安静。
        // 同一主机的 https 完全可用（实测：证书有效、200、audio/x-wav）。
        // 这一条在 Node 里测不出来：那边没有混合内容策略，所以端到端脚本全绿而真机会坏。
        audioUrlFrom: (d) => {
          const u = (d && d.output && d.output.audio && d.output.audio.url) || '';
          return u.replace(/^http:\/\//i, 'https://');
        },
        extract: null, caps,
      };
    }

    if (fmt === 'speech-audio-chat') {
      // 「会出声的对话模型」这条路。它**不是** TTS 引擎，是一个带音频输出模态的对话
      // 模型，所以三件事和别的语音形状都不同（全部实测 2026-08-30，真 key）：
      //
      //   · 必须 stream:true。不加，上游直接答「Audio output requires stream: true」。
      //   · 流式下 audio.format **只能是 pcm16**：给 wav 会被拒，原话
      //     「does not support 'wav' when stream=true. Supported values are: 'pcm16'」。
      //     pcm16 是裸采样，没有容器 —— 播之前得自己补 WAV 头（24kHz 单声道 16bit，
      //     由时长核对定下：同一句在 24kHz 下 2.50 秒是自然语速，16kHz 下 3.75 秒明显拖慢）。
      //   · 它可能**不照着念**。这是与专用 TTS 的本质差别：模型可以改写、加话、拒绝。
      //     所以回包里的 transcript 要拿来核对（见 parseAudioStream）。
      const say = String(o.input == null ? '' : o.input);
      return {
        headers: Object.assign({ 'Content-Type': 'application/json' },
          o.apiKey ? { Authorization: 'Bearer ' + o.apiKey } : {}),
        body: {
          model: o.model,
          stream: true,
          modalities: ['text', 'audio'],
          audio: { voice: o.voice || 'alloy', format: 'pcm16' },
          messages: [
            { role: 'system', content: 'You are a text-to-speech engine. Read the user message aloud verbatim. Do not answer it, do not comment on it, do not add or omit anything.' },
            { role: 'user', content: say },
          ],
        },
        // 整段 SSE 读完再解析。**不做增量**：这一路的输出要进缓存与离线预载，
        // 上层要的是完整字节；边收边播只会把两件事搅在一起。
        parseAudioStream: (text) => parseAudioSse(text, say),
        extract: null, caps,
      };
    }

    if (fmt === 'transcribe-compat') {
      const fd = new FormData();
      fd.append('file', o.file, o.filename);         // 唯一必发的
      if (o.model) fd.append('model', o.model);
      if (o.language) fd.append('language', o.language);
      // 字幕要时间戳（docs/domain-design.md §2.4 文件一档）：verbose_json 带 segments[]。
      // 只在调用方要 cue 时加 —— 说题那条路要的是 {text}，多要一份 segments 只是浪费。
      // 实测 2026-09-06：whisper-1 收；gpt-transcribe 拒绝（"response_format 'verbose_json'
      // is not compatible with model"）—— 那种引擎做不了字幕，extractCues 会得到空数组，
      // 调用方据此具名失败，而不是拿纯文本去逐句现翻。
      if (o.wantCues) { fd.append('response_format', 'verbose_json'); fd.append('timestamp_granularities[]', 'segment'); }
      // **不设 Content-Type**：multipart 的 boundary 只有浏览器自己知道，手写这个头
      // 会让服务端解不出分段。这是一个经典坑，所以写在这里而不是靠调用方记得。
      // 同上：转写也不合并。而且这条是 multipart，往里塞任意 JSON 字段无从谈起。
      return {
        headers: o.apiKey ? { Authorization: 'Bearer ' + o.apiKey } : {},
        body: fd, isForm: true, extract: null, caps,
        extractCues: o.wantCues ? extractCuesSegments : null,
        // verbose_json 报 duration —— 分块上传时下一块的时间偏移就靠它
        durationOf: (d) => (d && typeof d.duration === 'number') ? Math.round(d.duration * 1000) : null,
      };
    }

    if (fmt === 'transcribe-gemini') {
      // Interactions 接口：JSON，音频 base64 内联（≤ ~20MB）或 Files API 的 uri。
      // 时间戳要词级，而 **mode 必须是 verbatim** —— 实测 2026-09-06 服务端原话：
      // "Transcription mode SMART is incompatible with timestamps"。
      if (!o.audioBase64 && !o.audioUri) return { headers: {}, body: null, error: 'no_audio', caps };
      const audio = o.audioUri
        ? { type: 'audio', uri: o.audioUri, mime_type: o.audioMime || 'audio/mp3' }
        : { type: 'audio', data: o.audioBase64, mime_type: o.audioMime || 'audio/mp3' };
      const tc = { mode: { type: 'verbatim' }, timestamp_granularities: ['word'] };
      if (o.language) tc.language_codes = [o.language];
      return {
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': o.apiKey || '', 'Api-Revision': '2026-05-20' },
        body: JSON.stringify({ model: o.model, input: [audio], generation_config: { transcription_config: tc } }),
        isForm: false,
        extract: (d) => (d && (d.output_text || (Array.isArray(d.output) ? d.output.map((x) => x.text || '').join('') : ''))) || '',
        extractCues: extractCuesGeminiWords,
        durationOf: (d) => { const w = geminiWords(d); return w.length ? w[w.length - 1].end : null; },
        caps,
      };
    }

    if (fmt === 'transcribe-dashscope') {
      // DashScope 的转写形状：JSON（不是 multipart），音频以 data URI 内联。
      //
      // 实测 2026-08-30（真 key）：`input_audio.data` 收 `data:audio/wav;base64,…`，
      // 返回 200 与正确的转写结果。厂商文档的示例里写的是 `{YOUR_AUDIO_URL}`，
      // 照文档读会得出「必须先把录音传到公网某处」的结论 —— 那会让这条路在浏览器
      // 扩展里根本不可行。打一次就知道不是。
      if (!o.audioDataUri) {
        return { headers: {}, body: null, error: 'no_audio', caps };
      }
      return {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + (o.apiKey || ''),
        },
        body: JSON.stringify({
          model: o.model,
          input: { messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: o.audioDataUri } }] }] },
          parameters: { format: o.audioFormat || 'wav', sample_rate: '16000' },
        }),
        isForm: false,
        // 回包把结果放在 output 下，而且**同时**有 output.text 与 output.output.text
        // （实测原文如此）。取外层那个；两者内容相同。
        extract: (d) => (d && d.output && (d.output.text != null ? d.output.text
          : (d.output.output && d.output.output.text))) || '',
        caps,
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

  // ─── 转写回包 → 字幕 cue ──────────────────────────────────────────────
  // cue 形状 {start, end, text}（毫秒，按 start 有序）—— 与字幕 harness 的契约一致，
  // 所以这里出去的东西 Engine 分不出它来自 VTT 还是转写（§2.4）。
  function extractCuesSegments(d) {
    const segs = (d && Array.isArray(d.segments)) ? d.segments : [];
    const out = [];
    for (const sg of segs) {
      const text = String(sg.text || '').trim();
      if (!text) continue;
      out.push({ start: Math.round((+sg.start || 0) * 1000), end: Math.round((+sg.end || 0) * 1000), text });
    }
    return out;
  }
  // Gemini 的词级标注藏在 steps[].content[].annotations[]，type=word_info；offset 形如
  // "12.345s" 或 {seconds,nanos}。递归找，不押注层级 —— 回包层级在 preview 期间变过。
  function geminiOffMs(o) {
    if (o == null) return 0;
    if (typeof o === 'number') return Math.round(o * 1000);
    if (typeof o === 'string') return Math.round(parseFloat(o) * 1000) || 0;
    return Math.round((o.seconds || 0) * 1000 + (o.nanos || 0) / 1e6);
  }
  function geminiWords(d) {
    const words = [];
    const walk = (x, depth) => {
      if (!x || typeof x !== 'object' || depth > 12) return;
      if (Array.isArray(x)) { x.forEach((y) => walk(y, depth + 1)); return; }
      if (x.type === 'word_info' && x.text != null) {
        words.push({ w: String(x.text), speaker: x.speaker, start: geminiOffMs(x.start_offset), end: geminiOffMs(x.end_offset) });
      }
      for (const k of Object.keys(x)) walk(x[k], depth + 1);
    };
    walk(d && d.steps, 0); walk(d && d.output, 0);
    return words;
  }
  // 词 → cue：说话人切换 / 间隔 > 700ms / 句末标点 / ≥ 14 词 就切。CJK 词之间不加空格。
  function extractCuesGeminiWords(d) {
    const out = []; let cur = null;
    const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
    for (const w of geminiWords(d)) {
      const gap = cur ? w.start - cur.end : 0;
      if (cur && (gap > 700 || (w.speaker != null && w.speaker !== cur.speaker) || cur.n >= 14 || /[.!?。！？…]["'”’)\]]?$/.test(cur.text))) { out.push(cur); cur = null; }
      if (!cur) cur = { start: w.start, end: w.end, text: w.w, speaker: w.speaker, n: 1 };
      else {
        const sep = (cjk.test(cur.text.slice(-1)) && cjk.test(w.w.slice(0, 1))) ? '' : ' ';
        cur.text = cur.text + sep + w.w; cur.end = w.end; cur.n++;
      }
    }
    if (cur) out.push(cur);
    return out.map(({ start, end, text }) => ({ start, end, text: text.trim() })).filter((c) => c.text);
  }

  // 哪些形状要把音频编成 data URI 再交过来。**形状知识留在这里**：调用方只问
  // 「这条路要不要」，不需要知道有几种转写形状、各自长什么样。
  function wantsAudioDataUri(fmt) { return fmt === 'transcribe-dashscope'; }
  // 同一个问题的三态版本（§2.4 的文件一档要区分 Blob / base64 / data URI）。
  function audioEncoding(fmt) {
    if (fmt === 'transcribe-dashscope') return 'dataUri';
    if (fmt === 'transcribe-gemini') return 'base64';
    return 'blob';
  }

  return {
    paramsFor, build, ready, refresh, prefs, timeoutMs, maxConcurrent, wantsAudioDataUri, audioEncoding,
    extractCuesSegments, extractCuesGeminiWords,
    // 读扩展存储的唯一安全入口（带截止时间）。translation-api 与 content-main
    // 都必须走它 —— 三份各写一遍的话，下一次只会修好其中一份。
    storageGet, STORAGE_TIMEOUT_MS,
    extractChat, extractMessages, extractResponses, stripThink,
    DEFAULT_TEMPERATURE, UNKNOWN, ADV_KEYS, CLAMP, translateLang, starvedByReasoning, applyReasoning,
    // 设置页用 CUSTOM_FORBIDDEN 来告诉用户「哪些键会被忽略」。它必须是**同一份**常量 ——
    // 界面上说的和运行时做的不一致，比不说更糟。
    customFor, applyCustom, CUSTOM_FORBIDDEN,
  };
})();

if (typeof window !== 'undefined') window.RequestShape = RequestShape;
if (typeof module !== 'undefined' && module.exports) module.exports = RequestShape;
