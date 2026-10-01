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

  test('★ App 侧：登录汇合点必须补上朗读引擎（设备内置），且状态行的「未配置」分支只在那之后才可能为真', () => {
    const model = read('src/app/shell-model.js').replace(/\/\/.*$/gm, '');
    ok(/ensureDeviceTts\(\)/.test(model), 'show() 里没有补朗读引擎那一步 —— 真机上就会显示「未配置」');
    const fn = model.slice(model.indexOf('async function paintEngineStatus'));
    ok(/firstRunEngineOk\(/.test(fn.slice(0, 900)),
      '状态行的「就绪」判定没有用 firstRunEngineOk —— 两处判据会分叉');
    ok(/chip\.hidden = true/.test(fn.slice(0, 1200)),
      '就绪时没有把 chip 收起来 —— 它会一直挂着');
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
