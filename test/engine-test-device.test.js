// test/engine-test-device.test.js — 本机识别器的「测试」（EngineTest.device）。
//
// 2026-09-17 报障：用户在 App 设置页选了「设备内置转写」，点测试连接，看到「✗ device_no_file」——
// App 自留了一份旧的失败原因表，不认识新码，把原始代码原样显示出来。当天下午的裁定把这条
// 注册表条目整个删了（实时转写固定为设备内置，不再是可选引擎，learning-design §9.4 修订），
// 于是 device_no_file 这个码不可达了；留下来的是 EngineTest.device 本身 —— 它以后给设置页
// 「对话与字幕」块的「识别语言包」行用（§9.1.1），判据不变：
//   本机识别器能不能用、语言包在不在、原生不回话有上限地超时、失败原因是人话不是代码。
const fs = require('fs');
const path = require('path');
const { loadModule, describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const T = (k, d) => d;   // 用回落文案断言：key 缺了也不会让断言假绿，因为回落本身就是人话

function load(nativeSpeech) {
  const sandbox = { window: {} };
  if (nativeSpeech) sandbox.NativeSpeech = nativeSpeech;
  return loadModule('learn/engine-test.js', sandbox).EngineTest;
}
const fakeNative = (answer) => ({ available: () => true, probe: () => answer });

describe('EngineTest.device — 本机识别器的测试', () => {
  test('语言包已就绪 ⇒ ✓，且说的是「本机识别可用」，不是「通了 · ms」', async () => {
    const E = load(fakeNative(Promise.resolve({ ok: true, assets: 'installed' })));
    const r = await E.device(['zh-CN']);
    const text = E.format(r, null, T);
    ok(/^✓/.test(text), text);
    ok(/本机识别可用/.test(text) && /已就绪/.test(text), text);
    ok(!/通了/.test(text), '本机没有往返，说「通了 · ms」是假话：' + text);
  });

  test('语言包没下 ⇒ 仍是 ✓（配置没错），并说清会自动下载', async () => {
    const E = load(fakeNative(Promise.resolve({ ok: true, assets: 'supported' })));
    const text = E.format(await E.device(['en-US']), null, T);
    ok(/^✓/.test(text) && /自动下载/.test(text), text);
  });

  test('系统不支持 ⇒ ✗ + 人话，不是原始代码', async () => {
    const E = load(fakeNative(Promise.resolve({ ok: false, reason: 'os' })));
    let err = null;
    try { await E.device(['zh-CN']); } catch (e) { err = e; }
    ok(err, '应当抛错');
    eq(err.code, 'device_unavailable');
    const text = E.format(null, err, T);
    ok(/^✗/.test(text) && /iOS 26/.test(text), text);
    ok(!/device_/.test(text), '原始代码漏给了用户：' + text);
    ok(!/云端/.test(text), '2026-09-17 起没有云端实时引擎可选，不许再指人去「选一个云端实时引擎」：' + text);
  });

  test('没有原生桥（比如在浏览器扩展里）⇒ device_unavailable，不是崩溃', async () => {
    const E = load(null);
    let err = null;
    try { await E.device([]); } catch (e) { err = e; }
    eq(err && err.code, 'device_unavailable');
  });

  test('原生不回话 ⇒ 有上限地超时，不是永远「测试中…」', async () => {
    const E = load(fakeNative(new Promise(() => {})));   // 永不落定，正是 native-speech.js 顶部那道疤
    const t0 = Date.now();
    let err = null;
    try { await E.device(['zh-CN'], 50); } catch (e) { err = e; }
    ok(Date.now() - t0 < 2000, '超时没有生效');
    eq(err && err.code, 'device_timeout');
    ok(!/device_/.test(E.format(null, err, T)), '原始代码漏给了用户');
  });

  test('reason 表里每个本机相关的码都有人话（不落到默认分支把代码原样吐出来）', () => {
    const E = load(null);
    for (const code of ['device_unavailable', 'device_timeout']) {
      const text = E.reason({ code, message: code }, T);
      ok(text && text !== code && !/^device_/.test(text), `${code} 落到了默认分支：${text}`);
    }
  });

  test('device_no_file 不再是客户端会产生的码（注册表里没有 device 转写条目了）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'extension/learn/speech-input.js'), 'utf8');
    ok(!/device_no_file/.test(src), 'speech-input.js 又在产 device_no_file —— 说题的下拉里不该有本机条目');
    const stt = require(path.join(ROOT, 'build/stt.config.js'));
    ok(!stt.some((e) => e.type === 'device-transcribe'), '转写注册表里又出现了 device-transcribe');
  });
});

describe('App 设置页不许再自留一份失败原因表', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app/settings.js'), 'utf8');

  test('engineTestReason 这份副本已删除', () => {
    ok(!/function\s+engineTestReason\s*\(/.test(src),
      'app/settings.js 又定义了自己的原因表 —— 它会再次漏掉新码，把原始代码显示给用户（2026-09-17「✗ device_no_file」）');
  });

  test('测试结果走 EngineTest.format（成功与失败都走）', () => {
    ok(/EngineTest\.format\(r, null, t\)/.test(src), '成功分支没走共用 format');
    ok(/EngineTest\.format\(null, e, t\)/.test(src), '失败分支没走共用 format');
  });
});
