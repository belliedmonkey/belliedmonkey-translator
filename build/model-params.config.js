// build/model-params.config.js — 「这个端点的这个模型收哪些可选参数」的观测表。
//
// ── 它不是注册表，这一点决定了它被允许存在 ──────────────────────────────────
//
// 注册表（providers/tts/stt）缺一条 = 用户少一个引擎可选，那是错误。
// **这张表缺一行 = 我们对那个端点少一条知识，于是只发协议要求的最小必要字段** ——
// 那是正确的请求，只是少一点成本与风格控制。
//
// 这条不对称是许可证。`docs/domain-design.md` §7 曾写下「不要做模型参数表，那是别人
// 决定的副本，写下来那天就开始腐烂」——那句话针对的是**另一种设计**：用表去构造一个
// 乐观的请求体，表一旦过期请求就坏掉。本表的默认态相反：表外 = 最小必要 = 不会被拒。
// 它过期的表现是「保守」，不是「说谎」。
//
// ⚠️ 一旦有人往这张表里加一个「缺了就会错」的字段（认证头类型、端点改写、必填参数），
// 许可证就作废了 —— 那会让它变回 2026-08-18 那张冻结迁移表：缺一行就算出错误的 URL。
//
// ── 为什么按 host + 模型前缀匹配，而不是注册表条目 id ─────────────────────────
//
// 用户要覆盖的厂商里 openrouter / grok / minimax 根本不是注册表条目——它们只能通过
// custom_chat 填地址用到，按 id 匹配对它们永远是空。而企业中转网关用自家域名，匹配
// 不到就自动落到最小必要集：**我们对陌生端点的正确态度是少说话，不是猜。**
// 2026-08-20 真机那个 400（网关拒 temperature）在这条规则下从一开始就不会发生。
//
// ── 字段 ──────────────────────────────────────────────────────────────────
//  id          仅用于诊断与日志，不参与匹配。带品牌词的行必须是 global-only。
//  flavors     必填。哪些包收录这一行。带 OpenAI / Claude / api.openai.com /
//              api.anthropic.com 字样的行必须 ['global'] —— 中国合规门连注释一起
//              逐行 grep（build.js 的 complianceGateChina）。实测只有这三个字符串
//              会命中：api.openai.com、api.anthropic.com、裸 id `openai`。
//  hosts       必填，**精确主机名**数组，小写、不带端口、不做通配。
//              不允许 '*.aliyuncs.com'：通配是一个会烂的假设（今天的子域明天换），
//              而漏配的代价只是走最小必要集。国内外双域就老实写两条字符串。
//  models      模型名**前缀**数组，小写比较。省略/空 = 这一行对该 host 的所有模型
//              生效（host 通行行）。命中多行时**前缀最长者赢**；等长时文件顺序在先
//              者赢，所以「表的顺序」是一个可读、可 review 的优先级。
//  temperature true = 收；false = **明确不收**；**缺省 = 不知道**。
//              三态，缺省不等于 false —— 见下方「三态」小节，那是这张表最要紧的一处。
//  budget      输出预算这个可选字段：
//                true                     收，用该 wire format 的规范名
//                'max_completion_tokens'  收，但 chat-compat 下改叫这个名字
//                false                    明确不收
//                缺省                     不知道
//              ⚠️ messages-compat 例外：那条链路上 max_tokens 是 **API 必填**，
//              表说 false 也照发。一行观测表不能推翻一条协议契约。
//  systemRole  chat-compat 里系统消息的 role：'system'（默认）| 'developer'。
//              只对 chat-compat 有意义 —— messages-compat 走顶层 system、
//              responses-compat 走顶层 instructions，那是**形状**的属性，不是模型的。
//  note        为什么写这一行。**必填**，且必须是可被证伪的事实。这张表腐烂的方式是
//              被人凭印象加行。`note` **不出货**（build.js 的白名单不带它）——它是给
//              维护者的证据，也是最容易夹带品牌原话的一段自由文本。
//
// ── 证据不对称：写 false 需要实测，写 true 可以据文档 ────────────────────────
//
//   temperature: true  写错 ⇒ 我们发了 ⇒ 服务端 400 ⇒ 用户看见服务端原话。可见、可恢复。
//   temperature: false 写错 ⇒ 我们不发 ⇒ 用户设的值被静默丢弃（界面上有一行说明）。
//
// 后者更难被发现，所以**任何 false 都必须来自一条真实的服务端拒绝**，note 里要写出
// 那句原话。true 可以据厂商文档 + 同族模型的实测经验，因为它错了会自己叫出来。
//
// ── 表达不了的一类：只收流式的网关 ──────────────────────────────────────────
// 1.5.3 的试探性协商能处理它（被拒后改发 stream:true），这次随协商一并删除。代价写在
// 这里：一个只接受 stream:true 的网关会一直 400，并把服务端原话显示给用户。那是**具名
// 失败**，不是静默错误。表也表达不了它——「先发一次非流式、失败再改流式」本质上就是协商。

module.exports = [
  // ── OpenAI 官方域 ───────────────────────────────────────────────────────
  {
    id: 'openai-classic', flavors: ['global'],
    hosts: ['api.openai.com'],
    models: ['gpt-4', 'gpt-3.5', 'chatgpt-'],
    temperature: true, budget: true, systemRole: 'system',
    note: '4 系与 3.5 系照旧收 temperature + max_tokens + role:system（长期在用）。',
  },
  {
    // 例外行：前缀更长者赢，所以它盖住上面那条家族行。
    id: 'openai-reasoning', flavors: ['global'],
    hosts: ['api.openai.com'],
    models: ['gpt-5', 'o1', 'o3', 'o4'],
    temperature: false, budget: 'max_completion_tokens', systemRole: 'developer',
    note: '实测 2026-08-20，经企业网关转发 gpt-5.6-sol 的 400 原话：'
      + "Unsupported parameter: 'temperature' is not supported with this model."
      + ' param=temperature。同族的改名与 developer 角色为官方文档所载。',
  },

  // ── Anthropic 官方域（messages-compat）──────────────────────────────────
  {
    id: 'anthropic', flavors: ['global'],
    hosts: ['api.anthropic.com'],
    // models 省略 = host 通行。这条链路上 max_tokens 本来就是必填，budget:true 只是
    // 让「用户设的预算」能覆盖调用方的默认值，而不是决定发不发。
    temperature: true, budget: true,
    note: 'Messages 形状：max_tokens 必填、temperature 合法、system 走顶层（文档 + 长期在用）。',
  },

  // ── Gemini 的 chat-compat 端点 ──────────────────────────────────────────
  // 注册表里的 `google` 条目走的是 Gemini 自己的原生形状（generateContent，body 是
  // contents/generationConfig），那条路**根本不经过这张表**。这一行管的是另一件事：
  // 用户把 custom_chat 指向 Gemini 的 Chat Completions 兼容端点时发什么。
  // global-only —— 这个域名在中国大陆不可达，注册表里的 google 条目同样是 global-only。
  {
    id: 'gemini-compat', flavors: ['global'],
    hosts: ['generativelanguage.googleapis.com'],
    temperature: true, budget: true, systemRole: 'system',
    note: '兼容端点 /v1beta/openai/chat/completions 收 temperature 与 max_tokens'
      + '（后者映射到原生的 maxOutputTokens），系统消息按 system 角色收（文档）。',
  },

  // ── 聚合网关 ────────────────────────────────────────────────────────────
  {
    id: 'openrouter', flavors: ['global', 'china'],
    hosts: ['openrouter.ai'],
    temperature: true, budget: true, systemRole: 'system',
    note: '实测 2026-08-18：qwen/qwen3.8-27b 自检 3538ms 通过，请求体带 temperature:0.3。'
      + ' 网关自己做参数归一化，所以 host 通行行成立。',
  },
  {
    // 但归一化不是万能的：走它转推理系模型时，上游的拒绝会一字不差地透传出来。
    id: 'openrouter-reasoning', flavors: ['global'],
    hosts: ['openrouter.ai'],
    models: ['openai/gpt-5', 'openai/o1', 'openai/o3', 'openai/o4'],
    temperature: false, budget: true, systemRole: 'system',
    note: '同 openai-reasoning 的那条 400；网关透传上游错误，原话一字不差。',
  },

  // ── 国内外双域（两条 hosts 写在同一行，因为参数能力一致）──────────────────
  {
    id: 'dashscope', flavors: ['global', 'china'],
    hosts: ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com'],
    temperature: true, budget: true, systemRole: 'system',
    note: 'compatible-mode 完整支持 Chat Completions 的可选字段（文档）。',
  },
  {
    id: 'glm', flavors: ['global', 'china'],
    hosts: ['open.bigmodel.cn', 'api.z.ai'],
    temperature: true, budget: true, systemRole: 'system',
    note: 'paas/v4 收 temperature 与 max_tokens（文档）。',
  },
  {
    id: 'deepseek', flavors: ['global', 'china'],
    hosts: ['api.deepseek.com'],
    temperature: true, budget: true, systemRole: 'system',
    note: '长期基线（verification-spec §0）：一直带 temperature:0.3 发送，从未被拒。',
  },
  {
    id: 'kimi', flavors: ['global', 'china'],
    hosts: ['api.moonshot.cn', 'api.moonshot.ai'],
    temperature: true, budget: true, systemRole: 'system',
    note: 'moonshot-v1 系收 temperature 与 max_tokens（文档）。',
  },
  {
    id: 'ark', flavors: ['global', 'china'],
    hosts: ['ark.cn-beijing.volces.com'],
    // models 省略 = host 通行。这一行**必须**是通行行：Ark 的 `model` 字段收的既可以是
    // 模型名（doubao-…），也可以是用户自己在控制台建的推理接入点 id（ep-…），后者是一
    // 串与模型无关的编号 —— 按模型名前缀去匹配它永远匹配不上，写前缀等于写了个死条目。
    temperature: true, budget: true, systemRole: 'system',
    note: 'Chat Completions 兼容，收 temperature 与 max_tokens（文档）。'
      + ' 其它地域的 ark 域名（非 cn-beijing）不在本表内，会落到最小必要集 —— 那是'
      + '正确的兜底，不是遗漏：没实测过的主机名不该凭猜写进来。',
  },
  {
    id: 'grok', flavors: ['global'],
    hosts: ['api.x.ai'],
    temperature: true, budget: true, systemRole: 'system',
    note: 'Chat Completions 兼容（文档）。它不收的是 presence/frequency_penalty 与 stop，'
      + '而我们从来不发那三个，所以表里不需要为它们造字段。',
  },
  {
    id: 'minimax', flavors: ['global', 'china'],
    hosts: ['api.minimax.chat', 'api.minimaxi.com'],
    temperature: true, budget: true, systemRole: 'system',
    note: 'Chat Completions 兼容（文档）。temperature 需 > 0，因此高级面板的下限是 0.01 而非 0。',
  },
];
