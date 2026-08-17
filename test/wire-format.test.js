// test/wire-format.test.js — 端点地址的两个纯问题 (#147, domain-design §7).
//
// 三件必须成立的事，按重要性排：
//   · **迁移没跑成的设备行为逐字节不变**（resolveEndpoint 的 legacy 分支）。这是本次
//     改动唯一会动到「用户已经有的东西」的地方，所以它有一张笛卡尔积表，oracle 是把
//     改动前那四行表达式照抄进来的冻结副本。
//   · **后缀判定不误伤**。误判一次的代价是把一个今天能用的配置发到错误形状的接口上。
//   · **家族封闭**。语音端点永远不会被翻译成对话传输，这是「厂商永不参与分派」的机械
//     保证——判定只在同一能力内部选变体。

const { describe, test, ok, eq } = require('./harness');
const WF = require('../extension/content/wire-format.js');

// ─── 改动前那四行表达式的冻结副本，作为 legacy 分支的 oracle ────────────────
// 照抄自：translation-api.js 的 `base = baseUrl || p.defaultBase` → `cfg.base + cfg.path`
// （不裁尾斜杠）、notes.js 的 `base + p.path`（不裁）、tts.js 的
// `base.replace(/\/+$/,'') + e.path`（裁）、speech-input.js 同款（裁）。
// 四处策略当年就不一致，legacy 分支的职责是复刻这份不一致，不是统一它。
const OLD = {
  chat: (stored, path) => stored + path,
  tts: (stored, path) => stored.replace(/\/+$/, '') + path,
  stt: (stored, path) => stored.replace(/\/+$/, '') + path,
};

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

describe('WireFormat.resolveEndpoint — 三个分支，判据是戳而不是形状', () => {
  const chatEntry = { id: 'deepseek', type: 'chat-compat', defaultEndpoint: 'https://api.deepseek.com/v1/chat/completions' };
  const customEntry = { id: 'custom_chat', type: 'chat-compat', defaultEndpoint: null };

  test('存值为空 ⇒ 注册表默认端点', () => {
    eq(WF.resolveEndpoint('', chatEntry, { cap: 'chat' }), 'https://api.deepseek.com/v1/chat/completions');
    eq(WF.resolveEndpoint(null, chatEntry, { cap: 'chat' }), 'https://api.deepseek.com/v1/chat/completions');
    eq(WF.resolveEndpoint('   ', chatEntry, { cap: 'chat' }), 'https://api.deepseek.com/v1/chat/completions');
  });

  test('没有默认端点又没填 ⇒ 空串，交给调用方报 no_base', () => {
    eq(WF.resolveEndpoint('', customEntry, { cap: 'chat' }), '');
  });

  test('有戳 ⇒ 逐字使用，包括我们自己认不出后缀的地址', () => {
    const opts = { cap: 'chat', verbatim: true };
    eq(WF.resolveEndpoint('https://proxy.example/api/llm', customEntry, opts), 'https://proxy.example/api/llm');
    // 尾斜杠是用户敲进去的字符，verbatim 就是 verbatim。
    eq(WF.resolveEndpoint('https://proxy.example/v1/responses/', customEntry, opts), 'https://proxy.example/v1/responses/');
    eq(WF.resolveEndpoint('  https://p.example/x  ', customEntry, opts), 'https://p.example/x');
  });

  test('无戳 + 看起来还是老形状 ⇒ legacy 分支补路径（老用户零变化）', () => {
    eq(WF.resolveEndpoint('https://myproxy.example', chatEntry, { cap: 'chat' }),
      'https://myproxy.example/v1/chat/completions');
    // 带路径段但不是完整端点的代理地址——今天它拼出来能用，改动后必须还是同一个地址。
    eq(WF.resolveEndpoint('https://myproxy.example/openai', chatEntry, { cap: 'chat' }),
      'https://myproxy.example/openai/v1/chat/completions');
  });

  test('无戳 + 已经是完整端点 ⇒ 安全网兜住，不会再接一次路径', () => {
    // 戳丢了（某个调用点还没接上新键、或存储读失败）而值其实迁移过时，legacy 分支会
    // 拼出 `…/v1/chat/completions/v1/chat/completions`。这一条挡住它。
    eq(WF.resolveEndpoint('https://api.deepseek.com/v1/chat/completions', chatEntry, { cap: 'chat' }),
      'https://api.deepseek.com/v1/chat/completions');
    eq(WF.resolveEndpoint('https://p.example/v1/responses', chatEntry, { cap: 'chat' }),
      'https://p.example/v1/responses');
  });

  test('没有 legacy path 的条目（google / browser）原样返回，不凭空造路径', () => {
    const g = { id: 'google', type: 'google', defaultEndpoint: null };
    eq(WF.resolveEndpoint('https://whatever.example', g, { cap: 'chat' }), 'https://whatever.example');
    const b = { id: 'browser', type: 'browser', defaultEndpoint: null };
    eq(WF.resolveEndpoint('https://whatever.example', b, { cap: 'tts' }), 'https://whatever.example');
  });
});

// ─── 这一节是本次改动的验收判据 ──────────────────────────────────────────────
//
// 「no-op 证明」：对每个能力 × 每个注册表条目 × 五种存值形态，断言无戳时
// resolveEndpoint 的结果**逐字节等于**改动前那一行表达式的求值结果。
//
// 它同时证伪四件事：legacy 分支是否真的等价；四处尾斜杠策略是否被**分别**保留（改动
// 前只有 tts/stt 两处有回归测试，翻译和解析从来没有）；折叠出来的 defaultEndpoint 是否
// 等于旧的 defaultBase + path（stored 为空那一格）；以及 path 被误删时 `undefined`
// 会立刻炸在这里而不是炸在用户设备上。
describe('WireFormat — 无戳时与改动前逐字节等价（验收判据）', () => {
  const SHAPES = [
    'https://h.example',
    'https://h.example/',
    'https://h.example//',
    'https://h.example/openai',
    'http://127.0.0.1:8880',
  ];

  test('四个能力 × 每个 legacy 条目 × 五种存值形态', () => {
    let checked = 0;
    for (const cap of Object.keys(WF.LEGACY_PATHS)) {
      for (const [id, path] of Object.entries(WF.LEGACY_PATHS[cap])) {
        const entry = { id, type: 'chat-compat', defaultEndpoint: null };
        for (const stored of SHAPES) {
          const got = WF.resolveEndpoint(stored, entry, { cap });
          const want = OLD[cap](stored, path);
          eq(got, want, `${cap}/${id} · ${stored}`);
          checked++;
        }
      }
    }
    ok(checked >= 60, `覆盖面太小（只跑了 ${checked} 格），注册表是不是被裁过？`);
  });

  test('每个能力至少有一个条目，否则这张表是空转的', () => {
    for (const cap of ['chat', 'tts', 'stt']) {
      ok(Object.keys(WF.LEGACY_PATHS[cap]).length > 0, cap + ' 的冻结表空了');
    }
  });
});
