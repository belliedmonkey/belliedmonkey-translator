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

// ─────────────────────────────────────────────────────────────────────────────
// 宿主 App 也是它的 host —— 2026-09-04 补。
//
// 上面那一组门禁只 grep options.js，于是 `app/settings.js` 的三份手抄**从来不会让
// 任何测试变红**。用户当天报的「App 设置页与扩展端不一致」就是这么攒出来的：
//
//   · paintNotesFields 是 `hidden = !p` —— 只要选了引擎就露出 Key 框，不看 needsKey；
//     扩展那边看。不需要 Key 的引擎在 App 上多一个空 Key 框。
//   · tts / stt 两处只判 needsKey，不判 `supportsKey ?? needsKey`。
//   · 四个输入框的 id 与 SLOTS 对不上（notes-key / notes-base / stt-key / stt-base）。
//
// 三条都不报错、都不被任何门禁看见 —— 这正是「静默漂移」的形状，也是这一组断言
// 存在的全部理由。规则只能有一份，而守它的门禁必须覆盖**每一个** host。
describe('app/settings.js 也不许有第二份同能力的判断', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'settings.js'), 'utf8');
  const bundle = fs.readFileSync(path.join(ROOT, 'build', 'app-bundle.js'), 'utf8');

  test('App 不再自己判 supportsBaseUrl / supportsModel / supportsKey / needsKey', () => {
    const hits = src.split('\n')
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => !/^\s*\/\//.test(l))                    // 注释里说得起这些词
      .filter(([, l]) => /supportsBaseUrl|supportsModel|supportsKey|needsKey/.test(l));
    eq(hits.length, 0,
      'App 又留了第二份判据 —— 它不会报错，只会在某个引擎某个字段上与扩展不一样：\n  '
      + hits.map(([n, l]) => `${n}: ${l.trim()}`).join('\n  '));
  });

  test('三组引擎配置都接在组件的判据上（App 没有翻译引擎那一组）', () => {
    const n = (src.match(/EngineFields\.visibility\(/g) || []).length;
    eq(n, 3,
      `只接上了 ${n} 组，期望 3 组 —— 朗读 / 解析 / 转写。App 没有网页翻译，`
      + '所以没有 chat 那一组；漏掉的任何一组都会另写一套并慢慢漂走');
  });

  test('下拉一律用组件填，不许再手写 createElement(\'option\') 塞引擎', () => {
    // 声音列表是系统语音 / 注册表 voices，不是引擎注册表 —— 那几处是正当的。
    const bad = src.split('\n')
      .map((l, i) => [i + 1, l])
      .filter(([n]) => {
        const around = src.split('\n').slice(Math.max(0, n - 6), n + 2).join('\n');
        return /MT_TTS_ENGINES|MT_STT_ENGINES|chatEngines\(\)/.test(around);
      })
      .filter(([, l]) => /createElement\('option'\)/.test(l));
    eq(bad.length, 0,
      '又在手写引擎下拉 —— populate() 比手抄多做两件事（不认识的 id 落到能用的选项、'
      + '哨兵语义），漏掉的那一件不会有人发现：\n  '
      + bad.map(([n, l]) => `${n}: ${l.trim()}`).join('\n  '));
  });

  test('输入框 id 从 SLOTS 取，不是第八份手抄表', () => {
    ok(/EngineFields\.SLOTS\[/.test(src),
      'app/settings.js 没有从 EngineFields.SLOTS 取 id —— 这个仓库已经有七份手抄的'
      + '设置键表了，第八份只会让「改一处、另外七处不红」再发生一次');
    for (const id of ['notes-key', 'notes-base', 'stt-key', 'stt-base']) {
      ok(!new RegExp(`['"]${id}['"]`).test(src),
        `旧 id '${id}' 又回来了 —— 它与 EngineFields.SLOTS 对不上，`
        + '组件渲染出来的框和 App 读写的框会是两个东西');
    }
  });

  test('组件真的在 App 包里，且排在 app/settings.js 之前', () => {
    for (const m of ['engine-fields.js', 'quick-setup.js', 'engine-test.js']) {
      const a = bundle.indexOf('extension/learn/' + m);
      ok(a >= 0, `build/app-bundle.js 的 MODULES 里没有 ${m} —— App 包里没有这个模块，`
        + 'settings.js 就只能继续手抄');
      ok(a < bundle.indexOf("'app/settings.js'"),
        `${m} 排在了 app/settings.js 后面 —— MODULES 的顺序就是依赖顺序`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// App 里不许存在「设置页看不见、也清不掉，却会被读走」的键 —— 2026-09-04。
//
// 起因是「解析引擎键名挪用」：App 设置页那一档叫「解析引擎」，写的却是基础组
// (`provider/apiKey/apiBaseUrl/apiModel`)。这本身是对的 —— App 没有网页翻译，
// 没有第二个 chat 引擎要区分，`LearnNotes.resolveConfig` 的回落分支正是为它准备的。
//
// **真正的隐患是不对称**：`app/driving.js` 的读取清单里还有 notes* 四个键，而
// `LearnNotes.resolveConfig` 一旦看见 `notesProvider` 就会**优先用它**，静默赢过
// 设置页写的 `provider` —— 而 App 设置页没有那一档控件，用户既看不见也清不掉。
//
// ⚠️ **不能靠「把 notes* 从 driving.js 删掉」来修**（2026-09-04 差点这么做）：
// `extension/learn/review.js` 是与扩展**同一份字节**打进 App 包的，它自己那份读取
// 清单里也有 notes*，也调 resolveConfig。只删一处的结果是同一个 App 里播客模式回落
// 到基础组、复习页仍用 notes 组 —— 从「一个静默赢」变成「两处解出两个不同引擎」。
// 而 review.js 那份不能动：扩展那边 notes 组是真实可配的。
//
// 所以这里钉的是**不变量本身**，而不是某一处读取：读得到的键，必须要么设置页管得到，
// 要么在下面这张写明理由的白名单上。往清单里加一个键会撞上这道门，那是刻意的 ——
// 「加一个 App 读得到却改不了的设置」必须是一次自觉的动作。
describe('App 读得到的设置，设置页必须管得到', () => {
  const drv = fs.readFileSync(path.join(ROOT, 'app', 'driving.js'), 'utf8');
  const set = fs.readFileSync(path.join(ROOT, 'app', 'settings.js'), 'utf8');
  const listOf = (src, name) => {
    const m = src.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];'));
    ok(!!m, '找不到 ' + name + ' —— 这道门禁靠解析它，改名要同步改这里');
    return [...m[1].matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((x) => x[1]);
  };

  // 读得到、但设置页管不到 —— 每一条都要有理由。
  const ALLOW = {
    drivePlaybackMode: '播放顺序：由播放器里的按钮写，不属于设置页。用户看得见也改得到，'
      + '只是入口在播放界面 —— 与「看不见也清不掉」是两回事。',
    notesProvider: '见本段开头。App 从不写它（grep 可证），所以回落分支恒成立；'
      + '它留在读取清单里是因为 review.js 是共享字节、两处必须解出同一个引擎。',
    notesApiKey: '同 notesProvider。',
    notesBaseUrl: '同 notesProvider。',
    notesModel: '同 notesProvider。',
  };

  test('差集恰好等于白名单 —— 多一个少一个都要说明', () => {
    const read = listOf(drv, 'SETTINGS_KEYS');
    const known = new Set(listOf(set, 'KEYS'));
    const gap = read.filter((k) => !known.has(k)).sort();
    const allow = Object.keys(ALLOW).sort();
    eq(gap.join(','), allow.join(','),
      'driving.js 读得到但设置页管不到的键变了。\n'
      + '  实际：' + (gap.join(' ') || '（无）') + '\n'
      + '  白名单：' + allow.join(' ') + '\n'
      + '  多出来的那个会**静默赢过**设置页写的值，而用户看不见也清不掉它 ——'
      + '要么给它一个控件，要么写进 ALLOW 并说明理由。');
  });

  test('App 从不写 notes* —— 回落分支恒成立，靠的是这一条', () => {
    for (const f of ['settings.js', 'app.js', 'driving.js', 'translate-fill.js']) {
      const src = fs.readFileSync(path.join(ROOT, 'app', f), 'utf8');
      const writes = src.split('\n')
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => !/^\s*\/\//.test(l))
        .filter(([, l]) => /\bnotes(Provider|ApiKey|BaseUrl|Model)\b/.test(l))
        .filter(([, l]) => !/SETTINGS_KEYS|^\s*'notes/.test(l));
      eq(writes.length, 0,
        `app/${f} 动了 notes* 键 —— 一旦 App 存储里出现 notesProvider，`
        + 'resolveConfig 会优先用它，而设置页读不回它：\n  '
        + writes.map(([n, l]) => `${n}: ${l.trim()}`).join('\n  '));
    }
  });
});

// 界面语言：四份清单必须都等于 build/ui-langs.config.js —— 2026-09-04。
//
// 「这个产品的界面能说哪些语言」此前在四处各写一份，且已经不一致：扩展少 hi，
// 官网少 de/ja/ko/zh-TW。两边都不报错，只是那门语言的人看到兜底语言。用户裁定
// **三个面取全集**，于是有了那张注册表，也就必须有这道门 —— endonym 是
// no-hardcoded-copy 的刻意例外，抽不成 t()，端点只能留在 markup 里。
//
// **四份都对着注册表核，不是互核** —— 两份一起抄错时互核照样绿。
describe('界面语言 = build/ui-langs.config.js', () => {
  const REG = require(path.join(ROOT, 'build', 'ui-langs.config.js'));
  const ids = REG.map((l) => l.id);
  const dirs = REG.map((l) => l.chrome);

  test('注册表自身自洽：id / chrome 目录 / endonym 都不重复', () => {
    for (const [f, list] of [['id', ids], ['chrome', dirs], ['endonym', REG.map((l) => l.endonym)]]) {
      eq(new Set(list).size, list.length, f + ' 有重复：' + list.join(' '));
    }
  });

  test('扩展 _locales/ 与注册表一一对应', () => {
    const shipped = fs.readdirSync(path.join(ROOT, 'extension', '_locales'))
      .filter((d) => fs.existsSync(path.join(ROOT, 'extension', '_locales', d, 'messages.json')))
      .sort();
    eq(shipped.join(','), dirs.slice().sort().join(','),
      '_locales/ 与注册表对不上。\n  磁盘上：' + shipped.join(' ')
      + '\n  注册表：' + dirs.slice().sort().join(' ')
      + '\n  少一份 = 选择器里列了一门根本没有文案的语言（选了回落到兜底且不报错）；'
      + '多一份 = 有翻译却没人选得到。');
  });

  const optionsOf = (html) => {
    const m = html.match(/<select id="ui-lang">([\s\S]*?)<\/select>/);
    ok(!!m, '找不到 ui-lang 选择器');
    return [...m[1].matchAll(/value="([^"]+)"[^>]*>([^<]*)</g)].map((x) => [x[1], x[2].trim()]);
  };

  // 两个宿主的 <option> 用的是 **chrome 那一列**（两边共用 uiLang 这个存储键，
  // 而它的取值一直是 Chrome 的 locale 码）。官网用 id 那一列。
  for (const [label, file] of [
    ['扩展设置页', path.join('extension', 'options', 'options.html')],
    ['宿主 App 设置页', path.join('app', 'index.html')],
  ]) {
    test(label + '：auto 在最前，其余逐项等于注册表（含顺序与 endonym）', () => {
      const list = optionsOf(fs.readFileSync(path.join(ROOT, file), 'utf8'));
      eq(list[0][0], 'auto', label + ' 的第一项不是 auto —— 「跟随系统」是默认，必须在最前');
      const got = list.slice(1);
      eq(got.map((x) => x[0]).join(','), dirs.join(','),
        label + ' 的语言项与注册表对不上（顺序也算）。\n  选择器：'
        + got.map((x) => x[0]).join(' ') + '\n  注册表：' + dirs.join(' '));
      const badName = got.filter((x, i) => x[1] && x[1] !== REG[i].endonym);
      eq(badName.length, 0,
        label + ' 的 endonym 与注册表不同字：'
        + badName.map((x, i) => x[0] + ' 写「' + x[1] + '」').join(' · ')
        + ' —— endonym 按定义不翻译，三个面必须逐字相同');
    });
  }
});
