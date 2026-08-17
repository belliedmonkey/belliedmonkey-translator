// content/wire-format.js — 端点地址的两个纯问题：**请求哪个地址**，和**用哪种请求形状**。
//
// See docs/domain-design.md §7. 三条传输（翻译、解析、语音、转写）全部经过这里，
// 所以「怎么得到最终 URL」在整个产品里只有一份实现。
//
// ── 零拼接 ────────────────────────────────────────────────────────────────
// 用户填的地址**原样使用**，我们一个字符都不加。旧模型是「注册表写死一段 path +
// 用户填的 base」，它有两个真实后果：同一个对话端点今天分成 /v1/chat/completions 与
// /v1/responses 两套请求形状而用户无从选择；中转代理的路径约定与官方不一致时，
// 用户填的地址被我们二次加工之后就不是他要的那个端点了。
//
// 「base 是 origin」这个前提本来也不成立：qwen 的默认地址本身就带 /compatible-mode
// 路径段，而 google 条目根本没有 path。旧模型是在描述一个并不存在的规整世界。
//
// ── 形状由地址声明 ────────────────────────────────────────────────────────
// wire shape 优先看 URL 的路径后缀，认不出来才回落到注册表 `type`。理由：`type` 是
// **我们对一个 id 的猜测**，URL 是**用户对端点的陈述**。判定家族封闭——后缀只在同一
// 能力（对话／语音／转写）内部选变体，所以一个碰巧以 /messages 结尾的语音端点绝不会
// 被翻译成对话传输。厂商在两处都不参与：后缀表里全是协议路径，没有一个是厂商名。

var WireFormat = (() => {
  // ─── 冻结的历史快照（2026-08）──────────────────────────────────────────
  //
  // 这是**历史**，不是配置。三条规矩，违反任何一条都会悄悄改变老用户的出网地址：
  //   1. 永远不要从注册表读——注册表已经改成完整端点了，这里记的是改之前的样子。
  //   2. 已有条目的值永不可修改。
  //   3. 之后新增的注册表条目永不可加进来（新条目没有「改之前」）。
  //
  // 它有两个用途：`resolveEndpoint` 的 legacy 分支（迁移没跑成的设备继续按老语义
  // 工作），以及 background.js / chrome-shim.js 的一次性迁移。background.js 是
  // `type: module` 的 service worker，既不能 importScripts 也不能 import 这个写
  // `window` 的 IIFE，所以那边有一份字面量副本，由 test/base-url-migration.test.js
  // 逐字段钉死。
  const LEGACY_PATHS = {
    chat: {
      openai: '/v1/chat/completions',
      claude: '/v1/messages',
      deepseek: '/v1/chat/completions',
      glm: '/api/paas/v4/chat/completions',
      qwen: '/v1/chat/completions',
      kimi: '/v1/chat/completions',
      custom_chat: '/v1/chat/completions',
      custom_msg: '/v1/messages',
    },
    tts: { local: '/v1/audio/speech', openai_speech: '/v1/audio/speech' },
    stt: { local: '/v1/audio/transcriptions', openai_transcribe: '/v1/audio/transcriptions' },
  };

  // 改动之前四条传输对尾斜杠的处理并不一致：翻译（translation-api.js）与解析
  // （notes.js）直接相加，语音（tts.js）与转写（speech-input.js）先裁掉尾斜杠。
  // 那个 `//` 看起来像 bug，但它正是那批用户当时在跑的东西——legacy 分支的职责是
  // **逐字节复刻**，不是顺手修正。修正交给用户：完整地址现在在输入框里看得见了。
  const LEGACY_STRIPS_SLASH = { chat: false, tts: true, stt: true };

  // ─── 后缀 → wire shape ──────────────────────────────────────────────────
  const FAMILY = {
    'chat-compat': 'chat',
    'messages-compat': 'chat',
    'responses-compat': 'chat',
    'speech-compat': 'speech',
    'transcribe-compat': 'transcribe',
  };

  // 后缀取**最后两段、不含版本段**：`/chat/completions` 而不是
  // `/v1/chat/completions`。版本段（/v1、/api/paas/v4、Azure 的无版本段）正是用户
  // 抱怨的那个变量，把它写进匹配规则等于重新引入我们要去掉的假设。
  const RULES = {
    chat: [
      ['/chat/completions', 'chat-compat'],
      ['/responses', 'responses-compat'],
      ['/messages', 'messages-compat'],
    ],
    speech: [['/audio/speech', 'speech-compat']],
    transcribe: [['/audio/transcriptions', 'transcribe-compat']],
  };
  // 最长优先，在模块初始化时排一次——这样以后往表里加一行不可能破坏优先级。
  for (const fam of Object.keys(RULES)) RULES[fam].sort((a, b) => b[0].length - a[0].length);

  // 归一化**只用于判定**，绝不影响真正发出去的 URL。
  //   · 丢 query：Azure 形态是 `…/chat/completions?api-version=2024-…`，不丢就永远认不出。
  //     （真正发请求时 query 原样保留——旧的拼接模型根本表达不了 query，这是新语义
  //     顺带解锁的能力。）
  //   · 丢一层尾斜杠：让 `…/v1/responses/` 也认得出。
  //   · 小写：主机名本就大小写不敏感；没有任何真实端点靠路径大小写区分请求形状，
  //     认不出的代价远大于认错。
  function normalize(url) {
    return String(url == null ? '' : url).trim()
      .split('#')[0].split('?')[0]
      .replace(/\/+$/, '')
      .toLowerCase();
  }

  // 末尾锚定匹配，不是 `includes`。`includes` 会把
  // `https://api.example/messages/v1/chat/completions` 判成 Messages 形状；而末尾
  // 锚定既能正确判成 chat，又能命中带中转前缀的 `https://proxy/openai/v1/chat/completions`。
  //
  // `fallbackType` 不在 FAMILY 里（google / browser）时直接原样返回：那两个条目
  // 根本没有用户可填的地址，判定无从谈起。
  function formatFor(url, fallbackType) {
    const fam = FAMILY[fallbackType];
    if (!fam) return fallbackType;
    const n = normalize(url);
    for (const rule of RULES[fam]) if (n.endsWith(rule[0])) return rule[1];
    return fallbackType;
  }

  // 主机名之后是否有非空路径。只在设置页的「测试连接」里用来把「你保存的地址少了
  // 接口路径」从 CORS / 不可达里切出来——运行时**不拦**，因为「原样使用」是承诺，
  // 不该因为一个极罕见的根路径端点就剥夺用户的能力。
  function hasPath(url) {
    const m = /^https?:\/\/[^/?#]+(\/[^?#]*)?/i.exec(String(url == null ? '' : url).trim());
    if (!m) return false;
    return (m[1] || '').replace(/\/+$/, '').length > 0;
  }

  function isAbsolute(url) {
    return /^https?:\/\/[^/?#]+/i.test(String(url == null ? '' : url).trim());
  }

  // 所有家族的后缀并成一张表，只回答一个问题：这个地址**看起来已经是完整端点**吗。
  // 这是 resolveEndpoint 的安全网，不是它的判据——判据是戳。
  const ALL_SUFFIXES = Object.keys(RULES)
    .reduce((acc, fam) => acc.concat(RULES[fam].map((r) => r[0])), [])
    .sort((a, b) => b.length - a.length);

  function looksComplete(url) {
    const n = normalize(url);
    return ALL_SUFFIXES.some((s) => n.endsWith(s));
  }

  // 改动那一刻，每个已存的地址都**必然**是被当作 base + path 消费的，所以「老代码
  // 会请求哪个 URL」是可以精确算出来的，不需要任何关于 URL 形状的猜测。
  function legacyCompose(stored, cap, entryId) {
    const table = LEGACY_PATHS[cap];
    const path = table && table[entryId];
    // google / browser 这类条目当年就没有 path 可接——原样返回，别凭空造一个。
    if (!path) return stored;
    const base = LEGACY_STRIPS_SLASH[cap] ? stored.replace(/\/+$/, '') : stored;
    return base + path;
  }

  // 最终地址。三个分支，**分支只看戳，永不检查 URL 形状**：
  //
  //   存值为空          → 注册表的 defaultEndpoint
  //   存值非空 + 有戳    → 逐字使用
  //   存值非空 + 无戳    → legacy 分支，复刻老代码那一行
  //
  // 为什么不是「迁移一次之后只走 verbatim」：那条路把「迁移必须成功」变成正确性前提，
  // 而这个仓库有两处证据表明存储读取会骗人（Safari 把 storage 回调喂 undefined；
  // page-settings.js 的 ok:false ≠ {} 契约与 2026-08-05 事故）。有了 legacy 分支，
  // **迁移没跑成 = 这台设备继续按老代码的语义工作**，而不是一批用户被改坏。
  // 我们没有遥测，永远拿不到「可以删了」的证据，所以这个分支永不删除。
  //
  // `looksComplete` 是第三道分支，安全网而非判据：戳没被读到（新键还没传到某个调用
  // 点、或存储读失败）而存值其实已经迁移过时，legacy 分支会给一个完整地址再接一次
  // 路径，拼出 `…/v1/chat/completions/v1/chat/completions`。这一条挡住它。
  //
  // 它为什么对**今天能用的**配置是安全的：迁移之前，一个以已知接口后缀结尾的存值
  // 必然会被老代码再接一次路径而 404 —— 也就是说它从来没工作过。所以「能工作过的
  // 存值」与「看起来已完整的存值」是不相交的两个集合，这条捷径不会误伤任何人。
  //
  // opts: { cap: 'chat'|'tts'|'stt', verbatim: boolean }
  function resolveEndpoint(stored, entry, opts) {
    const s = String(stored == null ? '' : stored).trim();
    if (!s) return (entry && entry.defaultEndpoint) || '';
    if (opts && opts.verbatim) return s;
    if (looksComplete(s)) return s;
    return legacyCompose(s, opts && opts.cap, entry && entry.id);
  }

  return {
    LEGACY_PATHS, LEGACY_STRIPS_SLASH,
    formatFor, hasPath, isAbsolute, looksComplete, resolveEndpoint, legacyCompose, normalize,
  };
})();

if (typeof window !== 'undefined') window.WireFormat = WireFormat;
if (typeof module !== 'undefined' && module.exports) module.exports = WireFormat;
