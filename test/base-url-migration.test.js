// test/base-url-migration.test.js — 端点一次性迁移 (#147).
//
// 这次改动只有一个动作会**不可逆地重写用户已经有的数据**：把存着的 base URL 补成完整
// 端点。所以这份测试守的是三件事，按严重度排：
//
//   1. **迁移与不迁移，出网地址必须完全一样。** 迁移只是把「每次请求算一遍」变成
//      「存起来」；两条路径算出不同结果，就意味着升级悄悄改变了用户的出网目标。
//   2. **空值永不写入。** 空 =「跟随注册表默认」。把今天的默认主机冻进存储，会同时废掉
//      verification-spec 的调试配方（改 .gen.js 的默认值 + 地址留空）和未来换默认端点
//      的能力。绝大多数用户四个键都是空的，这一条把他们整批摘出迁移范围。
//   3. **折叠等价性。** 注册表把 defaultBase + path 合成了 defaultEndpoint，而折叠前
//      `/v1/chat/completions` 被 5 个条目共用（写错会同时炸一片），折叠后每条是独立
//      字面量，且 qwen 与 kimi 从来一条 URL 断言都没有。

const { describe, test, ok, eq, deepEq } = require('./harness');
const LEGACY_SRC = require('../build/legacy-endpoints.config.js');

// 运行时从 window.MT_LEGACY_ENDPOINTS 懒读（build.js 按 flavor 过滤后 emit 进
// providers.gen.js）。Node 里没有 window，测试自己装一个，喂的是构建源本身。
global.window = global.window || {};
global.window.MT_LEGACY_ENDPOINTS = {
  paths: LEGACY_SRC.paths, stripsSlash: LEGACY_SRC.stripsSlash, keyPairs: LEGACY_SRC.keyPairs,
};
const WF = require('../extension/content/wire-format.js');

describe('迁移 — 冻结表的完整性', () => {
  test('每一个当年有 path 的注册表条目都在表里', () => {
    // 漏掉一个条目 = 那批用户的地址永远不迁移，而设置页会显示一个半截地址。
    for (const p of require('../build/providers.config.js')) {
      if (p.type === 'google') continue;                 // 当年就没有 path
      ok(LEGACY_SRC.paths.chat[p.id], `providers 条目 ${p.id} 不在冻结表里`);
    }
    for (const [file, cap] of [['tts.config.js', 'tts'], ['stt.config.js', 'stt']]) {
      for (const e of require('../build/' + file)) {
        if (e.type === 'browser') continue;              // 不说 HTTP
        ok(LEGACY_SRC.paths[cap][e.id], `${cap} 条目 ${e.id} 不在冻结表里`);
      }
    }
  });

  test('四个地址键各有一条配对规则，且能力名都认识', () => {
    const keys = LEGACY_SRC.keyPairs.map((p) => p[0]);
    deepEq(keys.slice().sort(), ['apiBaseUrl', 'notesBaseUrl', 'sttBaseUrl', 'ttsBaseUrl']);
    for (const pair of LEGACY_SRC.keyPairs) {
      const cap = pair[2];
      ok(LEGACY_SRC.paths[cap], `配对规则指向了不存在的能力 ${cap}`);
      ok(cap in LEGACY_SRC.stripsSlash, `能力 ${cap} 没有尾斜杠策略`);
    }
  });

  test('中国包不含任何品牌词的引擎 id —— 这正是它必须按 flavor 过滤的原因', () => {
    // 表的键名是引擎 id，其中四个本身就是品牌词。写死进出货文件会被合规门逐行扫到。
    const FORBIDDEN = /ChatGPT|OpenAI|\bClaude\b/i;
    const chinaIds = new Set();
    for (const f of ['providers.config.js', 'tts.config.js', 'stt.config.js']) {
      for (const e of require('../build/' + f)) if (e.flavors.includes('china')) chinaIds.add(e.id);
    }
    for (const cap of Object.keys(LEGACY_SRC.paths)) {
      for (const id of Object.keys(LEGACY_SRC.paths[cap])) {
        if (!chinaIds.has(id)) continue;                 // global-only，会被 build 过滤掉
        ok(!FORBIDDEN.test(id), `${cap}/${id} 会随中国包出货并触发合规门`);
      }
    }
  });
});

describe('迁移 — migrateStored 的纯逻辑', () => {
  const cases = [
    // [stored, id, cap, expected]
    ['https://api.deepseek.com', 'deepseek', 'chat', 'https://api.deepseek.com/v1/chat/completions'],
    ['https://myproxy.example/openai', 'custom_chat', 'chat', 'https://myproxy.example/openai/v1/chat/completions'],
    // 对话链路当年不裁尾斜杠 —— 那个 `//` 正是这批用户今天在跑的东西。
    ['https://p.example/', 'deepseek', 'chat', 'https://p.example//v1/chat/completions'],
    // 语音/转写当年裁。
    ['http://127.0.0.1:8880/', 'local', 'tts', 'http://127.0.0.1:8880/v1/audio/speech'],
    ['http://127.0.0.1:18790///', 'local', 'stt', 'http://127.0.0.1:18790/v1/audio/transcriptions'],
    ['https://open.bigmodel.cn', 'glm', 'chat', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
    // 空 / 未知 id / 已迁移 ⇒ null（什么都不做）
    ['', 'deepseek', 'chat', null],
    ['   ', 'deepseek', 'chat', null],
    [undefined, 'deepseek', 'chat', null],
    ['https://x.example', 'no_such_engine', 'chat', null],
    ['https://x.example', undefined, 'chat', null],
    ['https://api.deepseek.com/v1/chat/completions', 'deepseek', 'chat', null],
  ];

  test('逐格', () => {
    for (const c of cases) {
      eq(WF.migrateStored(c[0], c[1], c[2]), c[3], `${c[2]}/${c[1]} · ${JSON.stringify(c[0])}`);
    }
  });

  test('迁移结果 === legacy 分支的结果 —— 迁不迁移，出网地址都一样', () => {
    for (const c of cases) {
      if (c[3] === null) continue;
      const viaLegacy = WF.resolveEndpoint(c[0], { id: c[1], defaultEndpoint: null }, { cap: c[2] });
      eq(WF.migrateStored(c[0], c[1], c[2]), viaLegacy, `${c[2]}/${c[1]} · ${c[0]}`);
    }
  });
});

describe('迁移 — migrationPatch 的落地行为', () => {
  const seeded = {
    provider: 'deepseek', apiBaseUrl: 'https://myproxy.example',
    ttsEngine: 'local', ttsBaseUrl: 'http://127.0.0.1:8880/',
    sttEngine: 'local', sttBaseUrl: 'http://127.0.0.1:18790',
  };

  test('非空地址被补全，原值被备份，戳被写下 —— 全在一个补丁里', () => {
    const patch = WF.migrationPatch(seeded);
    eq(patch.apiBaseUrl, 'https://myproxy.example/v1/chat/completions');
    eq(patch.apiBaseUrlPreVerbatim, 'https://myproxy.example', '原值必须留一份 —— 这是唯一不可逆的写');
    eq(patch.apiBaseUrlVerbatim, true);
    eq(patch.ttsBaseUrl, 'http://127.0.0.1:8880/v1/audio/speech');
    eq(patch.sttBaseUrl, 'http://127.0.0.1:18790/v1/audio/transcriptions');
    // 一个补丁 = 一次写入。分两次写，中间被杀就会留下「改了但没备份」的状态。
    eq(Object.keys(patch).length, 9, '应当只有三组 值/备份/戳');
  });

  test('空地址一个字都不碰 —— 绝大多数用户属于这一类', () => {
    deepEq(WF.migrationPatch({ provider: 'deepseek', ttsEngine: 'browser' }), {},
      '空值被写成了默认主机 —— 调试配方与未来换端点都会被这一步毁掉');
    deepEq(WF.migrationPatch({}), {});
    deepEq(WF.migrationPatch(null), {});
  });

  test('幂等：把补丁应用回去之后，再算一次是空的', () => {
    const once = Object.assign({}, seeded, WF.migrationPatch(seeded));
    deepEq(WF.migrationPatch(once), {}, '第二次迁移把路径又接了一遍');
  });

  test('未知引擎 id 的地址不动 —— 我们不知道当年会给它接什么', () => {
    deepEq(WF.migrationPatch({ provider: 'gone_provider', apiBaseUrl: 'https://x.example' }), {});
  });

  test('notesProvider 为空时 notesBaseUrl 不动 —— 那时它根本不参与解析配置', () => {
    // notes.js 的 resolveConfig：notesProvider 空 ⇒ 整组跟随翻译引擎，notesBaseUrl 不读。
    // 无从判断它当年属于哪个条目，所以不猜。
    const patch = WF.migrationPatch({ notesBaseUrl: 'https://n.example', provider: 'deepseek' });
    eq(patch.notesBaseUrl, undefined);
  });
});

// ─── 折叠等价性 ────────────────────────────────────────────────────────────
//
// 下面这张 base 表是 2026-08 折叠**之前**注册表里的原值，冻结在这里当 oracle。它和
// 冻结的 path 表合起来，机械地证明每一条折叠都逐字节等于当年实际发出的地址。
// 规矩同冻结 path 表：只增不改，新条目不进来（新条目没有「折叠之前」）。
const LEGACY_BASES_2026_08 = {
  // 当年既没有 defaultBase 也没有 path —— 端点带 query、调用时才拼出来。
  google: { global: null },
  openai: { global: 'https://api.openai.com' },
  claude: { global: 'https://api.anthropic.com' },
  deepseek: { global: 'https://api.deepseek.com', china: 'https://api.deepseek.com' },
  glm: { china: 'https://open.bigmodel.cn', global: 'https://api.z.ai' },
  // 这一条是最容易算错的：base 本身就带路径段。
  qwen: {
    china: 'https://dashscope.aliyuncs.com/compatible-mode',
    global: 'https://dashscope-intl.aliyuncs.com/compatible-mode',
  },
  kimi: { china: 'https://api.moonshot.cn', global: 'https://api.moonshot.ai' },
  custom_chat: { china: null, global: null },
  custom_msg: { china: null, global: null },
};
const LEGACY_BASES_TTS_2026_08 = {
  browser: { china: null, global: null },
  local: { china: null, global: null },
  openai_speech: { global: 'https://api.openai.com' },
};
const LEGACY_BASES_STT_2026_08 = {
  local: { china: null, global: null },
  openai_transcribe: { global: 'https://api.openai.com' },
};

describe('折叠等价性 — defaultEndpoint 必须逐字节等于当年的 base + path', () => {
  const CASES = [
    ['providers', require('../build/providers.config.js'), LEGACY_BASES_2026_08, 'chat'],
    ['tts', require('../build/tts.config.js'), LEGACY_BASES_TTS_2026_08, 'tts'],
    ['stt', require('../build/stt.config.js'), LEGACY_BASES_STT_2026_08, 'stt'],
  ];

  test('每个条目、每个 flavor', () => {
    let checked = 0;
    for (const row of CASES) {
      const name = row[0], entries = row[1], bases = row[2], cap = row[3];
      for (const e of entries) {
        const oldBases = bases[e.id];
        ok(oldBases, `${name}/${e.id} 不在冻结的 base 表里 —— 新条目请勿加入，老条目不该消失`);
        const path = LEGACY_SRC.paths[cap] && LEGACY_SRC.paths[cap][e.id];
        for (const f of e.flavors) {
          const got = (e.defaultEndpoint && typeof e.defaultEndpoint === 'object')
            ? e.defaultEndpoint[f] : e.defaultEndpoint;
          const base = oldBases[f];
          // 当年没有 base（用户自填）或没有 path（google/browser）⇒ 现在必须是 null。
          const want = (base == null || !path) ? null : base + path;
          eq(got == null ? null : got, want, `${name}/${e.id} (${f})`);
          checked++;
        }
      }
    }
    ok(checked >= 20, `只比对了 ${checked} 格 —— 注册表是不是被裁过？`);
  });
});
