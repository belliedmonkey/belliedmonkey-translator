// test/quick-setup.test.js — 「一把 key 配好全部」的判据（QuickSetup）。
//
// 这个模块的价值几乎全在**它不写什么**上：写多一个键，设置页的保存路径读不回来，
// 下次任何字段变更就会把它清掉 —— 静默且必然。所以这里的断言大量是 deepEq 整个
// writes，而不是「包含某个键」。
//
// 分组那一组**对真实产物跑**，不是手写 fixture：dist/ 与 dist-china/ 的 *.gen.js 才是
// 用户手上的那份表，而 build/*.config.js 是作者视角（同一个 qwen 在两个 flavor 里
// 指向不同的 host）。

const fs = require('fs');
const path = require('path');
const { loadModule, loadSrc, describe, test, ok, eq, deepEq } = require('./harness');
const { stripComments, stripJsx } = require('./lib/strip-comments');

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

describe('QuickSetup.prefill — 已经配过的 key 要在快速卡上回显', () => {
  // 2026-09-07 用户报：详细里有 key，快速里空着。翻译是 DeepSeek（不在一键清单）、转写是
  // OpenAI 时 represents 为 null，而 App 那边原来根本没传 prefill。回显的判据比 represents
  // 宽：三样里只要有一样配在可一键的平台上，就把那把 key 回显出来。
  const REG = (() => { const d = fromDist('dist'); return d ? d : null; })();
  test('翻译在一键平台上 ⇒ 回翻译那把 key（slot chat）', () => {
    if (!REG) return ok(true, '（dist/ 不存在，跳过）');
    const p = REG.Q.prefill({ provider: 'openrouter', apiKey: 'k1', sttEngine: 'openai_transcribe', sttApiKey: 'k3' });
    ok(p && p.host === 'openrouter.ai' && p.key === 'k1' && p.slot === 'chat', JSON.stringify(p));
  });
  test('翻译不在一键平台、转写在 ⇒ 回转写那把 key（slot stt）', () => {
    if (!REG) return ok(true, '（dist/ 不存在，跳过）');
    const p = REG.Q.prefill({ provider: 'deepseek', apiKey: 'k1', sttEngine: 'openai_transcribe', sttApiKey: 'k3' });
    ok(p && p.host === 'api.openai.com' && p.key === 'k3' && p.slot === 'stt', JSON.stringify(p));
  });
  test('三样都不在一键平台上 ⇒ null（卡空着是真话）', () => {
    if (!REG) return ok(true, '（dist/ 不存在，跳过）');
    eq(REG.Q.prefill({ provider: 'deepseek', apiKey: 'k1' }), null, '');
    eq(REG.Q.prefill({}), null, '');
  });
});

describe('QuickSetup.represents — 这份已存配置，一键卡表示得了吗', () => {
  // 它决定设置页默认落在哪个 tab。判错的代价不对称：判成「表示得了」而其实表示不了，
  // 用户会对着一张空卡以为自己没配过，而他此刻唯一能做的动作（粘一把新 key）会覆盖
  // 掉现有配置。所以「没配过」和「表示不了」都必须回 null。
  const REG = (() => {
    const d = fromDist('dist');
    return d ? d : null;
  })();

  test('没配过（apiKey 空）⇒ null，谈不上表示不表示', () => {
    if (!REG) return ok(true, '（dist/ 不存在，跳过）');
    eq(REG.Q.represents({ provider: 'openrouter', apiKey: '' }), null, '');
    eq(REG.Q.represents({}), null, '');
    eq(REG.Q.represents(null), null, '');
  });

  test('用一键平台的引擎配的 ⇒ 回那个平台（设置页据此预选 + 回显 key）', () => {
    if (!REG) return ok(true, '（dist/ 不存在，跳过）');
    const p = REG.Q.represents({ provider: 'openrouter', apiKey: 'sk-x' });
    ok(p && p.host === 'openrouter.ai', '应当回 openrouter.ai 那一组，实际 ' + JSON.stringify(p && p.host));
  });

  test('用不在一键清单里的引擎配的 ⇒ null（设置页要默认落在详细）', () => {
    if (!REG) return ok(true, '（dist/ 不存在，跳过）');
    eq(REG.Q.represents({ provider: 'deepseek', apiKey: 'sk-x' }), null,
      'DeepSeek 不在任何一键平台里 —— 快速视图没有一个控件能显示这份配置');
  });

  // #421 方案 C 之后这一条**反过来了**：卡上有了地址框，用自定义端点配好的人
  // 两格都显示得出来，于是设置页可以落在「快速」，不必把他赶去「详细」。
  test('用自定义端点配好的 ⇒ 表示得了（地址随 prefill 一起回显）', () => {
    if (!REG) return ok(true, '（dist/ 不存在，跳过）');
    const url = 'https://gw.example.internal/v1/chat/completions';
    const rep = REG.Q.represents({ provider: 'custom_chat', apiKey: 'sk-x', apiBaseUrl: url });
    ok(rep && rep.custom, '自定义那一项应当认得出这份配置，实际 ' + JSON.stringify(rep && rep.host));
    const pre = REG.Q.prefill({ provider: 'custom_chat', apiKey: 'sk-x', apiBaseUrl: url });
    ok(pre && pre.custom && pre.key === 'sk-x' && pre.baseUrl === url,
      '回显要带上地址 —— 少了它，卡看起来像「配好了」而那一格是空的：' + JSON.stringify(pre));
  });

  test('朗读/转写用别的平台不影响判据 —— 只看翻译那一路', () => {
    if (!REG) return ok(true, '（dist/ 不存在，跳过）');
    const p = REG.Q.represents({ provider: 'openrouter', apiKey: 'sk-x',
      ttsEngine: 'openai_speech', ttsApiKey: 'sk-other' });
    ok(p && p.host === 'openrouter.ai',
      '一键卡自己也允许只配其中一样，不该因为朗读用了别家就把人赶去详细页');
  });
});

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
      // 自定义那一项（#421 C）没有「去哪儿申请」可言：地址和 key 都来自用户自己的
      // 服务，给一个第三方控制台的链接才是错的。渲染器对没有 keyUrl 的平台隐藏那一行。
      const list = d.Q.platforms().filter((p) => !p.custom);
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
    // 同上：自定义那一项不参与推导，这条断言守的是推导出来的那几组。
    const hosts = d.Q.platforms().filter((p) => !p.custom).map((p) => p.host);
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
    // 推导出来的组**恰好一组**；自定义那一项（#421 C）不参与推导，单独排在末尾。
    const hosts = d.Q.platforms().filter((p) => !p.custom).map((p) => p.host);
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
    // 原来这里断言另一条会出现在 p.alt 里「供展开修改时换」。展开修改没有了，alt
    // 也就没有了消费者，一并删掉 —— 留着的话它是一份永远不会被读的数据。
  });

  test('推导出来的组里不含 needsKey:false 或 requiresEndpoint 的条目', () => {
    for (const dir of ['dist', 'dist-china']) {
      const d = fromDist(dir);
      if (!d) continue;
      // 自定义那一项（#421 C）**故意**是 requiresEndpoint 的 —— 它不走推导，
      // 单独加在末尾，承诺的也只有翻译一样。这条断言守的是推导那一段。
      for (const p of d.Q.platforms().filter((x) => !x.custom)) {
        for (const e of [p.chat, p.tts, p.stt]) {
          eq(e.needsKey, true, `${dir} ${e.id} needsKey`);
          ok(!e.requiresEndpoint, `${dir} ${e.id} 不该是自填端点条目`);
        }
        ok(d.Q.consistent(p), `${dir} ${p.host} 组内 needsKey 必须一致 —— 不一致说明这个 host 上不是一把 key 通吃`);
      }
    }
    ok(true, '');
  });

  // ── 自定义那一项（#421 方案 C）────────────────────────────────────────
  test('两个 flavor 都有「自定义」，且**排在最后**（推导出来的平台先来）', () => {
    for (const dir of ['dist', 'dist-china']) {
      const d = fromDist(dir);
      if (!d) continue;
      const list = d.Q.platforms();
      const customs = list.filter((x) => x.custom);
      eq(customs.length, 1, `${dir} 自定义应当恰好一项`);
      eq(list[list.length - 1].custom, true, `${dir} 自定义应当排在最后`);
      ok(customs[0].chat.requiresEndpoint, `${dir} 自定义那一条必须是自填端点的引擎`);
      ok(!customs[0].tts && !customs[0].stt, `${dir} 自定义只承诺翻译，不该带朗读 / 转写`);
      ok(d.Q.consistent(customs[0]), `${dir} 自定义那一项的自检应当通过`);
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
};
const KEY = 'sk-or-v1-test';
const CUSTOM = {
  host: '', custom: true,
  chat: { id: 'custom_chat', needsKey: true, requiresEndpoint: true, defaultEndpoint: null },
  tts: null, stt: null,
};

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

  // #421 方案 C：自定义平台只配翻译，而且地址是构成要件。
  test('自定义平台：地址写进 apiBaseUrl，朗读 / 转写记成 absent、一个键都不写', () => {
    const { Q } = load();
    const url = 'https://gw.example.internal/v1/chat/completions';
    const r = Q.plan({ platform: CUSTOM, key: KEY, settings: {}, baseUrl: url });
    deepEq(r.writes, { provider: 'custom_chat', apiKey: KEY, apiBaseUrl: url, apiModel: '' },
      '自定义平台只写翻译那一组，且地址是用户填的那一条');
    deepEq(r.tests, ['chat'], '只测翻译 —— 它也只承诺了翻译');
    deepEq(r.skipped.map((x) => x.slot + ':' + x.reason).sort(), ['stt:absent', 'tts:absent'],
      '缺的两样要记成 absent（「这个地址不提供」），不是「你已经配过了」');
  });

  test('自定义平台缺地址：什么都不写、什么都不测 —— 没有端点的 requiresEndpoint 引擎运行时是死的', () => {
    const { Q } = load();
    const r = Q.plan({ platform: CUSTOM, key: KEY, settings: {} });
    deepEq(r.writes, {}, '缺地址就不许写 provider/key —— 否则卡上说「配好了」，实际配了个空端点');
    deepEq(r.tests, [], '也不该测');
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

  // 原来这里有一条「展开修改过的模型/音色，写进 writes」。那个入口 2026-08-31 去掉了
  // （与手动引擎配置重复），plan() 随之不再吃 pick —— 一个没有调用方的参数留着就是
  // 没人消费的灵活性。下面这条接替它：**永远写注册表默认**。
  test('模型/音色一律写空 —— 空 = 走注册表默认，那是有实测依据的那一个', () => {
    const { Q } = load();
    const r = Q.plan({ platform: PLATFORM, key: KEY, settings: {} });
    eq(r.writes.apiModel, '', '');
    eq(r.writes.ttsModel, '', '');
    eq(r.writes.ttsVoice, '', '');
    eq(r.writes.sttModel, '', '');
    eq(r.writes.ttsEngine, PLATFORM.tts.id, '取该 host 的注册表第一条');
    eq(r.writes.sttEngine, PLATFORM.stt.id, '取该 host 的注册表第一条');
  });

  test('没有 key 就什么都不写', () => {
    const { Q } = load();
    deepEq(Q.plan({ platform: PLATFORM, key: '   ', settings: {} }).writes, {}, '');
  });
});

describe('QuickSetup — 写的每个键都必须是设置页保存路径读得回来的', () => {
  test('writes 的键 ⊆ OptionsModel.SAVE_KEYS', () => {
    // 不在键域里的键，写下去也留不住，下次任何字段变更就会把它清掉。
    // 静默，且必然 —— 所以这条断言直接读那张表，而不是抄一份。
    // （原锚点是 options.js 的 SETTINGS_KEYS；PR5 起由 SAVE_KEYS 接任，它与
    // schema 的对账在 test/options-model.test.js。）
    const { OptionsModel } = loadSrc('src/pages/options-model.js', 'OptionsModel');
    const known = new Set(OptionsModel.SAVE_KEYS);
    ok(known.size >= 30, `只抽到 ${known.size} 个键 —— 键域本身坏了，这条断言就空过了`);
    const { Q } = load();
    const r = Q.plan({ platform: PLATFORM, key: KEY, settings: {} });
    for (const k of Object.keys(r.writes)) {
      ok(known.has(k), `写了一个键域里没有的键：${k}`);
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
// saveNow 的存在性断言
//
// 旧世界的 saveAll() 是整体覆盖式的，按字面量读 28 个控件、零 null 保护：少一个
// 元素就在 null 上抛，而调用点全是无 catch 的 await —— 于是每次保存都静默什么都不
// 存。React 版没有这个失效类：页面 state 即镜像，saveNow 只把防抖窗口里的 patch
// 与六个不受控框收割成 patch，按 SAVE_KEYS 过滤后走 setMany。这里守它的**前提**：
// 键域过滤长在函数体里、过滤先于落盘；旧标识符不许回来。
// 动态行为（先 saveNow 落盘、一键卡才现读）归 scripts/verify-extension-smoke.js。
// ─────────────────────────────────────────────────────────────────────────────
describe('options.saveNow — 保存路径的前提不许漂', () => {
  const src = () => stripComments(fs.readFileSync(path.join(ROOT, 'src/pages/options.jsx'), 'utf8'));

  test('旧世界的四个标识符一个都不许回来', () => {
    const s = src();
    for (const id of ['saveAll', 'SAVE_FIELDS', 'assertSaveFields', 'SETTINGS_KEYS']) {
      ok(!s.includes(id), `${id} 在 options.jsx 里复活了 —— 整体覆盖式保存的失效类跟着回来`);
    }
  });

  test('saveNow 按键域过滤、过滤先于 setMany', () => {
    const s = src();
    const i = s.indexOf('const saveNow = async () => {');
    ok(i > 0, '找不到 saveNow —— 保存路径被改名了？这条断言就空过了');
    const j = s.indexOf('\n  };', i);
    ok(j > i, 'saveNow 的函数体截不出来 —— 缩进变了？');
    const body = s.slice(i, j);
    const f = body.indexOf('for (const k of SAVE_KEYS)');
    const m = body.indexOf('SettingsStore.setMany(');
    ok(f >= 0, 'saveNow 不再按 SAVE_KEYS 过滤 —— 键域外的键会混进 setMany 被整单拒绝，一次保存全灭');
    ok(m >= 0, 'saveNow 不走 SettingsStore.setMany 落盘了 —— 它是谁的后继？');
    ok(f < m, '键域过滤发生在落盘之后 —— 等于没滤');
  });

  test('这张页面不许手动 remove() 节点（收起一张卡走 hidden；sync-section 走条件渲染）', () => {
    // 旧判据是 $().remove()。React 里同族的破坏是手动 DOM 摘除 —— 绕开渲染、
    // 留下悬空 state；卸载一律走声明式路径。stripJsx 先把 JSX 注释抹掉 ——
    // 注释里提到的 sec.remove() 字样不算数，代码里真调才算。
    const removes = (stripJsx(fs.readFileSync(path.join(ROOT, 'src/pages/options.jsx'), 'utf8')).js.match(/\.remove\(\)/g) || []);
    eq(removes.length, 0, 'options.jsx 里有手动 .remove() —— 摘除节点要走渲染，不许绕过 React');
  });
});
