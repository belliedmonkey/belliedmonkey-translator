// test/registry.test.js — invariants that every capability registry must hold.
//
// There are two registries now: translation providers (docs/domain-design.md §7) and
// speech engines. The second was written to be *isomorphic* to the first and dropped
// exactly one field: `flavors`. Consequence — the China bundle shipped a brand-named
// speech engine (label "OpenAI Speech", defaultBase api.openai.com), because
// `generateTts()` never filtered and the China build has no such provider to hide it.
//
// The China compliance gate did catch it, which is why it exists. But that gate only
// fires on `node build.js --flavor china`, after a full copy + locale rewrite, and it
// reports a grep hit in a generated file rather than the missing field. These tests
// fail on the registry itself, in milliseconds, naming the entry.
//
// The rule they encode: **a registry entry declares which builds it belongs to.**
// An entry that forgets is not "defaulted to global" — it is an error, because the
// silent default is precisely how a brand reaches a bundle that may not carry one.

const { describe, test, ok, eq } = require('./harness');

// stt was missing from this list until #147. It went unnoticed only because its one
// branded entry happens to be global-only — i.e. the exact silent-default failure this
// file was written to catch, one registry over.
// model-params joined in #159. It is NOT a capability registry — it lists nothing the
// user can pick — but it ships per flavor and it carries brand-named hosts, so the two
// invariants that matter here (declare your builds; nothing branded reaches China) apply
// to it word for word. What does NOT apply is `type` / `defaultEndpoint`: those are how
// you REACH an engine, and this table only describes one you already reached. Hence
// `required` moved onto the row instead of being one global list.
const REGISTRIES = [
  { name: 'providers', entries: require('../build/providers.config.js'), cap: 'chat',
    required: ['id', 'type', 'flavors', 'defaultEndpoint'] },
  { name: 'tts', entries: require('../build/tts.config.js'), cap: 'tts',
    required: ['id', 'type', 'flavors', 'defaultEndpoint'] },
  { name: 'stt', entries: require('../build/stt.config.js'), cap: 'stt',
    required: ['id', 'type', 'flavors', 'defaultEndpoint'] },
  { name: 'model-params', entries: require('../build/model-params.config.js'), cap: null,
    required: ['id', 'flavors', 'hosts', 'note'] },
];

// Every key an entry of each registry is allowed to carry. Enumerating the ALLOWED set
// rather than the required one is what turns "a field was silently dropped or renamed"
// into a red test instead of a quiet gap — the gate below used to name the fields it
// checked, so renaming one made the check disappear rather than fail.
const KNOWN_KEYS = {
  providers: ['id', 'type', 'flavors', 'needsKey', 'supportsBaseUrl', 'supportsModel',
    'requiresEndpoint', 'defaultEndpoint', 'placeholder', 'defaultModel', 'label',
    'labelKey', 'hintKey', 'keyUrl'],
  tts: ['id', 'type', 'flavors', 'needsKey', 'supportsKey', 'supportsBaseUrl', 'supportsModel',
    'requiresEndpoint', 'defaultEndpoint', 'placeholder', 'defaultModel', 'voices',
    'returnsAudio', 'label', 'labelKey', 'hintKey'],
  stt: ['id', 'type', 'flavors', 'needsKey', 'supportsKey', 'supportsBaseUrl', 'supportsModel',
    'requiresEndpoint', 'defaultEndpoint', 'placeholder', 'defaultModel', 'label',
    'labelKey', 'hintKey',
    // docs/domain-design.md §2.4 / §7: the live-transcription socket and the large-file
    // upload are STORED addresses (complete URLs, used verbatim), never derived.
    'liveEndpoint', 'liveType', 'liveModel', 'liveRate', 'liveKeyProtocol', 'uploadEndpoint'],
  'model-params': ['id', 'flavors', 'hosts', 'models', 'temperature', 'budget',
    'systemRole', 'reasoning', 'note'],
};

const KNOWN_FLAVORS = ['global', 'china'];

// Mirrors the FORBIDDEN regex in build.js's complianceGateChina. Kept as a literal
// rather than imported: build.js is a script that runs on require, and a second copy
// of five words is cheaper than making it importable. If it drifts, the build gate is
// still the authority — this test is the early warning, not the law.
const FORBIDDEN = /ChatGPT|OpenAI|\bClaude\b|api\.openai\.com|api\.anthropic\.com/i;

describe('capability registries', () => {
  for (const { name, entries, required } of REGISTRIES) {
    test(`${name}: every entry declares the builds it ships in`, () => {
      for (const e of entries) {
        ok(Array.isArray(e.flavors), `${name}/${e.id} has no flavors array`);
        ok(e.flavors.length > 0, `${name}/${e.id} declares no flavor`);
        for (const f of e.flavors) {
          ok(KNOWN_FLAVORS.indexOf(f) >= 0, `${name}/${e.id} names unknown flavor ${f}`);
        }
      }
    });

    // Walks EVERY string an entry carries instead of naming the fields to check. The
    // enumerated version missed a field the moment one was added or renamed, and this
    // gate's whole reason for existing is that a silently-absent field is how a brand
    // reaches a bundle that may not carry one. Per-flavor maps yield only the china
    // branch — the global branch never ships there.
    function* chinaStrings(v, path) {
      if (v == null) return;
      if (typeof v === 'string') { yield [path, v]; return; }
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) yield* chinaStrings(v[i], `${path}[${i}]`);
        return;
      }
      if (typeof v !== 'object') return;
      // A { china, global } map: only the china side reaches a China build.
      if ('china' in v || 'global' in v) { yield* chinaStrings(v.china, path + '.china'); return; }
      for (const k of Object.keys(v)) yield* chinaStrings(v[k], path ? `${path}.${k}` : k);
    }

    test(`${name}: nothing shipped to China carries a brand reference`, () => {
      for (const e of entries) {
        if (!e.flavors || !e.flavors.includes('china')) continue;
        for (const [field, v] of chinaStrings(e, '')) {
          ok(!FORBIDDEN.test(v),
            `${name}/${e.id}.${field} would ship a brand reference to China: ${v}`);
        }
      }
    });

    test(`${name}: entries carry exactly the known keys, no more and no fewer`, () => {
      const known = KNOWN_KEYS[name];
      for (const e of entries) {
        for (const k of Object.keys(e)) {
          ok(known.indexOf(k) >= 0,
            `${name}/${e.id} carries unknown key \`${k}\` — a leftover from a rename?`);
        }
        for (const k of required) {
          ok(k in e, `${name}/${e.id} is missing \`${k}\` — an absent field is an error, not a default`);
        }
        // The two fields the zero-concatenation change removed. Named explicitly so a
        // half-applied revert fails here rather than producing `…undefined` URLs on a
        // user's device. (`known` already forbids them on model-params, which never had
        // an address of its own to begin with.)
        ok(!('path' in e), `${name}/${e.id} still has \`path\` — endpoints are complete now`);

        // `needsKey` and `supportsKey` are different questions: "must you give one"
        // vs "can you give one at all". The settings page read only the first and
        // therefore HID the key input for the self-hosted audio entries — whose own
        // definition is "any server implementing this request shape", and the cloud
        // half of that set all require auth. The transports were already sending the
        // header when a key was present (request-shape.js), so the value simply had
        // nowhere to be typed. Requiring a key while claiming not to support one is
        // the incoherent combination; forbid it.
        if ('supportsKey' in e) {
          ok(!(e.needsKey && !e.supportsKey),
            `${name}/${e.id} says needsKey but not supportsKey — a key is required and cannot be entered`);
        }
        ok(!('defaultBase' in e), `${name}/${e.id} still has \`defaultBase\``);
      }
    });

    test(`${name}: every defaultEndpoint is a complete, absolute request URL`, () => {
      for (const e of entries) {
        if (!('defaultEndpoint' in e)) continue;         // model-params carries no address
        for (const f of (e.flavors || [])) {
          const v = (e.defaultEndpoint && typeof e.defaultEndpoint === 'object')
            ? e.defaultEndpoint[f] : e.defaultEndpoint;
          if (v == null) continue;                       // user supplies the whole address
          ok(/^https?:\/\/[^/]+\/.+/.test(v),
            `${name}/${e.id} (${f}) is not an absolute URL WITH a path: ${v}`);
        }
      }
    });
  }

  // 片段比枚举强大得多,而这张表的许可证建立在「没有一个字段是缺了就会错的」之上。
  // 白名单是那条边界的守卫:任何人想往请求体里塞一个新字段,得先过这里,也就得先解释
  // 它缺了会怎样。没有这道门,`reasoning` 就是一个可以往请求体里写任意东西的口子。
  test('model-params: reasoning 片段只许用白名单里的顶层键', () => {
    // 四种拼法,四家各不相同 —— 这正是这一列要存片段而不是枚举的原因:
    //   reasoning_effort  OpenAI（顶层字符串）
    //   thinking          DeepSeek / GLM（开关对象）
    //   reasoning         OpenRouter（嵌套 effort），也是 responses-compat 的写法
    //   enable_thinking   DashScope（顶层布尔）
    //
    // 第四种是 2026-08-30 实测加进来的，而且**它缺了会怎样是量过的**（这条白名单
    // 只收这种字段）：在 dashscope 上不发它，glm-4.6 翻一段 870 字正文要 68.9 秒、
    // 思考 3623 tok；发了 4.2 秒、思考归零，译文长度不变 —— 17 倍。
    // 更要紧的是**别的拼法在这里不管用**：thinking:{type:'disabled'} 被完全无视，
    // 而那正是同一个模型 glm-4.6 在 open.bigmodel.cn 上已采纳的写法。所以这不是
    // 「多一种同义写法」，是「换个网关就必须换一种写法」——白名单里少了它，
    // 这个网关上所有会思考的模型就只能一直慢下去，而且没有任何地方会报错。
    const ALLOWED = ['reasoning_effort', 'thinking', 'reasoning', 'enable_thinking'];
    for (const e of require('../build/model-params.config.js')) {
      if (!('reasoning' in e)) continue;
      ok(e.reasoning && typeof e.reasoning === 'object' && !Array.isArray(e.reasoning),
        `model-params/${e.id}.reasoning 必须是对象（按 chat-compat 写法的请求体片段）`);
      for (const k of Object.keys(e.reasoning)) {
        ok(ALLOWED.indexOf(k) >= 0,
          `model-params/${e.id}.reasoning 用了白名单外的键 \`${k}\` —— `
          + '要加新键,先说清它缺了会怎样(这张表不收「缺了就会错」的字段)');
      }
    }
  });

  test('at least one entry is global-only, or these tests prove nothing', () => {
    // A guard on the guard: if every entry shipped everywhere, the China assertions
    // above would pass vacuously and keep passing after someone deleted the filter.
    const globalOnly = REGISTRIES.flatMap((r) => r.entries)
      .filter((e) => e.flavors && !e.flavors.includes('china'));
    ok(globalOnly.length > 0, 'no global-only entry exists — the flavor split is not being exercised');
    eq(globalOnly.every((e) => e.flavors.includes('global')), true);
  });
});

// ─── The description gate is only as good as its derivation (#69) ────────────
// build/brands.js feeds the gate that keeps `extension_description` provider-neutral.
// A derivation that silently returned [] would make that gate pass on every string,
// which is the failure mode this file exists to prevent elsewhere too — so assert the
// tokens, not just that the function runs.

describe('provider brand derivation (#69)', () => {
  const { providerBrands } = require('../build/brands.js');

  test('every branded provider contributes a token', () => {
    const brands = providerBrands().map((b) => b.toLowerCase());
    // One token per real vendor name that appears in a label, in either flavor.
    for (const expected of ['google', 'chatgpt', 'openai', 'claude', 'anthropic',
      'deepseek', 'glm', 'qwen', 'kimi', '智谱', '通义千问']) {
      ok(brands.indexOf(expected.toLowerCase()) >= 0, `品牌词漏了 "${expected}" —— 闸门会放行点名它的文案`);
    }
  });

  test('the generic words in labels are NOT treated as brands', () => {
    const brands = providerBrands().map((b) => b.toLowerCase());
    // These all appear inside labels ("Google 翻译（免费，无需 API Key）", "自定义 · Chat
    // Completions 格式"). If they leaked in, the gate would reject ordinary prose and
    // someone would delete the gate rather than fight it.
    for (const generic of ['api', 'key', 'custom', 'chat', 'completions', '翻译', '自定义', '格式']) {
      ok(brands.indexOf(generic) < 0, `"${generic}" 被当成品牌词 —— 闸门会对正常文案误报`);
    }
  });

  test('shipped descriptions name no provider, in every locale', () => {
    const fs = require('fs'), path = require('path');
    const brands = providerBrands();
    const dir = path.join(__dirname, '..', 'extension', '_locales');
    const offenders = [];
    for (const loc of fs.readdirSync(dir)) {
      const f = path.join(dir, loc, 'messages.json');
      if (!fs.existsSync(f)) continue;
      const desc = (JSON.parse(fs.readFileSync(f, 'utf8')).extension_description || {}).message || '';
      for (const b of brands) {
        if (desc.toLowerCase().indexOf(b.toLowerCase()) >= 0) offenders.push(`${loc}:${b}`);
      }
    }
    eq(offenders.length, 0, `商店描述里点名了服务商: ${offenders.join(', ')}`);
  });
});

// ─── Every locale must have a China description (#70) ────────────────────────
// `_locales/pt` was renamed `pt_BR` (#65) and descriptions.china.js kept `pt`, so the
// China build silently served Portuguese users the English `_default` — a compliant,
// brand-free, perfectly buildable wrong answer that no gate could see.

describe('China descriptions cover every locale (#70)', () => {
  test('each _locales dir has a matching key', () => {
    const fs = require('fs'), path = require('path');
    const DESC = require('../build/descriptions.china.js');
    const dir = path.join(__dirname, '..', 'extension', '_locales');
    const missing = fs.readdirSync(dir)
      .filter((loc) => fs.existsSync(path.join(dir, loc, 'messages.json')))
      .filter((loc) => !DESC[loc]);
    eq(missing.length, 0, `descriptions.china.js 缺少: ${missing.join(', ')}（会静默回落成英文）`);
  });
});

// ─── Apple caps the description at 112 characters ────────────────────────────
// Apple's validator rejects the UPLOAD, per locale, after a successful archive and
// export — nothing earlier can see it. The #69 rewrite was checked against Chrome's
// 132-character store summary limit, so six locales passed every local gate, built,
// installed on the simulator, and died at TestFlight (2026-08-07).

describe('description length (Apple 112)', () => {
  test('every locale fits', () => {
    const fs = require('fs'), path = require('path');
    const dir = path.join(__dirname, '..', 'extension', '_locales');
    const over = [];
    for (const loc of fs.readdirSync(dir)) {
      const f = path.join(dir, loc, 'messages.json');
      if (!fs.existsSync(f)) continue;
      const d = (JSON.parse(fs.readFileSync(f, 'utf8')).extension_description || {}).message || '';
      if ([...d].length > 112) over.push(`${loc}=${[...d].length}`);
    }
    eq(over.length, 0, `超过 Apple 的 112 字符上限: ${over.join(', ')}`);
  });

  test('the China descriptions fit too', () => {
    const DESC = require('../build/descriptions.china.js');
    const over = Object.entries(DESC).filter(([, v]) => [...String(v)].length > 112).map(([k, v]) => `${k}=${[...String(v)].length}`);
    eq(over.length, 0, `中国版描述超长: ${over.join(', ')}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 默认引擎必须存在于**它所在那个 flavor** 的注册表里。
//
// 2026-08-22 真机发现：中国版出货包的默认是 `provider: 'google'`，而 google 的
// flavors 是 ['global']。运行时 `providerById` 返回 null，`callProvider` 旧代码的
// `!p` 分支把它静默送去 translateGoogle —— 一份刚装好、没填任何 Key 的中国版
// 真的翻出了 38 段，输出与直接打 translate.googleapis.com 的返回逐字相同。
// 而设置页的 <select> 里没有 google 这一项，浏览器把它显示成第一项 DeepSeek：
// **界面写着 DeepSeek，实际发的是 Google**，国内那条地址还不通，只会等到超时。
//
// 这条不变量在构建期完全看得见，代价却是出货之后才被真机撞到。所以有两道：
// build.js 的 defaultProviderGate 查**出货目录**，这里查**源码 + 改写目标**，
// 毫秒级、并且指名道姓。
const fsRT = require('fs');
const pathRT = require('path');
const ROOT_RT = pathRT.join(__dirname, '..');
const idsFor = (flavor) => require('../build/providers.config.js')
  .filter((p) => p.flavors.includes(flavor)).map((p) => p.id);

describe('默认引擎属于自己的 flavor', () => {
  const bg = fsRT.readFileSync(pathRT.join(ROOT_RT, 'extension/background.js'), 'utf8');
  const m = /provider:\s*'([a-z_]+)'/.exec(bg);

  test('background.js 里能读到默认引擎', () => {
    ok(m, 'extension/background.js 里找不到 `provider: \'…\'` —— 改了名就要改这条门禁');
  });

  test('源码的默认引擎在 global 注册表里（源码树永远是 global）', () => {
    const ids = idsFor('global');
    ok(ids.includes(m[1]),
      `默认引擎 '${m[1]}' 不在 global 注册表里（${ids.join(', ')}）`);
  });

  test('build.js 为 china 改写默认引擎，且改成 china 注册表里有的 id', () => {
    const build = fsRT.readFileSync(pathRT.join(ROOT_RT, 'build.js'), 'utf8');
    const r = /'dist-china\/background\.js',\s*'([a-z_]+)'/.exec(build);
    ok(r, 'build.js 没有为 china flavor 改写默认引擎');
    const ids = idsFor('china');
    ok(ids.includes(r[1]),
      `china 的默认引擎被改写成 '${r[1]}'，但它不在 china 注册表里（${ids.join(', ')}）`);
  });
});

// ── MT_SYNC_ENABLED：交接块的开关，必须与 backend.config.js 的 enabled 一致 ──────
//
// 官网试翻页上那个「登录之后卡片才到 App」的块，靠这个布尔值决定出不出现。
// 中国版扩展的登录入口是被整节 remove 掉的，对那个构建这句话是死路。
//
// 这条门禁存在是因为第一版实现取错了值：判据写成 /enabled:\\s*true/，把文件里
// 一句**注释**（"enabled:true, sign-in included"）也算了进去，于是中国版产物里
// 它是 true。产物是二进制事实，比读源码更难骗 —— 所以这里读产物。
describe('MT_SYNC_ENABLED 与 backend.config.js 一致', () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const ROOT2 = path2.join(__dirname, '..');
  const read = (p) => (fs2.existsSync(p) ? fs2.readFileSync(p, 'utf8') : null);
  const flagOf = (gen) => {
    const m = gen && gen.match(/window\.MT_SYNC_ENABLED = (true|false);/);
    return m ? m[1] === 'true' : null;
  };
  // 源码里那一行**声明**（不是注释）说的是什么。
  const declared = (cfg) => {
    const on = (cfg.match(/^\s*enabled:\s*true,/gm) || []).length;
    const off = (cfg.match(/^\s*enabled:\s*false,/gm) || []).length;
    eq(on + off, 1, 'backend.config.js 里 enabled 声明不是恰好一处');
    return on === 1;
  };

  for (const [name, dist] of [['global', 'dist'], ['china', 'dist-china']]) {
    test(`${name} 产物里的 MT_SYNC_ENABLED 与它自己的 backend.config.js 相符`, () => {
      const gen = read(path2.join(ROOT2, dist, 'content/providers.gen.js'));
      const cfg = read(path2.join(ROOT2, dist, 'learn/backend.config.js'));
      if (!gen || !cfg) { ok(true, `跳过：${dist}/ 还没构建`); return; }
      const want = declared(cfg);
      const got = flagOf(gen);
      ok(got !== null, `${dist}/content/providers.gen.js 里没有 MT_SYNC_ENABLED`);
      eq(got, want, `${dist}: providers.gen.js 说 ${got}，backend.config.js 声明的是 ${want}`
        + ' —— 取值取错了（第一版就是被一句注释骗过去的）');
    });
  }

  // 这一条守的是「`flagOf` 真的在读产物，而不是返回一个常量」。
  //
  // 它**曾经**写成「两个 flavor 的取值必须不同」，因为当时 china 恒为 false。
  // 2026-09-05（§C 境内后端）之后那个前提会过期：`china.ready` 翻真那天两个 flavor
  // 都是 true，而那条会**假红** —— 红的原因不是判据坏了，是判据的前提过期了。
  //
  // 所以判据改成条件式的：**只有当两份 cfg 的声明不同时，才要求两个产物不同**。
  // 力量不减（声明不同而产物相同，正是「没在读文件」的指纹），但它跟着事实走，
  // 不需要谁在切后端那天记得回来改这里。
  test('声明不同的两个 flavor，产物也必须不同 —— 否则判据没在读那个文件', () => {
    const gGen = read(path2.join(ROOT2, 'dist/content/providers.gen.js'));
    const cGen = read(path2.join(ROOT2, 'dist-china/content/providers.gen.js'));
    const gCfg = read(path2.join(ROOT2, 'dist/learn/backend.config.js'));
    const cCfg = read(path2.join(ROOT2, 'dist-china/learn/backend.config.js'));
    if (!gGen || !cGen || !gCfg || !cCfg) { ok(true, '跳过：两个 flavor 没有都构建'); return; }
    if (declared(gCfg) === declared(cCfg)) {
      ok(true, '两个 flavor 声明相同（境内后端已启用），这条不适用');
      return;
    }
    ok(flagOf(gGen) !== flagOf(cGen),
      `两份 cfg 声明不同，产物里却都是 ${flagOf(gGen)} —— 判据没有真的在读 backend.config.js`);
  });
});

// 中国版只提供 Apple 登录（2026-09-03 用户裁定）。
//
// Google 在中国大陆连不上，留着那个按钮就是一个必然失败的按钮。而「能不能连上」是
// 用户所在网络的事实，客户端猜不出来，只能由 flavor 决定。
//
// **两条发射路径都要验**：dist-china（扩展）与 dist-app-china（App 包）读的是**不同**
// 的 backend.config.js —— 前者是 build.js 改写过的产物，后者拼的是**源码**那一份。
// 只改一条的后果，2026-08-09 的 sync 翻转已经演示过一次：手机端开着、Chrome 端悄悄
// 回退。而这一次漏掉的会是 App —— 恰恰是**唯一**有 Google 按钮的那个面。
describe('中国版的登录方式（两条发射路径）', () => {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..');
  const read = (p) => (fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p), 'utf8') : null);
  const providersIn = (src) => {
    const m = /providers:\s*(\[[^\]]*\])/.exec(src || '');
    return m ? m[1].replace(/'/g, '"') : null;
  };

  for (const [what, file, want] of [
    ['扩展 · 国际', 'dist/learn/backend.config.js', '["apple","google"]'],
    ['扩展 · 中国', 'dist-china/learn/backend.config.js', '["apple"]'],
    ['App · 国际', 'dist-app/Script.js', '["apple","google"]'],
    ['App · 中国', 'dist-app-china/Script.js', '["apple"]'],
  ]) {
    test(`${what}: ${want}`, () => {
      const src = read(file);
      if (src === null) return;                 // 那个 flavor 这次没构建，跳过
      const got = (providersIn(src) || '').replace(/\s/g, '');
      eq(got, want, `${file} 的 providers 是 ${got}，期望 ${want}`
        + (want === '["apple"]' ? ' —— 中国版留着 Google 就是一个必然失败的按钮' : ''));
    });
  }

  test('两条路径各自有自己的改写调用 —— 少一条就会漏掉 App', () => {
    const b = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
    const ab = fs.readFileSync(path.join(ROOT, 'build/app-bundle.js'), 'utf8');
    ok(/limitProviders\(/.test(b), 'build.js 里没有 limitProviders —— 扩展那条路没限制');
    ok(/opts\.limitProviders/.test(ab),
      'app-bundle.js 里没有 limitProviders —— App 包拼的是源码那份，'
      + '而 App 正是唯一有 Google 按钮的面');
  });
});
