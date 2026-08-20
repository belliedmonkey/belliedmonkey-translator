// build/perf-ledger.config.js — 「这个端点的这个模型，我们打过，结果是这样」的台账。
//
// ── 它为什么存在 ──────────────────────────────────────────────────────────
//
// 2026-08-20 用户报「翻译失败」，配置是 gpt-5-mini。根因是我们发的固定 2000 输出预算
// 在推理模型上同时覆盖思考与输出，长段落上思考先把它吃光，**HTTP 200、正文 0 字**。
// 顺着这条线把能打到的 host 逐个实测，又发现 GLM 一模一样的病（24 秒、正文 0 字），
// 以及 DeepSeek —— 我们自己的默认引擎和验证基线 —— 一直在为每个段落思考。
//
// 这些都不是读文档能得到的结论。文档会告诉你「支持 reasoning_effort」，但不会告诉你：
//   · o3-mini 收到 'minimal' 直接 400，而它不发这个参数时本来是好的
//   · GLM 收到 reasoning_effort 返回 200，然后**完全无视它**
//   · OpenRouter 两种拼法都 200，但错的那种效果差一截（320 vs 192 思考 tok）
//   · MiniMax 把「无效 key」包在 HTTP 200 里返回
//
// 所以这份台账记的是**观测**，不是文档摘抄。`build/model-params.config.js` 是从它
// 推导出来的结论；两者由 `test/perf-ledger.test.js` 锁在一起，不许各走各的。
//
// ── 怎么产生一行 ──────────────────────────────────────────────────────────
//
//   /perf-tune               （.claude/skills/perf-tune/SKILL.md）
//   node scripts/perf-probe.js <host别名> <模型...>
//
// ── 字段 ──────────────────────────────────────────────────────────────────
//  host      精确主机名，与 model-params 的 hosts 同一套写法。
//  model     实际发出去的那个 model 值。
//  date      YYYY-MM-DD。没有日期的「能用」不算验证（verification-spec §1.0）。
//  verdict   'adopted'     —— 找到了更好的参数，已写进 model-params
//            'rejected'    —— 打通了，但没有值得写的参数（没收益 / 效果不稳定 / 本来就
//                             不思考）。**这一类必须记**，否则下一个人会照文档补上它。
//            'unreachable' —— 打不到（没 key、余额不足、模型 id 拿不到）。这是一张
//                             带日期的欠条，不是免责声明。
//            'inferred'    —— **没打这个 host，按同厂另一个域的实测结论处理**。见下。
//  from      `inferred` 必填：结论继承自哪个 host。
//
// ── 继承规则：同厂不同域可以，网关与第一方之间不行 ──────────────────────────
//
// 一个厂商常有国内外两个域（open.bigmodel.cn / api.z.ai、api.moonshot.cn / .ai、
// dashscope 国内外、minimax 两域），逐一实测等于把成本翻倍，而它们是同一套 API。
// 所以允许继承 —— 但**只在共享同一个 model-params 行的 hosts 之间**。
//
// 那条判据不是随手划的，它恰好等价于「同厂不同域」，因为能力表本来就把同厂的两个域
// 写在一行，而 openrouter.ai 独占一行。于是网关继承在结构上不可能发生，且不需要另外
// 维护一张需要人记得去更新的网关名单。
//
// ⚠️ 为什么网关不能继承 —— 有实测反例（2026-08-20/21，同一个 deepseek-v4-flash）：
//     api.deepseek.com（第一方）  基线 278 tok（**默认在思考**），thinking:disabled → 0
//     openrouter.ai（网关）       基线 0 tok（**默认不思考**），reasoning:{effort:'low'}
//                                 反而把思考**开启**到 78–233 tok
// 同一个模型、两个端点、默认行为相反。把任一边赋给另一边都是错的。而 api.openai.com
// 对 thinking / reasoning / enable_thinking 三种拼法一律 400 Unknown parameter ——
// 拼法本身也不通用。
//
// 另外两条，由 test/perf-ledger.test.js 钉住：
//   · 不许继承自另一条 inferred（推测值链式传播，会越传越远离证据）
//   · 同一个 (host, model) 一旦有实测行，就不许再有 inferred 行 —— **实测永远优先**
//  baseline  不发任何推理字段时的观测：{ ms, thinkTokens, outChars, finish }
//            adopted / rejected 必填。ms 是墙钟时间，**证据力最弱**（端点会抖、会 503），
//            所以判断优先看 thinkTokens 与 outChars。
//  tried     试过的候选：[{ params, ms, thinkTokens, outChars, note }]
//            adopted 必填且至少一条。被拒的候选也写在这里，连同服务端原话 —— 那是
//            「为什么不是这个值」的唯一证据。
//  adopted   verdict==='adopted' 时必填，且必须与 model-params 里那一行逐字相等。
//  why       rejected / unreachable 必填。一句能被证伪的话。
//
// ⚠️ 这张表**不进出货包**。它是维护者的证据台账，不是运行时数据。

module.exports = [
  // ── api.openai.com ───────────────────────────────────────────────────
  {
    host: 'api.openai.com', model: 'gpt-5-mini', date: '2026-08-20',
    baseline: { ms: 27786, thinkTokens: 2000, outChars: 0, finish: 'length' },
    tried: [
      { params: { reasoning_effort: 'minimal' }, ms: 5580, thinkTokens: 0, outChars: 304 },
      { params: { reasoning_effort: 'low' }, ms: 22594, thinkTokens: 1152, outChars: 333 },
      { params: { max_completion_tokens: 4000 }, ms: 39195, thinkTokens: 2368, outChars: 298,
        note: '只加预算也能出正文，但慢得多 —— 钱和时间都花在思考上了' },
    ],
    verdict: 'adopted', adopted: { reasoning_effort: 'minimal' },
    why: '不发时预算被思考吃光：finish=length、正文 0 字，用户看到「翻译失败」且重试永远同样失败',
  },
  {
    host: 'api.openai.com', model: 'gpt-5-nano', date: '2026-08-20',
    baseline: { ms: 2147, thinkTokens: null, outChars: 7, finish: 'stop' },
    tried: [{ params: { reasoning_effort: 'minimal' }, ms: 794, thinkTokens: null, outChars: 8 }],
    verdict: 'adopted', adopted: { reasoning_effort: 'minimal' },
    why: '与 gpt-5-mini 同族，同一行覆盖；短输入上也快 2.7 倍',
  },
  {
    host: 'api.openai.com', model: 'o3-mini', date: '2026-08-20',
    baseline: { ms: 5782, thinkTokens: null, outChars: 6, finish: 'stop' },
    tried: [
      { params: { reasoning_effort: 'minimal' }, ms: 303, thinkTokens: null, outChars: 0,
        note: "400 —— Unsupported value: 'reasoning_effort' does not support 'minimal' with "
          + "this model. Supported values are: 'low', … ⇒ o 系必须与 gpt-5 系分成两行" },
      { params: { reasoning_effort: 'low' }, ms: 2785, thinkTokens: null, outChars: 6 },
    ],
    verdict: 'adopted', adopted: { reasoning_effort: 'low' },
    why: '不发时慢一倍；而 gpt-5 系那个 minimal 在这里直接 400，合成一行会打断一条能用的路',
  },
  {
    host: 'api.openai.com', model: 'o4-mini', date: '2026-08-20',
    baseline: { ms: 3332, thinkTokens: null, outChars: 7, finish: 'stop' },
    tried: [
      { params: { reasoning_effort: 'minimal' }, ms: 639, thinkTokens: null, outChars: 0,
        note: '400，同 o3-mini 那条原话' },
      { params: { reasoning_effort: 'low' }, ms: 2642, thinkTokens: null, outChars: 7 },
    ],
    verdict: 'adopted', adopted: { reasoning_effort: 'low' },
    why: '同 o3-mini',
  },

  // ── api.deepseek.com ─────────────────────────────────────────────────
  {
    host: 'api.deepseek.com', model: 'deepseek-v4-flash', date: '2026-08-20',
    baseline: { ms: 3549, thinkTokens: 278, outChars: 123, finish: 'stop' },
    tried: [{ params: { thinking: { type: 'disabled' } }, ms: 1126, thinkTokens: 0, outChars: 111 }],
    verdict: 'adopted', adopted: { thinking: { type: 'disabled' } },
    why: '**注册表默认模型**，也是我们的验证基线 —— 它一直在为每个段落思考。关掉快 3.2 倍',
  },
  {
    host: 'api.deepseek.com', model: 'deepseek-reasoner', date: '2026-08-20',
    baseline: { ms: 3506, thinkTokens: 226, outChars: 122, finish: 'stop',
      note: '两遍取平均：3515/3497ms、228/223tok' },
    tried: [
      { params: { thinking: { type: 'disabled' } }, ms: 1296, thinkTokens: 0, outChars: 115,
        note: '两遍：1414/1178ms' },
      { params: { reasoning_effort: 'low' }, ms: 4346, thinkTokens: 345, outChars: 137,
        note: '**被接受但完全无效** —— 思考反而更多。OpenAI 那套字段在这里是装饰' },
    ],
    verdict: 'adopted', adopted: { thinking: { type: 'disabled' } },
    why: '同 host 通行；reasoning_effort 在这里无效，只有 thinking 开关有用',
  },

  // ── GLM ──────────────────────────────────────────────────────────────
  {
    host: 'open.bigmodel.cn', model: 'glm-4.6', date: '2026-08-20',
    baseline: { ms: 24833, thinkTokens: 1995, outChars: 0, finish: 'stop',
      note: '两遍：24339/25328ms、1995/1996tok，正文都是 0 字。对一句 57 字符的短句也复现过 '
        + '31.8 秒 / 思考 6806 字 / 正文 0 字' },
    tried: [
      { params: { thinking: { type: 'disabled' } }, ms: 1410, thinkTokens: 0, outChars: 117,
        note: '两遍：1253/1567ms。紧循环里 4/4 落在 0.6–1.2 秒' },
      { params: { reasoning_effort: 'low' }, ms: 38491, thinkTokens: 1991, outChars: 0,
        note: '**被接受但完全无效** —— 200，然后照样烧光预算吐 0 字' },
    ],
    verdict: 'adopted', adopted: { thinking: { type: 'disabled' } },
    why: '与 gpt-5-mini 同一种坏法：预算被思考吃光、正文 0 字，用户看到「翻译失败」',
  },
  {
    host: 'open.bigmodel.cn', model: 'glm-4-flash', date: '2026-08-20',
    baseline: { ms: 4660, thinkTokens: 0, outChars: 149, finish: 'stop' },
    tried: [{ params: { thinking: { type: 'disabled' } }, ms: 5554, thinkTokens: 0, outChars: 117,
      note: '安全性检查：本来就不思考的模型带上这个参数照常 200，所以那一行可以写成 host 通行' }],
    verdict: 'adopted', adopted: { thinking: { type: 'disabled' } },
    why: '注册表默认模型，本身不思考；这一行记的是「host 通行不会打断它」',
  },
  {
    host: 'api.z.ai', model: 'glm-4.6', date: '2026-08-20',
    baseline: { ms: null, thinkTokens: null, outChars: null, finish: null,
      note: '首轮 429 余额不足；后来走产品代码打通了，只取到加参数之后的观测' },
    tried: [{ params: { thinking: { type: 'disabled' } }, ms: 1444, thinkTokens: 0, outChars: 17,
      note: '走产品代码（TranslationAPI.translate）实测' }],
    verdict: 'adopted', adopted: { thinking: { type: 'disabled' } },
    why: '与 open.bigmodel.cn 同一套 paas/v4，同一行两个 host；这里补的是「z.ai 也接受且生效」',
  },

  // ── dashscope ────────────────────────────────────────────────────────
  {
    host: 'dashscope.aliyuncs.com', model: 'qwen-plus', date: '2026-08-20',
    baseline: { ms: 3175, thinkTokens: 0, outChars: 182, finish: 'stop' },
    tried: [{ params: { enable_thinking: false }, ms: 3819, thinkTokens: 0, outChars: 182 }],
    verdict: 'rejected',
    why: '默认就不思考，没有可关的东西。加了参数也一样 —— 写进表只会是一个要跟着厂商改的负担',
  },
  {
    host: 'dashscope.aliyuncs.com', model: 'qwen3-max', date: '2026-08-20',
    baseline: { ms: 3938, thinkTokens: 0, outChars: 195, finish: 'stop' },
    tried: [{ params: { enable_thinking: false }, ms: 4017, thinkTokens: 0, outChars: 172 }],
    verdict: 'rejected', why: '同 qwen-plus，默认不思考',
  },
  {
    host: 'dashscope.aliyuncs.com', model: 'qwen-mt-turbo', date: '2026-08-20',
    baseline: { ms: 383, thinkTokens: 0, outChars: 17, finish: 'stop',
      note: '走产品代码（translate-compat 形状）实测' },
    tried: [],
    verdict: 'rejected',
    why: '翻译专用模型，不思考，且本身就是最快的一档（383ms，对比 qwen-plus 509ms）',
  },

  // ── openrouter ───────────────────────────────────────────────────────
  {
    host: 'openrouter.ai', model: 'openai/gpt-5-mini', date: '2026-08-21',
    baseline: { ms: 14951, thinkTokens: 1168, outChars: 156, finish: 'stop',
      note: '**四遍复验**（2026-08-21）：1344 / 1088 / 1344 / 896 tok，11197–16852ms。'
        + '首测（08-20）只跑了一遍，得 704tok / 9146ms —— 单次采样落在这个区间之外，'
        + '正说明 n=1 不足以下结论' },
    tried: [
      { params: { reasoning: { effort: 'low' } }, ms: 4694, thinkTokens: 208, outChars: 147,
        note: '四遍：192 / 256 / 320 / 64 tok（区间 64–320），3296–6413ms。'
          + '与基线的 896–1344 **毫不重叠**，基线最小值是候选最大值的 2.8 倍 —— '
          + '效果远大于噪声带，这一行站得住' },
      { params: { reasoning_effort: 'low' }, ms: 4848, thinkTokens: 320, outChars: 126,
        note: '**也返回 200，但明显没那么有效**（320 vs 192 思考 tok）。只看状态码会选到次优拼法' },
      { params: { reasoning: { enabled: false } }, ms: 271, thinkTokens: null, outChars: 0,
        note: '400 —— Reasoning is mandatory for this endpoint and cannot be disabled. 只能降档不能关' },
    ],
    verdict: 'adopted', adopted: { reasoning: { effort: 'low' } },
    why: '第四种拼法：这个网关用嵌套 reasoning:{effort}，与 OpenAI 顶层字符串、GLM/DeepSeek 的 '
      + 'thinking 都不同。⚠️ 这一行被**重新验过一次**：同 host 的 minimax/minimax-m2 露出'
      + '基线抖动 2.4 倍之后，本行原来的 n=1 证据就不够格了。复验后区间不重叠，结论保留 —— '
      + '规矩要先用在自己已经采纳的行上，否则它只是装饰',
  },
  {
    host: 'openrouter.ai', model: 'deepseek/deepseek-r1', date: '2026-08-20',
    baseline: { ms: 10401, thinkTokens: 466, outChars: 110, finish: 'stop' },
    tried: [
      { params: { reasoning: { effort: 'low' } }, ms: 22584, thinkTokens: 237, outChars: 114,
        note: '墙钟更慢但思考减半 —— 网关会换上游供应商，所以这一行按 token 下结论' },
      { params: { reasoning: { enabled: false } }, ms: 209, thinkTokens: null, outChars: 0,
        note: '400，同上那句原话' },
    ],
    verdict: 'adopted', adopted: { reasoning: { effort: 'low' } },
    why: '同 host 通行行；思考 466→237tok',
  },
  {
    host: 'openrouter.ai', model: 'qwen/qwen3.8-27b', date: '2026-08-20',
    baseline: { ms: 2169, thinkTokens: 0, outChars: 127, finish: 'stop' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: 2106, thinkTokens: 0, outChars: 120,
      note: '安全性检查：要写的那个值在不思考的模型上不会 400' }],
    verdict: 'rejected',
    why: '本身不思考；这一行记的是「host 通行不会打断它」，不是它自己需要什么参数',
  },

  {
    // 用户提议「MiniMax 自己的 key 无效，能不能借 openrouter 跑一遍」。可以，但要认清
    // 它量到的是**哪个 host**：这一行属于 openrouter.ai，填不上 api.minimax.chat 那张
    // 欠条 —— 网关做参数归一化，两边的拼法可以完全不同。
    host: 'openrouter.ai', model: 'minimax/minimax-m2', date: '2026-08-21',
    baseline: { ms: 5940, thinkTokens: 496, outChars: 271, finish: 'stop',
      note: '四遍：413 / 411 / 346 / 815 tok —— **同一个请求体抖动 2.4 倍**' },
    tried: [
      { params: { reasoning: { effort: 'low' } }, ms: 6257, thinkTokens: 421, outChars: 271,
        note: '四遍：598 / 171 / 571 / 345 tok（区间 171–598）。与基线的 346–815 几乎完全'
          + '重叠 —— 分不出差别' },
      { params: { reasoning: { enabled: false } }, ms: 228, thinkTokens: null, outChars: 0,
        note: '400，同 host 其它模型那句原话' },
    ],
    verdict: 'rejected',
    why: '证明不了有效果。⚠️ 这一行同时是**工具自己的一次翻车记录**：单次采样下五个候选'
      + '思考量落在 233–264，perf-probe 按最小的那个推荐了 enable_thinking:false —— 一个'
      + '大概率没生效的参数。多跑几遍才看出那只是噪声。工具与 skill 已据此各加一条判据：'
      + '候选相差 <15% 时不给自信结论，先测基线抖动',
  },

  // ── openrouter.ai 全家扫（2026-08-21）─────────────────────────────────
  //
  // 19 个厂商代表，每个基线 ×2 vs reasoning:{effort:'low'} ×2。**只有 1 个**出现不重叠
  // 的改善，而更要紧的是反方向的证据：这个参数在该网关上**不是「降低推理」，是「以低档
  // 开启推理」** —— deepseek-v4-flash / baidu / mistral 三家基线都是 0 思考，加上它之后
  // 分别变成 78–233 / 372–535 / 529 tok。
  //
  // 所以 model-params 里的 openrouter **host 通行行必须保持空白**。把这个参数加到通行行
  // 上是一个听起来很合理的改动（「既然对 gpt-5 有效，那就全都加上」），而它会让大多数
  // 模型变慢变贵。这 19 行的价值就是挡住那个改动。
  //
  // openai/* 前缀那一行仍然成立：它是在**那些模型上**测出不重叠区间的（896–1344 → 64–320）。

  {
    host: 'openrouter.ai', model: "deepseek/deepseek-v4-flash", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 0, outChars: null, finish: 'stop',
      note: '两遍，思考区间 0–0 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 78–233 tok' }],
    verdict: 'rejected',
    why: "⚠️ **反了**：基线不思考，加了参数反而思考 78–233 tok（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "baidu/ernie-4.5-vl-424b-a47b", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 0, outChars: null, finish: 'stop',
      note: '两遍，思考区间 0–0 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 372–535 tok' }],
    verdict: 'rejected',
    why: "⚠️ **反了**：0 → 372–535 tok，且耗时 4.6s → 13–16s（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "mistralai/mistral-small-2603", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 0, outChars: null, finish: 'stop',
      note: '两遍，思考区间 0–0 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 529 tok' }],
    verdict: 'rejected',
    why: "⚠️ **反了**：0 → 529 tok，2.4s → 5.4s（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "amazon/nova-2-lite-v1", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 0, outChars: null, finish: 'stop',
      note: '两遍，思考区间 0–0 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 3 tok' }],
    verdict: 'rejected',
    why: "基线不思考；加了参数也几乎没思考，但耗时 1.5s → 4.4s（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "perplexity/sonar-reasoning-pro", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 0, outChars: null, finish: 'stop',
      note: '两遍，思考区间 0–0 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 0–0 tok' }],
    verdict: 'rejected',
    why: "两边都不报推理 token（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "xiaomi/mimo-v2.5", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 0, outChars: null, finish: 'stop',
      note: '两遍，思考区间 0–0 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 0–0 tok' }],
    verdict: 'rejected',
    why: "两边都不报推理 token（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "qwen/qwen3.7-flash", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 2401, outChars: null, finish: 'stop',
      note: '两遍，思考区间 2401 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 2164–2573 tok' }],
    verdict: 'rejected',
    why: "区间重叠，分不出（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "minimax/minimax-m2.5", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 443, outChars: null, finish: 'stop',
      note: '两遍，思考区间 287–443 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 207–517 tok' }],
    verdict: 'rejected',
    why: "区间重叠，分不出（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "bytedance-seed/seed-1.6-flash", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 829, outChars: null, finish: 'stop',
      note: '两遍，思考区间 693–829 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 732–916 tok' }],
    verdict: 'rejected',
    why: "区间重叠（略偏高）。⚠️ 这是豆包家族，但走的是网关，填不上 ark 自家端点那张欠条（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "x-ai/grok-build-0.1", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 1564, outChars: null, finish: 'stop',
      note: '两遍，思考区间 1117–1564 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 1674–1728 tok' }],
    verdict: 'rejected',
    why: "⚠️ **反了**：思考变多。与 api.x.ai 自家端点上「效果不一致」的结论方向一致（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "tencent/hy3", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 1953, outChars: null, finish: 'stop',
      note: '两遍，思考区间 1386–1953 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 1087–1475 tok' }],
    verdict: 'rejected',
    why: "区间重叠，分不出；且该模型基线就要 22–30 秒（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "stepfun/step-3.5-flash", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 613, outChars: null, finish: 'stop',
      note: '两遍，思考区间 329–613 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 302–350 tok' }],
    verdict: 'rejected',
    why: "区间重叠，分不出（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "meituan/longcat-2.0", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 40, outChars: null, finish: 'stop',
      note: '两遍，思考区间 37–40 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 71–231 tok' }],
    verdict: 'rejected',
    why: "⚠️ **反了**：思考变多（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "inclusionai/ling-3.0-flash", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 458, outChars: null, finish: 'stop',
      note: '两遍，思考区间 242–458 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 38–1161 tok' }],
    verdict: 'rejected',
    why: "区间重叠且候选方差极大（38–1161），分不出（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "z-ai/glm-4.7-flash", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 2108, outChars: null, finish: 'stop',
      note: '两遍，思考区间 1831–2108 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 1562 tok' }],
    verdict: 'rejected',
    why: "⚠️ 基线耗时 18.7–97.8 秒；候选有一次 200 但正文为空（饿死特征）。这个模型在网关上不适合做翻译（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "moonshotai/kimi-k2.5", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 1083, outChars: null, finish: 'stop',
      note: '两遍，思考区间 533–1083 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 998 tok' }],
    verdict: 'rejected',
    why: "候选超时（>120 秒）。基线本身也要 29–45 秒（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "nvidia/nemotron-3.5-lightning", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 0, outChars: null, finish: 'stop',
      note: '两遍，思考区间 0–0 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 — tok' }],
    verdict: 'rejected',
    why: "基线不思考；候选两次都 200 但正文为空（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "upstage/solar-pro4", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 0, outChars: null, finish: 'stop',
      note: '两遍，思考区间 0–0 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 — tok' }],
    verdict: 'rejected',
    why: "基线不思考；候选两次都 200 但正文为空（2026-08-21 全家扫，19 个厂商代表）",
  },
  {
    host: 'openrouter.ai', model: "meta/muse-glimmer-30b", date: '2026-08-21',
    baseline: { ms: null, thinkTokens: 757, outChars: null, finish: 'stop',
      note: '两遍，思考区间 559–757 tok' },
    tried: [{ params: { reasoning: { effort: 'low' } }, ms: null, thinkTokens: null, outChars: null,
      note: '两遍，思考区间 186–315 tok' }],
    verdict: 'rejected',
    why: "**唯一一个区间不重叠的**。但一个孤例不足以支撑 host 通行行，而 meta/ 前缀也不是我们会去匹配的家族（2026-08-21 全家扫，19 个厂商代表）",
  },

  // ── 测过之后决定不写 ─────────────────────────────────────────────────
  {
    host: 'api.x.ai', model: 'grok-4-fast', date: '2026-08-20',
    baseline: { ms: 10176, thinkTokens: 858, outChars: 271, finish: 'stop' },
    tried: [{ params: { reasoning_effort: 'low' }, ms: 8255, thinkTokens: 602, outChars: 283 }],
    verdict: 'rejected',
    why: '本型号有改善，但同 host 的 grok-3-mini 反而变差（624→969tok），效果不一致；'
      + '且四次长段全部 finish=stop、271–283 字，没有饿死风险。不稳定的值是维护负担，不是知识',
  },
  {
    host: 'api.x.ai', model: 'grok-3-mini', date: '2026-08-20',
    baseline: { ms: 8535, thinkTokens: 624, outChars: 273, finish: 'stop' },
    tried: [{ params: { reasoning_effort: 'low' }, ms: 9428, thinkTokens: 969, outChars: 281,
      note: '思考反而更多 —— 这是决定整个 api.x.ai 不写的那条观测' }],
    verdict: 'rejected', why: '加了参数反而更慢更费；见 grok-4-fast 那行',
  },
  {
    host: 'generativelanguage.googleapis.com', model: 'gemini-3.6-flash', date: '2026-08-20',
    baseline: { ms: 7542, thinkTokens: null, outChars: 159, finish: 'stop',
      note: '两遍：6164/8921ms，出参 113/129tok（该端点不单独报推理 token）' },
    tried: [
      { params: { reasoning_effort: 'low' }, ms: 2040, thinkTokens: null, outChars: 183,
        note: '出参 130tok —— 与基线的 113/129 没有实质差别' },
      { params: { reasoning_effort: 'minimal' }, ms: 3639, thinkTokens: null, outChars: 199,
        note: '出参 139tok' },
      { params: { reasoning_effort: 'none' }, ms: 292, thinkTokens: null, outChars: 0,
        note: '400 —— Request contains an invalid argument' },
    ],
    verdict: 'rejected',
    why: '出参 token 基本不变，没有可测量的收益；期间多次 503（high demand），所以按 token 而非墙钟下结论',
  },

  // ── 打不到（带日期的欠条，不是免责声明）────────────────────────────────
  {
    host: 'api.anthropic.com', model: 'claude-haiku-4-5-20251001', date: '2026-08-21',
    baseline: { ms: 4721, thinkTokens: 0, outChars: 271, finish: 'end_turn' },
    tried: [
      { params: { thinking: { type: 'disabled' } }, ms: 3398, thinkTokens: 0, outChars: 279,
        note: '被接受（200），但基线本来就不思考，所以什么也没省' },
      { params: { thinking: { type: 'enabled', budget_tokens: 1024 } }, ms: 6291,
        thinkTokens: 697, outChars: 275,
        note: '**对照组**：显式打开后跑出 697 字思考。它证明上面那个「0」是真实观测，'
          + '而不是我们的解析没找到 —— 没有这一条，「不思考」与「没测到」无法区分' },
    ],
    verdict: 'rejected',
    why: 'extended thinking 是 opt-in，默认就是关的（三个档位实测均为 0）。没有可关的东西；'
      + '显式发 disabled 只是多一个字段，不省任何东西',
  },
  {
    host: 'api.anthropic.com', model: 'claude-sonnet-4-5-20250929', date: '2026-08-21',
    baseline: { ms: 6379, thinkTokens: 0, outChars: 291, finish: 'end_turn' },
    tried: [
      { params: { thinking: { type: 'disabled' } }, ms: 6572, thinkTokens: 0, outChars: 288 },
      { params: { thinking: { type: 'enabled', budget_tokens: 1024 } }, ms: 11567,
        thinkTokens: 680, outChars: 285, note: '同上的对照组' },
    ],
    verdict: 'rejected', why: '同 haiku：默认不思考',
  },
  {
    host: 'api.anthropic.com', model: 'claude-opus-4-5-20251101', date: '2026-08-21',
    baseline: { ms: 6996, thinkTokens: 0, outChars: 278, finish: 'end_turn' },
    tried: [{ params: { thinking: { type: 'disabled' } }, ms: 6166, thinkTokens: 0, outChars: 270 }],
    verdict: 'rejected', why: '同 haiku：默认不思考。三个档位（haiku/sonnet/opus）一致',
  },
  {
    host: 'api.minimax.io', model: 'MiniMax-M2', date: '2026-08-21',
    baseline: { ms: 4777, thinkTokens: 1082, outChars: 165, finish: 'end_turn',
      note: 'messages 形状（/anthropic/v1/messages），两遍：944/1220 字思考、4104/5449ms' },
    tried: [
      { params: { thinking: { type: 'disabled' } }, ms: 6417, thinkTokens: 1252, outChars: 175,
        note: '两遍：1981/522 字 —— 与基线的 944–1220 完全重叠，**证明不了有效果**' },
      { params: { thinking: { type: 'enabled', budget_tokens: 1024 } }, ms: 3596,
        thinkTokens: 529, outChars: 184, note: '对照组：确认思考字段确实读得到' },
    ],
    verdict: 'rejected',
    why: '区间重叠，分不出。⚠️ 但这一轮挖出两个**产品 bug**（都已修 + 加回归）：'
      + '① OpenAI 兼容口上该模型把思考写进正文（<think>…</think>），261 字符输入换回 '
      + '693 字符 —— 不剥就会把一段英文思考独白当译文渲染，而 isTranslated 只看非空，'
      + '没有任何一方会报错；② messages 形状上 thinking 是 content 的第 0 块，而 '
      + 'extractMessages 原来只取 content[0].text ⇒ 一律取到空串 ⇒ 用户看到「翻译失败」，'
      + '而响应里明明有译文。'
      + ' 另注：真正能用的 host 是 api.minimax.io（用户给出），不是表里原先写的 '
      + 'api.minimax.chat / api.minimaxi.com —— 后两者本轮 key 被拒，未能打通。',
  },
  {
    host: 'api.minimax.chat', model: 'MiniMax-M2', date: '2026-08-21',
    verdict: 'unreachable',
    why: 'key 被拒：2049 invalid api key。**充值不能解决 —— 是鉴权不是余额。** '
      + '2026-08-21 复测（用户充值后）三个端点仍全拒，且已定位到是 key 值本身的问题：'
      + '带 Bearer 时报 2049（说明头的写法正确、值不被认），改用裸 key / api-key / '
      + 'x-api-key 三种写法则报 login fail: Please carry the…（头就不对）。'
      + '另：该 key 126 字符、单段、以 sk-api 开头，而 MiniMax 官方 key 是 eyJ… 三段式 JWT '
      + '—— 形状就对不上，多半不是 MiniMax 的 key。需要用户从 MiniMax 控制台重新取。'
      + '⚠️ 顺带记一个真陷阱：/v1/text/chatcompletion_v2 把错误包在 HTTP 200 里（无效 key '
      + '也返回 200 + 空正文），只有 /v1/chat/completions 才正常 401 —— 我们的代码会把它'
      + '当成一次「翻译失败」，且拿不到任何服务端原话',
  },
  {
    host: 'ark.cn-beijing.volces.com', model: '(未取得可用 model id)', date: '2026-08-20',
    verdict: 'unreachable',
    why: 'key 可达（到 API 才报模型级 404），但 doubao-seed-1.6 / doubao-pro-32k / '
      + 'doubao-1.5-pro-32k / kimi-k2-250711 在该账号下全部 InvalidEndpointOrModel.NotFound。'
      + '这里的 model 常是控制台自建的 ep- 接入点 id —— 正是 model-params 那一行必须写成 '
      + 'host 通行的理由。需要用户从火山控制台提供一个可用 id',
  },
  {
    host: 'api.moonshot.cn', model: 'moonshot-v1-8k', date: '2026-08-20',
    verdict: 'unreachable', why: '.local/keys.md 里没有 kimi 的 key',
  },
  {
    host: 'api.moonshot.ai', model: 'moonshot-v1-8k', date: '2026-08-20',
    verdict: 'unreachable', why: '同上（global 侧同样没有 key）',
  },
  {
    // 欠条 → 推测值：与 dashscope.aliyuncs.com 共享同一个 model-params 行（同厂不同域），
    // 源端两个模型都实测过「默认不思考、没有可关的东西」。拿到该域 key 之后应回头实测，
    // `npm run perf:status` 会一直把它列在「推测值」一节里提醒。
    host: 'dashscope-intl.aliyuncs.com', model: 'qwen-plus', date: '2026-08-21',
    verdict: 'inferred', from: 'dashscope.aliyuncs.com',
    why: '同一套 compatible-mode 接口，与源 host 共享 model-params 行。源端实测 rejected'
      + '（qwen-plus 与 qwen3-max 基线思考均为 0，加 enable_thinking:false 无变化），'
      + '本域按同结论处理 —— 即 reasoning 一列留空 —— 直到拿到该域的 key 实测',
  },
];
