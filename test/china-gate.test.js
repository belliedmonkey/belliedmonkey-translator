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

describe('中国合规门：泰语 Grok / xAI 剥门（2026-10-23）', () => {
  test('api.x.ai / wss / grok-stt-open 红', () => {
    ok(scan('const U = "wss://api.x.ai/v1/stt"').length === 1, 'wss://api.x.ai 没被拦');
    ok(scan('host = "api.x.ai"').length === 1, 'api.x.ai 没被拦');
    ok(scan('case "grok-stt-open":').length === 1, 'grok-stt-open 没被拦');
  });
  test('无关协议词不误伤', () => {
    ok(scan('type: "stt-open"').length === 0, 'stt-open 被误拦');
    ok(scan('label: "Grok 风格"').length === 0, '无端点的 Grok 字样被误拦（仅禁端点与协议 id）');
  });
});


// ─── 中国包 native-speech 剥门（2026-10-25：固化 a01951ec 手剥）────────────────
// APP_OUT 扫的是拼好的 Script.js。omit Grok 时 modulesFor 已去掉 grok-stt.js，
// 但 native-speech 仍进包 —— 必须剥掉 PROTOCOL / 转发里的 grok-stt-open，否则
// build.js --flavor china 完整门红。源码保留（国际 Debug + Swift 对表）。
describe('中国合规门：native-speech china peel（SPEC-THAI-GROK-RELEASE-PEEL）', () => {
  const fs = require('fs');
  const path = require('path');
  const { peelGrokSttFromNativeSpeech, modulesFor } = require('../build/app-bundle.js');
  const src = fs.readFileSync(path.join(__dirname, '..', 'app/native-speech.js'), 'utf8');

  test('源码仍含 grok-stt-open（国际 Debug / Swift 对表）—— 红样', () => {
    ok(/grok-stt-open/.test(src), '源码丢了 grok-stt-open，对表与 intl Debug 会断');
    ok(scan(src).length >= 1, '未剥的 native-speech 源码应绊门（红样）');
  });

  test('peel 后 0×grok-stt-open，且不误伤本机协议', () => {
    const out = peelGrokSttFromNativeSpeech(src);
    ok(!/grok-stt-open/.test(out), 'peel 后仍有 grok-stt-open');
    ok(!/grok-stt-(pcm|cut|close|event)/.test(out), 'peel 后仍有其它 grok-stt-*');
    ok(!/if \(t ===\)/.test(out), 'peel 掏空了 if 条件留下残句');
    ok(/'stt-probe'/.test(out) && /'stt-start'/.test(out), '误伤本机 PROTOCOL');
    ok(scan(out).length === 0, 'peel 后的 native-speech 仍绊 china-gate');
  });

  test('china / genRoot / omitGrokStt 路径省略 grok-stt.js', () => {
    ok(!modulesFor({ flavor: 'china' }).includes('app/grok-stt.js'));
    ok(!modulesFor({ genRoot: '/tmp/dist-china' }).includes('app/grok-stt.js'));
    ok(!modulesFor({ omitGrokStt: true }).includes('app/grok-stt.js'));
    ok(modulesFor({}).includes('app/grok-stt.js'), '国际默认包应链入 grok-stt.js');
  });
});
