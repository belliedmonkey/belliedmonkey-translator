// test/engine-test-device.test.js — 设备内置转写的「测试连接」（2026-09-17 报障）。
//
// 用户在 App 设置页选了「设备内置转写」，点测试连接，看到的是「✗ device_no_file」。
// 两层原因，这里各钉一层：
//
//   ① App 设置页自留了一份旧的失败原因表（engineTestReason），不认识 device_no_file，
//      于是把原始代码原样显示出来。learn/engine-test.js 当初就是为消灭这种「同一个错误
//      在两个页面说两种话」抽出来的，App 那份是漏网的副本。
//   ② 就算翻成中文，对本机引擎说「✗ …只用于对话」也是错的：它没有端点可测，配得好好的，
//      而且实时字幕也在用它。真正有意义的测试是「本机识别器能不能用、语言包在不在」。
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

describe('EngineTest.device — 本机引擎的测试连接', () => {
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
    for (const code of ['device_no_file', 'device_unavailable', 'device_timeout']) {
      const text = E.reason({ code, message: code }, T);
      ok(text && text !== code && !/^device_/.test(text), `${code} 落到了默认分支：${text}`);
    }
  });

  test('「只用于对话」这句旧话不许回来 —— 实时字幕也在用本机转写', () => {
    const zh = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/_locales/zh_CN/messages.json'), 'utf8'));
    ok(/实时字幕/.test(zh.stt_device_no_file.message), zh.stt_device_no_file.message);
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

  test('本机引擎走 EngineTest.device，不落到 LearnSpeech 的端点测试', () => {
    ok(/device-transcribe[\s\S]{0,400}EngineTest\.device\(/.test(src),
      '设备内置转写的测试没有分流到 EngineTest.device');
  });
});
