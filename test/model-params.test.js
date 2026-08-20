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

const { describe, test, ok, eq } = require('./harness');
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
