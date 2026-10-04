// test/home-engine.test.js — 真机（TestFlight 1.19.0）反馈的两条（2026-10-01）。
//
// 两条都是**用户当场看到的**：
//   ① 登录之后不该还是「引擎未配置」——所有引擎都该配好，而且**翻译那格要有服务端指定的默认值**
//      （不是留空让用户自己填）。真机截图：状态行写着「翻译引擎未配置，前往 设置 › 引擎 选一个」。
//   ② 那个提示 chip 跟它上面的分隔线**重合**了（我这版 CSS 给 chip 用了负外边距，压进了 header 的边线）。
//
// 按仓库规矩：能变成门禁的就别留在清单里 —— 这两条各自钉一个可判定的形状。
const fs = require('fs');
const path = require('path');
const { describe, test, eq, ok, loadSrc } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 与 test/grant.test.js 同一套装载（Registry 同形 + window 垫片）。
const SPEC = {
  vendor: 'openrouter', vendorLabel: 'OpenRouter', limitUsd: 0.2,
  claimUrl: 'https://backend.example/functions/v1/bt-grant',
  models: { chat: 'deepseek/deepseek-v4-flash' },
};
const REG = {
  MT_PROVIDERS: [{ id: 'grant', type: 'chat-compat', needsKey: true, grantOnly: true,
    defaultEndpoint: 'https://backend.example/functions/v1/bt-relay/chat/completions',
    defaultModel: 'deepseek/deepseek-v4-flash' }],
  MT_TTS_ENGINES: [{ id: 'grant_speech', type: 'speech-compat', needsKey: true, grantOnly: true,
    defaultEndpoint: 'https://backend.example/functions/v1/bt-relay/audio/speech',
    defaultModel: 'deepgram/aura-2' }],
  MT_STT_ENGINES: [{ id: 'grant_stt', type: 'transcribe-compat', needsKey: true, grantOnly: true,
    defaultEndpoint: 'https://backend.example/functions/v1/bt-relay/audio/transcriptions',
    defaultModel: 'openai/gpt-4o-mini-transcribe' }],
};
const REGISTRY = { providers: REG.MT_PROVIDERS, tts: REG.MT_TTS_ENGINES, stt: REG.MT_STT_ENGINES };
const load = (spec) => loadSrc('src/shared/grant.js', 'grant', {
  window: Object.assign({ MT_GRANT: spec === undefined ? SPEC : spec }, REG),
  document: { createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }) },
  chrome: { i18n: { getMessage: () => '' } },
});

describe('登录后的引擎就位（真机反馈 ①，2026-10-01）', () => {
  test('★ 空账号 + 成功领取 ⇒ 翻译槽必须写出**服务端指定的默认**（provider/key/model 三样）', () => {
    const g = load().grant;
    const plan = g.plan({ token: 'bmg_x', limitUsd: 0.2, spentUsd: 0 }, {}, REGISTRY, {});
    const w = plan.writes || {};
    eq(w.provider, 'grant', '翻译引擎没有落到服务端指定那条（provider 不是 grant）');
    ok(!!w.apiKey, '翻译槽没有写 key —— 领取之后仍然是「未配置」');
    eq(w.apiModel, SPEC.models.chat,
      '模型不是服务端指定的默认值（MT_GRANT.models.chat）—— 用户会被要求自己填');
  });

  test('★ 空账号 + 成功领取 ⇒ 朗读与转写两槽也要写（服务端给了就给）', () => {
    const g = load().grant;
    const plan = g.plan({ token: 'bmg_x', limitUsd: 0.2, spentUsd: 0 }, {}, REGISTRY, {});
    const w = plan.writes || {};
    ok(!!w.ttsApiKey, '朗读槽没写 —— 「登录完所有引擎都配好」不成立');
    ok(!!w.sttApiKey, '转写槽没写 —— 「登录完所有引擎都配好」不成立');
  });

  test('★ 中国版那种注册表（服务端只有 chat）也要成立：chat 由领取写，朗读/转写由 App 补设备内置', () => {
    const g = load().grant;
    const cnReg = { providers: REG.MT_PROVIDERS, tts: [], stt: [] };   // 中国版：中继没有朗读/转写那两条
    const w = (g.plan({ token: 'bmg_x', limitUsd: 0.2, spentUsd: 0 }, {}, cnReg, {}).writes) || {};
    ok(!!w.apiKey && w.provider === 'grant', '中国版连翻译槽都没写');
    ok(!w.ttsEngine && !w.sttEngine, '中国版不该凭空写出朗读/转写槽（中继没有那两条）');
    // App 侧必须补上（否则真机就是「还没配语音引擎」）
    const model = read('src/app/shell-model.js').replace(/\/\/.*$/gm, '');
    ok(/chrome\.storage\.local\.set\(\{ ttsEngine: 'device' \}/.test(model),
      'App 没有把朗读补成设备内置 —— 中国版登录后仍是「未配置」');
  });

  test('★ 领取失败时，状态行必须说「没领到」并给一条重领的路（不许只说「未配置」）', () => {
    const model = read('src/app/shell-model.js').replace(/\/\/.*$/gm, '');
    ok(/claimFailed = true/.test(model), '领取失败没有被记住 —— 界面无从区分「没领到」与「没配」');
    const fn = model.slice(model.indexOf('async function paintEngineStatus'));
    ok(/miss === 'translate' && claimFailed/.test(fn.slice(0, 2000)),
      '状态行没有把「领取失败」这一支分出来 —— 真机上它会说「翻译引擎未配置」，把人指向救不了他的设置页');
    ok(/_autoClaimed = null/.test(fn.slice(0, 2200)),
      '缺项不可重领 —— 判据 J07 要求缺失项带恢复路径');
  });

  test('★ App 侧：登录汇合点必须补上朗读引擎（设备内置），且状态行的「未配置」分支只在那之后才可能为真', () => {
    const model = read('src/app/shell-model.js').replace(/\/\/.*$/gm, '');
    ok(/ensureDeviceTts\(\)/.test(model), 'show() 里没有补朗读引擎那一步 —— 真机上就会显示「未配置」');
    const fn = model.slice(model.indexOf('async function paintEngineStatus'));
    ok(/firstRunEngineOk\(/.test(fn.slice(0, 900)),
      '状态行的「就绪」判定没有用 firstRunEngineOk —— 两处判据会分叉');
    ok(/chip\.hidden = true/.test(fn.slice(0, 1200)),
      '就绪时没有把 chip 收起来 —— 它会一直挂着');
  });

  test('★ 领取/补朗读之后必须**重画**状态行；离开设置页回首页也要重画（2026-10-02 真机）', () => {
    // 真机现象：登录成功后首页状态行仍写着「翻译引擎未配置，前往 设置 › 引擎 选一个」。
    // 根因不是判定（firstRunEngineOk / plan 都对，前面几条已经钉住），而是**没人重画**：
    // 状态行由 paintStatic 画，而 boot 的那次 paintStatic 跑在登录之前（存储里还没令牌）；
    // 领取写盘之后没有任何东西再画一次。两个「各自正确」的单元拼起来漏了一根线 ——
    // 纯函数/静态判据看不见它，这正是加这一条的理由。
    const model = read('src/app/shell-model.js').replace(/\/\/.*$/gm, '');
    const show = model.slice(model.indexOf('async function show('));
    const claim = show.indexOf('autoClaimGrant()');
    ok(claim > -1, 'show() 里找不到 autoClaimGrant —— 领取不在登录汇合点上了');
    // 2026-10-02：领取改为**并行启动**（`const claimP = … autoClaimGrant()…`），落地在
    // `await claimP`（那次网络往返不再挡揭屏）。状态行必须在**落地之后**画 ——
    // 否则它会读成「引擎不通」，正是这条要防的那件事。
    const landed = show.indexOf('await claimP', claim);
    ok(landed > claim, 'show() 里没有 await 领取的落地 —— 状态行会读成「引擎不通」');
    const repaint = show.indexOf('paintEngineStatus()', landed);
    ok(repaint > landed,
      '登录汇合点在领取落地之后没有重画引擎状态行 —— 它会一直停在「翻译引擎未配置」（2026-10-02 真机）');
    // 同一类漏重画：在设置里配好引擎/改回额度后回首页，状态行要跟着变。
    const close = model.slice(model.indexOf('async function closeSettings'));
    const closeBody = close.slice(0, close.indexOf("say('"));
    ok(/paintEngineStatus\(\)/.test(closeBody),
      '离开设置页回首页没有重画状态行 —— 在那里配好引擎后首页仍显示旧状态');
  });
});

describe('状态行 chip 不许与上方的线重合（真机反馈 ②，2026-10-01）', () => {
  const css = read('app/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

  test('★ chip 不得用负外边距把自己拉进 header 的边线里', () => {
    const m = /\.status-chip\s*\{([^}]*)\}/.exec(css);
    ok(m, 'style.css 里找不到 .status-chip 规则');
    const body = m[1];
    ok(!/margin\s*:\s*-\d/.test(body) && !/margin-(top|bottom)\s*:\s*-\d/.test(body),
      'chip 用了负的外边距 —— 真机上就是它与上面的分隔线重合的原因');
  });

  test('★ 状态行自身要有与上方内容的间距（不是贴着边线画）', () => {
    const m = /\.status\s*\{([^}]*)\}/.exec(css);
    ok(m, 'style.css 里找不到 .status 规则');
    ok(/margin[^;]*\d/.test(m[1]) || /padding[^;]*\d/.test(m[1]),
      '状态行没有上下间距 —— 会贴着 header 的边线');
  });

  test('★ chip 允许换行但不许溢出容器（长文案「翻译引擎未配置，前往 设置 › 引擎 选一个」）', () => {
    const m = /\.status-chip\s*\{([^}]*)\}/.exec(css);
    ok(/max-width|flex\s*:|white-space/.test(m[1]),
      'chip 没有任何宽度/换行约束 —— 长文案会溢出或压住邻居');
  });
});

describe('登录屏的错误文案：表外 code 不透出服务端原文（2026-10-02，用户）', () => {
  // 交换失败撞到不在表里的 code（`validation_failed` / `user_already_exists` / `signup_disabled`…）
  // 时，humanError 原来最后是 `return msg` —— 而 msg 多半是英文的 GoTrue 串（"Validation failed"），
  // App 的规矩是「绝不把提供方的原文摆给用户」。这一条钉住兜底是**文案**，不是原文。
  test('★ humanError 的兜底必须是一条具名文案，不是 `return msg`', () => {
    const model = read('src/app/shell-model.js');
    const i = model.indexOf('function humanError');
    ok(i >= 0, 'shell-model.js 里找不到 humanError');
    const tail = model.slice(i, i + 4000).split('\n  }')[0];
    ok(!/return\s+msg\s*;/.test(tail),
      '兜底又写成 `return msg` —— 表外 code 会把服务端英文原文甩到登录屏');
    ok(/return t\('app_apple_failed'/.test(tail),
      '兜底没有复用已有的具名文案键（app_apple_failed）');
  });
});

describe('配好之后不再报状态；额度在用就不再让人配 key（2026-10-03 用户裁定）', () => {
  test('★ 首页那行状态：配好就**整行不出现**（不再写「登录已配好…」）', () => {
    const model = read('src/app/shell-model.js').replace(/\/\/.*$/gm, '');
    const fn = model.slice(model.indexOf('async function paintEngineStatus'));
    const okBranch = fn.slice(0, 900);
    ok(/engine-status'\)/.test(okBranch) && /hidden = true/.test(okBranch),
      '就绪分支没有把 #engine-status 整行藏掉 —— 首页还在报「登录已配好…」');
    ok(!/engine_status_ok/.test(okBranch), '就绪分支还在写「登录已配好」那句');
    ok(/hidden = false/.test(fn.slice(0, 1400)),
      '「缺东西」那一支没有把状态行放回来 —— 该露的时候它得在');
  });

  test('★ 额度在用 ⇒ 设置页收起「用一把 key 配好全部」（两条路互斥）', () => {
    const sv = read('src/app/settings-view.jsx');
    ok(/id="quick-setup-card"[\s\S]{0,90}grantActive/.test(sv),
      '一键卡没有按 grantActive 收起 —— 额度正在用的时候设置页还挂着「用一把 key 配好全部」');
    ok(/setGrantActive\(/.test(sv) && /LearnGrant\.active\(/.test(sv),
      'settings-view 没有从 LearnGrant.active 算出 grantActive');
  });
});
