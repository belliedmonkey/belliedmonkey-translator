// test/model-params.test.js — 能力表本身的规约，以及匹配算法。
//
// 分工：translation-api.test.js 验的是「查表的结果最终变成了什么请求体」（端到端），
// 这里验的是表和匹配器本身——那两件事会因为不同的原因坏掉。表可以被人手改坏（加一行
// 没有证据的 false、写一个通配 host），匹配器可以被改坏（等长前缀的胜负翻转）。
//
// 表的准入规则写在 build/model-params.config.js 的头部，核心是一条**证据不对称**：
//   temperature: true  写错 ⇒ 我们发了 ⇒ 服务端 400 ⇒ 用户看见原话。可见、可恢复。
//   temperature: false 写错 ⇒ 我们不发 ⇒ 用户设的值被静默丢弃，没有任何一方会报错。
// 所以 false 必须带一条真实的服务端拒绝，写进 note。下面把这条规则变成一道门。

const { describe, test, ok, eq, deepEq } = require('./harness');
const { loadModule } = require('./harness');
const WireFormat = require('../extension/content/wire-format.js');
const TABLE = require('../build/model-params.config.js');

// 匹配器要的是**出货后**的表（build.js 过滤过 flavor、砍掉 note）。这里直接喂配置
// 原表：字段是同名的，而 flavor 过滤本身由 registry.test.js 与合规门管。
function shapeWith(rows, store) {
  const window = { MT_MODEL_PARAMS: rows };
  const chrome = {
    storage: {
      local: { get: (_k, cb) => cb(store || {}) },
      onChanged: { addListener: () => {} },
    },
  };
  const ctx = loadModule('request-shape.js', { window, chrome, WireFormat, FormData: class {} });
  return ctx.RequestShape;
}

describe('能力表：准入规则', () => {
  test('每一行都带 note —— 没有理由的行就是凭印象加的行', async () => {
    for (const r of TABLE) {
      ok(String(r.note || '').trim().length > 10, `${r.id} 的 note 太短或缺失`);
    }
  });

  test('任何 false 都必须在 note 里引用一条真实的服务端拒绝', () => {
    // 这是证据不对称落到机器上的样子。true 不受此约束（据文档即可，错了会自己叫）。
    for (const r of TABLE) {
      const denies = [r.temperature === false, r.budget === false].some(Boolean);
      if (!denies) continue;
      ok(/实测|400|拒|Unsupported|not supported/i.test(String(r.note)),
        `${r.id} 写了 false 却没有引用服务端拒绝 —— 写错时没有任何一方会报错`);
    }
  });

  test('hosts 是精确主机名：小写、无端口、无通配、无协议', () => {
    // 通配是一个会烂的假设（今天的子域明天换），而漏配的代价只是走最小必要集。
    for (const r of TABLE) {
      ok(Array.isArray(r.hosts) && r.hosts.length > 0, `${r.id} 没有 hosts`);
      for (const h of r.hosts) {
        eq(h, h.toLowerCase(), `${r.id} 的 host 不是小写: ${h}`);
        ok(!h.includes('*'), `${r.id} 的 host 带通配: ${h}`);
        ok(!h.includes('/') && !h.includes(':'), `${r.id} 的 host 带协议或端口: ${h}`);
      }
    }
  });

  test('models 前缀全小写 —— 匹配时输入被 toLowerCase，大写前缀永远命不中', () => {
    for (const r of TABLE) {
      for (const m of (r.models || [])) {
        eq(m, m.toLowerCase(), `${r.id} 的模型前缀不是小写: ${m}`);
      }
    }
  });

  test('budget 只有四种取值 —— 打错的字符串会被当成字段名发出去', () => {
    for (const r of TABLE) {
      if (!('budget' in r)) continue;
      const v = r.budget;
      ok(v === true || v === false || v === 'max_completion_tokens' || v === 'max_output_tokens',
        `${r.id} 的 budget 取值不认识: ${JSON.stringify(v)}`);
    }
  });

  test('systemRole 只有两种 —— 别的值会变成一个服务端不认的 role', () => {
    for (const r of TABLE) {
      if (!('systemRole' in r)) continue;
      ok(r.systemRole === 'system' || r.systemRole === 'developer',
        `${r.id} 的 systemRole 取值不认识: ${r.systemRole}`);
    }
  });
});

describe('能力表：匹配', () => {
  const ROWS = [
    { id: 'pass', hosts: ['h.test'], temperature: true, budget: true },
    { id: 'short', hosts: ['h.test'], models: ['gpt-5'], temperature: false },
    { id: 'long', hosts: ['h.test'], models: ['gpt-5.6-sol'], budget: 'max_output_tokens' },
    { id: 'tie-a', hosts: ['t.test'], models: ['abcd'], systemRole: 'developer' },
    { id: 'tie-b', hosts: ['t.test'], models: ['abcd'], systemRole: 'system' },
  ];

  test('表外的 host ⇒ 什么都不知道，而不是「都不支持」', () => {
    // 这个区别就是整套设计：不知道 ⇒ 只发最小必要；都不支持 ⇒ 会把用户设的值吃掉。
    const RS = shapeWith(ROWS);
    const caps = RS.paramsFor('https://unknown.example/v1/chat/completions', 'anything');
    eq(caps.matched, false, '表外要明确标记为未命中');
    eq(caps.temperature, undefined, '不知道 ≠ false');
    eq(caps.budget, undefined);
  });

  test('前缀更长者赢，与它在表里的位置无关', () => {
    const RS = shapeWith(ROWS);
    eq(RS.paramsFor('https://h.test/v1/chat/completions', 'gpt-5.6-sol').id, 'long');
    eq(RS.paramsFor('https://h.test/v1/chat/completions', 'gpt-5-mini').id, 'short');
  });

  test('等长前缀 ⇒ 表里靠前者赢，所以表的顺序是一份可 review 的优先级', () => {
    const RS = shapeWith(ROWS);
    eq(RS.paramsFor('https://t.test/v1/chat/completions', 'abcd-x').id, 'tie-a');
  });

  test('模型名未知时只有 host 通行行能命中', () => {
    const RS = shapeWith(ROWS);
    eq(RS.paramsFor('https://h.test/v1/chat/completions', '').id, 'pass');
  });

  test('host 匹配是精确的 —— 子域不继承父域的能力', () => {
    // 一个企业网关可能叫 corp-h.test 或 gw.h.test，而它和 h.test 毫无关系。
    const RS = shapeWith(ROWS);
    eq(RS.paramsFor('https://gw.h.test/v1/chat/completions', 'gpt-5').matched, false);
    eq(RS.paramsFor('https://corp-h.test/v1/chat/completions', 'gpt-5').matched, false);
  });

  test('端口、大小写、userinfo 都不影响 host 匹配', () => {
    const RS = shapeWith(ROWS);
    eq(RS.paramsFor('https://H.TEST:8443/v1/chat/completions', '').id, 'pass');
    eq(RS.paramsFor('https://user@h.test/v1/chat/completions', '').id, 'pass');
  });

  test('不是 URL 的地址不会命中任何一行', () => {
    const RS = shapeWith(ROWS);
    eq(RS.paramsFor('', 'gpt-5').matched, false);
    eq(RS.paramsFor('not a url', 'gpt-5').matched, false);
  });
});

describe('能力表：真实的表在真实的地址上', () => {
  test('那个企业网关（自家域名）永远落到最小必要集', () => {
    // 2026-08-20 的 400 就是这一条。它现在是一条测试，而不是一天的调试。
    const RS = shapeWith(TABLE);
    const caps = RS.paramsFor('https://idealab.alibaba-inc.com/v1/chat/completions', 'gpt-5.6-sol');
    eq(caps.matched, false);
    const req = RS.build('chat-compat', {
      url: 'https://idealab.alibaba-inc.com/v1/chat/completions',
      model: 'gpt-5.6-sol', system: 's', user: 'u', budget: 2000,
    });
    eq(Object.keys(req.body).sort().join(','), 'messages,model');
  });
});

// ─── 翻译专用形状（domain-design §7 第三条声明）────────────────────────────
// 这一组的存在理由跟上面几组不同。上面钉的是「少发了什么」，这里钉的是「必须发」——
// 而且是因为漏发**不会报错**：实测 2026-08-20，qwen-mt 缺 translation_options 时服务端
// 答 200 并把原文原样吐回来，isTranslated() 只看非空，于是英文段落下面渲染出同一句
// 英文，没有任何报错，还会进 12 小时缓存。一个必填字段的缺失被答以一个像模像样的 200,
// 就必须由结构保证，而不是由「记得传」保证。
describe('translate-compat：qwen-mt 的形状', () => {
  const RS = () => shapeWith(TABLE);
  const DASH = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

  test('translation_options 一定在，且带目标语言', () => {
    const req = RS().build('translate-compat', {
      url: DASH, model: 'qwen-mt-turbo', system: '（应被丢弃）', user: 'hello',
      targetLang: 'zh-CN', budget: 2000,
    });
    ok(req.body.translation_options, 'translation_options 缺失 = 静默回显原文');
    eq(req.body.translation_options.target_lang, 'zh');
    eq(req.body.translation_options.source_lang, 'auto');
  });

  test('只有一条 user 消息，没有 system —— 两者都会 400', () => {
    const req = RS().build('translate-compat', {
      url: DASH, model: 'qwen-mt-turbo', system: '（应被丢弃）', user: 'hello', targetLang: 'zh-CN',
    });
    eq(req.body.messages.length, 1, '多于一条: The length of the input.messages field has exceeded the limit');
    eq(req.body.messages[0].role, 'user', 'system 角色: Role must be in [user, assistant]');
    eq(req.body.messages[0].content, 'hello');
    ok(!JSON.stringify(req.body).includes('应被丢弃'), '提示词在这个形状里没有位置');
  });

  test('zh-TW 映射成 Traditional Chinese，不是 zh —— 否则繁体用户静默拿到简体', () => {
    // 实测：zh-TW / zh-Hant 都 400，裸 zh 会 200 但输出简体。这条断言是那个静默错误的
    // 唯一守卫，因为服务端对「给繁体用户简体」这件事永远不会有意见。
    const RS2 = RS();
    eq(RS2.translateLang('zh-TW'), 'Traditional Chinese');
    eq(RS2.translateLang('zh-CN'), 'zh');
    eq(RS2.translateLang('ja'), 'ja', '实测可用的裸代码原样透传');
    eq(RS2.translateLang('xx-YY'), 'xx-YY', '没见过的原样透传 —— 换来一句可见的 400');
  });

  test('可选字段仍走能力表：dashscope 说收，就带上', () => {
    const req = RS().build('translate-compat', {
      url: DASH, model: 'qwen-mt-turbo', user: 'hello', targetLang: 'zh-CN', budget: 2000,
    });
    eq(req.body.temperature, 0.3);
    eq(req.body.max_tokens, 2000);
  });
});

describe('形状判定：同一地址内由模型名声明', () => {
  const WF = require('../extension/content/wire-format.js');
  const DASH = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

  test('qwen-mt 家族 ⇒ translate-compat；同址别的模型 ⇒ 照旧 chat-compat', () => {
    eq(WF.formatFor(DASH, 'chat-compat', 'qwen-mt-turbo'), 'translate-compat');
    eq(WF.formatFor(DASH, 'chat-compat', 'qwen-mt-plus'), 'translate-compat');
    eq(WF.formatFor(DASH, 'chat-compat', 'qwen-plus'), 'chat-compat');
    eq(WF.formatFor(DASH, 'chat-compat', ''), 'chat-compat');
  });

  test('判据是 host 与模型前缀两者，不是任一 —— 两个方向都会静默出错', () => {
    // 不该用却用了：发出去的是一句没有任何指令的裸文本，同样是个像模像样的 200。
    eq(WF.formatFor('https://gw.corp.example/v1/chat/completions', 'chat-compat', 'qwen-mt-turbo'),
      'chat-compat', '陌生 host 上的同名模型不该被换形状');
  });

  test('家族封闭 —— 语音/转写端点不会被模型名拖进对话形状', () => {
    eq(WF.formatFor('https://x.example/v1/audio/speech', 'speech-compat', 'qwen-mt-turbo'), 'speech-compat');
    eq(WF.formatFor('https://x.example/v1/audio/transcriptions', 'transcribe-compat', 'qwen-mt-turbo'),
      'transcribe-compat');
  });
});

// ─── 推理档位：一个被实测所迫的字段 ────────────────────────────────────────
// 2026-08-20 用户真机报「翻译失败」，配置是 ChatGPT + gpt-5-mini。真端点复现（真 key）：
//
//   长段(870字) 预算2000 不发档位  ⇒ 27.8s, finish=length, 推理 2000 tok, 正文 **0 字**
//   长段(870字) 预算2000 + minimal ⇒  5.6s, finish=stop,   推理 0 tok,    正文 304 字
//   短句(23字)  预算2000 不发档位  ⇒  9.3s（推理 448 tok，为了译一个小标题）
//   短句(23字)  预算2000 + minimal ⇒  1.3s
//
// 推理开销**不随输入变小而变小**，短输入上反而更大。所以对翻译这种任务，压到最低档
// 不是省钱，是让它能用。
describe('推理档位：表只存档位，拼法由形状决定', () => {
  const RS = () => shapeWith(TABLE);
  const OA = 'https://api.openai.com/v1/chat/completions';
  const OA_RESP = 'https://api.openai.com/v1/responses';

  test('chat-compat：片段原样合并（这一家的机制是档位）', () => {
    const req = RS().build('chat-compat', {
      url: OA, model: 'gpt-5-mini', system: 's', user: 'u', budget: 2000,
    });
    eq(req.body.reasoning_effort, 'minimal');
    ok(!req.body.reasoning, '这条形状不用嵌套写法');
  });

  test('responses-compat 用嵌套 reasoning.effort —— 写成顶层字符串会 400', () => {
    // 服务端原话（实测）：In the Responses API, this parameter has moved to
    // 'reasoning.effort'. 两条形状同一个模型、同一个档位、两种拼写。
    const req = RS().build('responses-compat', {
      url: OA_RESP, model: 'gpt-5-mini', system: 's', user: 'u', budget: 2000,
    });
    eq(req.body.reasoning && req.body.reasoning.effort, 'minimal');
    ok(!('reasoning_effort' in req.body), '顶层写法在这条形状上是 400');
  });

  test('各家机制不同：deepseek / glm 是开关，不是档位', () => {
    // reasoning_effort 在这两家**被接受但完全无效**（glm 加了 reasoning_effort:'low'
    // 仍然 38 秒、思考 1991 tok、正文 0 字）。所以表里存的是字段本身，不是一个枚举。
    const S = RS();
    for (const url of ['https://api.deepseek.com/v1/chat/completions',
                       'https://open.bigmodel.cn/api/paas/v4/chat/completions',
                       'https://api.z.ai/api/paas/v4/chat/completions']) {
      const b = S.build('chat-compat', { url, model: 'x', system: 's', user: 'u', budget: 2000 }).body;
      deepEq(b.thinking, { type: 'disabled' }, url);
      ok(!('reasoning_effort' in b), url + ' 不该发档位 —— 那个字段在这里是无效的');
    }
  });

  test('没实测过的行一个字都不发 —— 猜错会打断一条今天能用的路', () => {
    const S = RS();
    // openrouter：没打过那个网关的推理参数归一化。
    // dashscope：实测 qwen-plus / qwen3-max 默认就不思考，没有可关的东西。
    for (const [url, model] of [
      ['https://openrouter.ai/api/v1/chat/completions', 'openai/gpt-5'],
      ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen-plus'],
      ['https://api.x.ai/v1/chat/completions', 'grok-4'],
    ]) {
      const b = S.build('chat-compat', { url, model, system: 's', user: 'u', budget: 2000 }).body;
      ok(!('reasoning_effort' in b) && !('thinking' in b), url + ' 不该发任何推理字段');
    }
  });

  test('表外的 host 仍然只有最小必要集 —— 新字段不许把兜底撑大', () => {
    const req = RS().build('chat-compat', {
      url: 'https://gw.corp.example/v1/chat/completions', model: 'gpt-5-mini',
      system: 's', user: 'u', budget: 2000,
    });
    eq(Object.keys(req.body).sort().join(','), 'messages,model');
  });
});

describe('预算被思考吃光：认出来，并且不要重试', () => {
  const RS = () => shapeWith(TABLE);

  test('两条形状的截断信号都认得', () => {
    const S = RS();
    ok(S.starvedByReasoning({ choices: [{ finish_reason: 'length', message: { content: '' } }] }),
      'chat-compat: finish_reason=length');
    ok(S.starvedByReasoning({ status: 'incomplete' }), 'responses-compat: status=incomplete');
    ok(S.starvedByReasoning({ incomplete_details: { reason: 'max_output_tokens' } }),
      'responses-compat: incomplete_details');
  });

  test('正常收尾不会被误判 —— 误判会把一次成功变成一条吓人的报错', () => {
    const S = RS();
    ok(!S.starvedByReasoning({ choices: [{ finish_reason: 'stop', message: { content: 'x' } }] }));
    ok(!S.starvedByReasoning({ status: 'completed' }));
    ok(!S.starvedByReasoning(null));
    ok(!S.starvedByReasoning('not an object'));
    ok(!S.starvedByReasoning({}));
  });
});

describe('推理档位：档位取值本身要按型号分', () => {
  const RS = () => shapeWith(TABLE);
  const OA = 'https://api.openai.com/v1/chat/completions';

  test('gpt-5 系用 minimal，o 系用 low —— 合成一行会打断 o 系', () => {
    // 实测 2026-08-20：o3-mini / o4-mini 收到 'minimal' 直接 400，原话
    // 「Unsupported value: 'reasoning_effort' does not support 'minimal' with this
    // model. Supported values are: 'low', …」。而它们不发档位时本来是 200，所以
    // 猜一个通用档位过去，代价是把一条能用的路打断。
    const S = RS();
    for (const m of ['gpt-5-mini', 'gpt-5-nano', 'gpt-5']) {
      eq(S.build('chat-compat', { url: OA, model: m, system: 's', user: 'u', budget: 2000 })
        .body.reasoning_effort, 'minimal', m);
    }
    for (const m of ['o3-mini', 'o4-mini', 'o1']) {
      eq(S.build('chat-compat', { url: OA, model: m, system: 's', user: 'u', budget: 2000 })
        .body.reasoning_effort, 'low', m);
    }
  });

  test('两行的其余能力一致 —— 拆行的唯一理由是档位取值', () => {
    const S = RS();
    for (const m of ['gpt-5-mini', 'o3-mini']) {
      const b = S.build('chat-compat', { url: OA, model: m, system: 's', user: 'u', budget: 2000 }).body;
      ok(!('temperature' in b), m + ' 不该带 temperature');
      eq(b.max_completion_tokens, 2000, m);
      eq(b.messages[0].role, 'developer', m);
    }
  });
});

describe('推理片段：三家三种拼法，这就是它存片段而非枚举的理由', () => {
  const RS = () => shapeWith(TABLE);

  test('openrouter 用嵌套 reasoning:{effort} —— 顶层拼法也 200，但明显没那么有效', () => {
    // 实测 2026-08-20：openai/gpt-5-mini 经 openrouter，
    //   reasoning:{effort:'low'} ⇒ 思考 192tok；reasoning_effort:'low' ⇒ 思考 320tok。
    // 两个都 200。**只看状态码会选到次优的那个拼法** —— 这是本表最需要实测的一类差异，
    // 也是 GLM 那个「被接受但完全无效」的变体。
    const b = RS().build('chat-compat', {
      url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-5-mini',
      system: 's', user: 'u', budget: 2000,
    }).body;
    deepEq(b.reasoning, { effort: 'low' });
    ok(!('reasoning_effort' in b), '顶层拼法在这个网关上是次优解，不能发');
  });

  test('同一个 host 上的非推理模型不受影响 —— 前缀更长者赢那条规则在这里兜底', () => {
    const b = RS().build('chat-compat', {
      url: 'https://openrouter.ai/api/v1/chat/completions', model: 'qwen/qwen3.8-27b',
      system: 's', user: 'u', budget: 2000,
    }).body;
    ok(!('reasoning' in b) && !('reasoning_effort' in b), '通行行没有推理片段');
  });

  test('三种拼法互不串台', () => {
    const S = RS();
    const pick = (url, model) => S.build('chat-compat',
      { url, model, system: 's', user: 'u', budget: 2000 }).body;
    eq(pick('https://api.openai.com/v1/chat/completions', 'gpt-5-mini').reasoning_effort, 'minimal');
    deepEq(pick('https://api.deepseek.com/v1/chat/completions', 'x').thinking, { type: 'disabled' });
    deepEq(pick('https://openrouter.ai/api/v1/chat/completions', 'openai/gpt-5').reasoning, { effort: 'low' });
  });

  test('kimi 两个域都发 thinking:disabled —— 国内那条来自继承，不是单独实测', () => {
    // 继承策略的落点：.ai 实测出结论，.cn 共享同一个 model-params 行，于是两边发同一个
    // 值。台账里 .cn 那行是 verdict:'inferred'，from: 'api.moonshot.ai'。
    const S = RS();
    for (const url of ['https://api.moonshot.ai/v1/chat/completions',
                       'https://api.moonshot.cn/v1/chat/completions']) {
      const b = S.build('chat-compat', { url, model: 'kimi-k2.6', system: 's', user: 'u', budget: 2000 }).body;
      deepEq(b.thinking, { type: 'disabled' }, url);
    }
  });

  test('实测之后决定不写的行,确实一个字都不发', () => {
    // grok / gemini / minimax / ark / kimi / anthropic / dashscope —— 每一条留空的理由
    // 都写在 config 的 note 里(测过没收益 / key 无效 / 模型 id 拿不到 / 默认就不思考)。
    // 这条测试防的是「下一个人照文档把它们补上」。
    const S = RS();
    for (const [url, model] of [
      ['https://api.x.ai/v1/chat/completions', 'grok-4-fast'],
      ['https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'gemini-3.6-flash'],
      ['https://api.minimax.chat/v1/chat/completions', 'MiniMax-M2'],

      ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen-plus'],
    ]) {
      const b = S.build('chat-compat', { url, model, system: 's', user: 'u', budget: 2000 }).body;
      for (const k of ['reasoning', 'reasoning_effort', 'thinking']) {
        ok(!(k in b), `${url} 不该发 ${k}`);
      }
    }
  });
});

// ─── 解析：两个静默错误，方向相反 ──────────────────────────────────────────
// 2026-08-21 打 MiniMax 时撞见的两个真 bug。它们都不是「报错」，一个是把思考当译文
// 渲染出去，一个是把有译文的响应读成空 —— 前者用户看到一段英文独白，后者看到
// 「翻译失败」，而服务端两次都答了 200。
describe('extractChat：思考写在正文里时要剥掉', () => {
  const RS = () => shapeWith(TABLE);

  test('<think>…</think> 被剥掉，只留译文', () => {
    // 实测形状（api.minimax.io 的 OpenAI 兼容口，MiniMax-M2）：思考不进
    // reasoning_content，而是用 <think> 包在 content 里。不剥的话整块会被当成译文
    // 渲染，而 isTranslated 只看非空（刻意如此）—— 没有任何一方会报错。
    const raw = '<think>\nThe user wants me to translate this text. Let me think:\n'
      + '"Rendered obsolete" - 使其过时\nOK here is my translation:\n</think>\n\n间隔重复有效。';
    eq(RS().extractChat({ choices: [{ message: { content: raw } }] }), '间隔重复有效。');
  });

  test('未闭合的 <think> 也要处理 —— 被 max_tokens 截断时只有开标签', () => {
    const RS2 = RS();
    eq(RS2.extractChat({ choices: [{ message: { content: '<think>thinking forever…' } }] }), '');
    // 剥完为空 ⇒ 落到具名的空正文分支，而不是把一段思考渲染成译文。
    eq(RS2.stripThink('<think>abc'), '');
  });

  test('不含 think 标签的正文一字不动', () => {
    const RS2 = RS();
    eq(RS2.extractChat({ choices: [{ message: { content: '  间隔重复有效。  ' } }] }), '间隔重复有效。');
    eq(RS2.stripThink('a < b and c > d'), 'a < b and c > d');
  });
});

describe('extractMessages：思考是独立的块，且排在第 0 位', () => {
  const RS = () => shapeWith(TABLE);

  test('thinking 块在前时仍能取到译文 —— 旧实现在这里返回空串', () => {
    // 实测块序（api.minimax.io/anthropic，MiniMax-M2）：thinking → text。
    // 旧实现取 content[0].text ⇒ undefined ⇒ ''，用户看到「翻译失败」，而响应里
    // 明明有译文。Anthropic 自家模型打开 extended thinking 后也是同样的块序。
    const d = { content: [
      { type: 'thinking', thinking: 'Let me translate this carefully…' },
      { type: 'text', text: '间隔重复有效。' },
    ] };
    eq(RS().extractMessages(d), '间隔重复有效。');
  });

  test('多个文本块要拼起来，思考块永远不进正文', () => {
    const d = { content: [
      { type: 'thinking', thinking: 'aaa' },
      { type: 'text', text: '前半' },
      { type: 'redacted_thinking', data: 'zzz' },
      { type: 'text', text: '后半' },
    ] };
    eq(RS().extractMessages(d), '前半后半');
  });

  test('缺 type 的块按文本处理 —— 中转网关未必带上它', () => {
    eq(RS().extractMessages({ content: [{ text: '你好' }] }), '你好');
  });

  test('只有思考块（被截断）⇒ 空串 ⇒ 具名失败，而不是把思考当译文', () => {
    eq(RS().extractMessages({ content: [{ type: 'thinking', thinking: '…' }] }), '');
  });
});

describe('ark（豆包）：基线不可用，参数是刚需', () => {
  const RS = () => shapeWith(TABLE);

  test('发 thinking:disabled —— 不发的话基线 120 秒超时', () => {
    // 实测 2026-08-21，doubao-seed-2-1-turbo-260628，883 字正文：
    //   基线 **120 秒超时**  →  thinking:disabled 4893ms / 思考 0 / 正文 291 字
    // 这是本表里最极端的一条：不加参数，这个模型根本没法用于翻译。
    const b = RS().build('chat-compat', {
      url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      model: 'doubao-seed-2-1-turbo-260628', system: 's', user: 'u', budget: 2000,
    }).body;
    deepEq(b.thinking, { type: 'disabled' });
    // 另外三个候选实测**让情况更糟**（最糟的 reasoning:{enabled:false} 思考 6145 tok、
    // 近两分钟），所以一个都不能发。
    for (const k of ['reasoning', 'reasoning_effort', 'enable_thinking']) {
      ok(!(k in b), '不该发 ' + k);
    }
  });

  test('host 通行 —— 豆包的 model 可能是控制台自建的 ep- 接入点 id', () => {
    const S = RS();
    for (const m of ['doubao-seed-2-1-turbo-260628', 'ep-20260101120000-abcde', '']) {
      const b = S.build('chat-compat', {
        url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        model: m, system: 's', user: 'u', budget: 2000,
      }).body;
      deepEq(b.thinking, { type: 'disabled' }, JSON.stringify(m));
    }
  });
});

// ─── 自定义请求参数：能力表的逃生口 ────────────────────────────────────────
// 私域端点永远测不到（没 key、打不到、也不该要用户交出内网地址），所以给用户一个口子。
// 三条规则由用户裁定 2026-08-21：自由 JSON、冲突时**用户赢**、**按引擎条目存**。
describe('自定义参数：逃生口', () => {
  const OA = 'https://api.openai.com/v1/chat/completions';
  const GW = 'https://gw.corp.example/v1/chat/completions';

  // 必须 await ready()：_prefs 是异步从 chrome.storage 读进来的，而这些用例直接调
  // build()（不像别处走 translate()，那条路内部会 await）。不等的话读到的是空 prefs，
  // 于是断言「没发自定义字段」会通过 —— 那是最坏的一种绿：测试在测一个空配置。
  async function withCustom(map) {
    const S = shapeWith(TABLE, { reqCustomParams: map });
    await S.ready();
    return S;
  }
  const chat = (S, url, model, providerId) => S.build('chat-compat',
    { url, model, system: 's', user: 'u', budget: 2000, providerId }).body;

  test('⚠️ 许可证不变：没填自定义时，表外 host 仍然只有 model 与 messages', async () => {
    // 整组里最要紧的一条。逃生口不能弄坏「表外 = 最小必要」这条默认态 ——
    // 那是整张表被允许存在的前提。
    const S = await withCustom({});
    eq(Object.keys(chat(S, GW, 'x', 'custom_chat')).sort().join(','), 'messages,model');
  });

  test('表外 host + 填了自定义 ⇒ 那些字段真的发出去', async () => {
    const S = await withCustom({ custom_chat: '{"thinking":{"type":"disabled"},"top_p":0.9}' });
    const b = chat(S, GW, 'x', 'custom_chat');
    deepEq(b.thinking, { type: 'disabled' });
    eq(b.top_p, 0.9);
  });

  test('**用户赢** —— 表说 temperature 不收，用户写了就照发', async () => {
    // 推翻了最初那条「表赢」裁定（当时针对的是 temperature 那四个数值项）。理由：
    // 表的权威来自实测，而写错的代价是一个带服务端原话的 400 —— 可见、可恢复。
    const S = await withCustom({ openai: '{"temperature":1.5}' });
    const b = chat(S, OA, 'gpt-5-mini', 'openai');
    eq(b.temperature, 1.5, '表说 false，但用户显式写了');
    eq(b.reasoning_effort, 'minimal', '没被覆盖的表项照旧生效');
  });

  test('**按引擎隔离** —— 为 A 写的参数，选 B 时一个字都不发', async () => {
    const S = await withCustom({ custom_chat: '{"thinking":{"type":"disabled"}}' });
    const b = chat(S, GW, 'x', 'deepseek');
    ok(!('thinking' in b), '为 custom_chat 写的字段跟着 deepseek 跑出去了');
    eq(Object.keys(b).sort().join(','), 'messages,model');
  });

  test('结构字段不可覆盖 —— 那不是调参数，是把请求换成另一个请求', async () => {
    const S = await withCustom({ p: JSON.stringify({
      model: 'HIJACK', messages: [{ role: 'user', content: 'HIJACK' }],
      system: 'HIJACK', stream: true, translation_options: { target_lang: 'xx' },
      top_p: 0.5,                       // 合法字段，应该留下
    }) });
    const b = chat(S, GW, 'real', 'p');
    eq(b.model, 'real');
    eq(b.messages[1].content, 'u');
    ok(!('stream' in b), 'stream 打开会换来一段解析不了的正文 —— sseMerge 已删');
    ok(!('translation_options' in b), '它是 translate-compat 的定义，不是可选项');
    eq(b.top_p, 0.5, '合法字段不该被误伤');
  });

  test('JSON 解析不了 ⇒ 当没填，而不是崩、也不是发一段字符串', async () => {
    for (const bad of ['{不是 json', '[1,2,3]', '"just a string"', '42', '  ']) {
      const S = await withCustom({ p: bad });
      eq(Object.keys(chat(S, GW, 'x', 'p')).sort().join(','), 'messages,model', JSON.stringify(bad));
    }
  });

  test('语音 / 转写永不合并 —— 那是另一种能力', async () => {
    const S = await withCustom({ p: '{"thinking":{"type":"disabled"}}' });
    const sp = S.build('speech-compat', { url: 'https://x.example/v1/audio/speech',
      model: 'm', input: 'hi', voice: 'v', providerId: 'p' }).body;
    ok(!('thinking' in sp), '对话旋钮发给语音端点，最好被忽略、最坏 400');
  });

  test('messages / responses / translate 三条形状也生效', async () => {
    const S = await withCustom({ p: '{"top_p":0.7}' });
    const m = S.build('messages-compat', { url: 'https://x.example/v1/messages',
      model: 'm', system: 's', user: 'u', budget: 2000, providerId: 'p' }).body;
    eq(m.top_p, 0.7);
    const r = S.build('responses-compat', { url: 'https://x.example/v1/responses',
      model: 'm', system: 's', user: 'u', budget: 2000, providerId: 'p' }).body;
    eq(r.top_p, 0.7);
    const t = S.build('translate-compat',
      { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        model: 'qwen-mt-turbo', user: 'u', targetLang: 'zh-CN', budget: 2000, providerId: 'p' }).body;
    eq(t.top_p, 0.7);
    ok(t.translation_options, 'translate 的定义字段仍在');
  });
});
