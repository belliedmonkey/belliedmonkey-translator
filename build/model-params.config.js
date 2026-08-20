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
//  reasoning   「把思考压下去」的那组字段，**按 chat-compat 的写法存一个请求体片段**。
//              缺省 = 不发 = 用模型自己的默认行为 = 今天的行为。
//
//              为什么是片段而不是一个档位字符串:各家根本不是同一种机制,实测 2026-08-20:
//                api.openai.com   reasoning_effort: 'minimal' / 'low'   —— 档位
//                api.deepseek.com thinking: { type: 'disabled' }        —— 开关
//                open.bigmodel.cn thinking: { type: 'disabled' }        —— 开关
//              而 `reasoning_effort` 在后两家是**被接受但完全无效**(GLM 加了
//              reasoning_effort:'low' 仍然 38 秒、思考 1991 tok、正文 0 字)。一个枚举
//              字符串表达不了这两种东西,所以这里存的就是要合并进请求体的字段本身。
//
//              形状差异仍由 request-shape.js 处理:responses-compat 上 reasoning_effort
//              要写成 reasoning:{effort},写成顶层会 400,原话「In the Responses API,
//              this parameter has moved to 'reasoning.effort'」(实测)。
//
//              ⚠️ 允许的顶层键是一份**白名单**(registry.test.js 钉住),不是任意字段。
//              这一列写的是我们真的会发出去的东西,片段比枚举强大得多,而这张表的许可证
//              建立在「表里没有一个字段是缺了就会错的」之上 —— 白名单是那条边界的守卫。
//
//              ⚠️ 它**不是**「缺了就会错」的字段:不发 = 模型默认行为 = 今天的行为。
//              它省的是时间和一次失败,不是请求的正确性 —— 许可证仍然成立。
//
//              ⚠️ 关掉思考是一个**质量取舍**,不只是速度。对翻译这个任务实测下来译文
//              长度与可读性相当(见各行 note),但那是这个任务的结论,不是普适结论。
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
    models: ['gpt-5'],
    temperature: false, budget: 'max_completion_tokens', systemRole: 'developer',
    reasoning: { reasoning_effort: 'minimal' },
    note: '实测 2026-08-20，经企业网关转发 gpt-5.6-sol 的 400 原话：'
      + "Unsupported parameter: 'temperature' is not supported with this model."
      + ' param=temperature。同族的改名与 developer 角色为官方文档所载。'
      + ' reasoning:minimal 为实测所迫（2026-08-20，gpt-5-mini，真 key，用户真机同款配置）：'
      + '不发这个档位时，一段 870 字的维基正文 27.8 秒烧光 2000 预算全部用于思考，'
      + 'finish_reason=length、正文 0 字 —— 用户看到的就是「翻译失败,点此重试」，而重试'
      + '永远同样失败。加上 minimal 后同一段 5.6 秒成功、推理 0 tok；23 字的小标题'
      + '从 9.3 秒降到 1.3 秒。',
  },

  {
    // o 系与 gpt-5 系分成两行，唯一的原因是**档位取值不同**，而这是实测逼出来的：
    // o3-mini / o4-mini 收到 'minimal' 直接 400，原话
    //   Unsupported value: 'reasoning_effort' does not support 'minimal' with this
    //   model. Supported values are: 'low', …
    // 合成一行写 'minimal' 会打断一条今天能用的路 —— 这两个型号不发档位时本来是 200。
    id: 'openai-o-series', flavors: ['global'],
    hosts: ['api.openai.com'],
    models: ['o1', 'o3', 'o4'],
    temperature: false, budget: 'max_completion_tokens', systemRole: 'developer',
    reasoning: { reasoning_effort: 'low' },
    note: '实测 2026-08-20（真 key）：o3-mini / o4-mini 拒收 minimal，原话 '
      + "「Unsupported value: 'reasoning_effort' does not support 'minimal' with this "
      + "model. Supported values are: 'low', …」；改用 low 后两者均 200"
      + '（o3-mini 2785ms、o4-mini 2642ms，对照不发档位时 5782ms / 3332ms）。'
      + ' temperature 与 developer 角色同 gpt-5 系。',
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
      + '（后者映射到原生的 maxOutputTokens），系统消息按 system 角色收（文档）。'
      + ' **reasoning 一列刻意留空,是实测之后的决定,不是没测**（2026-08-20，真 key，'
      + 'gemini-3.6-flash，基线与 low 交替各两遍以摊掉抖动）：出参 token 基本不变'
      + '（基线 113·129 → low 130·139 → minimal 139），四次全部 finish=stop、149–199 字、'
      + "没有饿死风险；effort:'none' 被拒（400 Request contains an invalid argument）。"
      + ' 没有可测量的收益就不写 —— 写进来只会变成一个要跟着厂商改的负担。'
      + ' 另注：该端点期间多次返回 503（This model is currently experiencing high demand），'
      + '所以单次耗时不能当证据，这也是这一行按出参 token 而非墙钟时间下结论的原因。',
  },

  // ── 聚合网关 ────────────────────────────────────────────────────────────
  {
    id: 'openrouter', flavors: ['global', 'china'],
    hosts: ['openrouter.ai'],
    temperature: true, budget: true, systemRole: 'system',
    // ⚠️ **这一行刻意没有 reasoning，而且是实测之后的决定**：把同 host 那条按模型前缀
    // 限定的推理行（见下一条）的 reasoning:{effort:'low'} 提到通行行上，是一个听起来很
    // 合理的改动（「对那一族有效，那就全都加上」），而 2026-08-21 的 19 厂商全家扫证明
    // 它会**帮倒忙** —— 在这个网关上
    // 那个参数对本来不思考的模型是「以低档**开启**推理」：deepseek-v4-flash 0 → 78–233 tok、
    // baidu 0 → 372–535、mistral 0 → 529。19 个代表里只有 1 个出现不重叠的改善。
    // 逐条证据见 build/perf-ledger.config.js 的「全家扫」一节。
    note: '实测 2026-08-18：qwen/qwen3.8-27b 自检 3538ms 通过，请求体带 temperature:0.3。'
      + ' 网关自己做参数归一化，所以 host 通行行成立。'
      + ' reasoning 一列留空是 2026-08-21 全家扫（19 个厂商代表）之后的决定，不是没测：'
      + '该参数在这个网关上对不思考的模型是「开启」而非「降档」，加到通行行会让大多数'
      + '模型变慢变贵。只有下一条按模型前缀限定的推理行有不重叠区间为证。',
  },
  {
    // 但归一化不是万能的：走它转推理系模型时，上游的拒绝会一字不差地透传出来。
    id: 'openrouter-reasoning', flavors: ['global'],
    hosts: ['openrouter.ai'],
    models: ['openai/gpt-5', 'openai/o1', 'openai/o3', 'openai/o4'],
    temperature: false, budget: true, systemRole: 'system',
    reasoning: { reasoning: { effort: 'low' } },
    note: '同 openai-reasoning 的那条 400；网关透传上游错误，原话一字不差。'
      + ' 推理参数是**第四种拼法**（实测 2026-08-20，真 key）：这个网关用嵌套的'
      + ' reasoning:{effort}，与 OpenAI 的顶层 reasoning_effort、GLM/DeepSeek 的'
      + ' thinking 都不同。openai/gpt-5-mini 基线 9146ms/704tok → effort:low'
      + ' 4255ms/192tok；deepseek/deepseek-r1 思考 466→237tok。'
      + " ⚠️ 顶层 reasoning_effort 在这里**也返回 200，但明显没那么有效**（320 vs 192tok）"
      + '——只看状态码会选到次优的拼法，这是本表最需要实测而非读文档的一类差异。'
      + " reasoning:{enabled:false} 被明确拒绝，原话「Reasoning is mandatory for this"
      + " endpoint and cannot be disabled.」，所以只能降档不能关。"
      + ' 不思考的模型（qwen/qwen3.8-27b、openai/gpt-4o-mini）带上它照常 200。',
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
    reasoning: { thinking: { type: 'disabled' } },
    note: 'paas/v4 收 temperature 与 max_tokens（文档）。'
      + ' thinking:disabled 为实测所迫（2026-08-20，open.bigmodel.cn，真 key，各跑两遍）：'
      + 'glm-4.6 基线 24339·25328ms、思考 1995·1996 tok、**正文 0 字**——与 gpt-5-mini'
      + '同一种坏法（预算被思考吃光，用户看到「翻译失败」）；关掉后 1253·1567ms、117 字。'
      + ' reasoning_effort:low 在这里被接受但完全无效（仍 38 秒 / 1991 tok / 0 字）。'
      + ' 不思考的 glm-4-flash 带上它也照常 200，故写成 host 通行行。'
      + ' 两个 host 都实测过：api.z.ai 走产品代码 1444ms、思考 0、正文 17 字。'
      + ' ⚠️ open.bigmodel.cn 的时延本身波动很大（同一请求体在紧循环里 0.6–1.2 秒，'
      + '在单次调用里见过 19.9 秒），所以这一行的证据是「思考归零」，不是某个固定耗时。',
  },
  {
    id: 'deepseek', flavors: ['global', 'china'],
    hosts: ['api.deepseek.com'],
    temperature: true, budget: true, systemRole: 'system',
    reasoning: { thinking: { type: 'disabled' } },
    note: '长期基线（verification-spec §0）：一直带 temperature:0.3 发送，从未被拒。'
      + ' thinking:disabled 为实测（2026-08-20，真 key，同一段 440 字正文，各跑两遍）：'
      + '**注册表默认的 deepseek-v4-flash 基线就在思考**（3549ms / 278 tok），关掉后'
      + '1126ms、思考 0，快 3.2 倍；deepseek-reasoner 3515·3497ms / 228·223 tok →'
      + '1414·1178ms / 0。译文长度相当（123→111、118→116、127→115 字）。'
      + ' reasoning_effort 在这个 host 上被接受但无效，所以不能用它。'
      + ' 不思考的模型带上这个参数也照常 200，故写成 host 通行行。',
  },
  {
    id: 'kimi', flavors: ['global', 'china'],
    hosts: ['api.moonshot.cn', 'api.moonshot.ai'],
    temperature: true, budget: true, systemRole: 'system',
    reasoning: { thinking: { type: 'disabled' } },
    note: 'moonshot-v1 系收 temperature 与 max_tokens（文档）。'
      + ' thinking:disabled 为实测所迫（2026-08-21，api.moonshot.ai，真 key，kimi-k2.6，'
      + '各跑两遍）：基线 24263/30287ms、思考 1428/1999 tok，其中一次 finish=length、'
      + '**正文 0 字** —— 与另外两家同一种饿死。加上之后 3432/3263ms、思考 1 tok、'
      + '正文 277/266 字，快约 8 倍且饿死消失。'
      + ' 五个候选里只有它有效：reasoning_effort 的 minimal 与 low 各自也饿死一次，'
      + 'reasoning:{enabled:false} 与 enable_thinking:false 反而让思考**变多**'
      + '（名字里写着「关闭」，行为是「开启」）。'
      + ' 两个 host 共用本行：.cn 的结论按同厂跨域继承自 .ai（perf-ledger 里 verdict:inferred）。',
  },
  {
    id: 'ark', flavors: ['global', 'china'],
    hosts: ['ark.cn-beijing.volces.com'],
    // models 省略 = host 通行。这一行**必须**是通行行：Ark 的 `model` 字段收的既可以是
    // 模型名（doubao-…），也可以是用户自己在控制台建的推理接入点 id（ep-…），后者是一
    // 串与模型无关的编号 —— 按模型名前缀去匹配它永远匹配不上，写前缀等于写了个死条目。
    temperature: true, budget: true, systemRole: 'system',
    reasoning: { thinking: { type: 'disabled' } },
    note: 'Chat Completions 兼容，收 temperature 与 max_tokens（文档）。'
      + ' thinking:disabled 为实测所迫（2026-08-21，真 key，doubao-seed-2-1-turbo-260628，'
      + '883 字维基正文）：**基线 120 秒超时**，而加上它之后 4893ms、思考 0、正文 291 字。'
      + '这是本表里最极端的一条 —— 不加参数这个模型根本没法用于翻译。'
      + " reasoning_effort:'minimal' 同样有效（4750ms/思考 0），两者择一；选 thinking 是"
      + '为了与同为国内厂商的另外几行保持一致。'
      + ' ⚠️ 另外三个候选**让情况更糟**：reasoning:{effort:low} 88882ms/思考 5246、'
      + 'reasoning:{enabled:false} 111470ms/思考 6145（名字写着「关闭」，行为是狂想）、'
      + 'enable_thinking:false 直接 120 秒超时。'
      + ' 其它地域的 ark 域名（非 cn-beijing）不在本表内，会落到最小必要集 —— 那是'
      + '正确的兜底，不是遗漏：没实测过的主机名不该凭猜写进来。'
      + ' 排查备忘（2026-08-20/21 问错过三次）：先 GET /api/v3/models 拿目录，别猜 id；'
      + '豆包的 id 用**连字符不用点**且带日期后缀；而「目录里有」不等于「账号已开通」，'
      + '未开通时报的是 has not activated 而不是 NotFound。',
  },
  {
    id: 'grok', flavors: ['global'],
    hosts: ['api.x.ai'],
    temperature: true, budget: true, systemRole: 'system',
    note: 'Chat Completions 兼容（文档）。它不收的是 presence/frequency_penalty 与 stop，'
      + '而我们从来不发那三个，所以表里不需要为它们造字段。'
      + ' **reasoning 一列刻意留空,是实测之后的决定,不是没测**（2026-08-20，真 key）：'
      + 'reasoning_effort:low 全型号都收（grok-4/grok-4-latest/grok-4-fast/grok-3-mini 均 200），'
      + '但效果不一致、甚至为负 —— grok-4-fast 长段 858→602tok 变好，grok-3-mini 长段'
      + '624→**969**tok 变差，grok-4-latest 短句 3336→4121ms 变慢。四次长段全部 finish=stop、'
      + '271–283 字，**没有饿死风险**。一个效果不稳定的值不值得写进表：它带来的是维护负担,'
      + '不是知识。',
  },
  {
    id: 'minimax', flavors: ['global', 'china'],
    // 2026-08-21：真正能用的是 api.minimax.io（用户给出），同一个 host 上 chat-compat
    // 与 messages-compat 两条口都通。原先表里写的 api.minimax.chat / api.minimaxi.com
    // 是**错的地址**，已删 —— 留着一个从未打通、能力未证实的 host，等于让这张表说一句
    // 我们并不知道的话；而删掉之后它们只是「表外」，照样能用，只是走最小必要集。
    hosts: ['api.minimax.io'],
    temperature: true, budget: true, systemRole: 'system',
    note: 'Chat Completions 兼容（文档）。temperature 需 > 0，因此高级面板的下限是 0.01 而非 0。'
      + ' reasoning 一列**测过之后决定留空**（2026-08-21，api.minimax.io，真 key）：'
      + 'MiniMax-M2 在 messages 形状上基线思考 944/1220 字，thinking:{type:\'disabled\'}'
      + ' 之后是 1981/522 字 —— 区间完全重叠，证明不了有效果。'
      + ' ⚠️ 两个真陷阱：① 该模型在 chat-compat 那条口上**把思考写进正文**（<think>…</think>），'
      + '不进 reasoning_content —— 261 字符输入换回 693 字符，不剥就会把英文思考独白当译文'
      + '渲染出去；② 它在 messages 形状上把 thinking 放在 content 的**第 0 块**。'
      + '两处都已在 request-shape.js 的 extractChat / extractMessages 修掉并加了回归。'
      + ' ③ 老域名 /v1/text/chatcompletion_v2 把错误包在 HTTP 200 里（无效 key 也返回'
      + ' 200 + 空正文）。',
  },
];
