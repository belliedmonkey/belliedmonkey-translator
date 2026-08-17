// test/base-url-migration.test.js — 端点一次性迁移 (#147).
//
// 这次改动只有一个动作会**不可逆地重写用户已经有的数据**：把存着的 base URL 补成完整
// 端点。所以这份测试守的是三件事，按严重度排：
//
//   1. **两个宿主行为一致。** 扩展的 service worker 是 `type: module`，既不能
//      importScripts 也不能 import 那个写 window 的 IIFE，所以 background.js 里有一份
//      冻结表的字面量副本。副本会漂移——除非有人把它钉死。这里钉死。
//   2. **空值永不写入。** 空 =「跟随注册表默认」。把今天的默认主机冻进存储，会同时废掉
//      verification-spec 里那条调试配方（改 .gen.js 的默认值 + 地址留空）和未来换默认
//      端点的能力。绝大多数用户四个键都是空的，这一条把他们整批摘出迁移范围。
//   3. **幂等 + 不越界。** 重复的 'update' 事件、未知的引擎 id、已经迁移过的值，都必须
//      是 no-op。

const { describe, test, ok, eq, deepEq } = require('./harness');
const { loadModule } = require('./harness');
const { makeChrome } = require('./stubs');
const WF = require('../extension/content/wire-format.js');

// background.js 顶层就注册 onInstalled，直接 require 会在 Node 里炸 —— 用 vm 载入，
// 并塞一个 `module` 进去让它自己的导出守卫生效。
function loadBackground(store = {}) {
  const chrome = makeChrome({ store });
  const installed = [];
  chrome.runtime.onInstalled = { addListener: (fn) => installed.push(fn) };
  chrome.runtime.onMessage = { addListener: () => {} };
  chrome.action = { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} };
  const mod = { exports: {} };
  const ctx = loadModule('./background.js', { chrome, module: mod });
  return { api: mod.exports, fire: (d) => installed[0](d), store: chrome._store, ctx };
}

describe('迁移 — 两个宿主的冻结表必须逐字节相同', () => {
  test('background.js 的副本 === WireFormat.LEGACY_PATHS', () => {
    const { api } = loadBackground();
    // 副本存在本身也要断言：字段被悄悄删掉时，deepEq(undefined, undefined) 会通过。
    ok(api.LEGACY_ENDPOINTS_2026_08, 'background.js 没有导出冻结表');
    deepEq(api.LEGACY_ENDPOINTS_2026_08, WF.LEGACY_PATHS,
      '两个宿主的历史快照漂移了 —— App 与扩展会把同一个存值迁成不同的地址');
    deepEq(api.LEGACY_STRIPS_SLASH_2026_08, WF.LEGACY_STRIPS_SLASH,
      '尾斜杠策略漂移了 —— 一个宿主保留 //，另一个裁掉');
  });

  test('冻结表覆盖了每一个当年有 path 的注册表条目', () => {
    // 漏掉一个条目 = 那批用户的地址永远不迁移，而新代码会逐字使用一个半截地址。
    const P = require('../build/providers.config.js');
    for (const p of P) {
      if (p.type === 'google') continue;                 // 当年就没有 path
      ok(WF.LEGACY_PATHS.chat[p.id], `providers 条目 ${p.id} 不在冻结表里`);
    }
    for (const [file, cap] of [['tts.config.js', 'tts'], ['stt.config.js', 'stt']]) {
      for (const e of require('../build/' + file)) {
        if (e.type === 'browser') continue;              // 不说 HTTP
        ok(WF.LEGACY_PATHS[cap][e.id], `${cap} 条目 ${e.id} 不在冻结表里`);
      }
    }
  });
});

describe('迁移 — migrateEndpoint 的纯逻辑', () => {
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

  test('扩展侧的实现', () => {
    const { api } = loadBackground();
    for (const [stored, id, cap, want] of cases) {
      eq(api.migrateEndpoint(stored, id, cap), want, `${cap}/${id} · ${JSON.stringify(stored)}`);
    }
  });

  test('迁移结果 === legacy 分支的结果 —— 迁不迁移，出网地址都一样', () => {
    // 这条是整份改动的核心不变式：迁移只是把「每次请求时算一遍」变成「存起来」，
    // 它不改变任何地址。两条路径算出不同结果，就意味着升级会改变用户的出网目标。
    const { api } = loadBackground();
    for (const [stored, id, cap, want] of cases) {
      if (want === null) continue;
      const viaLegacy = WF.resolveEndpoint(stored, { id, defaultEndpoint: null }, { cap });
      eq(api.migrateEndpoint(stored, id, cap), viaLegacy, `${cap}/${id} · ${stored}`);
    }
  });
});

describe('迁移 — onInstalled 的落地行为', () => {
  const seeded = {
    provider: 'deepseek', apiBaseUrl: 'https://myproxy.example',
    ttsEngine: 'local', ttsBaseUrl: 'http://127.0.0.1:8880/',
    sttEngine: 'local', sttBaseUrl: 'http://127.0.0.1:18790',
  };

  test('非空地址被补全、原值被备份、戳被写下，全部在一次写入里', () => {
    const { fire, store } = loadBackground(Object.assign({}, seeded));
    fire({ reason: 'update' });
    eq(store.apiBaseUrl, 'https://myproxy.example/v1/chat/completions');
    eq(store.apiBaseUrlPreVerbatim, 'https://myproxy.example', '原值必须留一份 —— 这是唯一不可逆的写');
    eq(store.apiBaseUrlVerbatim, true);
    eq(store.ttsBaseUrl, 'http://127.0.0.1:8880/v1/audio/speech');
    eq(store.sttBaseUrl, 'http://127.0.0.1:18790/v1/audio/transcriptions');
    eq(store.endpointMigrated2026, true);
  });

  test('空地址一个字都不碰 —— 绝大多数用户属于这一类', () => {
    const { fire, store } = loadBackground({ provider: 'deepseek', ttsEngine: 'browser' });
    fire({ reason: 'update' });
    eq(store.apiBaseUrl, '', '空值被写成了默认主机 —— 调试配方与未来换端点都会被这一步毁掉');
    eq(store.apiBaseUrlVerbatim, undefined, '没迁移的字段不该有戳');
    eq(store.apiBaseUrlPreVerbatim, undefined);
    eq(store.endpointMigrated2026, true, '标记仍要落下 —— 这台设备确实已经检查过了');
  });

  test('重复的 update 事件是 no-op（一次性标记）', () => {
    const { fire, store } = loadBackground(Object.assign({}, seeded));
    fire({ reason: 'update' });
    const after = store.apiBaseUrl;
    fire({ reason: 'update' });
    fire({ reason: 'update' });
    eq(store.apiBaseUrl, after, '第二次迁移把路径又接了一遍');
    eq(store.apiBaseUrlPreVerbatim, 'https://myproxy.example', '备份被第二轮覆盖成了已迁移的值');
  });

  test('未知引擎 id 的地址不动 —— 我们不知道当年会给它接什么', () => {
    const { fire, store } = loadBackground({ provider: 'gone_provider', apiBaseUrl: 'https://x.example' });
    fire({ reason: 'update' });
    eq(store.apiBaseUrl, 'https://x.example');
    eq(store.apiBaseUrlVerbatim, undefined);
  });

  test('读失败（Safari 把回调喂 undefined）绝不消耗一次性标记', () => {
    // colorMigrated2026 用 `existing` 而不是 `have` 守卫，理由写在 background.js 里：
    // 我们从没**看见**过真实值，把一次性标记花掉会让这台设备永远错过迁移。
    const chrome = makeChrome({ store: {} });
    const installed = [];
    chrome.runtime.onInstalled = { addListener: (fn) => installed.push(fn) };
    chrome.runtime.onMessage = { addListener: () => {} };
    chrome.action = { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} };
    // Safari 形状：回调收到 undefined。
    chrome.storage.local.get = (keys, cb) => cb(undefined);
    const writes = [];
    chrome.storage.local.set = (items, cb) => { writes.push(items); if (cb) cb(); };
    loadModule('./background.js', { chrome, module: { exports: {} } });
    installed[0]({ reason: 'update' });
    for (const w of writes) {
      eq(w.endpointMigrated2026, undefined, '读失败却把标记花掉了 —— 这台设备再也不会迁移');
    }
  });
});

// ─── 折叠等价性 ────────────────────────────────────────────────────────────
//
// 注册表把 defaultBase + path 合成了 defaultEndpoint。合并之前，`/v1/chat/completions`
// 这个字面量被 5 个条目共用，写错会同时炸掉一片；合并之后每条端点都是独立字面量，而
// translation-api.test.js 从来只断言 openai / deepseek / glm 三条 —— qwen 和 kimi 一条
// URL 断言都没有。也就是说：手写折叠一个字符，`npm test` 全绿，直接上架，用户拿到 404。
//
// 下面这张 base 表是 2026-08 折叠**之前**注册表里的原值，冻结在这里当 oracle。它和上面
// 的 path 表合起来，机械地证明每一条折叠都逐字节等于当年实际发出的地址。
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
    for (const [name, entries, bases, cap] of CASES) {
      for (const e of entries) {
        const oldBases = bases[e.id];
        ok(oldBases, `${name}/${e.id} 不在冻结的 base 表里 —— 新条目请勿加入，老条目不该消失`);
        const path = WF.LEGACY_PATHS[cap] && WF.LEGACY_PATHS[cap][e.id];
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
