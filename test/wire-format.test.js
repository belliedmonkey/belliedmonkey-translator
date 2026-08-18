// test/wire-format.test.js — 端点地址的两个纯问题 (domain-design §7).
//
// 三件必须成立的事，按重要性排：
//   · **零拼接是无条件的**。resolveEndpoint 只有两个分支（空 → 默认端点；非空 → 逐字），
//     没有第三个。1.5.2 那条「无戳时按老语义补路径」的兜底分支是两次真机故障的共同
//     原因，这里有一节专门钉死它不会以任何形式回来。
//   · **后缀判定不误伤**。误判一次的代价是把一个今天能用的配置发到错误形状的接口上。
//   · **家族封闭**。语音端点永远不会被翻译成对话传输，这是「厂商永不参与分派」的机械
//     保证——判定只在同一能力内部选变体。

const { describe, test, ok, eq } = require('./harness');
const WF = require('../extension/content/wire-format.js');

describe('WireFormat.formatFor — 后缀判定，家族封闭', () => {
  test('三种对话形状各自认得出来', () => {
    eq(WF.formatFor('https://api.example/v1/chat/completions', 'chat-compat'), 'chat-compat');
    eq(WF.formatFor('https://api.example/v1/responses', 'chat-compat'), 'responses-compat');
    eq(WF.formatFor('https://api.example/v1/messages', 'chat-compat'), 'messages-compat');
  });

  test('末尾锚定，不是包含 —— 中转前缀命中，中间出现的关键词不命中', () => {
    // `includes('/messages')` 会把这个判成 Messages 形状，然后往一个 Chat Completions
    // 端点发 Anthropic 的 body。末尾锚定是唯一能同时处理下面两行的写法。
    eq(WF.formatFor('https://api.example/messages/v1/chat/completions', 'chat-compat'), 'chat-compat');
    eq(WF.formatFor('https://proxy.example/openai/v1/chat/completions', 'chat-compat'), 'chat-compat');
    eq(WF.formatFor('https://p.example/responses-proxy/v1/chat/completions', 'chat-compat'), 'chat-compat');
  });

  test('query string 必须先剥掉 —— 否则带 api-version 的端点永远认不出', () => {
    eq(WF.formatFor('https://x.example/openai/deployments/d/chat/completions?api-version=2024-06-01',
      'chat-compat'), 'chat-compat');
    eq(WF.formatFor('https://p.example/v1/responses?x=1', 'chat-compat'), 'responses-compat');
    eq(WF.formatFor('https://p.example/v1/responses#frag', 'chat-compat'), 'responses-compat');
  });

  test('尾斜杠与大小写不影响判定', () => {
    eq(WF.formatFor('https://p.example/v1/responses/', 'chat-compat'), 'responses-compat');
    eq(WF.formatFor('https://p.example/v1/RESPONSES', 'chat-compat'), 'responses-compat');
    eq(WF.formatFor('https://p.example/V1/Chat/Completions', 'chat-compat'), 'chat-compat');
  });

  test('家族封闭：语音/转写端点绝不会被判成对话形状', () => {
    // 一个碰巧以 /messages 结尾的语音端点，如果判定跨家族，就会被拿去发对话请求。
    eq(WF.formatFor('https://tts.example/v1/messages', 'speech-compat'), 'speech-compat');
    eq(WF.formatFor('https://tts.example/v1/audio/speech', 'speech-compat'), 'speech-compat');
    eq(WF.formatFor('https://stt.example/v1/chat/completions', 'transcribe-compat'), 'transcribe-compat');
    eq(WF.formatFor('https://stt.example/v1/audio/transcriptions', 'transcribe-compat'), 'transcribe-compat');
  });

  test('认不出的后缀回落到注册表 type —— 未知端点的行为与今天完全一致', () => {
    eq(WF.formatFor('https://proxy.example/api/llm', 'chat-compat'), 'chat-compat');
    eq(WF.formatFor('https://proxy.example/api/llm', 'messages-compat'), 'messages-compat');
    eq(WF.formatFor('https://proxy.example', 'chat-compat'), 'chat-compat');
    eq(WF.formatFor('', 'chat-compat'), 'chat-compat');
  });

  test('没有用户地址的两个 type 直通 —— 判定对它们无从谈起', () => {
    eq(WF.formatFor('anything', 'google'), 'google');
    eq(WF.formatFor('anything', 'browser'), 'browser');
    eq(WF.formatFor('https://x.example/v1/responses', 'google'), 'google');
  });
});

describe('WireFormat.hasPath — 把「地址少了路径」从 CORS 里切出来', () => {
  test('只有主机名 ⇒ false（这正是迁移漏网的形状）', () => {
    eq(WF.hasPath('https://api.deepseek.com'), false);
    eq(WF.hasPath('https://api.deepseek.com/'), false);
    eq(WF.hasPath('http://127.0.0.1:8880///'), false);
  });
  test('有路径段 ⇒ true', () => {
    eq(WF.hasPath('https://api.deepseek.com/v1/chat/completions'), true);
    eq(WF.hasPath('https://myproxy.example/openai'), true);
  });
  test('不是绝对 http(s) 地址 ⇒ false —— 缺协议头会被 fetch 当相对路径', () => {
    eq(WF.hasPath('api.openai.com/v1/chat/completions'), false);
    eq(WF.hasPath(''), false);
    eq(WF.hasPath(null), false);
  });
});

describe('WireFormat.resolveEndpoint — 两个分支，没有第三个', () => {
  const chatEntry = { id: 'deepseek', type: 'chat-compat', defaultEndpoint: 'https://api.deepseek.com/v1/chat/completions' };
  const customEntry = { id: 'custom_chat', type: 'chat-compat', defaultEndpoint: null };

  test('存值为空 ⇒ 注册表默认端点', () => {
    eq(WF.resolveEndpoint('', chatEntry), 'https://api.deepseek.com/v1/chat/completions');
    eq(WF.resolveEndpoint(null, chatEntry), 'https://api.deepseek.com/v1/chat/completions');
    eq(WF.resolveEndpoint('   ', chatEntry), 'https://api.deepseek.com/v1/chat/completions');
    eq(WF.resolveEndpoint(undefined, chatEntry), 'https://api.deepseek.com/v1/chat/completions');
  });

  test('没有默认端点又没填 ⇒ 空串，交给调用方报 no_base', () => {
    eq(WF.resolveEndpoint('', customEntry), '');
    eq(WF.resolveEndpoint('', null), '');
  });

  test('存值非空 ⇒ 逐字使用，不看形状、不看条目、不看能力', () => {
    // 这一组每一行在 1.5.2 里都会被补上一段路径。
    const cases = [
      'https://myproxy.example',                              // 只有主机名
      'https://myproxy.example/',                             // 尾斜杠
      'https://myproxy.example//',                            // 两个尾斜杠
      'https://myproxy.example/openai',                       // 带路径段但不是完整端点
      'https://aispace.example/api/openai/v1',                // 真机那一条（#151）
      'http://127.0.0.1:8880',                                // 自建、无 TLS
      'https://p.example/v1/chat/completions?api-version=x',  // 带 query
      'https://p.example/v1/responses/',                      // 完整端点 + 尾斜杠
    ];
    for (const u of cases) {
      eq(WF.resolveEndpoint(u, chatEntry), u, 'chat/' + u);
      eq(WF.resolveEndpoint(u, customEntry), u, 'custom/' + u);
      // 条目换成语音/转写也一样——能力不再参与，因为参数已经没有了。
      eq(WF.resolveEndpoint(u, { id: 'openai_speech', type: 'speech-compat', defaultEndpoint: 'x' }), u, 'tts/' + u);
    }
  });

  test('只 trim 首尾空白，中间与内部一个字符都不动', () => {
    eq(WF.resolveEndpoint('  https://p.example/x  ', customEntry), 'https://p.example/x');
    eq(WF.resolveEndpoint('https://p.example/a b', customEntry), 'https://p.example/a b');
    eq(WF.resolveEndpoint('HTTPS://P.example/V1/Chat', customEntry), 'HTTPS://P.example/V1/Chat');
  });
});

// ─── 这一节是本次改动的验收判据 ──────────────────────────────────────────────
//
// 「零拼接」是对用户的承诺，而 1.5.2 的教训是：只要拼接还作为**某个条件下的行为**存在，
// 它就会因为某个调用点漏传一个参数而变回默认行为（设置页的「测试连接」漏传 verbatim，
// 于是自检对着 `…/v1` + `/v1/chat/completions` 报 404）。所以这里断言的不是「默认不
// 拼接」，而是**拼接这件事在这个模块里不存在**。
describe('WireFormat — 拼接不存在（验收判据）', () => {
  test('输出必然是「默认端点」或「存值本身」二者之一，没有第三种可能', () => {
    const entries = [
      { id: 'deepseek', type: 'chat-compat', defaultEndpoint: 'https://d.example/v1/chat/completions' },
      { id: 'custom_chat', type: 'chat-compat', defaultEndpoint: null },
      { id: 'openai_speech', type: 'speech-compat', defaultEndpoint: 'https://s.example/v1/audio/speech' },
      { id: 'local', type: 'transcribe-compat', defaultEndpoint: null },
      { id: 'google', type: 'google', defaultEndpoint: null },
    ];
    const SHAPES = ['', '   ', 'https://h.example', 'https://h.example/', 'https://h.example//',
      'https://h.example/openai', 'https://h.example/api/openai/v1', 'http://127.0.0.1:8880',
      'https://h.example/v1/chat/completions', 'https://h.example/v1/responses'];
    let checked = 0;
    for (const entry of entries) {
      for (const stored of SHAPES) {
        const got = WF.resolveEndpoint(stored, entry);
        const want = stored.trim() ? stored.trim() : (entry.defaultEndpoint || '');
        eq(got, want, `${entry.id} · ${JSON.stringify(stored)}`);
        checked++;
      }
    }
    ok(checked >= 50, `覆盖面太小（只跑了 ${checked} 格）`);
  });

  test('模块不再导出任何拼接/迁移入口 —— 删掉的东西不能悄悄回来', () => {
    for (const gone of ['legacyCompose', 'migrateStored', 'migrationPatch', 'looksComplete', 'legacy']) {
      eq(typeof WF[gone], 'undefined', gone + ' 又出现了');
    }
  });

  test('resolveEndpoint 只吃两个参数 —— 第三个 opts 回来就说明条件分支回来了', () => {
    eq(WF.resolveEndpoint.length, 2);
  });
});
