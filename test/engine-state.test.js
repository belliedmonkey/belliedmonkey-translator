// test/engine-state.test.js — 「配好了没有」只有一份判据。
//
// 2026-09-01 全流程图数出来：这个问题在扩展里被算了四遍，而它们互相不一致。最要命的
// 一处是**归一化与否**：一个注册表不认识的 provider id 上，两种写法给出相反的结论。
// 真实触发不是假想 —— 中国版带着遗留的 provider:'google'（background.js 的
// DEFAULT_SETTINGS 写的），而 google 的 flavors 是 ['global']。
//
// 所以这一组守两件事：判据本身对，以及**没有人再另写一份**。

const fs = require('fs');
const path = require('path');
const { loadModule, describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');

function withRegistry(providers) {
  const window = { MT_PROVIDERS: providers };
  return loadModule(['content/engine-state.js'], { window }).EngineState;
}
const KEYED = { id: 'deepseek', needsKey: true };
const FREE = { id: 'google', needsKey: false };

describe('EngineState — 先归一化，再判', () => {
  test('注册表不认识的 id ⇒ 落到第一条，而不是当成「没有 needsKey」', () => {
    const E = withRegistry([KEYED, FREE]);
    eq(E.resolve('google'), 'google', '认识的原样返回');
    eq(E.resolve('nope'), 'deepseek', '不认识的落到注册表第一条');
    ok(E.needsSetup({ provider: 'nope', apiKey: '' }),
      '这正是中国版带着遗留 google 的场景：不归一化就会说「一切正常」');
  });

  test('中国版那个真实场景：注册表里没有 google', () => {
    const E = withRegistry([KEYED]);       // 中国版没有免费条目
    ok(E.needsSetup({ provider: 'google', apiKey: '' }), '存着一个本版不存在的 id ⇒ 未配置');
    ok(!E.freeChannel({ provider: 'google' }), '也不该被当成免费通道');
  });

  test('免费通道：能用，且不该被判成「要去配」', () => {
    const E = withRegistry([FREE, KEYED]);
    ok(!E.needsSetup({ provider: 'google', apiKey: '' }), '');
    ok(E.freeChannel({ provider: 'google' }), '');
  });

  test('要 key 的引擎：填了才算配好；空白与全空格都算没填', () => {
    const E = withRegistry([KEYED]);
    ok(E.needsSetup({ provider: 'deepseek', apiKey: '' }), '');
    ok(E.needsSetup({ provider: 'deepseek', apiKey: '   ' }), '');
    ok(!E.needsSetup({ provider: 'deepseek', apiKey: 'sk-x' }), '');
  });

  test('注册表还没加载 ⇒ 不拦。把人拦在门外比让他撞一次失败更糟', () => {
    const E = withRegistry([]);
    ok(!E.needsSetup({ provider: 'x', apiKey: '' }), '判不了就不该拦');
    eq(E.defaultId(), '', '也不许凭空造一个 id 出来');
  });

  test('needsSetup 与 freeChannel 不是互补 —— 配好了的引擎两者都是 false', () => {
    const E = withRegistry([KEYED]);
    const s = { provider: 'deepseek', apiKey: 'sk-x' };
    ok(!E.needsSetup(s) && !E.freeChannel(s), '');
  });
});

describe('没有人再另写一份判据', () => {
  const FILES = ['popup/popup.js', 'options/options.js', 'content/content-main.js',
    'content/translation-api.js'];

  test('四个面都不再自己算 needsKey && !apiKey', () => {
    const bad = [];
    for (const rel of FILES) {
      const src = fs.readFileSync(path.join(ROOT, 'extension', rel), 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        if (line.trim().startsWith('//')) continue;
        // 「自己判 needsKey」的形状：读到 .needsKey 而不是走 EngineState
        if (/\.needsKey/.test(line) && !/EngineState/.test(line)) {
          bad.push(`${rel}:${i + 1}  ${line.trim()}`);
        }
      }
    }
    eq(bad.length, 0, '还有人自己判 needsKey —— 归一化与否会给出相反结论：\n  ' + bad.join('\n  '));
  });

  test('归一化也只有一份 —— 不许再出现硬写的默认引擎 id', () => {
    const bad = [];
    for (const rel of FILES.concat(['background.js'])) {
      const src = fs.readFileSync(path.join(ROOT, 'extension', rel), 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        if (line.trim().startsWith('//')) continue;
        if (/\|\|\s*'(google|deepseek|openai|openrouter|qwen)'/.test(line)) {
          bad.push(`${rel}:${i + 1}  ${line.trim()}`);
        }
      }
    }
    eq(bad.length, 0,
      '硬写的默认引擎 id 回来了 —— 它不跟着注册表走，换 flavor 就指向一个不存在的引擎：\n  '
      + bad.join('\n  '));
  });

  test('四个面都真的加载了它', () => {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'));
    for (const b of m.content_scripts || []) {
      const js = b.js || [];
      if (!js.includes('content/translation-api.js')) continue;
      ok(js.includes('content/engine-state.js'), '内容脚本清单里缺 engine-state.js');
      ok(js.indexOf('content/engine-state.js') < js.indexOf('content/translation-api.js'),
        'engine-state.js 必须排在 translation-api.js 之前，否则加载期 ReferenceError');
    }
    for (const page of ['popup/popup.html', 'options/options.html', 'onboard/onboard.html']) {
      const html = fs.readFileSync(path.join(ROOT, 'extension', page), 'utf8');
      ok(html.includes('engine-state.js'), page + ' 没加载 engine-state.js');
    }
  });
});
