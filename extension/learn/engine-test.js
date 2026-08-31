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

  const withUrl = (s, url, t) => (url ? s + '\n' + t('engine_test_url', '请求地址：{u}').replace('{u}', url) : s);
  const withRoute = (s, route, t) => (route ? s + '\n' + t('engine_test_route', '通路：{r}').replace('{r}', route) : s);

  // 成功/失败统一成一段可直接塞进 textContent 的文字。
  function format(r, err, t) {
    if (err) return withRoute(withUrl('✗ ' + reason(err, t), err && err.url, t), err && err.route, t);
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

  async function notes(settings) {
    if (typeof LearnNotes === 'undefined') throw missing('LearnNotes');
    LearnNotes.configure(LearnNotes.resolveConfig(settings || {}));
    return LearnNotes.test();
  }

  async function stt(cfg) {
    if (typeof LearnSpeech === 'undefined') throw missing('LearnSpeech');
    assertEndpointShape(cfg.baseUrl);
    LearnSpeech.configure(cfg);
    return LearnSpeech.test();
  }

  async function tts(cfg) {
    if (typeof LearnTTS === 'undefined') throw missing('LearnTTS');
    assertEndpointShape(cfg.baseUrl);
    LearnTTS.configure(cfg);
    return LearnTTS.test();
  }

  return { reason, serverLine, assertEndpointShape, format, translation, notes, stt, tts };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EngineTest;
