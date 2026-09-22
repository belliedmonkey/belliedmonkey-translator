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
