// test/engine-fields.test.js — 「露哪几个框」和「怎么填下拉」的唯一实现。
//
// 这一组的价值在于它**替代了八份抄写**（options.js 四份、app/settings.js 三份、
// onboard.js 一份）。所以判据不是「函数返回了什么」，而是两件事：
//   1. 对**真实生成物**的每一个条目，判据都还成立（不是手写 fixture —— 手写的
//      fixture 只能证明我理解的规则自洽，证明不了它和用户手上那张表对得上）；
//   2. options.js 里**不许再残留第二份**同能力的判断。抽完之后旧代码还在，就是抽了
//      个寂寞：下一个人改其中一份，另一份静默保持旧行为。

const fs = require('fs');
const path = require('path');
const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const EF = loadModule(['learn/engine-fields.js']).EngineFields;

// 真实生成物。没跑过 build 就跳过，并说清楚 —— 一个静默跳过的断言等于没有断言。
function registries(dir) {
  const base = path.join(ROOT, dir, 'content');
  const files = ['providers.gen.js', 'tts.gen.js', 'stt.gen.js'].map((f) => path.join(base, f));
  if (!files.every((f) => fs.existsSync(f))) return null;
  const window = {};
  loadModule(files.map((f) => path.relative(path.join(ROOT, 'extension'), f)), { window });
  return {
    chat: window.MT_PROVIDERS || [],
    tts: window.MT_TTS_ENGINES || [],
    stt: window.MT_STT_ENGINES || [],
  };
}

describe('EngineFields.visibility — 一条规则，对三张真表都成立', () => {
  for (const dir of ['dist', 'dist-china']) {
    test(`${dir}：key 的判据是「supportsKey 没声明就看 needsKey」`, () => {
      const r = registries(dir);
      if (!r) return ok(true, `（${dir}/ 不存在，跳过 —— 先跑 node build.js）`);
      // 自检用「三张表都非空」，不用总数阈值 —— 中国版只有 12 个条目，写死一个数
      // 会让这条断言变成 flavor 的函数，而它要验的根本不是数量。
      for (const [group, list] of Object.entries(r)) {
        ok(list.length > 0, `${dir} 的 ${group} 注册表是空的 —— 生成物没读进来，这一组在空转`);
      }
      for (const [group, list] of Object.entries(r)) {
        for (const e of list) {
          const want = e.supportsKey === undefined ? !!e.needsKey : !!e.supportsKey;
          eq(EF.visibility(e).key, want, `${group}/${e.id}`);
        }
      }
    });

    test(`${dir}：地址与模型的框跟着 supportsBaseUrl / supportsModel`, () => {
      const r = registries(dir);
      if (!r) return ok(true, `（${dir}/ 不存在，跳过）`);
      for (const list of Object.values(r)) {
        for (const e of list) {
          const v = EF.visibility(e);
          eq(v.baseUrl, !!e.supportsBaseUrl, e.id + ' baseUrl');
          eq(v.model, !!e.supportsModel, e.id + ' model');
        }
      }
    });

    test(`${dir}：要自填地址的条目，地址框必须露出来`, () => {
      const r = registries(dir);
      if (!r) return ok(true, `（${dir}/ 不存在，跳过）`);
      let seen = 0;
      for (const list of Object.values(r)) {
        for (const e of list) {
          if (!e.requiresEndpoint) continue;
          seen += 1;
          ok(EF.visibility(e).baseUrl,
            `${e.id} 要求自填端点，却不显示地址框 —— 这个引擎会永远配不成`);
        }
      }
      ok(seen > 0, 'requiresEndpoint 的条目一个都没有？那这条断言在空转');
    });

    test(`${dir}：示例地址永远不为空 —— 空的示例等于没有示例`, () => {
      const r = registries(dir);
      if (!r) return ok(true, `（${dir}/ 不存在，跳过）`);
      for (const list of Object.values(r)) {
        for (const e of list) {
          ok(String(EF.visibility(e).basePlaceholder || '').trim().length > 0, e.id);
        }
      }
    });
  }

  test('没有条目（下拉选了哨兵项）⇒ 一个框都不露', () => {
    deepEq(EF.visibility(null),
      { key: false, baseUrl: false, model: false, basePlaceholder: '', modelPlaceholder: '' },
      'null 必须是「什么都不显示」，不是「显示全部」');
    deepEq(EF.visibility(undefined), EF.visibility(null), '');
  });

  test('needsKey=false 但 supportsKey=true ⇒ 露 Key 框（自建端点那一类）', () => {
    eq(EF.visibility({ needsKey: false, supportsKey: true }).key, true,
      'stt.config.js:36 明写过：needsKey=false 是「不强制」，supportsKey=true 是「可以填」');
  });
});

describe('EngineFields.populate — 哨兵项与回落', () => {
  // 极小的 document 替身：只要 createElement / appendChild / value 三样。
  function fakeSelect() {
    const kids = [];
    const sel = {
      innerHTML: '', value: '',
      ownerDocument: { createElement: () => ({ value: '', textContent: '' }) },
      appendChild: (o) => kids.push(o),
      options: kids,
    };
    return sel;
  }
  const LIST = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];

  test('存着的 id 认识 ⇒ 选它', () => {
    const s = fakeSelect();
    eq(EF.populate(s, LIST, { selected: 'b' }), 'b', '');
  });

  test('存着的 id 不认识 ⇒ 落到第一项（换 flavor / 厂商下架都会走到这里）', () => {
    const s = fakeSelect();
    eq(EF.populate(s, LIST, { selected: 'gone' }), 'a',
      '留一个空 select 比落到一个能用的选项糟 —— 用户看不出发生了什么');
  });

  test('有哨兵项时，不认识的 id 落回哨兵而不是第一个引擎', () => {
    const s = fakeSelect();
    eq(EF.populate(s, LIST, { selected: 'gone', sentinel: { value: '', text: '未配置' } }), '',
      '转写的 \'\' 是「不出说题」、解析的 \'\' 是「跟随翻译引擎」—— 有语义的空，'
      + '悄悄替换成第一个引擎会打开一个用户没选过的功能');
    eq(s.options.length, 3, '哨兵项要置顶');
    eq(s.options[0].textContent, '未配置', '');
  });

  test('显式 fallback 压过其它回落', () => {
    const s = fakeSelect();
    eq(EF.populate(s, LIST, { selected: 'gone', fallback: 'b' }), 'b', '');
  });

  test('空注册表 ⇒ 不炸，回空串', () => {
    const s = fakeSelect();
    eq(EF.populate(s, [], {}), '', '');
    eq(EF.populate(null, LIST, {}), '', 'select 不存在也不许抛');
  });

  test('labelKey 走 t()，没有就用 label / id', () => {
    eq(EF.labelOf({ id: 'x', labelKey: 'k', label: 'L' }, (k, fb) => 'T:' + fb), 'T:L', '');
    eq(EF.labelOf({ id: 'x', label: 'L' }, null), 'L', '');
    eq(EF.labelOf({ id: 'x' }, null), 'x', '');
  });
});

describe('options.js 里不许再有第二份同能力的判断', () => {
  const src = fs.readFileSync(path.join(ROOT, 'extension', 'options', 'options.js'), 'utf8');

  test('抽完之后 options.js 不再自己判 supportsBaseUrl / supportsModel / supportsKey', () => {
    const hits = src.split('\n')
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => /supportsBaseUrl|supportsModel|supportsKey/.test(l));
    eq(hits.length, 0,
      '还留着第二份判据 —— 下一个人改其中一份，另一份会静默保持旧行为：\n  '
      + hits.map(([n, l]) => `${n}: ${l.trim()}`).join('\n  '));
  });

  // 判据不是「调了几次」——那是个会随迁移不断失效的代理。要守的是：**四组引擎配置
  // 一组都不许自己另写一套**。每一组要么整块由组件渲染（render），要么至少用组件的
  // 判据（visibility）。两者相加必须正好是四组：翻译 / 朗读 / 解析 / 转写。
  test('四组引擎配置全都接在组件上，一组都不落', () => {
    // 不能用 [^)]*? —— 第一个实参就是 $('stt-core')，里面有括号。限长的懒惰匹配。
    const rendered = [...src.matchAll(/EngineFields\.render\([\s\S]{0,240}?slot:\s*'(\w+)'/g)].map((m) => m[1]);
    const ruleOnly = (src.match(/EngineFields\.visibility\(/g) || []).length;
    ok(rendered.length + ruleOnly === 4,
      `只接上了 ${rendered.length + ruleOnly} 组（组件渲染 ${rendered.length} 组：`
      + `${rendered.join('/') || '无'}；只用判据 ${ruleOnly} 组），期望 4 组`
      + ' —— 翻译/朗读/解析/转写，漏掉的那一组会另写一套并慢慢漂走');
    // 四组现在全部由组件渲染。退回「只用判据」也算接着，但那意味着又有一份手写
    // markup —— 加字段时它不会自己长出来。
    ok(new Set(rendered).size === 4,
      '不是四组都由组件渲染，实际：' + (rendered.join('/') || '一组都没有'));
    ok(new Set(rendered).size === rendered.length,
      '同一个 slot 渲染了两次：' + rendered.join('/'));
  });

  test('两个 host 都加载了它，且在自己的脚本之前', () => {
    for (const [page, own] of [['options/options.html', 'options.js'], ['onboard/onboard.html', 'onboard.js']]) {
      const html = fs.readFileSync(path.join(ROOT, 'extension', page), 'utf8');
      const a = html.indexOf('engine-fields.js');
      const b = html.indexOf(own + '"');
      ok(a >= 0, page + ' 没加载 engine-fields.js');
      ok(a < b, page + ' 把 engine-fields.js 排在了自己的脚本后面 —— 加载期就会 ReferenceError');
    }
  });
});
