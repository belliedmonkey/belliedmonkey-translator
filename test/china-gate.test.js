// test/china-gate.test.js — the **public** China-build invariant (BEL-172 split).
//
// The detailed region policy (allowed in-country hosts, MT_GRANT shape, grantOnly endpoints)
// moved to the private compliance repo with its own 13-case falsification suite. This file
// guards only what the public artifact must prove by itself:
//   ① no brand strings, ② no *.supabase.co host.
//
// A gate that cannot go red is not a gate, so each rule is fed an input that must hit.

const { describe, test, ok } = require('./harness');
const G = require('../build/china-gate.js');

const scan = (text) => G.scan([{ name: 'x.js', text }]);

describe('中国版公开不变量：品牌词', () => {
  test('品牌词红', () => {
    ok(scan('label: "OpenAI"').length === 1, 'OpenAI 没被拦');
    ok(scan('x = "api.anthropic.com"').length === 1, 'anthropic 端点没被拦');
    ok(scan('ChatGPT 兼容').length === 1, 'ChatGPT 没被拦');
    ok(scan('Claude 风格').length === 1, 'Claude 没被拦');
    ok(scan('api.openai.com/v1').length === 1, 'openai 端点没被拦');
  });

  test('通用协议头不算品牌（anthropic-version）', () => {
    ok(scan("headers: { 'anthropic-version': '2023-06-01' }").length === 0,
      'anthropic-version 是 Messages 协议头，不是品牌指代');
  });
});

describe('中国版公开不变量：*.supabase.co', () => {
  test('任何路径的 supabase.co 主机都红', () => {
    for (const p of ['/functions/v1/bt-ingest', '/functions/v1/bt-relay/chat/completions',
      '/functions/v1/bt-grant', '/auth/v1/user', '/rest/v1/bt_events']) {
      ok(scan(`u = "https://x.supabase.co${p}"`).length === 1, `东京主机漏了：${p}`);
    }
    ok(scan('u = "https://example.supabase.co/"').length === 1, '根路径也应在内');
  });

  test('非 supabase 的境内主机放行', () => {
    ok(scan('u = "https://api.example.cn/functions/v1/bt-ingest"').length === 0);
    ok(scan('u = "https://relay.example.cn/functions/v1/bt-relay/chat/completions"').length === 0);
  });

  test('普通文本 / 别的 URL 不误伤', () => {
    ok(scan('https://api.deepseek.com/v1/chat/completions').length === 0);
    ok(scan('这是一段中文说明，没有 URL').length === 0);
    ok(scan('supabase').length === 0, '裸词不是主机名');
  });
});

describe('这道门本身能红（返回 file:line，不是静默 true/false）', () => {
  test('命中带文件名与行号', () => {
    const hits = G.scan([{ name: 'a.js', text: 'ok\nconst k = "OpenAI";' }]);
    ok(hits.length === 1 && /^a\.js:2/.test(hits[0]), `实际：${JSON.stringify(hits)}`);
  });

  test('空输入不红', () => {
    ok(G.scan([]).length === 0);
    ok(G.scan([{ name: 'a.js', text: '' }]).length === 0);
  });
});
