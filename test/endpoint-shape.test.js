// test/endpoint-shape.test.js — 「地址写错了」必须在发请求之前说出来，而且四条路一致。
//
// 2026-09-21 回读线上 engine_test 的失败码：`http` 34 条、`no_path` 9 条、**`bad_url` 0 条**
// （issue #385）。两个码都在白名单里、都有产地，所以 0 不是「没人填错」——
// 是**产地被绕开了**：`assertEndpointShape` 是 bad_url / no_path 的唯一来源，而当时
//   · `EngineTest.notes()` 自己不调，靠 options.js 在外面猜一次「该查哪个框」；
//   · App 的两个自检按钮直接调底层，既不检查也不上报；
//   · 两个宿主的「试听」都不检查。
// 于是一个「只填了主机名」的地址被真发出去，回 404，记成 `http`。
//
// 这个文件钉三件事，第三件最要紧：
//   1. assertEndpointShape / shapeHint 的判据本身（纯函数）；
//   2. 四条传输都经过它；
//   3. **宿主不许绕过** —— 四处漏调当初全是静默的，没有任何东西在比对，只有门禁能防复发。
//      同族先例：test/engine-test-device.test.js「App 设置页不许再自留一份失败原因表」。

const fs = require('fs');
const path = require('path');
const { loadModule, describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const T = (k, d) => d;   // 用回落文案断言：key 缺了也不会让断言假绿，回落本身就是人话
const WireFormat = require('../extension/content/wire-format.js');
const E = loadModule('learn/engine-test.js', { window: {}, WireFormat }).EngineTest;

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// **先去注释再比**，两个方向都要：正向断言会被注释里的同名字样弄成假绿，负向断言会被
// 自己解释历史的那句话绊倒（本仓两种都发生过，见 telemetry-registry.test.js 的同一段）。
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
// 从某个标记往后截一段，用来问「这个按钮的处理器里有没有经过 X」。
const blockAfter = (src, marker, chars) => {
  const i = src.indexOf(marker);
  return i < 0 ? '' : src.slice(i, i + (chars || 1200));
};
// 按钮 id 在文件里会出现好几次（i18n 里先给它写一遍文案），所以锚点必须是**注册监听**
// 那一行，不能是 id 本身 —— 第一次写这条断言就撞在这上面，截到了 `.textContent = …`。
const handlerOf = (src, id, chars) => blockAfter(src, "$('" + id + "').addEventListener", chars);
// 函数体要**截到它自己的收尾大括号**为止。第一版按固定字数截 900，窗口漏进了下一个
// 函数 —— 把 notes() 里的检查整句删掉，断言照样绿（2026-09-21 当场证伪出来的）。
// 一个证明不了缺失的门禁，和没有门禁是一回事。
const bodyOf = (src, name) => {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) return '';
  const end = src.indexOf('\n  }', i);
  return end < 0 ? src.slice(i) : src.slice(i, end);
};
const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };

describe('assertEndpointShape — 离线就能判的两种错', () => {
  test('空地址不是错 —— 空 = 用注册表默认端点', () => {
    eq(throws(() => E.assertEndpointShape('')), null);
    eq(throws(() => E.assertEndpointShape(null)), null);
    eq(throws(() => E.assertEndpointShape('   ')), null);
  });

  test('只有主机名 ⇒ no_path（这正是被记成 http 404 的那一批）', () => {
    for (const u of ['https://api.example.com', 'https://api.example.com/', 'http://127.0.0.1:8880///']) {
      const e = throws(() => E.assertEndpointShape(u));
      ok(e && e.code === 'no_path', u + ' ⇒ ' + (e && e.code));
      eq(e.url, u);   // withUrl 要靠它把「请求地址」贴出来
    }
  });

  test('缺协议头 ⇒ bad_url —— 会被 fetch 当成相对路径，请求根本发不出去', () => {
    const e = throws(() => E.assertEndpointShape('api.openai.com/v1/chat/completions'));
    ok(e && e.code === 'bad_url', String(e && e.code));
  });

  test('完整地址不抛', () => {
    eq(throws(() => E.assertEndpointShape('https://api.deepseek.com/v1/chat/completions')), null);
    eq(throws(() => E.assertEndpointShape('https://myproxy.example/openai')), null);
  });
});

describe('shapeHint — 同一份判据提前到失焦', () => {
  test('没话说的时候返回空串（空地址、合法地址）', () => {
    eq(E.shapeHint('', T), '');
    eq(E.shapeHint('https://api.deepseek.com/v1/chat/completions', T), '');
  });

  test('说的是人话，不是码', () => {
    const h = E.shapeHint('https://api.example.com', T);
    ok(h && /路径/.test(h), h);
    ok(!/no_path/.test(h), '把内部码贴给用户看：' + h);
    const b = E.shapeHint('api.example.com/v1/chat/completions', T);
    ok(b && /http:\/\//.test(b), b);
  });

  test('与 assertEndpointShape 同源 —— 一个说有问题，另一个必须也抛', () => {
    for (const u of ['https://api.example.com', 'api.example.com/v1', 'ftp://x.example/v1',
      '', 'https://ok.example/v1/chat/completions']) {
      const hinted = !!E.shapeHint(u, T);
      const threw = !!throws(() => E.assertEndpointShape(u));
      eq(hinted, threw, u);
    }
  });
});

describe('四条传输都经过形状检查（源码，去注释）', () => {
  const src = strip(read('extension/learn/engine-test.js'));
  for (const fn of ['translation', 'notes', 'stt', 'tts']) {
    test(fn + '() 里有 assertEndpointShape', () => {
      const body = bodyOf(src, fn);
      ok(body, '找不到 ' + fn + '()');
      ok(body.includes('assertEndpointShape('), fn + '() 绕开了形状检查');
    });
  }
  test('notes() 在 resolveConfig 之后才检查 —— 解析组可以跟随翻译组', () => {
    const body = bodyOf(src, 'notes');
    ok(body.indexOf('resolveConfig') < body.indexOf('assertEndpointShape('),
      'notes() 在解析出 cfg 之前就检查，等于在外面猜一次');
  });
});

describe('宿主不许绕过 EngineTest', () => {
  test('App 的自检按钮走 EngineTest，不直接调底层', () => {
    const src = strip(read('app/settings.js'));
    ok(!src.includes('LearnNotes.test()'), 'app/settings.js 又直接调 LearnNotes.test()');
    ok(!src.includes('LearnSpeech.test()'), 'app/settings.js 又直接调 LearnSpeech.test()');
    ok(handlerOf(src, 'btn-test-notes').includes('EngineTest.notes('), 'btn-test-notes 没走 EngineTest');
    ok(handlerOf(src, 'btn-test-stt').includes('EngineTest.stt('), 'btn-test-stt 没走 EngineTest');
  });

  test('扩展设置页的翻译自检走 EngineTest，不再自留一份', () => {
    const src = strip(read('extension/options/options.js'));
    ok(handlerOf(src, 'btn-test-provider').includes('EngineTest.translation('),
      'btn-test-provider 又自己拼了一份');
    // TranslationAPI.translate 在这个文件里只剩一处合法用途：§4.2d 长段卡的逐句重译。
    const direct = (src.match(/TranslationAPI\.translate\(/g) || []).length;
    eq(direct, 1);
    ok(blockAfter(src, 'healByRetranslate', 400).includes('TranslationAPI.translate('),
      '仅剩的那一处不是长段卡治愈 —— 有人又在别处直接发请求了');
  });

  test('两个宿主的「试听」都先判地址（它是播放不是探活，所以只补这一句）', () => {
    ok(handlerOf(strip(read('extension/options/options.js')), 'btn-tts-test').includes('EngineTest.shapeHint('),
      '扩展的试听没判地址');
    ok(handlerOf(strip(read('app/settings.js')), 'btn-tts-test').includes('EngineTest.shapeHint('),
      'App 的试听没判地址');
  });
});

describe('每个地址输入框都挂了失焦判定', () => {
  test('扩展：共用组件一处挂全（options + 引导页）', () => {
    const src = strip(read('extension/learn/engine-fields.js'));
    ok(src.includes('EngineTest.shapeHint('), 'engine-fields.js 没有失焦判定');
    ok(blockAfter(src, "addEventListener('blur'", 200).length > 0, '没有挂 blur');
  });

  test('App：三个槽各挂一次（静态 HTML，进不了那个组件）', () => {
    const src = strip(read('app/settings.js'));
    for (const id of ['notes-base-url', 'stt-base-url', 'tts-base-url']) {
      ok(src.includes("wireShapeHint('" + id + "'"), id + ' 没挂失焦判定');
    }
  });
});
