// test/quick-setup.test.js — 「一把 key 配好全部」的判据（QuickSetup）。
//
// 这个模块的价值几乎全在**它不写什么**上：写多一个键，saveAll() 读不回来，下次任何
// 字段变更就会把它清掉 —— 静默且必然。所以这里的断言大量是 deepEq 整个 writes，
// 而不是「包含某个键」。
//
// 分组那一组**对真实产物跑**，不是手写 fixture：dist/ 与 dist-china/ 的 *.gen.js 才是
// 用户手上的那份表，而 build/*.config.js 是作者视角（同一个 qwen 在两个 flavor 里
// 指向不同的 host）。

const fs = require('fs');
const path = require('path');
const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');

const ROOT = path.join(__dirname, '..');

function load(reg) {
  const window = {};
  const ctx = loadModule(['content/wire-format.js', 'learn/quick-setup.js'], { window });
  return { Q: ctx.QuickSetup, window };
}

// 把某个 flavor 的三张生成表 eval 进一个裸 window，再交给 QuickSetup。
// 生成物不存在时（没跑过 build）整组跳过并说清楚 —— 一个静默跳过的分组断言，
// 和没有这条断言是一回事。
function fromDist(dir) {
  const base = path.join(ROOT, dir, 'content');
  const files = ['providers.gen.js', 'tts.gen.js', 'stt.gen.js'].map((f) => path.join(base, f));
  if (!files.every((f) => fs.existsSync(f))) return null;
  const window = {};
  const ctx = loadModule(
    ['content/wire-format.js'].concat(files.map((f) => path.relative(path.join(ROOT, 'extension'), f))),
    { window });
  // gen 文件写的是 window.MT_*，而 quick-setup 也读 window.*，同一个对象即可
  const ctx2 = loadModule(['learn/quick-setup.js'], { window: ctx.window, WireFormat: ctx.WireFormat });
  return { Q: ctx2.QuickSetup, window: ctx.window };
}

describe('QuickSetup.tryVisible — 配好之后才给出口，没配好不给', () => {
  const { Q } = load();
  const OK = { slot: 'chat', ok: true };
  const BAD = { slot: 'chat', ok: false };

  test('翻译测通了 ⇒ 给', () => {
    ok(Q.tryVisible(['chat', 'tts', 'stt'], [OK, { slot: 'tts', ok: false }]) === true,
      '翻译通了就该给出口，朗读/转写没通不影响「去翻一页」这件事');
  });

  test('翻译没通 ⇒ 不给', () => {
    ok(Q.tryVisible(['chat', 'tts'], [BAD, { slot: 'tts', ok: true }]) === false,
      '翻译没通却请人去翻一页，是把失败推迟到一个更难解释的地方发生');
  });

  test('压根没测翻译（早就配过了）⇒ 给', () => {
    ok(Q.tryVisible(['tts', 'stt'], [{ slot: 'tts', ok: true }]) === true,
      'chat 不在 tests 里说明用户本来就配着翻译在用');
  });

  test('结果还没回来 ⇒ 不给（不是「先给了再收回」）', () => {
    ok(Q.tryVisible(['chat'], []) === false, '没有结果就不该有结论');
    ok(Q.tryVisible(['chat'], null) === false, '缺参数按未通过处理，不按通过处理');
  });
});

describe('QuickSetup — 每个进了下拉的平台都得说得出「去哪儿申请 key」', () => {
  // 这张卡的承诺是「最少操作」，而没有 key 的用户在第一格就停住 —— 那时前面省下的
  // 二十几次点击一次都用不上。所以「进得了下拉」和「给得出申请入口」必须绑死：
  // 将来加一个平台却忘了 keyUrl，那一行会**静默消失**（渲染器 hidden 掉它），
  // 没有这条断言就没有任何东西会红。
  for (const dir of ['dist', 'dist-china']) {
    test(dir + '：platforms() 里每个平台的 chat 条目都带 keyUrl，且是 https 绝对地址', () => {
      const d = fromDist(dir);
      if (!d) return ok(true, '（' + dir + '/ 不存在，跳过 —— 先跑 node build.js）');
      const list = d.Q.platforms();
      ok(list.length > 0, dir + ' 一个平台都没有，这条断言就成了空转');
      for (const p of list) {
        const u = p.chat.keyUrl;
        ok(!!u, p.host + '（' + p.chat.id + '）没有 keyUrl —— '
          + '进得了一键配置的下拉，就必须给得出申请入口');
        ok(/^https:\/\//.test(u), p.host + ' 的 keyUrl 不是 https 绝对地址：' + u);
      }
    });
  }

  test('keyUrl 按 flavor 分：中国版拿到的不是国际站控制台', () => {
    const cn = fromDist('dist-china');
    if (!cn) return ok(true, '（dist-china/ 不存在，跳过）');
    for (const p of cn.Q.platforms()) {
      ok(!/alibabacloud\.com/.test(p.chat.keyUrl || ''),
        '中国版拿到了国际站控制台（' + p.chat.keyUrl + '）—— 那边签出来的 key '
        + '不认这个端点，用户会以为是自己粘错了');
    }
  });
});

describe('QuickSetup.platforms — 分组从 host 推导，对真实产物跑', () => {
  test('global：恰好两组，且有实测推荐的 openrouter.ai 排第一', () => {
    const d = fromDist('dist');
    if (!d) return ok(true, '（dist/ 不存在，跳过 —— 先跑 node build.js）');
    const hosts = d.Q.platforms().map((p) => p.host);
    eq(hosts[0], 'openrouter.ai',
      '有实测推荐的排前面：注册表顺序是历史形成的（openai 只是加得早），拿它当推荐序'
      + '会让这张卡推荐一个我们从没跑过跨能力实测的平台');
    ok(hosts.includes('api.openai.com'), 'api.openai.com 必须成组');
    eq(hosts.length, 2, 'global 恰好两组，实际 ' + JSON.stringify(hosts));
  });

  test('dashscope-intl 不在 global 结果里 —— 这是「只有 chat 不算」那条规则的钉子', () => {
    const d = fromDist('dist');
    if (!d) return ok(true, '（dist/ 不存在，跳过）');
    const hosts = d.Q.platforms().map((p) => p.host);
    ok(!hosts.includes('dashscope-intl.aliyuncs.com'),
      'global 侧的通义千问只有翻译、没有语音条目，放进来那一行的承诺就是假的');
  });

  test('china：恰好 dashscope.aliyuncs.com', () => {
    const d = fromDist('dist-china');
    if (!d) return ok(true, '（dist-china/ 不存在，跳过 —— 先跑 node build.js --flavor china）');
    const hosts = d.Q.platforms().map((p) => p.host);
    deepEq(hosts, ['dashscope.aliyuncs.com'], 'china 恰好一组');
  });

  test('组代表取注册表第一条：china 是 qwen 不是 qwen_mt', () => {
    const d = fromDist('dist-china');
    if (!d) return ok(true, '（dist-china/ 不存在，跳过）');
    const p = d.Q.platforms()[0];
    eq(p.chat.id, 'qwen', 'qwen_mt 是翻译专用模型，当组代表会把「解析」也接到一个不做对话的模型上');
    eq(p.tts.id, 'qwen_tts', '');
    eq(p.stt.id, 'qwen_asr', '');
  });

  test('组代表：openrouter_speech 赢过 openrouter_audio（专用语音端点，不是带音频输出的对话模型）', () => {
    const d = fromDist('dist');
    if (!d) return ok(true, '（dist/ 不存在，跳过）');
    const p = d.Q.platforms().find((x) => x.host === 'openrouter.ai');
    eq(p.tts.id, 'openrouter_speech', '');
    ok(p.alt.tts.some((e) => e.id === 'openrouter_audio'), '另一条应当出现在 alt 里，供展开修改时换');
  });

  test('结果里不含 needsKey:false 或 requiresEndpoint 的条目', () => {
    for (const dir of ['dist', 'dist-china']) {
      const d = fromDist(dir);
      if (!d) continue;
      for (const p of d.Q.platforms()) {
        for (const e of [p.chat, p.tts, p.stt]) {
          eq(e.needsKey, true, `${dir} ${e.id} needsKey`);
          ok(!e.requiresEndpoint, `${dir} ${e.id} 不该是自填端点条目`);
        }
        ok(d.Q.consistent(p), `${dir} ${p.host} 组内 needsKey 必须一致 —— 不一致说明这个 host 上不是一把 key 通吃`);
      }
    }
    ok(true, '');
  });
});

// ── plan()：写什么、不写什么 ────────────────────────────────────────────
const PLATFORM = {
  host: 'openrouter.ai',
  chat: { id: 'openrouter', needsKey: true, defaultEndpoint: 'https://openrouter.ai/api/v1/chat/completions' },
  tts: { id: 'openrouter_speech', needsKey: true, defaultEndpoint: 'https://openrouter.ai/api/v1/audio/speech' },
  stt: { id: 'openrouter_transcribe', needsKey: true, defaultEndpoint: 'https://openrouter.ai/api/v1/audio/transcriptions' },
  alt: { chat: [], tts: [], stt: [] },
};
const KEY = 'sk-or-v1-test';

describe('QuickSetup.plan — 只填空，不覆盖', () => {
  test('空存储：三组键必须全部出现，且**恰好**是这些', () => {
    const { Q } = load();
    const r = Q.plan({ platform: PLATFORM, key: KEY, settings: {} });
    deepEq(r.writes, {
      provider: 'openrouter', apiKey: KEY, apiBaseUrl: '', apiModel: '',
      ttsEngine: 'openrouter_speech', ttsApiKey: KEY, ttsBaseUrl: '', ttsModel: '', ttsVoice: '',
      ttsMode: 'assist', ttsAutoPlay: false,
      sttEngine: 'openrouter_transcribe', sttApiKey: KEY, sttBaseUrl: '', sttModel: '',
    }, 'writes 必须逐字是这些 —— 多一个键就是一个 saveAll() 读不回、下次被清掉的键');
    deepEq(r.tests, ['chat', 'tts', 'stt'], '三样都要测');
  });

  test('翻译已配：不含任何 api* 键，skipped 记下它', () => {
    const { Q } = load();
    const r = Q.plan({ platform: PLATFORM, key: KEY, settings: { apiKey: 'sk-old', provider: 'deepseek' } });
    ok(!Object.keys(r.writes).some((k) => /^api|^provider$/.test(k)), '不许覆盖翻译组');
    ok(r.skipped.some((x) => x.slot === 'chat' && x.current === 'deepseek'), 'skipped 要带上现有引擎名，结果区要显示它');
    ok(!r.tests.includes('chat'), '没动的不测');
  });

  test('朗读已配：不含任何 tts* 键 —— **包括 ttsMode**', () => {
    const { Q } = load();
    const r = Q.plan({ platform: PLATFORM, key: KEY, settings: { ttsApiKey: 'x' } });
    ok(!Object.keys(r.writes).some((k) => /^tts/.test(k)),
      'ttsMode 的写入必须挂在「tts 组被写」这个条件上，而不是独立判断');
  });

  test('用户选过 audio-first：写 tts 组但不覆盖 ttsMode', () => {
    const { Q } = load();
    const r = Q.plan({ platform: PLATFORM, key: KEY, settings: { ttsMode: 'audio-first' } });
    eq(r.writes.ttsEngine, 'openrouter_speech', '朗读没配过，要写');
    ok(!('ttsMode' in r.writes), '一键配置永远不该改一个人怎么学习');
  });

  test('用户明确开过自动朗读：不覆盖', () => {
    const { Q } = load();
    const r = Q.plan({ platform: PLATFORM, key: KEY, settings: { ttsAutoPlay: true } });
    ok(!('ttsAutoPlay' in r.writes), '「缺失=从没选过」才写；显式设过 true 就是选择');
  });

  test('转写半配（engine 已选、key 为空）：仍然不覆盖 —— 录音去处是用户碰过的东西', () => {
    const { Q } = load();
    const r = Q.plan({ platform: PLATFORM, key: KEY, settings: { sttEngine: 'local', sttApiKey: '' } });
    ok(!Object.keys(r.writes).some((k) => /^stt/.test(k)), '不许覆盖转写组');
  });

  test('notes 四键在任何输入下都不出现', () => {
    const { Q } = load();
    for (const s of [{}, { apiKey: 'x' }, { notesProvider: 'deepseek' }, { ttsApiKey: 'y', sttEngine: 'local' }]) {
      const r = Q.plan({ platform: PLATFORM, key: KEY, settings: s });
      ok(!Object.keys(r.writes).some((k) => /^notes/.test(k)),
        'notesProvider==="" 的语义就是「跟随翻译」，写了会永久打断 follow 关系');
    }
  });

  test('展开修改过的模型/音色/条目，写进 writes', () => {
    const { Q } = load();
    const r = Q.plan({
      platform: PLATFORM, key: KEY, settings: {},
      pick: { chatModel: 'anthropic/claude-x', ttsEngine: 'openrouter_audio', ttsModel: 'openai/gpt-audio-mini', ttsVoice: 'alloy', sttModel: 'openai/whisper-1' },
    });
    eq(r.writes.apiModel, 'anthropic/claude-x', '');
    eq(r.writes.ttsEngine, 'openrouter_audio', '');
    eq(r.writes.ttsVoice, 'alloy', '');
    eq(r.writes.sttModel, 'openai/whisper-1', '');
  });

  test('没有 key 就什么都不写', () => {
    const { Q } = load();
    deepEq(Q.plan({ platform: PLATFORM, key: '   ', settings: {} }).writes, {}, '');
  });
});

describe('QuickSetup — 写的每个键都必须是 saveAll() 读得回来的', () => {
  test('writes 的键 ⊆ options.js 的 SETTINGS_KEYS', () => {
    // 不在 SETTINGS_KEYS 里的键，saveAll() 读不回来，下次任何字段变更就会把它清掉。
    // 静默，且必然 —— 所以这条断言直接从出货代码里抽那张表，而不是抄一份。
    const src = fs.readFileSync(path.join(ROOT, 'extension/options/options.js'), 'utf8');
    const m = /const SETTINGS_KEYS = \[([\s\S]*?)\];/.exec(src);
    ok(m, '在 options.js 里找不到 SETTINGS_KEYS —— 它改名了？这条断言就空过了');
    // 先剥行注释再抽引号。第一版没剥，被注释里的 `engine's` 那个撇号骗了：它开启
    // 一个假字符串，把 stt 那四个键整段吃掉，于是断言以一个**错误的理由**变红。
    // 一条会因为解析失误而红/绿的断言，和没有这条断言一样不可信。
    const body = m[1].split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    const known = new Set((body.match(/'([A-Za-z][A-Za-z0-9_]*)'/g) || []).map((x) => x.slice(1, -1)));
    ok(known.size >= 30, `只抽到 ${known.size} 个键 —— 抽取本身坏了，这条断言就空过了`);
    const { Q } = load();
    const r = Q.plan({ platform: PLATFORM, key: KEY, settings: {} });
    for (const k of Object.keys(r.writes)) {
      ok(known.has(k), `写了一个 SETTINGS_KEYS 里没有的键：${k}`);
    }
  });
});

describe('QuickSetup.summarize', () => {
  test('三成 → ok', () => {
    const { Q } = load();
    deepEq(Q.summarize([{ slot: 'chat', ok: true }, { slot: 'tts', ok: true }, { slot: 'stt', ok: true }]),
      { done: 3, failed: [], ok: true }, '');
  });
  test('一败 → 点名是哪一样，且 ok 为 false', () => {
    const { Q } = load();
    const s = Q.summarize([{ slot: 'chat', ok: true }, { slot: 'tts', ok: false }, { slot: 'stt', ok: true }]);
    deepEq(s.failed, ['tts'], '标题要说「其中 1 样没通：朗读」，不能说「部分成功」');
    eq(s.ok, false, '');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveAll 的存在性断言
//
// options.js 的 saveAll() 是整体覆盖式的，按字面量读 28 个控件、零 null 保护。
// 少一个元素就在 null 上抛，而所有调用点都是无 catch 的 `await saveAll()` ——
// 于是每次保存都静默什么都不存，且 smoke 里「一键配置扛住整体覆盖」那条断言会
// 因为「什么都没写」而变绿。
//
// 那道断言本身在 smoke 里够不着（saveAll 读的每张卡，smoke 或 applyQuickSetup
// 都会更早碰到并先抛）。所以这里守的是它的**前提**：SAVE_FIELDS 必须与 saveAll
// 的函数体逐个对得上。漂了，断言就会漏掉真正缺的那个元素 —— 一道漏检的断言比
// 没有断言更坏，因为它让人以为有人在看着。
// ─────────────────────────────────────────────────────────────────────────────
describe('options.saveAll — 存在性断言不许与函数体漂开', () => {
  const src = () => fs.readFileSync(path.join(ROOT, 'extension/options/options.js'), 'utf8');

  test('SAVE_FIELDS 恰好等于 saveAll 里读到的元素集合', () => {
    const s = src();
    const m = /const SAVE_FIELDS = \[([\s\S]*?)\];/.exec(s);
    ok(m, '找不到 SAVE_FIELDS —— 它改名了？这条断言就空过了');
    const declared = new Set((m[1].match(/'([a-z0-9-]+)'/g) || []).map((x) => x.slice(1, -1)));
    ok(declared.size >= 20, `只抽到 ${declared.size} 个 —— 抽取本身坏了`);

    const i = s.indexOf('async function saveAll() {');
    ok(i > 0, '找不到 saveAll');
    const j = s.indexOf('\n}', i);
    const body = s.slice(i, j);
    const used = new Set((body.match(/\$\('([a-z0-9-]+)'\)/g) || [])
      .map((x) => x.slice(3, -2)));

    for (const id of used) ok(declared.has(id), `saveAll 读了 ${id}，但 SAVE_FIELDS 没有它 —— 断言会漏掉它`);
    for (const id of declared) ok(used.has(id), `SAVE_FIELDS 有 ${id}，但 saveAll 不读它 —— 多余的断言会在无害的重构上误报`);
  });

  test('saveAll 第一行就是那道断言 —— 放在读值之后等于没放', () => {
    const s = src();
    const i = s.indexOf('async function saveAll() {');
    const head = s.slice(i, i + 200);
    ok(/assertSaveFields\(\);/.test(head), 'saveAll 开头没有 assertSaveFields()');
    ok(head.indexOf('assertSaveFields()') < head.indexOf("$('"), '断言必须在第一次读元素之前');
  });

  test('这张页面不许 remove() 任何 section（sync-section 是唯一例外）', () => {
    // sync-section 安全只因为它一个字段都不进 saveAll。照抄到别的卡上就是静默清零。
    const s = src();
    const removes = (s.match(/\$\('([a-z0-9-]+)'\)\.remove\(\)/g) || []);
    for (const r of removes) {
      ok(/sync-section/.test(r), `发现 ${r} —— 收起一张卡要用 hidden，remove() 会让 saveAll 每次都静默失败`);
    }
  });
});
