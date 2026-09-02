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

describe('EngineState — 先归一化，再判；免费通道不再享特例', () => {
  test('注册表不认识的 id ⇒ 落到第一条，而不是当成「没有 needsKey」', () => {
    const E = withRegistry([KEYED, FREE]);
    eq(E.resolve('google'), 'google', '认识的原样返回');
    eq(E.resolve('nope'), 'deepseek', '不认识的落到注册表第一条');
  });

  test('★ 全新安装（出厂默认是免费引擎、没配过 key）⇒ 判成没配好', () => {
    const E = withRegistry([FREE, KEYED]);
    ok(E.needsSetup({ provider: 'google', apiKey: '' }),
      '2026-09-01 裁定：决策不为免费通道开特例。旧判据把出厂默认算成已配好，'
      + '于是全球版全新安装的人永远不会被推去配一次 —— 那正是要改掉的');
  });

  test('★ 主动选过免费引擎 ⇒ 算配好了，不能被反复弹回引导页', () => {
    const E = withRegistry([FREE, KEYED]);
    ok(!E.needsSetup({ provider: 'google', apiKey: '', engineChosen: 1 }),
      '只写 !has(apiKey) 会把故意选了免费引擎的人困死');
  });

  test('主动选过**要 key 的**引擎但没填 key ⇒ 仍然没配好', () => {
    const E = withRegistry([FREE, KEYED]);
    ok(E.needsSetup({ provider: 'deepseek', apiKey: '', engineChosen: 1 }),
      'engineChosen 只对不需要 key 的引擎成立 —— 它是「选择」的证据，不是「配好」的证据');
  });

  test('配过 key ⇒ 配好了，与选没选过无关', () => {
    const E = withRegistry([KEYED]);
    ok(!E.needsSetup({ provider: 'deepseek', apiKey: 'sk-x' }), '');
    ok(E.needsSetup({ provider: 'deepseek', apiKey: '   ' }), '全空格算没填');
  });

  test('中国版那个真实场景：注册表里没有 google', () => {
    const E = withRegistry([KEYED]);       // 中国版没有免费条目
    ok(E.needsSetup({ provider: 'google', apiKey: '' }), '存着一个本版不存在的 id ⇒ 未配置');
    ok(E.needsSetup({ provider: 'google', apiKey: '', engineChosen: 1 }),
      '归一化后落到 deepseek，它要 key —— 主动选过也不能豁免');
  });

  test('注册表还没加载 ⇒ 不拦。把人拦在门外比让他撞一次失败更糟', () => {
    const E = withRegistry([]);
    ok(!E.needsSetup({ provider: 'x', apiKey: '' }), '判不了就不该拦');
    eq(E.defaultId(), '', '也不许凭空造一个 id 出来');
  });
});

describe('没有人再另写一份判据', () => {
  const FILES = ['popup/popup.js', 'options/options.js', 'content/content-main.js',
    'content/translation-api.js'];

  // needsKey 与 needsSetup 是**两个问题**。混用的后果是对着一个写着
  // 「免费，无需 API」的引擎说「这个引擎需要 API Key」——2026-09-02 真机截图实证，
  // 而当时那句话是设置页唯一的提示。
  test('needsKey 说的是「这个引擎要不要 Key」，与「配没配过」正交', () => {
    const ES = withRegistry([FREE, KEYED]);
    // 出厂默认（免费引擎、没 key、没主动选过）：needsSetup 为真，needsKey 为假。
    eq(ES.needsSetup({ provider: 'google', apiKey: '', engineChosen: false }), true);
    eq(ES.needsKey({ provider: 'google', apiKey: '', engineChosen: false }), false,
      '免费引擎被判成「需要 Key」—— 那句提示就会变成假话');
    // 要 key 的引擎、没填：两个都为真。
    eq(ES.needsSetup({ provider: 'deepseek', apiKey: '', engineChosen: true }), true);
    eq(ES.needsKey({ provider: 'deepseek', apiKey: '' }), true);
    // 要 key 的引擎、填了：needsSetup 假，而 needsKey 仍然为真 —— 它问的不是配没配。
    eq(ES.needsSetup({ provider: 'deepseek', apiKey: 'sk-x', engineChosen: true }), false);
    eq(ES.needsKey({ provider: 'deepseek', apiKey: 'sk-x' }), true);
    // 注册表不认识的 id ⇒ 归一化到第一条（这里是免费那个）。
    eq(ES.needsKey({ provider: 'nope' }), false);
  });

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
