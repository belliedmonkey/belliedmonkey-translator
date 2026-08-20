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
  test('每一行都带 note —— 没有理由的行就是凭印象加的行', () => {
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
      ['https://api.moonshot.cn/v1/chat/completions', 'kimi-k2'],
      ['https://api.x.ai/v1/chat/completions', 'grok-4'],
      ['https://ark.cn-beijing.volces.com/api/v3/chat/completions', 'doubao-seed-1-6'],
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
