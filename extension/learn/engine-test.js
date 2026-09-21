// learn/engine-test.js — 引擎自检的共用层（EngineTest）。
//
// 抽出来的理由不是「代码复用」，是**同一个 401 在两个页面上说两种话**：设置页显示
// 完整的失败码表 + 服务端原话 + 请求地址 + 通路，而引导页（onboard.js 自己手写的
// 第六份实现）只显示 `✗ Load failed`。抽完之后这道差距免费消失。
//
// 分工是刻意的：**收敛「编排与呈现」，不收敛「测什么」。**
//   · reason / serverLine / assertEndpointShape / format —— 四个页面共用
//   · translation / notes / stt / tts —— 各自调该功能**真正用的传输**，不另写请求
//     （一个用别的请求去探的自检，探到的就不是我们会跑的那条路）
//
// 顶层**不引用**任何传输全局：四个方法各自在调用时才取 TranslationAPI / LearnNotes /
// LearnTTS / LearnSpeech，缺了就抛 code:'no_engine'。两个 host 各缺哪个模块都不会在
// 加载期炸 —— 引导页刻意不加载 notes.js/store.js，那不是遗漏。
//
// ⚠️ 设置页的「试听一句」（btn-tts-test）**不在这里**，也不该并进来：它走 speak()
// 真放一遍，回答的是「这台设备放得出声吗」；而 tts() 只合成不播放，回答「配好了吗」。
// 把两者合并等于删掉一项真实检查 —— 一次被浏览器拦下的自动播放会显示成「key 不对」。

var EngineTest = (() => {
  'use strict';

  // 服务端原话，原样附上，不翻译也不改写：它是**证据**，任何加工都会让它对不上
  // 用户去搜的那段文字。
  function serverLine(e, t) {
    const said = e && e.serverMessage;
    return said ? '\n' + t('engine_test_server_said', '服务端原话：{msg}').replace('{msg}', String(said)) : '';
  }

  // 失败具名。用户该看到「哪里不对、怎么改」，而不是一句「测试失败」。
  // code 由各模块抛出（传输层已具名）。
  function reason(e, t) {
    const code = (e && e.code) || '';
    switch (code) {
      case 'no_base': return t('engine_test_no_base', '还没填端点地址');
      case 'no_key': return t('engine_test_no_key', '还没填 API Key');
      case 'no_engine': return t('engine_test_no_engine', '还没选引擎');
      // 设备内置转写（§9.6.1）没有端点可测：这一档的「测试」对它没有定义 —— 具名说清，不是「失败」
      // 本机识别器不可用 / 没回应（device() 抛的）。沿用听译页那句已有文案，不另写一份。
      case 'device_unavailable': return t('listen_need_os', '对话 · 实时字幕需要 iOS 26 / macOS 26');
      case 'device_timeout': return t('engine_test_device_timeout', '本机识别没有回应 —— 关掉 App 重开再试');
      case 'unknown_provider': return t('engine_test_unknown_provider', '这个版本不认识当前存着的引擎，请在上面重新选一个');
      case 'network': return t('stt_network', '连不上端点——检查地址是否可达；自建服务还需允许跨域访问（CORS）')
        + (e && e.viaProxy ? '\n' + t('engine_test_via_proxy', '（已自动改从扩展后台重试，仍未通——所以不是跨域问题，是这个地址从这台机器真的够不着）') : '');
      case 'timeout': return t('engine_test_timeout', '端点没有在超时前回应');
      case 'no_path': return t('engine_test_no_path', '这个地址只有主机名，没有接口路径 —— 请填完整的接口地址（参考输入框里的示例）');
      case 'bad_url': return t('engine_test_bad_url', '地址不是以 http:// 或 https:// 开头 —— 缺协议头会被当成相对路径，请求根本发不出去');
      case 'empty_output': return t('notes_test_empty', '模型没有返回正文——思考（推理）型模型不适合，请换对话模型');
      case 'reasoning_starved': return t('err_reasoning_starved', '模型把整个输出预算用在了思考上，没有产出译文。请在「高级参数」里调高「单次最大输出长度」，或换一个非推理模型。');
      case 'bad_output': return t('engine_test_bad_output', '端点通了，但返回的内容无法解析');
      case 'empty_audio': return t('engine_test_empty_audio', '端点通了，但没有返回音频');
      // 我们的提示是**猜**，服务端那句话是**事实** —— 所以两句都给，事实单起一行。
      case 'http': return t('engine_test_http', 'HTTP {n} —— {hint}')
        .replace('{n}', String(e.status || '?'))
        .replace('{hint}', e.status === 401 || e.status === 403
          ? t('engine_test_hint_key', 'key 不对或没有权限')
          : e.status === 404 ? t('engine_test_hint_404', '地址或模型名不对')
          : t('engine_test_hint_other', '服务端拒绝了这次请求'))
        + serverLine(e, t);
      default: return ((e && e.message) || t('engine_test_failed', '没通')) + serverLine(e, t);
    }
  }

  // 把「地址少了路径 / 缺协议头」从 CORS 里切出来 —— 那两种是本地就能判的错，
  // 让用户去查跨域是把他支到错误的方向。
  function assertEndpointShape(url) {
    const u = String(url || '').trim();
    if (!u) return;                                   // 空 = 用默认端点，不是错误
    if (typeof WireFormat === 'undefined') return;
    if (!WireFormat.isAbsolute(u)) { const e = new Error('not absolute'); e.code = 'bad_url'; e.url = u; throw e; }
    if (!WireFormat.hasPath(u)) { const e = new Error('no path'); e.code = 'no_path'; e.url = u; throw e; }
  }

  // 失焦即判：同一份判据（assertEndpointShape 是 bad_url / no_path 的唯一产地）、
  // 同一份文案（reason），只是把发现的时刻从「点了测试之后」提前到「填完离开输入框」。
  // 返回空串 = 没话说（地址为空是合法的，空 = 用注册表默认端点）。
  //
  // 为什么值得提前：2026-09-21 回读线上 engine_test，失败码里 http 34 条、no_path 9 条、
  // bad_url 0 条 —— 而「只填了主机名」本来就是离线能判的错，它被当成 404 是因为要等到
  // 发过请求才判。提前到失焦，用户改完地址当场就看见。
  function shapeHint(url, t) {
    try { assertEndpointShape(url); return ''; }
    catch (e) { return reason(e, t); }
  }

  // 占位符必须与 _locales 里的写法逐字一致。**兜底串不是真相** —— 它只在 locale
  // 缺键时才用得上，而 11 个 locale 一个不缺，所以代码里写 `{u}` 而 locale 写
  // `{url}` 的后果是：开发时一切正常，真机上原样显示「请求地址：{url}」。
  // 2026-08-31 真机截图实证，之前没有任何门禁看得见这条缝。
  const withUrl = (s, url, t) => (url ? s + '\n' + t('engine_test_url', '请求地址：{url}').replace('{url}', url) : s);
  const withRoute = (s, route, t) => (route ? s + '\n' + t('engine_test_route', '通路：{route}').replace('{route}', route) : s);

  // 成功/失败统一成一段可直接塞进 textContent 的文字。
  function format(r, err, t) {
    if (err) return withRoute(withUrl('✗ ' + reason(err, t), err && err.url, t), err && err.route, t);
    // 本机识别没有端点、没有往返 —— 「通了 · 12ms」对它是句假话。说它真正测了什么。
    if (r && r.local) {
      return r.assets === 'installed'
        ? t('engine_test_device_ready', '✓ 本机识别可用 · 语言包已就绪（不走网络，没有端点可测）')
        : t('engine_test_device_assets', '✓ 本机识别可用 · 语言包会在第一次开始听时自动下载');
    }
    return withRoute(withUrl(
      t('engine_test_ok', '✓ 通了 · {ms}ms').replace('{ms}', String(r.ms))
        + (r.sample ? ' · ' + t('engine_test_sample', '返回：') + r.sample : ''),
      r.url, t), r.route, t);
  }

  const missing = (name) => { const e = new Error(name + ' not loaded'); e.code = 'no_engine'; return e; };

  // ── 四条传输，各走该功能真正用的那条路 ──────────────────────────────
  async function translation(cfg) {
    if (typeof TranslationAPI === 'undefined') throw missing('TranslationAPI');
    assertEndpointShape(cfg.baseUrl);
    const t0 = Date.now();
    // noCache：一个可能不发请求的「测试连接」是有害的（实测过：改完地址点测试，
    // 1ms 返回「通了」，一个包都没出去）。diag 是出参，传输层把真正请求的地址与
    // 走了哪条通路填进来 —— 成功时也要看得见，否则只能靠时间戳倒推。
    const diag = {};
    const out = await TranslationAPI.translate('Hello.', cfg.targetLang || 'zh-CN',
      cfg.provider, cfg.apiKey, cfg.baseUrl, cfg.model, { noCache: true, diag });
    if (!out || !String(out).trim()) { const e = new Error('empty'); e.code = 'bad_output'; throw e; }
    return { ms: Date.now() - t0, sample: String(out).trim().slice(0, 40), url: diag.url, route: diag.route };
  }

  // 形状检查放在 resolveConfig **之后**：解析组可以为空并跟随翻译组（那条规则归
  // LearnNotes.resolveConfig），所以「该检查哪个地址」只有解析完才知道。此前这一支
  // 根本不检查，靠 options.js 在外面自己猜一次（`notes-provider` 非空就查 notes 的框）
  // —— App 没有那一份，于是 App 上的地址错全部落进 http 404。四条传输现在一致。
  async function notes(settings) {
    if (typeof LearnNotes === 'undefined') throw missing('LearnNotes');
    const cfg = LearnNotes.resolveConfig(settings || {});
    assertEndpointShape(cfg.baseUrl);
    LearnNotes.configure(cfg);
    return LearnNotes.test();
  }

  async function stt(cfg) {
    if (typeof LearnSpeech === 'undefined') throw missing('LearnSpeech');
    assertEndpointShape(cfg.baseUrl);
    LearnSpeech.configure(cfg);
    return LearnSpeech.test();
  }

  // 设备内置转写（§9.6.1）：没有端点，「测试连接」无从测起。测真正有意义的那件事 ——
  // 这台设备上本机识别器能不能用、语言包在不在。与 app/listen.js 开始听时走同一个
  // NativeSpeech.probe，不另造判据。
  //
  // 2026-09-17 之前这里根本没有这一支：App 设置页点「测试连接」会落到 LearnSpeech 的
  // engineReady()，抛 device_no_file，而 App 自留的那份旧原因表不认识它，于是原样
  // 显示「✗ device_no_file」—— 一个配对了的引擎被说成失败，还是一串代码。
  //
  // 探测必须有上限：原生不回话时 probe() 的 promise 永不落定（native-speech.js 顶部的疤）。
  async function device(locales, timeoutMs) {
    if (typeof NativeSpeech === 'undefined' || !NativeSpeech.available()) {
      const e = new Error('device'); e.code = 'device_unavailable'; throw e;
    }
    const t0 = Date.now();
    const r = await Promise.race([
      NativeSpeech.probe(Array.isArray(locales) ? locales : []),
      new Promise((res) => setTimeout(() => res({ ok: false, reason: 'timeout' }), timeoutMs || 8000)),
    ]);
    if (!r || !r.ok) {
      const e = new Error((r && r.reason) || 'device');
      e.code = (r && r.reason) === 'timeout' ? 'device_timeout' : 'device_unavailable';
      throw e;
    }
    return { ms: Date.now() - t0, local: true, assets: r.assets };
  }

  async function tts(cfg) {
    if (typeof LearnTTS === 'undefined') throw missing('LearnTTS');
    assertEndpointShape(cfg.baseUrl);
    LearnTTS.configure(cfg);
    return LearnTTS.test();
  }

  // ── 遥测（telemetry-design §3 的 engine_test，2026-09-16 用户裁定）──────────
  //
  // 接在**这一层**，不是四个调用方里：设置页 / 字段行 / 一键卡 / 引导页都调这四个
  // 函数，包在导出处一处覆盖全部，也顺带覆盖两个宿主（这个文件在 App 包里）。
  //
  // 只发「哪一槽、成没成、哪一类错」。**不带 key、不带端点、不带 serverMessage** ——
  // 服务端原话会引用用户输入（serverLine 就是把它原样贴给用户看的），原则 1 明禁。
  //
  // 白名单外的 code 会被客户端静默丢掉，所以这里显式收敛到 'other'：宁可记成「没归类
  // 的失败」，也不要让那一条失败从统计里消失（同 credit_exhausted 那条教训）。
  const TRACK_CODES = ['no_key', 'no_base', 'no_path', 'bad_url', 'no_engine', 'unknown_provider',
    'network', 'timeout', 'http', 'bad_output', 'empty_output', 'empty_audio',
    'reasoning_starved'];   // device_no_file 留在白名单里给历史行读回，客户端自 2026-09-17 起不再产生
  function track(slot, result, code) {
    try {
      if (typeof MTTelemetry === 'undefined') return;
      const props = { slot, result };
      if (result === 'fail') props.code = TRACK_CODES.indexOf(code) >= 0 ? code : 'other';
      MTTelemetry.track('engine_test', props);
    } catch (_) {}
  }
  // 成功/失败都记，且**不改变**调用方看到的东西：原样 return、原样 throw。
  async function probe(slot, run) {
    try { const r = await run(); track(slot, 'ok'); return r; }
    catch (e) { track(slot, 'fail', (e && e.code) || ''); throw e; }
  }

  return {
    reason, serverLine, assertEndpointShape, shapeHint, format,
    translation: (cfg) => probe('chat', () => translation(cfg)),
    notes: (settings) => probe('notes', () => notes(settings)),
    stt: (cfg) => probe('stt', () => stt(cfg)),
    tts: (cfg) => probe('tts', () => tts(cfg)),
    device: (locales, timeoutMs) => probe('stt', () => device(locales, timeoutMs)),
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EngineTest;
