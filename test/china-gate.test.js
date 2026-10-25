// test/china-gate.test.js — 中国版合规门的判据（build/china-gate.js）。
//
// 2026-09-22 额度那一条从「不许有额度端点」改成「额度端点只许是境内中继」。改写一条门禁时
// 最容易漏的是**它还红不红得了**，所以这里每一组都先喂「该红」的输入。grantHost 为空的那组
// 就是改写前的行为：它必须与旧门禁逐条等价。

const { describe, test, ok } = require('./harness');
const G = require('../build/china-gate.js');

const TOKYO = 'https://cavezcufztzqsohpjmup.supabase.co';
const CN = 'relay.example.cn';
const scan = (text, grantHost) => G.scan([{ name: 'x.js', text }], { grantHost });

describe('中国合规门：品牌与东京路径（与额度开没开无关）', () => {
  test('品牌词红', () => {
    ok(scan('label: "OpenAI"').length === 1, 'OpenAI 没被拦');
    ok(scan('x = "api.anthropic.com"').length === 1, 'anthropic 端点没被拦');
    ok(scan('ChatGPT 兼容').length === 1, 'ChatGPT 没被拦');
  });
  test('协议头 anthropic-version 不算品牌', () => {
    ok(scan("h['anthropic-version'] = '2023-06-01'").length === 0, '协议头被误拦');
  });
  test('东京三条路径：境内主机配了也照样红', () => {
    for (const host of ['', CN]) {
      ok(scan(`u = "${TOKYO}/functions/v1/bt-ingest"`, host).length === 1, 'bt-ingest 没被拦（' + host + '）');
      ok(scan(`u = "${TOKYO}/functions/v1/bt-grant"`, host).length === 1, '东京 bt-grant 没被拦（' + host + '）');
      ok(scan(`u = "${TOKYO}/functions/v1/bt-relay/chat/completions"`, host).length === 1, '东京 bt-relay 没被拦（' + host + '）');
    }
  });
});

describe('中国合规门：额度规格 MT_GRANT', () => {
  test('= null 永远放行', () => {
    ok(scan('window.MT_GRANT = null;').length === 0, '「恒为 null」被误拦');
    ok(scan('window.MT_GRANT = null;', CN).length === 0, '就绪时 null 被误拦');
  });
  test('未就绪（grantHost 空）：出现额度规格即红 —— 与改写前等价', () => {
    ok(scan(`window.MT_GRANT = {"claimUrl":"https://${CN}/claim"};`).length === 1,
      '未就绪时一份指向境内的额度规格被放行了');
  });
  test('就绪：领取地址在境内中继上 → 放行', () => {
    ok(scan(`window.MT_GRANT = {"vendor":"dashscope","limitUsd":0.2,"claimUrl":"https://${CN}/claim","models":{"chat":"qwen-plus"}};`, CN).length === 0,
      '合法的中国版额度规格被误拦');
  });
  test('就绪：任一地址不在境内中继上 → 红', () => {
    ok(scan(`window.MT_GRANT = {"claimUrl":"https://evil.example.com/claim"};`, CN).length === 1, '别的主机被放行');
    ok(scan(`window.MT_GRANT = {"claimUrl":"https://${CN}/claim","x":"https://other.cn/a"};`, CN).length === 1,
      '混进一个别的主机被放行（判据必须是「每一个」）');
    ok(scan(`window.MT_GRANT = {"limitUsd":0.2};`, CN).length === 1, '一个地址都没有的规格被放行');
    ok(scan(`window.MT_GRANT = {broken;`, CN).length === 1, '解析不了的规格被放行');
  });
  test('认不出的形状也红（不能换个写法就绕过去）', () => {
    ok(scan('window.MT_GRANT = spec;', CN).length === 1, '非字面量的赋值被放行');
  });
});

describe('中国合规门：注册表里的额度条目（原文真正发去的地址）', () => {
  const entry = (u) => `window.MT_PROVIDERS = [{"id":"qwen","grantOnly":false,"defaultEndpoint":"https://dashscope.aliyuncs.com/x"},{"id":"grant","grantOnly":true,"defaultEndpoint":"${u}"}];`;
  test('未就绪：出现额度条目即红', () => {
    ok(scan(entry(`https://${CN}/chat/completions`)).length === 1, '未就绪时额度条目被放行');
  });
  test('就绪：条目端点在境内 → 放行；在别处 → 红', () => {
    ok(scan(entry(`https://${CN}/chat/completions`), CN).length === 0, '境内的额度条目被误拦');
    ok(scan(entry('https://relay.elsewhere.com/chat/completions'), CN).length === 1, '境外的额度条目被放行');
  });
  test('普通条目不受影响', () => {
    ok(scan('window.MT_PROVIDERS = [{"id":"qwen","grantOnly":false,"defaultEndpoint":"https://dashscope.aliyuncs.com/x"}];', CN).length === 0,
      '普通引擎被误拦');
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
