// content/wire-format.js — 端点地址的两个纯问题：**请求哪个地址**，和**用哪种请求形状**。
//
// 第三个问题「这种形状的请求体长什么样」在 content/request-shape.js —— 它要读
// chrome.storage（用户的高级参数），而本文件刻意保持纯函数、零加载期依赖，测试把它
// 当依赖直接注入而不是打桩。把一次存储读塞进来会毁掉那个性质。
//
// See docs/domain-design.md §7. 三条传输（翻译、解析、语音、转写）全部经过这里，
// 所以「怎么得到最终 URL」在整个产品里只有一份实现。
//
// ── 零拼接，无条件 ────────────────────────────────────────────────────────
// 用户填的地址**原样使用**，我们一个字符都不加，**没有任何例外分支**。旧模型是
// 「注册表写死一段 path + 用户填的 base」，它有两个真实后果：同一个对话端点今天分成
// /v1/chat/completions 与 /v1/responses 两套请求形状而用户无从选择；中转代理的路径
// 约定与官方不一致时，用户填的地址被我们二次加工之后就不是他要的那个端点了。
//
// 「base 是 origin」这个前提本来也不成立：qwen 的默认地址本身就带 /compatible-mode
// 路径段，而 google 条目根本没有 path。旧模型是在描述一个并不存在的规整世界。
//
// 1.5.2 只做到了「有戳时逐字」——留了一条无戳时按老语义拼接的兜底路径，代价是拼接
// 变成了默认行为，只要哪个调用点忘了传戳就悄悄回去了。1.5.3 把那条路径连同它依赖
// 的冻结表、一次性迁移一起删掉：**没有戳，没有表，没有条件**。理由见 resolveEndpoint。
//
// ── 形状由地址声明 ────────────────────────────────────────────────────────
// wire shape 优先看 URL 的路径后缀，认不出来才回落到注册表 `type`。理由：`type` 是
// **我们对一个 id 的猜测**，URL 是**用户对端点的陈述**。判定家族封闭——后缀只在同一
// 能力（对话／语音／转写）内部选变体，所以一个碰巧以 /messages 结尾的语音端点绝不会
// 被翻译成对话传输。厂商在两处都不参与：后缀表里全是协议路径，没有一个是厂商名。

var WireFormat = (() => {
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
  // 锚定既能正确判成 chat，又能命中带中转前缀的 `https://proxy/upstream/v1/chat/completions`。
  // （示例地址刻意不写厂商名：这个文件进出货包，而中国合规门连注释一起扫。）
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

  // 主机名，小写，**不带端口、不带用户信息段**。
  //   · 端口不参与匹配：没有任何厂商靠端口区分模型能力，而带上端口会让
  //     `https://api.example.com:443/…` 匹配不到 `api.example.com` 那一行。
  //   · `user:pass@` 一并丢掉 —— 那是凭证，不该出现在任何比较里，更不该被
  //     哪天有人打进日志。
  // request-shape.js 的参数表按它匹配；translation-api.js 的路由记忆按 origin
  // 记，两者都从这里取，免得同一个「地址的哪一部分算数」有两份实现。
  function hostOf(url) {
    const m = /^https?:\/\/([^/?#]+)/i.exec(String(url == null ? '' : url).trim());
    if (!m) return '';
    return m[1].split('@').pop().split(':')[0].toLowerCase();
  }

  // 最终地址。**两个分支，没有第三个**：
  //
  //   存值为空   → 注册表的 defaultEndpoint
  //   存值非空   → 逐字使用（只 trim 首尾空白）
  //
  // 这里曾经有第三个分支：无戳时按「注册表 path + 用户填的 base」复刻老代码，好让
  // 一次性迁移没跑成的设备继续工作。它是 2026-08-18 两次真机故障的共同原因，删除的
  // 理由不是它写错了，而是**它存在本身就是错的**：
  //
  //   · 它是条件性的，而条件靠一个叫 `verbatim` 的位参数在六个调用点之间传递。少传
  //     一处就静默回到拼接——设置页的「测试连接」正是少传的那一处，于是自检对着
  //     `…/upstream/v1/v1/chat/completions` 报 404，而用户框里填的地址完全正确。
  //   · 同一张表还驱动着一次性迁移，而迁移不看戳，会把用户**刚存好的完整地址**再接
  //     一次路径写回存储。也就是说这条兜底路径不只是没帮上忙，它会主动改坏正确配置。
  //
  // 「原样请求」是对用户的承诺，而一个有例外的承诺不是承诺——例外恰恰会落在用户填了
  // 我们认不出的地址那一刻，也就是他最需要我们别自作主张的那一刻。所以这里不做任何
  // 形状判断：不看后缀、不看戳、不查表。地址是用户的陈述，我们只负责发出去。
  //
  // 代价说清楚：从 ≤1.5.2 升上来、存的是老语义 base 地址、且升级后从未打开过设置页
  // 的设备，会拿这个 base 去请求而失败。这不是静默失败——失败具名，并且把真正请求的
  // 地址回显出来（options.js 的 withUrl），用户照着输入框的提示补上路径即可。用一个
  // 会改坏正确配置的机制去救这批人，是拿多数人的正确性换少数人的方便。
  function resolveEndpoint(stored, entry) {
    const s = String(stored == null ? '' : stored).trim();
    if (!s) return (entry && entry.defaultEndpoint) || '';
    return s;
  }

  return { formatFor, hasPath, isAbsolute, hostOf, resolveEndpoint, normalize };
})();

if (typeof window !== 'undefined') window.WireFormat = WireFormat;
if (typeof module !== 'undefined' && module.exports) module.exports = WireFormat;
