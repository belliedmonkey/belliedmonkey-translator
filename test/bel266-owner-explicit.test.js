// test/bel266-owner-explicit.test.js — BEL-266：owner 必须来自显式 vendor。
//
// 这一组**不测「函数被调用了」**：每一方向都经真实的 SettingsStore（测试存储 shim）
// 落盘，然后把四把 owner 与四把 key 的**存储值**读回来对。BEL-257 的教训是
// 「owner 从引擎推」——那种 bug 在单测里看起来一切正常，直到下一次请求被
// key_owner_mismatch 拦下。
//
// 四条迁移（每条断言四把 owner + 四把 key 的终值）：
//   A. grant → 自己的 key（显式 vendor）
//   B. 自己的 key → grant（QuickSetup.plan → App applyQuickSetup）
//   C. vendor A → vendor B（只有显式粘贴才换 key）
//   D. 只换引擎、不动 key（key/owner 一个字节都不许变）
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq, rejects, loadSrc } = require('./harness');

const ROOT = path.join(__dirname, '..');
const M = loadSrc('src/pages/options-model.js', 'OptionsModel').OptionsModel;
const Owner = loadSrc('src/shared/owner.js', 'Owner').Owner;
const Q = loadSrc('src/shared/quick-setup.js', 'QuickSetup').QuickSetup;

const KEY_KEYS = ['apiKey', 'ttsApiKey', 'sttApiKey', 'notesApiKey'];
const OWNER_KEYS = ['apiKeyOwner', 'ttsKeyOwner', 'sttKeyOwner', 'notesKeyOwner'];
const GRANT = 'bmg_test_bel266_1234567890';
const OWN_A = 'sk-test_ownerA_chat';
const OWN_A_TTS = 'sk-test_ownerA_tts';
const OWN_A_STT = 'sk-test_ownerA_stt';
const OWN_A_NOTES = 'sk-test_ownerA_notes';
const OWN_B = 'sk-test_ownerB_chat';

function pick(store, keys) {
  const out = {};
  for (const k of keys) out[k] = store[k];
  return out;
}
const keysOf = (store) => pick(store, KEY_KEYS);
const ownersOf = (store) => pick(store, OWNER_KEYS);

function grantSeed() {
  return {
    apiKey: 'bmg_grant_chat_old', apiKeyOwner: 'grant',
    ttsApiKey: 'bmg_grant_tts_old', ttsKeyOwner: 'grant_speech',
    sttApiKey: 'bmg_grant_stt_old', sttKeyOwner: 'grant_stt',
    notesApiKey: 'bmg_grant_notes_old', notesKeyOwner: 'grant',
    provider: 'grant', ttsEngine: 'grant_speech', sttEngine: 'grant_stt', notesProvider: '',
  };
}
function ownSeed() {
  return {
    apiKey: OWN_A, apiKeyOwner: 'openai',
    ttsApiKey: OWN_A_TTS, ttsKeyOwner: 'openai_speech',
    sttApiKey: OWN_A_STT, sttKeyOwner: 'openai_transcribe',
    notesApiKey: OWN_A_NOTES, notesKeyOwner: 'openai',
    provider: 'openai', ttsEngine: 'openai_speech', sttEngine: 'openai_transcribe', notesProvider: '',
  };
}

// 真 SettingsStore + 测试存储 shim：read/write 都落到 `store`，测试读回同一个对象。
// 不用 register/事件总线，避免把「写入成功」伪装成「订阅者收到了」。
function makeStorage(seed) {
  const store = Object.assign({}, seed || {});
  const writes = [];
  const chrome = {
    i18n: { getUILanguage: () => 'zh-CN', getMessage: () => '' },
    storage: {
      local: {
        get(keys, cb) {
          let out = {};
          if (keys == null) out = Object.assign({}, store);
          else if (typeof keys === 'string') { if (keys in store) out[keys] = store[keys]; }
          else if (Array.isArray(keys)) keys.forEach((k) => { if (k in store) out[k] = store[k]; });
          else Object.keys(keys).forEach((k) => { out[k] = k in store ? store[k] : keys[k]; });
          if (cb) cb(out);
          return Promise.resolve(out);
        },
        set(patch, cb) {
          writes.push(Object.assign({}, patch));
          Object.assign(store, patch);
          if (cb) cb();
          return Promise.resolve();
        },
        remove(keys, cb) {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => { delete store[k]; });
          if (cb) cb();
          return Promise.resolve();
        },
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
    runtime: { lastError: undefined },
  };
  const PageSettings = {
    read: async (keys) => ({ ok: true, data: pick(store, keys) }),
    write: async (patch) => { writes.push(Object.assign({}, patch)); Object.assign(store, patch); return { ok: true }; },
  };
  const ctx = loadSrc('src/store/settings-store.js', 'SettingsStore', { chrome, PageSettings });
  return { store, writes, chrome, S: ctx.SettingsStore };
}

async function initStore(h) {
  const r = await h.S.init(KEY_KEYS.concat(OWNER_KEYS));
  eq(r.ok, true, '测试存储初始化必须成功，否则后面的读回没有意义');
  return h.S;
}

function loadSettingsModel(chrome) {
  const ctx = loadSrc('src/app/settings-model.js', 'SettingsModel', {
    chrome,
    window: {
      MT_PROVIDERS: [], MT_TTS_ENGINES: [], MT_STT_ENGINES: [],
      MT_LANGS: [], MT_I18N_MESSAGES: {},
    },
    EngineState: { needsSetup: () => false, resolve: (p) => String(p || '') },
    LearnGrant: {},
    LearnTTS: { config: {}, configure() {} },
    MTTelemetry: { track() {} },
    console, URL,
  });
  return ctx.SettingsModel;
}

describe('BEL-266 — ownerFor：显式 vendor，绝不由引擎推', () => {
  test('bmg_ 按槽位归 grant 家族（notes 跟 chat）', () => {
    eq(Owner.ownerFor('chat', GRANT, 'openai'), 'grant');
    eq(Owner.ownerFor('notes', GRANT, 'openai'), 'grant');
    eq(Owner.ownerFor('tts', GRANT, 'openai_speech'), 'grant_speech');
    eq(Owner.ownerFor('stt', GRANT, 'openai_transcribe'), 'grant_stt');
  });

  test('非 bmg_：有显式 vendor 就原样用它，没有就是空串', () => {
    eq(Owner.ownerFor('chat', OWN_A, 'qwencloud'), 'qwencloud');
    eq(Owner.ownerFor('tts', OWN_A, 'openai_speech'), 'openai_speech');
    eq(Owner.ownerFor('stt', OWN_A, 'openai_transcribe'), 'openai_transcribe');
    eq(Owner.ownerFor('notes', OWN_A, 'deepseek'), 'deepseek');
    eq(Owner.ownerFor('chat', OWN_A, ''), '');
    eq(Owner.ownerFor('chat', OWN_A, null), '');
    // notes 跟随 chat：调用点给空串 → 空串（不是拿 chat 的 owner 来填）。
    eq(Owner.ownerFor('notes', OWN_A, ''), '');
  });

  test('空 key → 空 owner；bmg_ 的手填仍由 options 拒绝（null）', () => {
    eq(Owner.ownerFor('chat', '', 'qwencloud'), '');
    eq(M.keyOwnerPatch('apiKey', '', 'qwencloud').apiKeyOwner, '');
    eq(M.keyOwnerPatch('apiKey', GRANT, 'qwencloud'), null, '手填令牌必须拒绝，不能写 owner');
    eq(M.keyOwnerPatch('ttsApiKey', GRANT, 'openai_speech'), null);
  });

  test('helper 不依赖存储 / 引擎全局（单独加载即可判定）', () => {
    // Owner 是在没有 SettingsStore、没有 EngineState 的 vm context 里加载的；
    // 若 helper 内部读任一者，上面几条会直接 ReferenceError，而不是静默给错值。
    ok(typeof Owner.ownerFor === 'function');
  });
});

describe('BEL-266 — 四方向迁移：落盘后读回四把 owner + 四把 key', () => {
  test('A. grant → 自己的 key：owner=vendor，key bytes=粘贴值', async () => {
    const h = makeStorage(grantSeed());
    const S = await initStore(h);
    const owner = await M.saveKeyField(S, 'apiKey', OWN_B, 'qwencloud');
    eq(owner.apiKeyOwner, 'qwencloud');
    deepEq(keysOf(h.store), {
      apiKey: OWN_B, ttsApiKey: 'bmg_grant_tts_old',
      sttApiKey: 'bmg_grant_stt_old', notesApiKey: 'bmg_grant_notes_old',
    }, '只有 chat 的 key 被这次显式粘贴替换');
    deepEq(ownersOf(h.store), {
      apiKeyOwner: 'qwencloud', ttsKeyOwner: 'grant_speech',
      sttKeyOwner: 'grant_stt', notesKeyOwner: 'grant',
    }, '其余三槽的 owner 一个都不许动');
  });

  test('B. 自己的 key → grant：claim 写 bmg_ 与 grant 家族 owner', async () => {
    const h = makeStorage(ownSeed());
    const S = await initStore(h);
    const SM = loadSettingsModel(h.chrome);
    const plan = Q.plan({
      platform: {
        chat: { id: 'grant' }, tts: { id: 'grant_speech' }, stt: { id: 'grant_stt' },
      },
      key: GRANT,
      settings: ownSeed(),
      overwrite: true,       // 用户明确选择「改回免费额度」，这是一次显式替换
    });
    eq(plan.writes.apiKey, GRANT, 'precondition：plan 真的写 chat 槽');
    eq(plan.marks.apiKeyOwner, 'grant');
    eq(plan.marks.ttsKeyOwner, 'grant_speech');
    eq(plan.marks.sttKeyOwner, 'grant_stt');
    await SM.applyQuickSetup(plan);
    deepEq(keysOf(h.store), {
      apiKey: GRANT, ttsApiKey: GRANT, sttApiKey: GRANT,
      notesApiKey: OWN_A_NOTES,     // notes 不写（跟随 chat），key 保留
    }, 'claim 只替换它真写了的三槽，解析那一槽不动');
    deepEq(ownersOf(h.store), {
      apiKeyOwner: 'grant', ttsKeyOwner: 'grant_speech',
      sttKeyOwner: 'grant_stt', notesKeyOwner: 'openai',
    }, 'owner 必须与它写进去的 bmg_ 同族；notes 仍跟随它自己的 key');
  });

  test('C. vendor A → vendor B：显式选 B 再粘 B 的 key，owner=B', async () => {
    const h = makeStorage(ownSeed());
    const S = await initStore(h);
    await M.saveKeyField(S, 'apiKey', OWN_B, 'deepseek');
    deepEq(keysOf(h.store), {
      apiKey: OWN_B, ttsApiKey: OWN_A_TTS,
      sttApiKey: OWN_A_STT, notesApiKey: OWN_A_NOTES,
    }, 'A 的 key 只由这次显式粘贴替换，别的槽不许连带清掉');
    deepEq(ownersOf(h.store), {
      apiKeyOwner: 'deepseek', ttsKeyOwner: 'openai_speech',
      sttKeyOwner: 'openai_transcribe', notesKeyOwner: 'openai',
    }, 'owner 跟 key 的显式来源，不跟 select 的旧值');
  });

  test('D. 只换引擎、不动 key：key bytes 与 owner 全不变（不重新推断）', async () => {
    const h = makeStorage(ownSeed());
    const S = await initStore(h);
    await S.setMany({ provider: 'deepseek' });
    await S.setMany({ ttsEngine: 'openai_speech', sttEngine: 'openai_transcribe' });
    deepEq(keysOf(h.store), {
      apiKey: OWN_A, ttsApiKey: OWN_A_TTS,
      sttApiKey: OWN_A_STT, notesApiKey: OWN_A_NOTES,
    }, '换引擎不清 key');
    deepEq(ownersOf(h.store), {
      apiKeyOwner: 'openai', ttsKeyOwner: 'openai_speech',
      sttKeyOwner: 'openai_transcribe', notesKeyOwner: 'openai',
    }, '换引擎不改 owner —— 尤其不许把 chat owner 推成 deepseek');
  });

  test('没有显式 vendor + 自己的 key → owner 空串（绝不回落引擎）', async () => {
    const h = makeStorage(ownSeed());
    const S = await initStore(h);
    await M.saveKeyField(S, 'apiKey', OWN_B, '');
    deepEq(keysOf(h.store), {
      apiKey: OWN_B, ttsApiKey: OWN_A_TTS,
      sttApiKey: OWN_A_STT, notesApiKey: OWN_A_NOTES,
    });
    deepEq(ownersOf(h.store), {
      apiKeyOwner: '', ttsKeyOwner: 'openai_speech',
      sttKeyOwner: 'openai_transcribe', notesKeyOwner: 'openai',
    }, '旧 owner 必须被空串覆盖；空 = 不判归属，而不是引擎名');
  });
});

describe('BEL-266 — QuickSetup.plan → App applyQuickSetup 的 owner 真落盘', () => {
  test('plan.marks 的 owner 键写进存储，非 owner 的 mark 不混进设置', async () => {
    const h = makeStorage({});
    await initStore(h);
    const SM = loadSettingsModel(h.chrome);
    const plan = Q.plan({
      platform: {
        chat: { id: 'qwencloud', defaultModel: 'qwen3.7-plus' },
        tts: { id: 'qwencloud_tts', defaultModel: 'qwen3-tts-flash' },
        stt: { id: 'qwencloud_asr', defaultModel: 'qwen3-asr-flash' },
      },
      key: OWN_B,
      settings: {},
    });
    eq(plan.marks.apiKeyOwner, 'qwencloud');
    eq(plan.marks.ttsKeyOwner, 'qwencloud_tts');
    eq(plan.marks.sttKeyOwner, 'qwencloud_asr');
    // 同一条通道里混入一个非 owner 的 mark：App 只许落 owner 键。
    plan.marks.grantTail = 'deadbeef';
    await SM.applyQuickSetup(plan);
    deepEq(ownersOf(h.store), {
      apiKeyOwner: 'qwencloud', ttsKeyOwner: 'qwencloud_tts',
      sttKeyOwner: 'qwencloud_asr', notesKeyOwner: undefined,
    }, 'owner 必须真的在 storage 里，不是只在 plan 对象里');
    eq(h.store.grantTail, undefined, 'grantTail 归领取路径，一键卡不许顺手写');
    deepEq(keysOf(h.store), {
      apiKey: OWN_B, ttsApiKey: OWN_B, sttApiKey: OWN_B, notesApiKey: undefined,
    }, 'writes 与 owner 是同一笔落盘');
  });

  test('落盘失败向上抛，不把失败说成成功', async () => {
    const h = makeStorage({});
    await initStore(h);
    h.chrome.storage.local.set = () => { throw new Error('storage down'); };
    const SM = loadSettingsModel(h.chrome);
    await rejects(SM.applyQuickSetup({
      writes: { apiKey: OWN_B },
      marks: { apiKeyOwner: 'qwencloud' },
    }), /storage down/);
    eq(h.store.apiKey, undefined, '失败时不能留下半套配置');
    eq(h.store.apiKeyOwner, undefined, '失败时不能声称 owner 已写');
  });

  test('options 落盘失败会抛（不返回成功）', async () => {
    const S = {
      setMany: async () => ({ ok: false, error: 'disk full' }),
    };
    await rejects(M.saveKeyField(S, 'apiKey', OWN_B, 'qwencloud'), /disk full/);
  });
});

describe('BEL-266 — 源码里不再有「owner 从引擎读」的第二份实现', () => {
  test('options.jsx 的两个保存入口都带显式 vendor 参数', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/pages/options.jsx'), 'utf8');
    const debounced = src.match(/keyOwnerFor\(key, value, currentVendorFor\(key\)\)/g) || [];
    const committed = src.match(/saveKeyField\(SettingsStore, key, value, currentVendorFor\(key\)\)/g) || [];
    eq(debounced.length, 1, '防抖输入入口必须把当前选择传进去');
    eq(committed.length, 1, 'change/blur 落盘入口必须把当前选择传进去');
    ok(!/keyOwnerFor\(key, value\)/.test(src), '仍有只传 key/value 的旧调用点');
    ok(!/SettingsStore\.get\(OWNER_ENGINE_KEY/.test(src),
      'options.jsx 仍从存储里的引擎推 owner');
  });
});
