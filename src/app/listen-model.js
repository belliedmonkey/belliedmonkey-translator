// src/app/listen-model.js — 「对话 · 实时听译」(learning-design §9.6 / interaction-spec 同名一节) — App-only.
//
// 线下听外语：对方说 → 手机上看中文；按住「我说」说中文 → 松手译成外语，放大给对方看并朗读。
// 双显与扩展的直播字幕同型：上卡是**当下**（逐词原文 + 边说边译的临时译文），下面是
// **整句定稿历史**（原文 + 整句译文，可加星）。定稿句对进复习，来源「对话」（默认开）。
//
// 分工（PR6c，原 app/listen.js 拆两半）：
//   · app/listen-core.js —— 纯逻辑：归属、门、语料形状、静音、计时、边说边译策略（不动）。
//   · 这个文件 —— 模型：麦克风（原生桥）、socket、翻译、TTS、语料写入、锁屏卡、停止态，
//     以及全部渲染决策（entryView/historyView/pillView… 把「该画什么」算成数据）。
//   · src/app/listen-view.jsx —— 画布：把数据映射成 JSX，唯一 import React 的一半。
//
// **画布回调（canvas）**：原 renderX()/note()/paint* 的每个调用点，在这里换成
// canvas.view(area) / canvas.entry() —— 画布实现里 flushSync 落 DOM，与原代码逐调用点
// 同时序（verify-listen 的 0 段 / M 段都在 `await AppListen.refreshEntry()` 的**下一条
// 同步语句**里读 DOM，通知不能走异步总线）。画布未挂载时是 no-op（模型单独被测试引入）。
// 入口卡与主视图分两个 store（视图侧）：storage.onChanged 的 refreshEntry 只 bump 入口，
// 不会连坐重渲染主 section —— 页外脚本（verify-listen T2）直写的 #app-listen.hidden 不被盖回。
//
// **直写保留**：#app-listen 与首页 section 的 hidden 切换（open/leave）沿用原直写 —— 它是
// shell 级视图互斥（shell-model 也读它），ListenView 的 JSX 把 hidden 恒写 true，vdom 不变
// React 就永不覆盖真实 DOM（与「孤岛承诺」同一条纪律）。
//
// 麦克风为什么走原生桥（PR-L0，2026-09-07 真机三轮）：WebKit 在 App 不可见时一律静音页内的
// getUserMedia —— 锁屏期间采集帧恒为 0，页内音频保活只能保住 JS。所以 PCM 由 Swift 的
// AVAudioEngine tap 采、重采样、经 mtAudio 桥送进来（NativeAudio.micStart）；socket、翻译、
// 语料写在这里，与扩展共用同一份 ws-transcribe 的收法。没有桥的宿主（Chrome 里的 test:app、
// 扩展页）退回页内 getUserMedia —— 那里没有锁屏问题，能力语义。
//
// 音频只发往用户配置的转写端点（§2.4 规则 5 / §10 Gate E）；不保存任何录音，只保留文字。
import PageText from '../lib/i18n.js';
import Registry from '../lib/registry.js';
import SETTINGS_SCHEMA from '../store/schema.js';

const listenModel = (() => {
  const $ = (id) => document.getElementById(id);
  const t = (k, fb) => PageText.t(k, fb);
  // macOS 宿主：有物理键盘、没有触屏 —— 「按住」的提示要把空格说出来（interaction-spec「macOS」）。
  const isMacHost = () => { try { return /^Mac/.test(navigator.platform || '') && !(navigator.maxTouchPoints > 0); } catch (_) { return false; } };
  const C = ListenCore;
  const PROCESSOR_FRAMES = 4096;
  const SOURCE_LABEL = () => t('listen_source_label', '对话');
  const SUBTITLE_LABEL = () => t('subtitle_source_label', '实时字幕');

  // 页内保活（PR-L0 第三轮实证）：一段不可闻的 WAV 循环播放（8 kHz、0.5 s、全零样本 ——
  // WebKit 只看「有没有元素在播」，不看幅度），WebContent 进程在锁屏后就不会被挂起
  // （计时器 2 s 节流但全程活着）。只在会挂起进程的宿主上放。
  // PR-L2 真机若证明原生录音本身已足以保住 WebContent，这一段就删掉（§9.6）。
  const KEEP_ALIVE_WAV = (() => {
    const rate = 8000, n = rate / 2, data = n * 2;
    const b = new Uint8Array(44 + data);
    const w32 = (o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; b[o + 2] = (v >> 16) & 255; b[o + 3] = (v >>> 24) & 255; };
    const w16 = (o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; };
    const tag = (o, s) => { for (let i = 0; i < 4; i++) b[o + i] = s.charCodeAt(i); };
    tag(0, 'RIFF'); w32(4, 36 + data); tag(8, 'WAVE'); tag(12, 'fmt '); w32(16, 16); w16(20, 1); w16(22, 1);
    w32(24, rate); w32(28, rate * 2); w16(32, 2); w16(34, 16); tag(36, 'data'); w32(40, data);
    let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return 'data:audio/wav;base64,' + btoa(s);
  })();
  let keepAlive = null;

  // ── 会话状态 ──────────────────────────────────────────────────────────────
  // phase: 'idle' | 'preparing' | 'listening' | 'paused' | 'halted' | 'ended'
  // （2026-09-08 去掉了 'speaking'：不再有「按住我说」，双方自由说话、归属按语言判）
  // 放大展示（给对方看）不是 phase：它是历史行上的一个叠层，底下照常在听（showRid）。
  let phase = 'idle';
  // 用法（learning-design §9.8）：'conv' = 对话 · 实时听译；'subtitle' = 实时字幕。差别查 ListenCore.MODES。
  let mode = 'conv';
  let subsReason = '';   // 实时字幕入口最近一次的判定（'' / hidden / no-live / no-key / os / device-os）
  let pauseReason = '';     // 'user' | 'silence' | 'denied' | 'socket' | 'socket-retry' | 'locked' | 'failed'
  let showRid = 0;          // 放大展示中的历史行（0 = 没有）
  let socketRetried = false; // socket 断开后自动重连过一次了吗（成功 ready 时清零）
  // 本机转写路（§9.6.1）：final 按 locale 串句的切句器；离线资产下载进度（downloading 态的胶囊）
  let cutter = null, dlPct = 0, dlLang = '';
  // 语种识别（LID，§9.6.1.3，2026-10-07）：端上模型判「这段音频是哪门语言」，归属由它给。
  // 半句与定稿都**只收 LID 判定的那一路**；'' = 还没判出来（此时什么都不上屏，不是随机先画一路）。
  let lidLang = '';
  let lidLangAt = 0;       // 当前判词是什么时候换过来的（用来算「它稳定了多久」）
  // **判词要稳住才算数**（`lidStable`）：难音频（演播室背景乐 / 多人交叠 / 低电平）上 LID 的判词
  // 会在十几门语言之间**乱跳**（真泰语多人对谈实测 `zh→th→ko→fr→ja→es→la→ru→ur…`），而只要有一条
  // 判成中文，中文路那条垃圾定稿就会上屏。稳不住的判词一律不认 —— 乱跳 ⇒ 什么都不上屏（宁可不显示）。
  const LID_SETTLE_MS = 1500;
  let lidUnsub = null;
  let session = null;
  let cfg = null;
  let sock = null;
  let inc = null;           // 边说边译（ListenCore.makeIncremental）
  let partial = '', partialTr = '';
  let clockTimer = 0;
  let cameFrom = 'signed-in';
  let gen = 0;              // 会话代际：旧会话的异步回调按它作废
  let speakingRid = 0;      // 正在朗读哪一行（0 = 没在读）
  const sq = C.makeSpeakQueue();     // 朗读队列（裁定 7：排队逐句读完）
  const echo = C.makeEchoGuard();    // 回声闸第一层：自己读出去的别再当成一句话收回来
  let speakPumping = false;          // 泵在跑（同一时刻只有一个）
  let speakFails = 0;                // 连续失败次数：三次才说话，不是每句弹一次
  let autoSpeakOff = false;          // 只关**本次会话**的自动朗读，绝不改用户的设置
  let autoAt = [];                   // 保险丝：最近自动入队的时刻
  let lastSpoken = '';               // 最后读出去的那句（端到端测试的读取点）
  // 页内麦克风（无桥宿主的退路）
  let audioCtx = null, stream = null, proc = null, srcNode = null;

  // ── 原来从 DOM 读的四处，提取为模型状态（PR6c）────────────────────────────
  let noteMsg = '', noteErr = true;       // app-listen-note（onMicState 'sound' 与 paintClock 撤销分支要比较它的现值）；初始 err 类对齐原 DOM 的静态 className="note err"
  let speakingShow = false;               // app-listen-flip-speaking（speakOut 异步前点亮、异步后熄灭）
  let ephemeralChecked = false;           // app-listen-ephemeral（start() 在开始那一刻钉住它）
  let mySelVal = '', otherSelVal = '';    // 语言对两个下拉的受控值
  let autoSpeakVal = false;               // 自动朗读勾选框
  let subsCaptureVal = true;              // 「字幕进复习」勾选框（paintMode 的 storage 回填）
  let summaryShown = false;               // 小结卡（open/start 收起、renderSummary 展开）
  let showShown = false;                  // 放大展示卡（renderShow/closeShow）
  // 历史卡外框（app-listen-history-wrap）原 DOM 没有 hidden 属性 —— 恒可见，start() 里那句
  // hidden=false 是空操作。视图静态渲染，不需要状态。

  // 画布：视图挂载时赋实现（listen-view.jsx），默认 no-op。
  const canvas = {
    entry() {},                       // 入口卡（独立 store，不连坐主视图）
    view(_area) {},                   // 'mode' | 'clock' | 'state' | 'note' | 'now' | 'history' | 'show' | 'summary' | 'pip' | 'langs'
    pipRectOn() {},                   // 视图挂载时覆盖：启/停 pip 预览矩形的几何监听
    pipRectOff() {},
  };

  const now = () => Date.now();

  // ── 设置 ──────────────────────────────────────────────────────────────────
  // 2026-09-17：不再读 stt* 四键 —— 那是说题（整段转写）的槽；对话 · 实时字幕固定走本机识别器。
  // PR9：READ_KEYS 手抄清单已删，键表 = schema 的 listen 面（含 notes×4，resolveConfig 用）。
  const READ_KEYS = SETTINGS_SCHEMA.keysFor('listen');
  function readCfg() {
    return new Promise((resolve) => {
      chrome.storage.local.get(READ_KEYS, (s) => {
        s = s || {};
        const tr = LearnNotes.resolveConfig(s);
        const rules = s.learnRules && typeof s.learnRules === 'object' ? s.learnRules : {};
        const B = C.baseCode;
        const sub = mode === 'subtitle';
        // 实时字幕：「对方的语言」换成「视频的语言」（subtitleVideoLang，§9.8 协议补充决定 6）
        // **读的时候就要挡掉不支持的短码**（2026-10-07 真机：`nn` 被写进 listenOtherLang 之后，
        // 每次进场都拿它去探识别器 ⇒ 整场 halt。存量坏值在这一层自愈）。
        const storedOther = sub ? B(s.subtitleVideoLang) : B(s.listenOtherLang);
        const otherLang = langOk(storedOther) ? storedOther : 'en';
        // 「译成」（= 用户想读的语言，2026-10-07 真机反馈后定名）：**默认系统语言** ——
        // 之前跟着界面语言走，界面语言不是中文的人拿到的译文就不是「自己读得懂的那门」。
        // 只在读取时回落，不往存储播种默认值（播种了，用户以后改系统语言这一项就不会跟着动）。
        // 系统语言也要过 `langOk`：系统是 nn/cy 这类我们没有的语言时，落到英文而不是拿它去探识别器。
        const storedTarget = B(s.listenMyLang);
        const sysLang = B(navigator.language);
        const myLang = langOk(storedTarget) ? storedTarget : (langOk(sysLang) ? sysLang : 'en');
        resolve({
          tr,
          // targetLang 从此是 myLang 的别名（原来直接读 uiLang）。留着这个名字是因为
          // draftFor 与端到端测试都在读它 —— 不在同一步里既改语义又改名字。
          targetLang: myLang,
          myLang,
          autoSpeak: !sub && s.listenAutoSpeak !== false,
          fontScale: C.fontStep(s.subtitleFontScale, 0),
          captureOn: sub ? s.subtitleCapture !== false : s.listenCapture !== false,
          mode: sub ? 'subtitle' : 'conv',
          otherLang,
          lang: otherLang,   // 对方说的语言 = 「对方的语言」选择（进语料时的 lang）
          langs: Array.isArray(rules.langs) && rules.langs.length ? rules.langs : null,
          registry: Registry.langs(),
          label: sub ? SUBTITLE_LABEL() : SOURCE_LABEL(),
        });
      });
    });
  }
  // 本机转写（§9.6.1）是这一页**唯一**的转写路（2026-09-17 起，learning-design §9.6 门控修订）：
  // 没有云端 socket、没有引擎下拉、没有 key。桥在不在由 NativeSpeech 探过才知道。
  function deviceBridge() { return typeof NativeSpeech !== 'undefined' && NativeSpeech.available(); }
  // 一个 locale 一路识别器：我方 + 对方（两边一样时只开一路）。
  function deviceLocales(c) {
    // 实时字幕只开「视频的语言」一路识别器（MODES.subtitle.recognizers = 1）
    if (c && c.mode === 'subtitle') return [C.toLocale(c.otherLang)];
    const a = C.toLocale(c && c.myLang), b = C.toLocale(c && c.otherLang);
    return a === b ? [a] : [a, b];
  }
  // 入口可用 ⇔ 原生桥报告本机识别器可用（探过 probe 之后读缓存的结果）
  function liveCapable() { return deviceBridge() && NativeSpeech.probeResult().ok; }
  // 不可用的原因只有两句、互斥：系统太旧（桥回 os / 无桥）或语言不支持（桥回 locale）。
  // 都不是配置问题 —— 所以没有「去设置里选择 →」。
  function unavailableReason() {
    if (!deviceBridge()) return 'os';
    const r = NativeSpeech.probeResult();
    return r.ok ? '' : (r.reason === 'locale' ? 'locale' : 'os');
  }
  function needText(reason) {
    return reason === 'locale'
      ? t('listen_need_locale', '本机识别器不支持这门语言 —— 换一种语言试试')
      : t('listen_need_os', '对话 · 实时字幕需要 iOS 26 / macOS 26');
  }
  let trackedNoLive = false;

  // ── 首页入口（门控与播客模式同规矩：门不过入口不存在，留一条去设置的路）──────
  // 入口在登录前后两个首页上都有（对话不依赖账号：语料写本机，§9.6），同一门控。
  const ENTRY_SUFFIXES = ['', '2'];
  // 入口卡的**数据**（entryView），视图按它渲染。键按 sfx 分存。
  const entryState = { '': null, '2': null };
  async function refreshEntry() {
    let ok = false;
    try {
      const c = await readCfg();
      // 先探桥（旧系统 / 语言不支持 / 资产缺失都在这里得到具名答案），再判门
      if (deviceBridge()) await NativeSpeech.probe(deviceLocales(c));
      ok = liveCapable();
    } catch (_) { ok = false; }
    try { canvas.view('langs'); } catch (_) {}   // 探到支持的语种清单 ⇒ 下拉只列支持的
    const reason = ok ? '' : unavailableReason();
    // 门没过：入口**灰掉 + 一句原因**（用户 09-07 裁定 A），而不是消失 —— 灰掉更容易被发现，
    // 也回答了「这个按钮为什么不能用」。播客模式仍按它自己的规矩（门不过不存在）。
    // 2026-09-17 起原因只有两句（系统 / 语言），都不是配置问题 ⇒ 「去设置里选择 →」常藏。
    // asr_entry{no_live}（telemetry §3.3.3）：含义改为「本机识别器不可用」，每次启动记一次。
    if (!ok && !trackedNoLive) {
      trackedNoLive = true;
      try { if (typeof MTTelemetry !== 'undefined') MTTelemetry.track('asr_entry', { surface: 'app_home', result: 'no_live' }); } catch (_) {}
    }
    // 写序同原文的 DOM 写序：refreshEntry **先**写对话行，refreshSubtitleEntry 在里面读它
    // 刚写的文案做「合成一句」比对 —— 所以这里先落 listen 数据，再 await 字幕行，最后统一 bump。
    // 形状与 subsEntryState 平齐（entryView 原样转发）：对话行的 ok 也要在顶层 ——
    // 隐私句的 hidden=!ok 由它驱动。此前误包了一层 listen:{}，视图读到的全是 undefined。
    for (const sfx of ENTRY_SUFFIXES) {
      entryState[sfx] = {
        ok,
        hidden: false, disabled: !ok,
        hint: t('listen_entry_short', '对方说，你看中文；按住说中文，译给对方'),
        privacy: t('listen_entry_privacy_device', '本机转写，边说边出字；整句定稿后接上你自己配置的翻译引擎。'),
        needShown: !ok,                      // 原 need.hidden = ok
        why: ok ? '' : needText(reason),     // 原 `if (why && !ok) why.textContent = needText(reason)`
      };
    }
    await refreshSubtitleEntry(ok, reason);
    canvas.entry();
  }

  // 实时字幕入口（learning-design §9.8 + 协议补充决定 3）：原生不回 audio-caps ⇒ 整行不显示（老壳）；
  // 回了就按 ListenCore.entryGate 的顺序给灰态原因（本机识别器不可用 → Mac 系统声音版本）。
  const subsEntryState = { '': null, '2': null };
  async function refreshSubtitleEntry(ok, deviceReason) {
    let caps = null;
    try { caps = bridged() ? await NativeAudio.capsProbe(1500) : null; } catch (_) { caps = null; }
    const reason = C.entryGate({ caps, deviceOk: ok, deviceReason });
    subsReason = reason;
    for (const sfx of ENTRY_SUFFIXES) {
      const subs = {
        hidden: reason === 'hidden', disabled: !!reason,
        hint: t('subtitle_entry_hint', '给正在播放的视频、直播、会议配双语字幕'),
        needShown: false, needWhy: '',
        // 没有任何一种灰态是「去设置」能解决的（系统版本 / 语言）—— 不给一个点了也没用的按钮
      };
      if (reason && reason !== 'hidden') {
        subs.needShown = true;
        // 2026-09-29 清理（1.19.0）：删掉了「系统声音字幕需要 macOS 14.4 或更新」那句 ——
        // 2026-09-17 §9.6 修订后实时转写只走设备内置识别器（iOS/macOS 26 下限），而 26 ≥ 14.4，
        // 所以 caps.system='os' 只可能出现在 deviceOk=false 的机器上，那时 entryGate 先回
        // 'device-os'，这里显示的已经是 needText('os') 那句**真**的「需要 iOS 26 / macOS 26」。
        // 万一未来哪条路真把 'os' 送进来（deviceOk=true 而 caps 却说 'os'），也落同一句，
        // 不再有第二份版本号要维护。
        subs.needWhy = needText(reason === 'locale' ? 'locale' : 'os');
      }
      // 两个入口因同一个原因灰掉时（例：旧系统上选了设备内置转写），首页只说一次 —— 同一句连写两遍像出错了
      // （用户 2026-09-15 裁定「合成一句」）。留对话那一行：它在上面，「去设置里选择 →」去的是同一个地方。
      // 原代码比对的是 refreshEntry 刚写上 DOM 的 listen 行文案；entryState 里躺的就是同一份
      // 数据（listen.needShown = !ok，why = needText(listenReason)），直接比字符串。
      const listen = entryState[sfx];
      if (subs.needShown && listen && listen.needShown && listen.why === subs.needWhy) {
        subs.needShown = false;
      }
      subsEntryState[sfx] = subs;
    }
  }

  // ── 翻译 ──────────────────────────────────────────────────────────────────
  // errOut：定稿行的调用方传一个空对象进来接住错误（遥测要它的 code）；半句的增量翻译不传 ——
  // 半句失败没有界面后果，也不记。
  async function translate(text, toLang, errOut) {
    if (!cfg || !cfg.tr || !cfg.tr.provider || !cfg.tr.apiKey) return '';
    try {
      return await TranslationAPI.translate(text, toLang, TranslationAPI.resolveProvider(cfg.tr.provider), cfg.tr.apiKey, cfg.tr.baseUrl || '', cfg.tr.model || '');
    } catch (e) { if (errOut) errOut.err = e; return ''; }
  }

  // ── 用量事件（docs/telemetry-design.md §3.3 裁定 1、§3.4 裁定 A）────────────────
  // App 的听译 / 实时字幕出译文 ⇒ translate_ok{kind:'subtitle'}：`host='app'` 已经把它与网页
  // 视频字幕分开，不新增 kind。与网页侧同义 —— **每个会话一次**（第一句定稿译文落地），
  // 不是每句一条。这条 09-16 就裁定了，却只进了文档没进代码：1.12.x 有 7 台开始了听译，
  // 译文事件 0 条（§3.4）。
  //
  // 失败同理：每个会话、每个 code 至多一条 —— 一场里三十句全 401 是一件事，不是三十件
  // （网页侧一段一条，5 天里 308 条 401 来自同一台机器，§3.1）。只记**请求真的失败**：
  // 没配引擎（没有 err）不是一次失败的翻译，那是 asr_entry / engine_set 回答的问题。
  // 没有原文、没有地址 —— 只有引擎 id、错误码、状态码、通路。
  function tmProvider() { return String((cfg && cfg.tr && cfg.tr.provider) || ''); }
  function tmOk() {
    if (!session || session.tmOk) return;
    session.tmOk = true;
    try {
      if (typeof MTTelemetry !== 'undefined') {
        MTTelemetry.track('translate_ok', { provider: tmProvider(), kind: 'subtitle', ms: Math.max(0, now() - session.startedAt) });
      }
    } catch (_) {}
  }
  function tmFail(e) {
    if (!session || !e) return;
    const code = typeof e.code === 'string' ? e.code : 'network';
    session.tmFailed = session.tmFailed || {};
    if (session.tmFailed[code]) return;
    session.tmFailed[code] = true;
    try {
      if (typeof MTTelemetry !== 'undefined') {
        MTTelemetry.track('translate_fail', {
          provider: tmProvider(), code,
          status: Number.isInteger(e.status) ? e.status : 0,
          route: e.route === 'proxy' ? 'proxy' : (e.route === 'direct' ? 'direct' : ''),
          ms: Math.max(0, now() - session.startedAt),
        });
      }
    } catch (_) {}
  }
  // 方向的唯一来源：我说的译成对方的语言，对方说的译成我的语言。改边（↔）之后同一行
  // 会换一个方向重译，所以它必须**按 row.who 现算**，不能记在行上。
  function targetLangFor(row) { return row.who === 'me' ? cfg.otherLang : cfg.myLang; }

  // 一行的译文：失败要留下「译文失败 · 重试」，不是永远的 ⏳（silent-failures-need-visible-exit）
  async function translateRow(row, toLang, quiet) {
    const myGen = gen;
    row.trErr = false; row.trBusy = true; canvas.view('history');
    const t0 = now();
    const eo = {};
    const tr = await translate(row.text, toLang == null ? targetLangFor(row) : toLang, eo);
    if (myGen !== gen) return;
    if (row.lat) row.lat.pass = now() - t0;
    row.trBusy = false; row.tr = tr || ''; row.trErr = !tr;
    if (row.tr) tmOk(); else tmFail(eo.err);
    canvas.view('history'); paintNowPlaying(); if (showRid === row.rid) canvas.view('show');
    subFinal(row);
    if (row.tr) { maybeWrite(row); if (!quiet) autoSpeak(row); }
  }

  // 本机路（§9.6.1）：每句一次远程「修正 + 翻译」。原始句先上屏（row.raw），修正稿回来换成 row.text，
  // 语料写修正文；修正不过接受门就只取译文。失败与 translateRow 同形：留「译文失败 · 重试」。
  function langName(code) {
    const c = String(code || '');
    const n = (TranslationAPI.LANG_NAMES || {})[c] || (TranslationAPI.LANG_NAMES || {})[c.split('-')[0]];
    return n || langLabel(c) || c;
  }
  async function passRow(row, quiet) {
    if (!cfg || !cfg.tr || !cfg.tr.provider || !cfg.tr.apiKey) { row.trErr = true; row.trBusy = false; canvas.view('history'); return; }
    const myGen = gen;
    row.trErr = false; row.trBusy = true; canvas.view('history');
    const srcLang = row.who === 'me' ? cfg.myLang : cfg.otherLang;
    const dstLang = targetLangFor(row);
    const prompt = C.buildListenPrompt({
      text: row.raw || row.text, alts: row.alts || [], who: row.who,
      srcLang, dstLang, srcName: langName(srcLang), dstName: langName(dstLang),
      context: C.contextRows(session ? session.rows : [], row),
    });
    let reply = '', passErr = null;
    const t0 = now();
    try {
      reply = await TranslationAPI.listenPass(prompt, TranslationAPI.resolveProvider(cfg.tr.provider), cfg.tr.apiKey, cfg.tr.baseUrl || '', cfg.tr.model || '');
    } catch (e) { reply = ''; passErr = e; }
    if (myGen !== gen) return;
    if (row.lat) row.lat.pass = now() - t0;
    const parsed = C.parseListenReply(reply, row.raw || row.text);
    if (parsed.tagged && C.acceptCorrection(row.raw || row.text, parsed.text, routeDeps)) row.text = parsed.text;
    row.trBusy = false; row.trTemp = false; row.tr = parsed.tr || ''; row.trErr = !row.tr;
    if (row.tr) tmOk(); else tmFail(passErr);
    canvas.view('history'); paintNowPlaying(); if (showRid === row.rid) canvas.view('show');
    subFinal(row);
    if (row.tr) { maybeWrite(row); if (!quiet) autoSpeak(row); }
  }
  // 重译入口：本机路走修正契约，云端路走普通翻译。
  function retranslate(row, quiet) { return row.raw != null ? passRow(row, quiet) : translateRow(row, null, quiet); }

  // 归属判断的注入点。生产里就是 LearnRules.dominantScript（已在 App 包里）；
  // 拿不到它时 sideOf 恒返回空，归属全走粘性兜底 —— 不抛，也不假装判得准。
  const routeDeps = {
    dominantScript: (text) => (typeof LearnRules !== 'undefined' && LearnRules.dominantScript
      ? LearnRules.dominantScript(text) : null),
  };

  // ── 语料写入（§9.6：定稿译文首次进历史时写一次；星绕过门）────────────────────
  const deps = {
    langAllowed: (lang, text, langs, registry) => (typeof LearnRules !== 'undefined' ? LearnRules.langAllowed(lang, text, langs, registry) : true),
    shouldCapture: (draft) => (typeof LearnModel !== 'undefined' && LearnModel.shouldCapture ? LearnModel.shouldCapture(draft) : true),
  };
  async function maybeWrite(row) {
    if (!session || !C.shouldWrite(row, session, cfg, deps)) return;
    if (typeof LearnStore === 'undefined' || typeof LearnModel === 'undefined') return;
    row.written = true;   // 先标再写：写失败下一次不会重试，但也不会把同一句写两遍
    try {
      const draft = C.draftFor(row, session, cfg);
      const item = LearnModel.makeItem(draft, now());
      await LearnStore.mergeBatch([item], [C.sourceFor(session, cfg.label)]);
      // 写成功之后才记（Collector law 2）—— 失败会走下面的 catch 把 written 退回去。
      // 同 app/docs.js：内容脚本 learn-collector.js 不进 App 包，App 的采集 seam 只有这里。
      try { if (typeof MTTelemetry !== 'undefined') MTTelemetry.once('capture_first'); } catch (_) {}
    } catch (_) { row.written = false; }
    canvas.view('history');
  }
  async function toggleStar(row) {
    row.starred = !row.starred;
    canvas.view('history');
    if (!row.starred) return;   // 取消星不删卡：卡已经是用户的了（同复习页的规则）
    if (row.written) {
      // 已写过：再合并一次，mergeItem 的 starred 是 OR，state 随之升为 learning
      try {
        const item = LearnModel.makeItem(C.draftFor(row, session, cfg), now());
        await LearnStore.mergeBatch([item], [C.sourceFor(session, cfg.label)], { accumulate: false });
      } catch (_) {}
      return;
    }
    await maybeWrite(row);
  }

  // ── socket ────────────────────────────────────────────────────────────────
  // 2026-09-17 之前这里按引擎分流：云端 socket（WsTranscribe.open）或本机路。云端实时档下线后
  // 只剩本机路；`sock` 这个名字与生命周期（open / close / socketLost 重连一次）原样保留 ——
  // NativeSpeech.sttOpen 本来就是照 socket 的返回形状做的。
  function openSocket() { openDevice(gen); }
  function closeSocket() {
    const s = sock; sock = null;
    cutter = null;
    try { if (s) s.close(); } catch (_) {}
  }
  // 本机路：NativeSpeech.sttOpen 返回 { sendPcm(){}, close() }，事件 ready / partial / final / error / close。
  // 两路识别器同时出 final，先按「文字系 + 置信度」收（C.acceptDeviceFinal），再按 locale 串句
  // （C.makeStreamCutter），归属直接由 locale 给（addFinal 的 deps.who）。
  // ── 半句与定稿的归属：由端上 LID 模型给（§9.6.1.3）────────────────────────────
  // 这一条是「半句闪错语言」的根治（2026-10-07 真音频复现后定案）。旧办法在**没有信息**时做选择：
  // 半句阶段两路识别器都没有置信度（conf -1），谁先到谁上屏就是随机 —— 说中文时泰语路把中文硬解成
  // 泰文的半句先画上去，几秒后才被改回来。端上 LID（sherpa-onnx SLID / whisper tiny）直接给语言，
  // 两路里只有那一路的半句/定稿能上屏；判出来之前**什么都不画**（显示「正在说…」）。
  // 代价如实记（§9.6.1.3）：LID 要 ~1–2s 才稳 ⇒ 每句话的开头一小段没有实时预览，第一句最明显。
  const PARTIAL_TTL_MS = 2500;
  let partialBy = {};   // locale base → { text, at }（正常至多一条：只有 LID 那一路会进来）
  // 当前该显示的那一条半句：只有 LID 那一路会进 partialBy，取最新即可（戴上时钟帽防挂死）。
  function pickPartial() {
    const at = Date.now();
    const list = Object.keys(partialBy).map((k) => partialBy[k]).filter((c) => c && (at - c.at) < PARTIAL_TTL_MS);
    if (!list.length) return null;
    return list.reduce((a, b) => ((b.at || 0) >= (a.at || 0) ? b : a));
  }
  function clearPartials() { partialBy = {}; partial = ''; partialTr = ''; }
  // LID 判词订阅（§9.6.1.3）。**本场归属的唯一判据**：判词到一条就把当前语言换成它。
  // 订阅一次即可（会话结束麦克风也就停了，不会再判词），新会话只把语言清空从头来。
  function lidOn() {
    lidLang = '';
    lidLangAt = 0;
    if (lidUnsub) return;
    try {
      lidUnsub = NativeSpeech.onLid((r) => {
        const lang = C.lidBase(r && r.lang);
        if (!lang || lang === lidLang) return;   // 同一门语言重复报：不算新的（稳定性按「换的那一刻」起算）
        lidLang = lang;
        lidLangAt = Date.now();
        canvas.view('state');
        // §9.6.1.4：稳住之后自动跟随（对方那一格换成它）—— 用户一个字都不用选。
        if (lidSettleTimer) clearTimeout(lidSettleTimer);
        lidSettleTimer = setTimeout(() => {
          lidSettleTimer = 0;
          if (lidStable() === lang) autoFollow(lang);
        }, LID_SETTLE_MS + 50);
      });
    } catch (_) { lidUnsub = null; }
  }
  /** 归属用的语言：**只认已经稳住 ≥LID_SETTLE_MS 的判词**，稳不住 ⇒ ''（不上屏）。 */
  function lidStable() {
    if (!lidLang) return '';
    return (Date.now() - lidLangAt) >= LID_SETTLE_MS ? lidLang : '';
  }
  /** 语言状态给界面用：'' = 还没开始 / 'detecting' 正在识别 / 'ready' 已识别（mine/other 可读）。 */
  function langState() {
    if (!session) return '';
    return lidStable() ? 'ready' : 'detecting';
  }

  // ── 自动跟随：「对方」那一格不再由用户选（§9.6.1.4，用户 2026-10-07 拍）──────────────
  // LID 判出**稳住**的语言 L，且 L 既不是我的语言、也不是当前对方语言 ⇒ 把对方换成 L：
  // ① 立刻 `sock.setLangs`（原生只换 SpeechAnalyzer 的模块，**不重连**、麦克风不停）；
  // ② 资产没装的话原生静默跳过 ⇒ 后台补包，补好再换一次（下一次开口就能用）；
  // ③ 记住它（listenOtherLang / subtitleVideoLang）—— 下次进场拿它当起点，紧接着又被 LID 修正。
  // 防抖 2s：判词在难音频上会来回跳，别跟着疯换。
  let langAutoAt = 0, lidSettleTimer = 0;
  let langEdit = false;      // 「语言不对？」半屏 sheet 开着（默认关，§9.6.1.5）
  let langManual = false;    // true = 用户手动指定过语言 ⇒ 自动跟随停（§9.6.1.5）
  function toggleLangEdit() { langEdit = !langEdit; canvas.view('state'); }
  /** 手动指定（sheet 里那两个下拉）：一旦手动 ⇒ 关掉自动跟随，LID 不再改「对方」那一格。 */
  function langChangeManual(which, value) {
    if (!langManual) { langManual = true; chrome.storage.local.set({ listenLangManual: true }); }
    langChange(which, value);
  }
  /** 回「自动识别」：清掉手动标记，之后 LID 又接管「对方」那一格。 */
  function setLangAuto() {
    langManual = false;
    chrome.storage.local.set({ listenLangManual: false });
    canvas.view('state');
  }
  const AUTO_GAP_MS = 2000;
  function autoFollow(lang) {
    const L = C.baseCode(lang);
    if (!L || !cfg || !session) return;
    if (phase !== 'listening' && phase !== 'preparing') return;
    if (L === C.baseCode(cfg.myLang) || L === C.baseCode(cfg.otherLang)) return;
    if (langManual) return;          // 用户手动指定过 ⇒ 自动跟随停（§9.6.1.5）
    // **只认我们支持的语言**（2026-10-07 真机批 28）：LID 的 99 类闭集里有 `nn`/`cy` 这类
    // 我们根本没有的语言（静音/噪声上很常见）。以前直接跟随 ⇒ 拿 `nn` 去探识别器 ⇒
    // `unsupported/locale` ⇒ 整场 halt（「本机识别器不支持这门语言」+「对方说的：nn」）。
    if (!langOk(L)) return;
    const now = Date.now();
    if (now - langAutoAt < AUTO_GAP_MS) return;
    langAutoAt = now;
    // 走**既有那条换语言的路**（补包 + 重连；只动识别器，麦克风不停）。
    // 为什么不用 `SpeechAnalyzer.setModules` 就地换：2026-10-07 实测它在 macOS 27 SDK 上
    // **直接 trap**（EXC_BREAKPOINT 在 Apple 内部 `TranscriberCommon.worker.setter`），
    // 崩在 `setModules` → `prepareModulesIfNeeded` → `setWorkers`。重连这条是既有代码、验过的。
    langChange('other', L, { skipTts: true });   // 只补识别资产，不因为「听到一门新语言」下朗读包
  }

  // LID 模型清单（app/device-models.config.js 的 MT_DEVICE_LID）；只在 App 包里。
  function lidModel() {
    try {
      if (typeof mtDeviceLidModelsFor !== 'function') return null;
      return mtDeviceLidModelsFor(Registry.flavor() || 'global');
    } catch (_) { return null; }
  }
  // VAD 模型清单（app/device-models.config.js 的 MT_DEVICE_VAD）；只在 App 包里。
  function vadModel() {
    try {
      if (typeof mtDeviceVadFor !== 'function') return null;
      return mtDeviceVadFor(Registry.flavor() || 'global');
    } catch (_) { return null; }
  }
  // 画当前该显示的那一路半句（只有 LID 那一路会进 partialBy，见 pickPartial）。
  function refreshPartial() {
    const pick = pickPartial();
    partial = pick ? pick.text : '';
    // 回声闸也要拦**半句**：整句那道只在定稿时判，而边说边译在半句上就会发翻译请求 ——
    // 自己朗读的内容回来时，环虽然断在定稿那一层，钱已经花出去了（2026-09-08 端到端实证）。
    if (partial && echo.isEcho(partial, now())) { canvas.view('now'); return; }
    if (inc) inc.onPartial(partial);
    canvas.view('now');
    subShow(partial, '', true);
  }
  function openDevice(myGen) {
    const locales = deviceLocales(cfg);
    const me = C.toLocale(cfg.myLang);
    const cut = C.makeStreamCutter((locale, sent) => {
      if (myGen !== gen || cutter !== cut || !sock) return;
      onFinal(sent, { who: locale === me ? 'me' : 'them', locale });
    });
    cutter = cut;
    const gate = C.makeFinalGate(routeDeps);   // 同一路之内的文字质量闸（低置信的拉丁句头先扣住、紧接的好片来了再接回）
    // 收一片定稿：**归属已由 LID 定死**（只有 LID 那一路走得进来），再过文字闸、进串句器。
    const takeFinal = (f) => {
      if (myGen !== gen || cutter !== cut || !sock) return;
      for (const tt of gate.push(f)) cut.add(f.locale, tt);
    };
    sock = NativeSpeech.sttOpen({
      locales,
      onEvent: (kind, ev) => {
        if (myGen !== gen) return;
        if (!sock && (kind === 'partial' || kind === 'final')) return;
        if (kind === 'ready') { socketRetried = false; }
        else if (kind === 'partial') {
          const base = C.baseCode(ev && ev.locale);
          // 我们自己正在朗读这门语言 ⇒ 这条半句是我们自己的声音（回声修，见 speakPump / echo.playingLangs）
          if (base && echo.playingLangs(Date.now()).has(base)) return;
          if (!C.sideMatchesLid(ev && ev.locale, lidStable())) return;   // LID 判的不是这一路（或还没稳住）⇒ 半句不上屏（§9.6.1.3）
          if (C.acceptDeviceFinal(ev, routeDeps)) onPartial(ev.locale, ev.text);
        }
        else if (kind === 'final') {
          const base = C.baseCode(ev && ev.locale);
          if (base && echo.playingLangs(Date.now()).has(base)) return;   // 同上：正在朗读这门语言
          if (!C.sideMatchesLid(ev && ev.locale, lidStable())) return;     // 错语言那一路对同一段音频的解读，丢（判词没稳住也丢）
          takeFinal(ev);
        }
        else if (kind === 'error') socketLost(ev.reason || '');
        else if (kind === 'close') { if (phase !== 'ended' && phase !== 'halted' && phase !== 'paused' && phase !== 'idle') socketLost(ev.reason || ''); }
      },
    });
  }
  // socket 断了：先自动重连一次（2 s），期间主按钮「重连中…」、我说灰；再断才停在具名态。
  function socketLost(why) {
    if (!socketRetried && (phase === 'listening' || phase === 'preparing')) {
      socketRetried = true;
      halt('socket-retry', why);
      setTimeout(() => { if (phase === 'halted' && pauseReason === 'socket-retry') resume(); }, 2000);
      return;
    }
    halt('socket', why);
  }

  function onPartial(locale, text) {
    const key = C.baseCode(locale);
    const t = String(text || '').trim();
    if (!t) delete partialBy[key]; else partialBy[key] = { text: t, at: Date.now() };
    refreshPartial();   // 归属已由 LID 定死 ⇒ 不必再扣住等另一路（旧的三档择一随 LID 退场）
  }
  function onFinal(text, meta) {
    if (meta && meta.locale) delete partialBy[C.baseCode(meta.locale)];   // 这一路定稿了，它的半句退休
    // 回声闸第一层：我们自己刚读出去的那句被麦克风录回来了 ⇒ **整句丢弃** —— 不进历史、
    // 不翻译、不写语料、不朗读、不算进小结。它根本不是一句话。
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean && echo.isEcho(clean, now())) { clearPartials(); canvas.view('now'); return; }
    // 本机路把「哪一路识别器认出来的」当归属（meta.who）；云端路没有 meta，照旧按语言判
    if (diagAudioOn) { try { diagSidecar.push({ t: Date.now(), k: 'stt', loc: (meta && meta.locale) || '', text: clean.slice(0, 500) }); } catch (_) {} }
    const row = C.addFinal(session, text, now(), cfg, meta && meta.who ? Object.assign({}, routeDeps, { who: meta.who }) : routeDeps);
    if (!row) return;
    // 时延埋点（§9.6.1 四段目标的读数来源；只给 _debug / 真机读回，不进遥测）
    row.lat = { final: now(), engine: 'device' };   // 2026-09-17 起只有本机路
    partial = ''; partialTr = '';
    // 两边的定稿走同一条路，只是目标语言相反（targetLangFor）。2026-09-08 之前
    // 「我说的」在这里直接 return，等松手时整段处理 —— 那条路随按住一起没了。
    const reuse = inc ? inc.close(row.text) : '';
    canvas.view('now'); canvas.view('history');
    if (meta && meta.locale) {
      // 本机路：原始句立即上屏；复用的临时译文斜体，等修正稿回来换正体；修正契约必发
      row.raw = row.text; row.alts = Array.isArray(meta.alts) ? meta.alts : [];
      if (reuse) { row.tr = reuse; row.trTemp = true; canvas.view('history'); }
      subShow(row.text, row.tr || '', true);
      passRow(row);
      return;
    }
    if (reuse) { row.tr = reuse; canvas.view('history'); paintNowPlaying(); subFinal(row); maybeWrite(row); autoSpeak(row); }
    else { subShow(row.text, '', true); translateRow(row); }
  }

  // ── 实时字幕：字幕条 / 画中画（§9.8）──────────────────────────────────────
  // 原生零文案：半句与定稿走 subtitle-show，停机态走 subtitle-state，每个态的字在 subtitle-config 里。
  function subOn() { return !!(session && session.mode === 'subtitle' && bridged()); }
  let pipWindow = '';            // iPhone 画中画小窗状态：inline / floating / closed（subtitle-window，协议补充决定 19）
  // closed 的原因：**空 = 用户点了小窗上的 ✕**（⇒ 暂停听，19 修订）；failed / not-active = 根本没浮出来（⇒ 出「浮出字幕窗」）
  let pipReason = '';
  let subPartialShown = false;   // 条上此刻是不是一个半句（停下时要清掉，否则「粗加工。…」一直挂着 —— 真机读数 2026-09-14）
  function subShow(orig, tr, isPartial) { if (subOn()) { subPartialShown = !!isPartial; NativeAudio.subtitleShow({ orig: orig || '', tr: tr || '', partial: !!isPartial }); } }
  function subFinal(row) {
    if (!subOn() || !row) return;
    if (row.tr) {
      subPartialShown = false; NativeAudio.subtitleShow({ orig: row.text, tr: row.tr, partial: false });
      if (phase === 'listening') NativeAudio.subtitleState('listening');
    } else if (row.trErr) {
      subPartialShown = false; NativeAudio.subtitleShow({ orig: row.text, tr: '', partial: false });
      NativeAudio.subtitleState('tr-failed');
    }
  }
  function subState(state, pct) {
    if (!subOn()) return;
    // 停下的几种状态：条上悬着的半句已经作废（暂停/停机时 partial 已清空），换成空，只留状态行与出口
    if (subPartialShown && !/^(listening|downloading|reconnecting|silent)$/.test(state)) { subPartialShown = false; NativeAudio.subtitleShow({ orig: '', tr: '', partial: false }); }
    NativeAudio.subtitleState(state, pct);
  }
  // 字幕条 A− / A+（§9.8 协议补充决定 9）：字号由页面存（设置与条永远一致），改完重发 subtitle-config
  function subFont(dir) {
    if (!subOn() || !cfg) return;
    cfg.fontScale = C.fontStep(cfg.fontScale, dir);
    try { chrome.storage.local.set({ subtitleFontScale: cfg.fontScale }); } catch (_) {}
    NativeAudio.subtitleConfig({ labels: subtitleLabels(), clickThrough: false, fontScale: cfg.fontScale, opacity: 1 });
  }

  // iPhone 画中画（§9.8 协议补充决定（三）17、19、20）：「现在」卡里的占位块就是小窗预览的位置 —— 系统要求画中画的来源在屏幕上，
  // 原生在同一矩形上叠预览，离开 App 时由它自动浮出。位置随版面 / 滚动节流重发；滚出视口发 null。
  function pipHost() {
    const c = bridged() ? NativeAudio.audioCaps() : null;
    return !!(session && session.mode === 'subtitle' && c && c.system === 'unsupported');
  }
  let pipOff = null, pipLastRect = '';
  // 预览占位块的几何从**画布**来（rect 感知在视图）：视图装 ResizeObserver/滚动监听，
  // 节流后把算好的矩形（或 null）递回来，去重与发桥留在这里。
  function pipRectUpdate(rect) {
    if (!pipHost()) return;
    const key = JSON.stringify(rect);
    if (key === pipLastRect) return;
    pipLastRect = key;
    NativeAudio.subtitleFloat(rect);
  }
  function pipRectOn() {
    if (!pipHost()) return;
    pipLastRect = '';     // 先清（原 :495 同序）：首发矩形与上一场相同也不能被去重吃掉
    canvas.pipRectOn();   // 视图实现：装监听 + 首发一次（会回调 pipRectUpdate）
  }
  function pipRectOff() { if (pipOff) { pipOff(); pipOff = null; } canvas.pipRectOff(); pipLastRect = ''; }
  function paintPipFloat() {
    // 只有**小窗没浮出来**（failed / not-active）才给这个按钮；用户自己 ✕ 关掉的那次是暂停，回来的路是主按钮「继续」
    canvas.view('pip');
  }
  function pipFloatShown() { return !!(pipHost() && phase !== 'ended' && pipWindow === 'closed' && !!pipReason); }
  // 预览占位块上的一句话：开始前 / 结束后原生预览不在（会话中它盖在这句上面）——不是一块莫名其妙的黑（用户 2026-09-14 手测）
  function pipNoteText() {
    return phase === 'ended' ? t('subtitle_pip_note_ended', '这次字幕已结束，小窗已关闭')
      : (!session || phase === 'idle') ? t('subtitle_pip_note_idle', '点「开始」后，这里是字幕小窗的预览；离开本 App 时它会浮在其它 App 上')
        : t('subtitle_pip_note_live', '字幕小窗的预览 —— 离开 App 时会浮在其它 App 上');
  }
  function subtitleLabels() {
    // iPhone（原生报 system:'unsupported'）听的是麦克风里的外放，不是系统声音 —— 两句状态文案按平台分（15 Pro 手测看到沿用了 Mac 的说法）
    const caps = bridged() ? NativeAudio.audioCaps() : null;
    const mic = !!(caps && caps.system === 'unsupported');
    return {
      // 画中画小窗（iPhone）：空窗时的说明、翻看历史时顶部那行（用户 2026-09-14 手测后裁定）
      pip: {
        title: t('subtitle_pip_title', '实时字幕'),
        hint: t('subtitle_pip_hint', '在任意 App 里外放视频或音频，字幕会出现在这里'),
        close: t('subtitle_pip_close', '点一下小窗：⏸ 暂停 · ⏪⏩ 翻看历史 · ✕ 关掉（回 App 可再打开）'),
        history: t('subtitle_pip_history', '历史 · 点 ⏩ 回到最新'),
      },
      state: {
        'waiting-permission': t('subtitle_bar_waiting', '等待系统授权 — 请在弹出的权限框里点「允许」'),
        listening: mic ? t('subtitle_bar_listening_mic', '正在听外放的声音…') : t('subtitle_bar_listening', '正在听系统声音…'),
        paused: t('subtitle_bar_paused', '已暂停'),
        silence: t('subtitle_bar_silence', '30 秒没有声音，已暂停以免计费'),
        denied: mic ? t('listen_stop_denied', '麦克风被拒绝 — 去「设置 › 隐私 › 麦克风」允许大肚猴翻译。')
          : t('subtitle_bar_denied', '听不到系统声音 — 请到 系统设置 › 隐私与安全性 › 屏幕与系统录音，允许「大肚猴翻译」'),
        socket: t('subtitle_bar_socket', '转写连接中断'),
        reconnecting: t('subtitle_bar_reconnecting', '正在重连…'),
        // {pct} 留给原生按实时进度填；{lang} 这里就填好（原生不持有语言名）
        downloading: t('subtitle_bar_downloading', '正在下载{lang}识别资产 · {pct}%').replace('{lang}', langLabel(cfg && cfg.otherLang)),
        'tr-failed': t('subtitle_bar_tr_failed', '这句译文失败 · 主窗口里可重试'),
        silent: silentHint(),
        // 静音门暂停、本场出过 silent 却从没 sound（决定 10 修订二补 O2）：全屏看视频只看得见条，条上也指向权限
        'silence-permission': t('subtitle_bar_silence_permission', '30 秒没有声音，已暂停 — 视频在放却没字？可能没开系统录音权限'),
      },
      controls: {
        pause: t('subtitle_ctl_pause', '暂停'), resume: t('subtitle_ctl_resume', '继续'),
        clickThrough: t('subtitle_ctl_clickthrough', '穿透'), main: t('subtitle_ctl_main', '主窗口'),
        end: t('subtitle_ctl_end', '结束'), openSettings: t('subtitle_ctl_open_settings', '打开系统设置'),
        float: t('subtitle_pip_float', '浮出字幕窗'),
      },
      menu: {
        showMain: t('subtitle_menu_show_main', '显示主窗口'),
        cancelClickThrough: t('subtitle_menu_cancel_clickthrough', '取消字幕条穿透'),
        end: t('subtitle_menu_end', '结束实时字幕'),
      },
    };
  }

  // ── 麦克风：原生桥优先，页内 getUserMedia 是无桥宿主的退路 ────────────────────
  function bridged() { return typeof NativeAudio !== 'undefined' && NativeAudio.available(); }
  let pcmFrames = 0, pcmSent = 0;
  function onPcm(int16) {
    pcmFrames++;
    if (!session || !sock) return;
    if (phase !== 'listening') return;
    if (sock.sendPcm(int16) !== false) pcmSent++;
    if (phase === 'listening' && C.silenceCheck(session, C.rmsOf(int16), now())) pause('silence');
  }
  // 本机路：原生不发 PCM，只发电平（≤10 Hz）—— 静音守卫吃它，其余一律在原生
  function onLevel(rms) {
    pcmFrames++;
    if (!session || !sock || phase !== 'listening') return;
    if (C.silenceCheck(session, rms, now())) pause('silence');
  }
  function onMicState(state, reason) {
    // iOS 字幕档：输出路由是耳机 ⇒ 麦克风听不到外放（§9.8 协议补充决定 7）
    if (reason === 'headphones') { halt('headphones', ''); return; }
    // Mac 系统声音：权限框还没点（§9.8 协议补充决定 10）—— 停在「准备中」，页面与字幕条都说在等授权
    if (state === 'waiting') {
      if (phase === 'preparing') { note(t('subtitle_bar_waiting', '等待系统授权 — 请在弹出的权限框里点「允许」'), false); subState('waiting-permission'); }
      return;
    }
    // Mac 系统声音：开始后 3 秒全零且有别的 App 开着输出（§9.8 协议补充决定 10 修订二）—— 可能没开权限，
    // 也可能只是开始那一刻恰好静音（全回归 F13），所以不停：页面与条上一句不中断的提示；一有声音就撤掉
    if (state === 'silent') {
      sysSilent = true;
      if (!sysSound && phase === 'listening') { note(silentHint(), false); subState('silent'); }
      return;
    }
    if (state === 'sound') {
      sysSound = true;
      // 原生说「有声」与我们自己收到非零样本是同一件事的两个来源（#424）：本机路只发电平、
      // 不发 PCM，两边都记进同一个 heardAny，免得同一场里两套判据打架。
      if (session) session.heardAny = true;
      if (phase === 'listening' && sysSilent) {
        if (noteMsg === silentHint()) note('');
        subState('listening');
      }
      return;
    }
    if (state === 'denied') halt('denied', '');
    else if (state === 'failed') halt('failed', reason);
    else if (state === 'interrupted') {
      // 刚起就被打断（3 s 内）多半是别的音频会话（页内保活/朗读走 WebKit 自己的会话）在
      // 抢，不是真的来电：带退避再试三次（0.8 / 1.6 / 3.2 s），**期间胶囊仍是「准备中」、
      // 不闪红字**；都不行才停在具名态等用户。
      if (now() - startedAt < 3000 && earlyRetries < 3) {
        const wait = 800 * Math.pow(2, earlyRetries); earlyRetries++;
        micStop(); closeSocket();
        phase = 'preparing'; canvas.view('state');
        setTimeout(() => { if (phase === 'preparing') beginPipeline(); }, wait);
        return;
      }
      halt('locked', '');
    }
    else if (state === 'granted') {
      earlyRetries = 0;
      if (session) session.lastVoiceAt = now();   // 静音计时从麦克风真正开始出帧算起，不从点按算起
      if (phase === 'preparing') { phase = 'listening'; note(''); canvas.view('state'); subState('listening'); }
    }
  }
  async function micStart() {
    // 本机路：PCM 留在原生侧喂识别器，过桥的只有电平（§9.6.1）；采样率只给原生建 tap 用
    const rate = 16000;
    if (bridged()) {
      const h = { onLevel, onState: onMicState, deliver: 'level' };
      if (session && session.mode === 'subtitle') {
        // 声音来源只从原生报的能力来（§9.8）：既没有 system:'ok'、也不是 iOS 的 'unsupported' ⇒ 不开始
        const src = C.captureSource(NativeAudio.audioCaps());
        if (!src) { halt('os', ''); return false; }
        h.source = src;
      }
      if (NativeAudio.micStart(rate, h) === false && h.source) { halt('os', ''); return false; }
      return true;
    }
    // 退路：页内采集（Chrome / 无桥）。AudioContext 必须在手势里建 —— start() 由点击触发。
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { halt(e && e.name === 'NotAllowedError' ? 'denied' : 'failed', e && e.message); return false; }
    const resample = makeResampler(audioCtx.sampleRate, rate);
    srcNode = audioCtx.createMediaStreamSource(stream);
    proc = audioCtx.createScriptProcessor(PROCESSOR_FRAMES, 1, 1);
    proc.onaudioprocess = (e) => { const pcm = resample(e.inputBuffer.getChannelData(0)); if (pcm.length) onPcm(pcm); };
    srcNode.connect(proc);
    const mute = audioCtx.createGain(); mute.gain.value = 0; proc.connect(mute); mute.connect(audioCtx.destination);
    proc._mute = mute;
    return true;
  }
  function micStop() {
    if (bridged()) NativeAudio.micStop();
    try { if (proc) { proc.disconnect(); if (proc._mute) proc._mute.disconnect(); } } catch (_) {}
    try { if (srcNode) srcNode.disconnect(); } catch (_) {}
    try { if (stream) stream.getTracks().forEach((tr) => tr.stop()); } catch (_) {}
    proc = null; srcNode = null; stream = null;
  }
  function makeResampler(fromRate, toRate) {
    const ratio = fromRate / toRate;
    let carry = new Float32Array(0);
    return (f32) => {
      const input = carry.length ? concatF32(carry, f32) : f32;
      const n = Math.floor(input.length / ratio);
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
        let s = 0; for (let j = a; j < b; j++) s += input[j];
        const v = s / (b - a);
        out[i] = v < 0 ? Math.max(-32768, Math.round(v * 32768)) : Math.min(32767, Math.round(v * 32767));
      }
      carry = input.subarray(Math.floor(n * ratio));
      return out;
    };
  }
  function concatF32(a, b) { const o = new Float32Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }

  // 返回 promise：**必须在启动麦克风之前放起来**。WebKit 一开始播页内媒体就会把音频会话
  // 类别改回 .playback，正在启动的录音引擎会被当场打断（2026-09-07 真机：第一次进入与
  // 结束后重开都是「起了半秒就断」，8 s 后重试才成功 —— 那时保活已在播，不再冲突）。
  async function keepAliveOn() {
    // 实时字幕两个平台都不播保活音频（§9.8 协议补充决定 5）
    if (session && session.mode === 'subtitle') return;
    if (!bridged() || !NativeAudio.suspends()) return;
    try {
      if (!keepAlive) { keepAlive = new Audio(KEEP_ALIVE_WAV); keepAlive.loop = true; }
      await keepAlive.play();
      await new Promise((r) => setTimeout(r, 250));   // 让 WebKit 把类别动完
    } catch (_) {}
  }
  function keepAliveOff() { try { if (keepAlive) keepAlive.pause(); } catch (_) {} }

  // ── 会话生命周期 ──────────────────────────────────────────────────────────
  async function start() {
    if (phase !== 'idle' && phase !== 'ended') return;
    gen++;
    cfg = await readCfg();
    if (!liveCapable()) { note(needText(unavailableReason()), true); return; }
    session = C.newSession(now(), Math.random(), mode);
    lidOn();   // 新会话：LID 语言从头判（§9.6.1.3，半句/定稿归属的唯一判据）
    langEdit = false;
    langAutoAt = 0;
    try { chrome.storage.local.get(['listenLangManual'], (st) => { langManual = !!st.listenLangManual; canvas.view('state'); }); } catch (_) {}
    diagAudioArm(session.id);
    sysSilent = false; sysSound = false; deafHinted = false; ttsHinted = false;
    // 「这次不留记录」在**开始的这一刻钉住**，会话中途不可改 —— 改了之后前半场已经
    // 写进去的怎么办，没有诚实的答案。它也**不进存储**：记住上次的勾选反而危险，
    // 用户会以为在留记录而其实没有。
    session.ephemeral = ephemeralChecked;
    // 边说边译的方向也按半句的语言实时判：我说中文时译成外语，对方说外语时译成中文。
    // 判不出就按「对方」走 —— 与 attributeByLang 的兜底同向，免得半句和定稿打架。
    // 实时字幕单向：半句一律译成我的语言
    inc = C.makeIncremental((text) => translate(text,
      (!C.modeOf(session).oneWay && C.sideOf(text, cfg, routeDeps) === 'me') ? cfg.otherLang : cfg.myLang));
    inc.result((text, tr) => { if (text === partial) { partialTr = tr; canvas.view('now'); subShow(partial, partialTr, true); } });
    clearPartials();
    if (bridged()) {
      // 再挂一次监听（onEvent 按引用去重）：桥晚于 wire() 出现的宿主（test:listen 的假桥）也收得到字幕条的「结束」
      NativeAudio.onEvent(onNative);
      NativeAudio.recordMode(true, C.modeOf(session).profile);   // 对话档不带 profile，消息逐字节不变
      NativeAudio.sessionStart();
      if (session.mode === 'subtitle') { NativeAudio.subtitleConfig({ labels: subtitleLabels(), clickThrough: false, fontScale: cfg.fontScale || 1, opacity: 1 }); pipRectOn(); }
    }
    summaryShown = false;
    canvas.view('history'); canvas.view('summary');   // 「再来一段」收小结卡：原 :887 直写 hidden=true
    if (!clockTimer) clockTimer = setInterval(paintClock, 1000);
    await beginPipeline();
  }
  // 按当前语言对补齐识别资产与朗读模型（2026-10-06 抽出共用）：进场（beginPipeline）与
  // 听译内改语言（langChange）都要走 —— 92 号包真机：首启 zh/en 只下英语包，听译里切泰语
  // **不触发**泰语包下载，必须退出重进。进度复用同一个 downloading/「准备中」态。
  // **按当前语言对过滤**（2026-10-06，90 号包真机）：不传 langOpt = 探注册表全量（zh+en+th）
  // —— 包屏按 zh/en 正确地没下泰语之后，这里会把它补判成「未就绪」、开下 105MB 泰语并把
  // 会话堵在「准备中」。与 probePacks/runFirstRunPacks（a1e9a232）、speak()（tts.js）同一条
  // 纪律：这一场要念哪些语言，就只探/只下哪些。调用前提 phase==='preparing'；返回 false
  // 表示已被 halt/改态接管，调用方直接返回。
  async function ensurePacksForPair(opts) {
    const epopts = opts || {};
    {
      if (!deviceBridge()) { halt('device', 'os'); return false; }
      const r = await NativeSpeech.probe(deviceLocales(cfg));
      if (phase !== 'preparing') return false;
      if (!r.ok) { halt('device', r.reason || ''); return false; }
      if (r.assets !== 'installed') {
        phase = 'downloading'; dlPct = 0; dlLang = ''; canvas.view('state');
        try {
          await NativeSpeech.ensureAssets('stt', deviceLocales(cfg), (m) => {
            dlPct = Math.max(dlPct, Math.round((Number(m.fraction) || 0) * 100)); dlLang = m.locale || ''; paintClock();
          });
        } catch (e) { if (phase === 'downloading') halt('assets', e && e.reason); return false; }
        if (phase !== 'downloading') return false;
        phase = 'preparing'; canvas.view('state');
      }
    }
    // 语种识别（LID，§9.6.1.3）：端上模型判「这段音频是哪门语言」—— 半句与定稿的归属全靠它。
    // 与转写资产/朗读模型共用同一个 downloading 态。缺了它就没有归属判据：宁可先说「下载中」，
    // 也不退回「谁先到谁上屏」那套（那正是半句闪错语言的老病根）。
    if (deviceBridge()) {
      const lm = lidModel();
      if (lm) {
        try {
          await NativeSpeech.ensureLid(lm, (m) => {
            if (phase === 'preparing') { phase = 'downloading'; dlPct = 0; canvas.view('state'); }
            if (phase !== 'downloading') return;
            dlPct = Math.max(dlPct, Math.round((Number(m.fraction) || 0) * 100)); paintClock();
          });
        } catch (e) {
          if (phase === 'preparing' || phase === 'downloading') halt('assets', e && e.reason);
          return false;
        }
        if (phase !== 'preparing' && phase !== 'downloading') return false;
        if (phase === 'downloading') { phase = 'preparing'; canvas.view('state'); }
      }
    }
    // 语音活动检测（VAD，2026-10-07）：难音频（背景乐 / 多人交叠 / 低电平）上 LID 的判词会在十几门
    // 语言之间乱跳，判错一次就让错语言那一路的定稿上屏（真泰语多人对谈实测）。装好 silero VAD 后，
    // 只有它判为语音的片段才累计进 LID。**644KB，下不下来都不拦听译** —— 失败就退回能量门（原行为）。
    if (deviceBridge()) {
      const vm = vadModel();
      if (vm) { try { await NativeSpeech.ensureVad(vm); } catch (_) {} }
    }
    // 设备内置朗读（§9.6.1）：模型缺失 ⇒ 同一个 downloading 态先下载（与转写资产共用一种态）
    // 设备内置朗读（§9.6.1）：**自动识别换来的语言不在这里下朗读包**（`skipTts`）——
    // 用户什么都没点，不该因为 LID 听到一门新语言就悄悄下 105MB（2026-10-07 真机批 28：
    // 首启按 zh/en 下好之后进听译，LID 认出泰语 ⇒ 又开下泰语朗读包、卡在「准备中…」）。
    // 没有那个包不影响听译：朗读那一步会回落系统语音（既有行为）。
    if (!epopts.skipTts && deviceTts() && deviceBridge()) {
      // 四处首播同一个下载入口（§9.1.1）：模型缺失时 LearnTTS.ensureDeviceReady 自己下载，
      // 进度回到这里画成 downloading 态（与转写语言包共用一种态）。
      const rd = await LearnTTS.ensureDeviceReady((m) => {
        if (phase === 'preparing') { phase = 'downloading'; dlPct = 0; dlLang = ''; canvas.view('state'); }
        if (phase !== 'downloading') return;
        dlPct = Math.max(dlPct, Math.round((Number(m.fraction) || 0) * 100)); dlLang = m.locale || ''; paintClock();
      }, undefined, deviceLocales(cfg));
      if (phase !== 'preparing' && phase !== 'downloading') return false;
      if (!rd.ok && rd.reason === 'assets') { halt('assets', rd.why); return false; }
      if (phase === 'downloading') { phase = 'preparing'; canvas.view('state'); }
      // 其它失败（no-engine 等）不拦听译：朗读那一步会具名失败，行上留「朗读」可重试
    }
    return true;
  }

  // 起管线：麦克风 + socket。暂停/中断之后「开始听」也走这里（同一场会话继续）。
  async function beginPipeline() {
    phase = 'preparing';
    pauseReason = '';
    note('');
    C.resume(session, now());
    // 恢复听 ⇒ 预览矩形重新发给原生（✕ 暂停时发过 rect:null 收起预览），之后离开 App 照旧自动浮出（19 修订）
    if (bridged() && session && session.mode === 'subtitle') pipRectOn();
    // 本机路：先探（旧系统 / 语言不支持 / 资产缺失都具名），缺资产就先进 downloading 态下载，下完再起识别
    if (!(await ensurePacksForPair())) return;
    openSocket();
    canvas.view('state');
    startedAt = now();
    await keepAliveOn();
    if (phase !== 'preparing') return;   // 等保活的这一拍里被停掉了
    const ok = await micStart();
    if (!ok) return;
    // 桥的路：granted 事件把 preparing 切成 listening；页内的路：这里就切
    if (!bridged() && phase === 'preparing') phase = 'listening';
    canvas.view('state');
  }
  let startedAt = 0, earlyRetries = 0;
  // 本场收到过 silent / sound 没有（决定 10 修订二）：决定静音门的暂停句指不指向权限
  let sysSilent = false, sysSound = false;
  // 听了这么久还一个非零样本都没有 ⇒ 说一句（#424）。8 秒：比原生那条 3 秒的探测宽松，
  // 给「开始 → 切到浏览器 → 点播放」留足时间，又远早于 30 秒的静音门。
  const DEAF_HINT_MS = 8000;
  let deafHinted = false;
  function silentHint() { return t('subtitle_bar_silent', '还没听到系统声音 — 视频在放却一直没字？可能没开系统录音权限'); }
  // 暂停：不再发 PCM，麦克风与 socket 都停（暂停期间不该产生任何计费）。
  function pause(reason) {
    if (phase !== 'listening') return;
    phase = 'paused'; pauseReason = reason || 'user';
    C.pause(session, now());
    sq.clear(); speakingRid = 0;
    if (typeof LearnTTS !== 'undefined') LearnTTS.stop();
    micStop(); closeSocket();
    if (inc) inc.reset();
    clearPartials();
    // 「没有声音」与「拿不到声音」是两回事，出口也相反（#424）。指向权限的条件有两个，
    // 任一成立即可：
    //   · 原生报过 silent 且从没报过 sound（决定 10 修订二 + O2，需要「别的 App 正在出声」）；
    //   · **这一场一个非零样本都没收到**（`session.heardAny`）—— 原生那条判据只在开始后
    //     3 秒量一次，而我们自己的文档教的顺序是「先在 App 里开始，再去点播放」，
    //     于是最常见的那一种恰好量不到：#420 当天就是这样，30 秒后得到的是「没有声音」。
    const deaf = !session.heardAny || (sysSilent && !sysSound);
    if (reason === 'silence') note(session.mode !== 'subtitle' ? t('listen_stop_silence', '听不到声音（30 秒静音）— 已暂停以免计费。')
      : deaf ? t('subtitle_stop_silence_permission', '30 秒没有声音 — 已暂停。如果视频一直在放却没字，可能没开系统录音权限：到 系统设置 › 隐私与安全性 › 屏幕与系统录音 允许「大肚猴翻译」，再点「继续」。')
      : t('subtitle_stop_silence', '30 秒没有声音 — 已暂停以免计费。视频继续播放后点「继续」。'), false);
    subState(reason !== 'silence' ? 'paused' : session.mode === 'subtitle' && deaf ? 'silence-permission' : 'silence');
    canvas.view('state');
  }
  // 具名停止：与暂停同一形状，但原因来自外部（拒绝、连接断、被打断、启动失败）。
  /** 改语言之后这场起不来 ⇒ **回到改之前那一对**（2026-10-07 真机批 28）。
   *  失败可能发生在补包那一步，也可能发生在 `stt-start` 之后（设备说支持、但识别包没装好）——
   *  所以兜在 halt 上，而不是只兜在补包那一步。 */
  let langRevert = null;     // { other }：一次改语言期间记下「改之前那门」
  function revertLangIfNeeded() {
    const r = langRevert; langRevert = null;
    if (!r || !r.other || !session || !cfg) return;
    if (C.baseCode(cfg.otherLang) === r.other) return;
    cfg.otherLang = r.other; cfg.lang = r.other; otherSelVal = r.other;
    const key = mode === 'subtitle' ? 'subtitleVideoLang' : 'listenOtherLang';
    try { const patch = {}; patch[key] = r.other; chrome.storage.local.set(patch); } catch (_) {}
    const back = t('listen_lang_unsupported_revert', '这门语言这台设备识别不了 — 已经回到「{lang}」').replace('{lang}', langLabel(r.other));
    beginPipeline().then(() => { if (phase === 'listening' || phase === 'preparing') note(back); }).catch(() => {});
  }

  function halt(reason, why) {
    if (phase === 'ended' || phase === 'idle') return;
    // 「这门语言这台设备弄不了」⇒ 回到上一对，别把整场丢掉（见上面那段注释）。
    if ((reason === 'device' || reason === 'socket') && (why === 'locale' || why === 'assets')) { revertLangIfNeeded(); return; }
    phase = 'halted'; pauseReason = reason;
    C.pause(session, now());
    // 停了听就别再读积压的译文 —— 那些话的上下文已经过去了
    sq.clear(); speakingRid = 0;
    if (typeof LearnTTS !== 'undefined') LearnTTS.stop();
    micStop(); closeSocket();
    if (inc) inc.reset();
    clearPartials();
    const why1 = String(why || '').replace(/\s+/g, ' ').slice(0, 80);
    const msg = reason === 'headphones' ? t('subtitle_bar_headphones', '听不到视频声音 · 摘下耳机用外放')
      : reason === 'denied' ? (session && session.mode === 'subtitle' && C.captureSource(bridged() ? NativeAudio.audioCaps() : null) === 'system'
        ? t('subtitle_bar_denied', '听不到系统声音 — 请到 系统设置 › 隐私与安全性 › 屏幕与系统录音，允许「大肚猴翻译」')
        : t('listen_stop_denied', '麦克风被拒绝 — 去「设置 › 隐私 › 麦克风」允许大肚猴翻译。'))
      // `locale` 是「这台设备的识别器不支持这门语言」的协议码（原生刚来的 reason），
      // 别把码当原文印出来（2026-10-07 批 28：屏上出现过「转写连接中断：locale」）。
      : reason === 'socket' && why1 === 'locale' ? needText('locale')
      : reason === 'socket' ? t('listen_stop_socket', '转写连接中断：{why} — 已听的句子还在。').replace('{why}', why1)
      : reason === 'socket-retry' ? t('listen_stop_socket_retry', '转写连接中断：{why} — 正在重连…').replace('{why}', why1)
      : reason === 'locked' ? t('listen_stop_locked', '录音被系统停止了（来电或其它 App 占用麦克风）— 挂断后会自动继续，或点「开始听」。')
      // 失败原因**按协议码**翻成人话（原生送的是 offline/http/sha/load，不是系统原文）——
      // 真机批 28 上这里把 `Error Domain=SFSpeechErrorDomain Code=11 "Too many allocated locales"`
      // 原样拼进「多半是网络问题」，既看不懂、又说错了原因。
      : reason === 'assets' ? t('listen_assets_failed2', '离线模型下载失败：{why} — 再点一次「开始听」重试。')
        .replace('{why}', (typeof LearnTTS !== 'undefined' && LearnTTS.reason) ? LearnTTS.reason(why1, t) : why1)
      // 识别器的语言名额用满（Apple 每 App 上限 5 个）：**与网络无关**，别按网络说
      // （2026-10-07 真机批 28：来回切语言之后点「开始听」就撞上 Code=11）。
      : (reason === 'device' || reason === 'socket') && why1 === 'locales'
        ? t('listen_need_locales', '本机识别器一次最多只能开 5 种语言，已经占满了 — 退出听译再进一次就好。')
      // 「设备说支持、但它的识别包还没装好」是另一种情况（2026-10-07 查实：probe 回
      // `{ok:true, assets:"missing"}`）—— 以前一律说成「不支持这门语言」，用户以为系统没有它。
      : (reason === 'device' || reason === 'socket') && why1 === 'assets'
        ? t('listen_lang_assets_missing', '这门语言的识别包还没装好 — 连上网再点一次「开始听」。')
      // 'os' 与 'device' 同归 needText（2026-09-29 清理）：那句「macOS 14.4」已删 —— 26 下限
      // 把它挡在前面，真到这里也是「需要 iOS 26 / macOS 26」这句真的。
      : (reason === 'device' || reason === 'os') ? needText(why1 === 'locale' ? 'locale' : 'os')
      : t('listen_stop_failed', '麦克风启动失败：{why} — 再点一次「开始听」。').replace('{why}', why1);
    note(msg, true);
    subState(reason === 'socket-retry' ? 'reconnecting' : reason === 'socket' ? 'socket' : reason === 'denied' ? 'denied' : 'paused');
    canvas.view('state');
  }
  async function resume() {
    if (phase !== 'paused' && phase !== 'halted') return;
    await beginPipeline();
  }
  function resumeByUser() { earlyRetries = 0; return resume(); }
  function toggle() {
    if (phase === 'listening') pause('user');
    else if (phase === 'paused' || phase === 'halted') resumeByUser();
    else if (phase === 'idle' || phase === 'ended') start();
  }
  function end() {
    if (!session || phase === 'ended') return;
    diagAudioDisarm();
    C.pause(session, now());
    phase = 'ended';
    micStop(); closeSocket(); keepAliveOff();
    if (inc) inc.reset();
    pipRectOff(); pipWindow = ''; pipReason = ''; paintPipFloat();
    if (bridged()) { if (session.mode === 'subtitle') NativeAudio.subtitleHide(); NativeAudio.sessionStop(); NativeAudio.recordMode(false); }
    sq.clear(); speakingRid = 0;
    if (typeof LearnTTS !== 'undefined') LearnTTS.stop();
    closeShow();
    renderSummary();
    canvas.view('state');
    // 收获时刻（telemetry-design §3.12 ④）：听译 / 实时字幕结束、而且真的出过句子。
    // 发生在会话结束的回调里（包括自动结束），与「结束」按钮本身是否被点无关 —— 门槛
    // 与节奏都在 feedback.js，这里只报「发生了」。
    try {
      const s = C.summary(session, now());
      if (s && Number(s.them) > 0 && typeof MTFeedback !== 'undefined' && MTFeedback.noteValueMoment) {
        MTFeedback.noteValueMoment('listen').catch(() => {});
      }
    } catch (_) {}
  }
  // 返回 = 结束会话（语料已逐句写了，不丢）；还在听时先确认一下（用户 09-07 裁定 B）。
  // 页内确认（LearnDialog）：App 的 WKWebView 没有原生确认框，window.confirm 恒为 false。
  async function leave() {
    if (session && phase !== 'ended' && phase !== 'idle') {
      const ask = session.mode === 'subtitle' ? t('subtitle_leave_confirm', '还在听。离开会结束这次字幕，已出的句子保留。') : t('listen_leave_confirm', '还在听。离开会结束这次对话，已听的句子保留。');
      if (!(await LearnDialog.confirm(ask, { ok: t('listen_leave_ok', '结束并离开') }))) return;
      end();
    }
    gen++;
    if (clockTimer) { clearInterval(clockTimer); clockTimer = 0; }
    session = null; phase = 'idle';
    $('app-listen').hidden = true;   // shell 级直写（JSX 恒 true，React 不覆盖 —— 头注释）
    $(cameFrom).hidden = false;
  }
  // m === 'subtitle' 打开实时字幕（§9.8）：先停在准备态，点「开始」才开始（画布 M3 / I2）；
  // 其余（含点击事件对象）一律是对话，照旧一进来就开始听。
  function open(m) {
    mode = m === 'subtitle' ? 'subtitle' : 'conv';
    // asr_entry（telemetry-design §3，surface 'app_home' 是 2026-09-16 加的枚举）：
    // 两张模式卡的**共同落点**，一处覆盖「对话 · 实时听译」与「实时字幕」。
    // 只可能是 started —— 灰态时按钮是 disabled，不发 click；「想用但被挡住」那一下
    // 记在 app.js 的 need-live-go 上（result:'no_live'）。
    try {
      if (typeof MTTelemetry !== 'undefined') MTTelemetry.track('asr_entry', { surface: 'app_home', result: 'started' });
    } catch (_) {}
    cameFrom = $('signed-in').hidden ? 'signed-out' : 'signed-in';
    $(cameFrom).hidden = true;
    $('app-listen').hidden = false;   // shell 级直写（同上）
    summaryShown = false;
    note('');
    paintMode();
    canvas.view('history'); canvas.view('now'); canvas.view('summary');   // 原开页收小结卡：原 :712 直写 hidden=true
    if (mode === 'subtitle') {
      readCfg().then((c) => { if (mode === 'subtitle' && !session) { cfg = c; canvas.view('state'); } });
      canvas.view('state');
      return;
    }
    start();
  }

  // 两种用法共用这一页：只切文案与几个只属于对话的控件（§9.8 表：没有 ↔ / 给对方看 / 朗读 / 锁屏卡）。
  function paintMode() {
    const sub = mode === 'subtitle';
    const caps = bridged() ? NativeAudio.audioCaps() : null;
    // 文案按原生报的能力分 Mac / iPhone（有系统声音 = Mac）；还不知道时退回宿主形态
    const macLike = caps ? caps.system !== 'unsupported' : isMacHost();
    try {
      chrome.storage.local.get(['listenOtherLang', 'subtitleVideoLang', 'subtitleCapture'], (st) => {
        st = st || {};
        otherSelVal = C.baseCode(sub ? st.subtitleVideoLang : st.listenOtherLang) || 'en';
        subsCaptureVal = st.subtitleCapture !== false;
        canvas.view('mode');
      });
    } catch (_) {}
    canvas.view('mode');
  }
  // modeView：paintMode 的静态部分数据化（macLike 在渲染时现算，与原同步涂写同一时点）。
  function modeView() {
    const sub = mode === 'subtitle';
    const caps = bridged() ? NativeAudio.audioCaps() : null;
    const macLike = caps ? caps.system !== 'unsupported' : isMacHost();
    const pipOn = sub && !!caps && caps.system === 'unsupported';
    return {
      title: sub ? t('subtitle_title', '实时字幕') : t('listen_title', '对话'),
      summaryTitle: sub ? t('subtitle_summary_title', '这次字幕') : t('listen_summary_title', '这次对话'),
      summaryNote: sub
        ? t('subtitle_summary_note', '声音没有保存，只保留文字。进复习的句子可在「来源 › 实时字幕」里管理或整段删除。')
        : t('listen_summary_note', '录音已丢弃；只保留文字。进复习的句子可在「来源 › 对话」里管理或整段删除。'),
      myLabel: sub ? t('listen_my_lang_label', '我的语言') : t('listen_lang_me_label', '我'),
      otherLabel: sub ? t('subtitle_video_lang_label', '视频的语言') : t('listen_lang_other_label', '对方'),
      arrow: sub ? '←' : '⇄',
      // 语言区（§9.6.1.6，2026-10-07 真机反馈后定稿）：
      //   「译成」= 用户想读的语言（**下拉，看得见，默认系统语言**）；
      //   「对方说的」= 自动识别出来的那门，被动显示；认错点「语言不对？」去 sheet 里手改。
      langTargetLabel: sub ? t('target_lang_label', '译成') : t('listen_my_lang_label', '我的语言'),
      langTargetOptions: langOptionsFor(cfg && cfg.myLang),
      langTargetValue: C.baseCode(cfg && cfg.myLang),
      partnerText: (() => {
        const l = langLabel(cfg && cfg.otherLang);
        if (langState() !== 'ready') {
          return sub ? t('subtitle_lang_detecting', '正在识别视频语言…') : t('listen_lang_detecting', '正在识别语言…');
        }
        return sub ? t('subtitle_partner_auto', '视频语言：{lang}（自动）').replace('{lang}', l)
                   : t('listen_partner_auto', '对方说的：{lang}（自动）').replace('{lang}', l);
      })(),
      langEditLabel: t('listen_lang_edit', '语言不对？'),
      langDirsText: sub ? '' : t('listen_lang_dirs', '对方的话翻译成它；你说的话翻译成对方的语言'),
      langEdit: !!langEdit,
      langManual: !!langManual,
      langSheetNote: t('listen_lang_sheet_note', '识别错了才需要动这里'),
      langAutoLabel: t('listen_lang_auto', '自动识别'),
      autospeakRowHidden: sub,
      macNoteShown: !sub && isMacHost(),
      prepHidden: !sub,
      pipShown: pipOn,
      pipFloatLabel: t('subtitle_pip_float', '字幕'),   // 原 paintMode 恒写 #app-subs-float
      partialsHidden: pipOn,   // 半句两行被小窗预览占位顶掉（协议补充决定（三）17）
      subsPrivacyShown: sub,
      subsPrivacyText: sub ? (macLike
        ? t('subtitle_privacy', '只在你点「开始」后听这台 Mac 正在播放的声音；声音只在本机识别（或只发往你配置的转写端点），不录音、不保存，我们的服务器不参与。只有「字幕进复习」开着时，识别出的文字才会留在复习里。')
        : t('subtitle_privacy_ios', '只在你点「开始」后听这台 iPhone 外放的声音；声音只在本机识别（或只发往你配置的转写端点），不录音、不保存，我们的服务器不参与。只有「字幕进复习」开着时，识别出的文字才会留在复习里。')) : '',
      subsTipText: sub ? (macLike
        ? t('subtitle_tip_mac', '开始后，字幕出现在屏幕下方的悬浮条上；每句定稿也会列在这里。')
        : t('subtitle_tip_ios', '先点开始，再去任意 App（Safari、Chrome、YouTube、播客…）外放播放；字幕会浮在画中画小窗里。戴耳机时听不到视频声音。')) : '',
    };
  }

  // ── ↔ 改边（归属判错时用户点一下）──────────────────────────────────────────
  //
  // 一次点击要做完五件事，顺序是硬的：**先按旧方向算出已写进语料的那张卡，再翻转** ——
  // 反过来就算不出它的 id 了（语料里「学的永远是外语那一面」，改边会让两面互换）。
  async function flipRow(row) {
    if (!row || !session) return;
    session.flips = (session.flips || 0) + 1;
    const before = C.flipWho(row);          // 翻转并钉住，交回旧方向的快照
    const wasWritten = row.written;
    row.written = false;                    // 新方向的卡等译文到了再按正常的门写一次

    // ① 界面先一致，再做别的。旧方向的译文必须**同步**清掉：语料回收是异步的，
    //    把清空排在它后面，屏幕上会有一段「归属已经翻了、译文还是旧方向」的时间。
    row.tr = ''; row.trErr = false;
    if (speakingRid === row.rid) { speakingRid = 0; if (typeof LearnTTS !== 'undefined') LearnTTS.stop(); }
    sq.drop(row.rid);
    canvas.view('history');
    if (showRid === row.rid) canvas.view('show');

    // ② 立刻按新方向重译。**不自动重读**：用户翻历史点 ↔ 时突然大声念一句是最吓人的
    //    副作用，而且改边这个动作本身说明前一次朗读已经发生过了。
    retranslate(row, true);

    // ③ 回收旧卡。用**翻转前**的快照算 id —— 语料里「学的永远是外语那一面」，改边会让
    //    两面互换，不回收就留下一张面反了的卡。走 deleteItems 而不是绕过账本：它写删除
    //    账本，会同步到别的设备。放在重译之后是因为它不该拖慢屏幕。
    if (wasWritten && typeof LearnStore !== 'undefined' && typeof LearnModel !== 'undefined') {
      try {
        const old = C.draftFor(Object.assign({}, row, before), session, cfg);
        const n = await LearnStore.deleteItems([LearnModel.itemId(old.lang, old.text)], now());
        // deleteItems 返回**真删掉的条数**。0 = 被「用户已经复习过」的保护挡下了
        // （也可能它早被淘汰了，但那时这句提示无害）。如实说一声，不假装删干净了。
        if (!n) note(t('listen_flip_kept_card',
          '改边了 · 之前那张卡你已经复习过，留在「来源 › 对话」里'), false);
      } catch (_) { /* 删不掉不该挡住改边本身 */ }
    }
  }
  // 「识别原文」展开开关（原视图内 r.showRaw=!r.showRaw; renderHistory()）
  function toggleShowRaw(row) { row.showRaw = !row.showRaw; canvas.view('history'); }

  // ── 放大给对方看（历史行叠层，底下照常在听）────────────────────────────────
  function ttsReady() { return typeof LearnTTS !== 'undefined' && !!(LearnTTS.engine && LearnTTS.engine()); }
  function deviceTts() { const e = ttsReady() ? LearnTTS.engine() : null; return !!(e && e.type === 'device-speech'); }
  function foreignOf(row) { return row.who === 'me' ? row.tr : row.text; }
  function nativeOf(row) { return row.who === 'me' ? row.text : row.tr; }
  function openShow(row) {
    if (!row) return;
    showRid = row.rid;
    canvas.view('show');
  }
  // showView：renderShow 的数据版。row 缺失时收卡并清 showRid（与原 renderShow 同一副作用）。
  function showView() {
    const row = session && session.rows.find((r) => r.rid === showRid);
    if (!row) { showShown = false; if (showRid) showRid = 0; return { shown: false }; }
    const big = foreignOf(row), small = nativeOf(row);
    return {
      shown: true,
      big: big || (row.trErr ? t('listen_tr_failed', '译文失败 · 重试') : t('listen_pending', '⏳ 译文准备中…')),
      sub: small || '',
      againShown: !!(ttsReady() && big),
      speakingShown: speakingShow,
    };
  }
  function closeShow() {
    showRid = 0;
    showShown = false;
    speakingShow = false;
    canvas.view('show');
    // 关卡片只掐**一次性**的那种朗读（队列空 = 用户手点读了一句）。整场排队的自动朗读
    // 不该因为关了一张卡就断掉 —— 它读的是整段对话，不是这张卡。
    if (!sq.size() && typeof LearnTTS !== 'undefined') LearnTTS.stop();
  }
  let speakOutGen = 0;
  // 语言从参数来（对方的话读给我听、我的话读给对方听），不再写死一个方向。
  async function speakOut(text, lang, opts) {
    if (diagAudioOn) { try { diagSidecar.push({ t: Date.now(), k: 'tts', lang: String(lang || ''), text: String(text || '').slice(0, 500) }); } catch (_) {} }
    if (!ttsReady() || !text) return null;
    const my = ++speakOutGen;
    const rid = (opts && opts.rid) || 0;
    let r = null;
    try {
      // 展示卡上的「朗读中」只在这一行正被放大时点亮；行内的那个由 historyView 按
      // speakingRid 画。原来无条件点亮，展示卡关着时是个不可见的空操作。
      if (showRid && showRid === rid) { speakingShow = true; canvas.view('show'); }
      const t0 = now();
      r = await LearnTTS.speak(text, lang || (cfg && cfg.otherLang));
      // 出声耗时：从要求朗读到引擎报「已开始出声」（browser 是 start 事件、device 是 tts-start）
      if (session && rid) { const row = session.rows.find((x) => x.rid === rid); if (row && row.lat) { row.lat.ttsStart = now() - t0; row.lat.ttsEngine = (r && r.engine) || ''; row.lat.ttsOk = !!(r && r.ok); } }
    } catch (_) { r = null; }
    if (my === speakOutGen) { speakingShow = false; canvas.view('show'); }
    // 设备内置朗读回落到系统语音（模型不含这个语言）：行上具名，不静默
    if (r && r.ok && r.fallback === 'lang' && session && rid) {
      const row = session.rows.find((x) => x.rid === rid);
      if (row && !row.ttsFallback) { row.ttsFallback = lang || (cfg && cfg.otherLang) || ''; canvas.view('history'); }
    }
    return r;
  }

  // ── 自动朗读：一个泵 + 一条队列 ──────────────────────────────────────────────
  //
  // 队列不是为了优雅：朗读引擎每次开口前都会先掐掉上一次，并发调用互相打断。
  async function speakPump() {
    if (speakPumping) return;
    speakPumping = true;
    try {
      for (let job; (job = sq.next());) {
        if (job.gen !== gen) continue;            // 旧会话的残留
        speakingRid = job.rid; canvas.view('history');
        const at = now();
        echo.speaking(job.text, at, job.lang);   // lang 给「朗读进行中」那道闸用（回声修）
        sq.noteSpoken(job.text, at);
        lastSpoken = job.text;
        // 每句必须超时（#565 六轮真机教训）：speakOut 挂住（下载卡死 / 网络不通）不得阻塞
        // 后续句子。超时后跳过该句、标失败、继续下一句。30 s = 模型装载上限（1–2 s）+
        // 网络重试窗口（MTBackgroundDownloader 默认 3 次退避）的余量。
        const r = await Promise.race([
          speakOut(job.text, job.lang, { rid: job.rid, auto: true }),
          new Promise((res) => setTimeout(() => res({ ok: false, reason: 'timeout' }), 30000)),
        ]);
        if (r && r.done) { try { await r.done; } catch (_) {} }
        echo.spoke(now());                        // 播完：回声窗口从这里开始倒计时
        speakingRid = 0;
        onSpeakResult(r);
      }
    } finally { speakPumping = false; canvas.view('history'); }
  }

  // 失败要出错，但要有节制：no_voice / http 这类会**每一句都复现**，不设门槛就是满屏
  // 错误行。三次之后只关这一场的自动朗读，行内的单句朗读照常可用。
  // **assets / timeout 例外（#565 六轮真机）**：模型没下好 / 下载卡死**不是瞬态错误** ——
  // 它不会自愈，用户等 3 次只是在等一个不会来的好转。第一次就说。
  function onSpeakResult(r) {
    if (!r) return;
    if (r.ok) { speakFails = 0; return; }
    if (r.reason === 'superseded' || r.reason === 'empty') return;   // tts.js 明说调用方不该报错
    if (r.reason === 'assets' || r.reason === 'timeout') {
      autoSpeakOff = true; sq.clear();
      const why = (typeof LearnTTS !== 'undefined' && LearnTTS.reason) ? LearnTTS.reason(r.reason, t) : r.reason;
      note(t('listen_autospeak_off', '自动朗读已停 · {why} — 行尾的朗读仍可单句用').replace('{why}', why), false);
      return;
    }
    speakFails++;
    if (speakFails < 3) return;
    autoSpeakOff = true; sq.clear();
    const why = (typeof LearnTTS !== 'undefined' && LearnTTS.reason) ? LearnTTS.reason(r.reason, t) : r.reason;
    note(t('listen_autospeak_off', '自动朗读已停 · {why} — 行尾的朗读仍可单句用').replace('{why}', why), false);
  }

  // 译文首次落地时自动入队。改边后的重译与手动重试**不走这里**（裁定：不自动重读）。
  // §0.4.1 诊断录音（2026-10-06 用户拍板）：设置里显式开启才武装。sidecar 收「stt_final 文本/
  // speak 文本」—— 只随音频包上传（对齐回放用），零内容事件通道一个字节不变。
  let diagAudioOn = false;
  let diagSidecar = [];
  const diagAudioUrl = () => {
    // 尾斜杠是 Caddy 路由的硬前提：/diag-audio/* 不匹配裸 /diag-audio（2026-10-06 部署实测）
    try { return String(Registry.backend().url || '') + '/diag-audio/'; } catch (_) { return ''; }
  };
  function diagAudioArm(sessionId) {
    diagSidecar = [];
    diagAudioOn = false;
    // 先读出开关、再武装原生录音。**顺序不能反**：原录音同步立刻开始写盘，而开关是异步读的；
    // 老写法（先武装、回调里才置 diagAudioOn）会让会话开头几秒的定稿被录到、却漏进 sidecar ——
    // 音频没有对齐文本，判分时对不上（2026-10-06 自检）。开关关着就干脆不武装（默认关）。
    const arm = () => {
      try { if (typeof NativeSpeech !== 'undefined' && NativeSpeech.diagAudio) NativeSpeech.diagAudio(true, sessionId, diagAudioUrl()); } catch (_) {}
    };
    try {
      chrome.storage.local.get(['mtDiagAudio'], (v) => { diagAudioOn = !!(v && v.mtDiagAudio); if (diagAudioOn) arm(); });
    } catch (_) { /* 读不到开关就不武装：默认关是安全的一侧 */ }
  }
  function diagAudioDisarm() {
    try { if (typeof NativeSpeech !== 'undefined' && NativeSpeech.diagAudio) NativeSpeech.diagAudio(false, '', '', JSON.stringify(diagSidecar)); } catch (_) {}
    diagSidecar = []; diagAudioOn = false;
  }
  let autoSkip = '';   // 最近一次自动朗读没入队的原因（只给 _debug 看；'tts' 那一类会另出一次可见提示）
  let ttsHinted = false;   // 「朗读引擎不可用」的提示每场只说一次（autoSpeak）
  function autoSpeak(row) {
    autoSkip = !cfg ? 'cfg' : !cfg.autoSpeak ? 'off' : autoSpeakOff ? 'fuse' : !ttsReady() ? 'tts' : !row || !row.tr ? 'row' : '';
    if (autoSkip) {
      // #565 六轮「TTS 的问题不许静默」漏了这一类：引擎不可用（存了注册表解析不了的 id /
      // 没配）不会自愈、用户等到的是一整场没有声音。第一句就说，指到设置去；只说一次。
      // （2026-10-06 中国版中泰全哑真机：这里曾是零提示的哑跳。）
      if (autoSkip === 'tts' && !ttsHinted) {
        ttsHinted = true;
        note(t('listen_tts_unusable', '自动朗读不可用 —— 朗读引擎没配置好，到 设置 › 朗读 里选一个'), true);
      }
      return;
    }
    // 回声第二道闸：这段话我们刚读过 ⇒ 不再读第二遍。漏过第一层的回声，环在这里断掉。
    if (sq.spokenRecently(row.tr, now())) { autoSkip = 'recent'; return; }
    // 保险丝：任何会自己往前跑的东西都要有一个人能按下的停止。
    const at = now();
    autoAt = autoAt.filter((x) => at - x < 10000);
    autoAt.push(at);
    if (autoAt.length > 6) {
      autoSpeakOff = true; sq.clear(); autoAt = [];
      note(t('listen_autospeak_echo', '自动朗读暂停 · 检测到回声循环 — 调低音量或用耳机后可重开'), false);
      canvas.view('history');
      return;
    }
    sq.push({ rid: row.rid, text: row.tr, lang: targetLangFor(row), gen });
    canvas.view('history');
    speakPump();
  }

  // 手点行内的朗读：优先级最高，清队直接读，并把本场的自动朗读重新打开。
  function speakNow(row) {
    if (!ttsReady() || !row || !row.tr) return;
    sq.clear();
    if (typeof LearnTTS !== 'undefined') LearnTTS.stop();
    autoSpeakOff = false; speakFails = 0; autoAt = [];
    sq.push({ rid: row.rid, text: row.tr, lang: targetLangFor(row), gen });
    speakPump();
  }

  // ── 锁屏卡片（复用 §9.5 的 Now Playing 通道）────────────────────────────────
  function paintNowPlaying() {
    // 实时字幕没有锁屏卡（画布 v5：iPhone 用画中画字幕窗，锁屏卡不做）
    if (!bridged() || !session || session.mode === 'subtitle') return;
    const last = session.rows.length ? session.rows[session.rows.length - 1] : null;
    const listening = phase === 'listening';
    NativeAudio.playingState(listening);
    NativeAudio.nowPlaying({
      title: last ? last.text : t('listen_np_title', '对话 · 实时听译中'),
      subtitle: last ? (last.tr || t('listen_pending', '⏳ 译文准备中…')) : '',
      album: t('listen_np_album', '对话 · 实时听译中 · {t} · {n} 句')
        .replace('{t}', C.fmtClock(C.listenedMs(session, now()))).replace('{n}', String(session.rows.length)),
    });
  }
  function onNative(msg) {
    if (!msg || ($('app-listen') && $('app-listen').hidden) || !session) return;
    if (msg.type === 'subtitle-window') {
      pipWindow = String(msg.state || ''); pipReason = String(msg.reason || '');
      // ✕ 关掉小窗 = 暂停听（§9.8 协议补充决定（三）19 修订，2026-09-15 用户裁定）：关掉后屏幕上一个字都看不到，
      // 麦克风却还在听、云端转写还在计费。不带 reason 的 closed 才是用户关的；failed / not-active 不暂停。
      // 一并发 rect:null 收起预览：不然离开 App 时，刚被关掉的窗又自动浮出来。
      if (pipWindow === 'closed' && !pipReason && phase === 'listening') {
        pipRectOff(); NativeAudio.subtitleFloat(null); pause('user');
      }
      paintPipFloat();
      return;
    }
    if (msg.type === 'remote') {
      if (msg.command === 'pause') { if (phase === 'listening') pause('user'); }
      else if (msg.command === 'play') { if (phase === 'paused' || phase === 'halted') resumeByUser(); }
      else if (msg.command === 'toggle') toggle();
      // 字幕条的「结束」（§9.8 协议补充决定 4：叫 end，不叫 stop —— 媒体控制的 stop 映射成暂停）
      else if (msg.command === 'end') end();
      else if (msg.command === 'font-up') subFont(1);
      else if (msg.command === 'font-down') subFont(-1);
      // 'open-app'：原生已经把主窗口拉回来了（协议补充决定 9），页面无事可做
    } else if (msg.type === 'interrupt' && msg.phase === 'begin') {
      if (phase === 'listening') halt('locked', '');
    } else if (msg.type === 'interrupt' && msg.phase === 'end') {
      // 中断结束且系统说可以继续（来电挂断、别的 App 放开麦克风）⇒ 自动续听 ——
      // 与播客模式 §9.5 的「.shouldResume 才自动续播」同一条规则；没有它就等用户点。
      if (msg.resume && phase === 'halted' && pauseReason === 'locked') resume();
    }
  }

  // ── 界面（涂写点全部换成 canvas.view；数据在下方 *View() getter 里）─────────
  function note(msg, isErr) {
    noteMsg = msg || '';
    noteErr = !!isErr;
    canvas.view('note');
  }
  function paintClock() {
    if (!session) return;
    // 早说一句（#424）：字幕档听了 DEAF_HINT_MS 还**一个非零样本都没收到** ⇒ 采集链路多半
    // 是死的（Mac 上通常是系统录音权限），不是环境安静。原来这句话只在原生报 silent 时出，
    // 而那条判据只在开始后 3 秒量一次；等不到它的人要一直等到 30 秒静音门，然后收到一句
    // 指错方向的「没有声音」。不中断会话、不改计费，只是把话说对，并给一条去系统设置的路。
    const ms = C.listenedMs(session, now());
    const listening = phase === 'listening';
    if (phase === 'downloading') subState('downloading', dlPct);
    if (listening && session.mode === 'subtitle' && !session.heardAny && !deafHinted
        && ms >= DEAF_HINT_MS) {
      deafHinted = true;
      note(silentHint(), false);
      subState('silent');
    } else if (listening && deafHinted && session.heardAny) {
      // 声音终于来了 ⇒ 把那句话撤掉（同原生 'sound' 那一支的做法：只撤**我们自己写的**
      // 那一句，别把用户看到的别的提示一并清了）。
      deafHinted = false;
      if (noteMsg === silentHint()) note('');
      if (!sysSilent || sysSound) subState('listening');
    }
    canvas.view('clock');
    if (listening && (Math.floor(ms / 1000) % 5 === 0)) paintNowPlaying();
  }
  // pillView：paintClock 的胶囊数据版（视图每秒随 clock bump 重画）。
  function pillView() {
    if (!session) return null;
    const ms = C.listenedMs(session, now());
    const listening = phase === 'listening';
    return {
      text: phase === 'downloading' ? t('listen_downloading', '正在下载{lang}离线模型 · {pct}%').replace('{lang}', langLabel(dlLang)).replace('{pct}', String(dlPct))
        : phase === 'preparing' ? t('listen_pill_preparing', '准备中')
        : listening ? (session.mode === 'subtitle' ? t('subtitle_pill_live', '● 字幕中 · {t}') : t('listen_pill_listening', '听译中 · {t}')).replace('{t}', C.fmtClock(ms))
        : phase === 'ended' ? t('listen_pill_ended', '已结束 · {t}').replace('{t}', C.fmtClock(ms))
        : t('listen_pill_paused', '已暂停 · {t}').replace('{t}', C.fmtClock(ms)),
      live: listening,
    };
  }
  // footView：paintClock 尾部两行（Gate H 披露 + 用量行）。
  function footView() {
    const ms = session ? C.listenedMs(session, now()) : 0;
    return {
      privacyShown: !!session,
      privacyText: t('listen_device_privacy', '本机转写：边说边出字；整句定稿后连同前几句上下文一起发到你自己配置的翻译引擎做修正与翻译。选「设备内置朗读」时，语音在你的设备上合成，首次使用会下载一次离线模型。'),
      cost: t('listen_cost_line_device', '已听 {t}').replace('{t}', C.fmtClock(ms)),
    };
  }
  // paint：paintPipNote → 表 1 全量 → paintClock/paintNowPlaying/renderNow。
  function paint() {
    canvas.view('state');
    canvas.view('clock');
    canvas.view('now');
    paintNowPlaying();
  }
  // paint 的数据版（视图渲染时逐项取）。
  function langLineText() {
    return mode === 'subtitle'
      ? t('subtitle_lang_line', '{a} → {b}').replace('{a}', langLabel(cfg && cfg.otherLang)).replace('{b}', langLabel(cfg && cfg.myLang))
      : t('listen_lang_pair', '{a} ⇄ {b}').replace('{a}', langLabel(cfg && cfg.myLang)).replace('{b}', langLabel(cfg && cfg.otherLang));
  }
  function nowLabel() {
    const sub = mode === 'subtitle';
    // 上卡的归属**按半句实时判**：句子还没定稿就先给出归属，判错了用户当场看得见，
    // 而不是等整句出来才发现。判不出就说「正在说…」，不假装知道。
    const side = partial ? C.sideOf(partial, cfg, routeDeps) : '';
    return sub ? t('subtitle_now_label', '现在') : side === 'me' ? t('listen_now_me', '我正在说')
      : side === 'them' ? t('listen_now_them', '对方正在说')
        : t('listen_now_any', '正在说…');
  }
  function ephemeralView() {
    const live = !!session && phase !== 'ended';
    const pillShown = !!(session && session.ephemeral);
    // 没勾又在会话中 ⇒ 一个纯灰的勾选框；家规是「灰 = 45% 透明 + 文案不变，且屏上一定有原因」
    // （2026-09-08 用户实测发现没原因）。勾上了的那种情况由胶囊说话。
    const whyShown = live && !(session && session.ephemeral);
    return {
      live,
      pillShown,
      whyShown,
      whyText: t('listen_ephemeral_locked', '这一场已经开始，要不留记录请先结束再重开'),
    };
  }
  function toggleView() {
    const ended = phase === 'ended';
    return {
      text: phase === 'listening' ? t('listen_toggle_pause', '● 正在听 · 暂停')
        : (phase === 'preparing' || phase === 'downloading') ? t('listen_toggle_preparing', '准备中…')
        : (phase === 'halted' && pauseReason === 'socket-retry') ? t('listen_toggle_reconnecting', '重连中…')
        : mode === 'subtitle' ? (session && phase !== 'ended' ? t('subtitle_ctl_resume', '继续') : t('subtitle_start', '开始'))
        : t('listen_toggle_start', '开始听'),
      disabled: phase === 'preparing' || phase === 'downloading' || (phase === 'halted' && pauseReason === 'socket-retry'),
      ended,                                       // 结束后主按钮与上卡都不出现（要说话就「再来一段」）
      endHidden: !session || ended,                // 「结束」按钮：没有会话或已结束时藏（原 :1216）
    };
  }
  function langLabel(code) {
    const c = String(code || '');
    const base = c.split('-')[0].toLowerCase();
    const e = Registry.langs().find((l) => l.code === base || l.code === c);
    return e ? (e.labelKey ? t(e.labelKey, e.label) : e.label) : c;
  }
  // 语言下拉的选项（wire 里 fillLangSel 的数据版）：**始终列全注册表**。
  // 2026-10-04 用户裁定「所有选语言的地方都要有泰语（ไทย）……不能只在部分入口有」——
  // 引擎当下不支持的语言**不从列表里拿掉**，而是标记出来（`disabled` + 后缀），
  // 并在这一行旁边给「换引擎」的出路（见 ListenView）。
  function langOptions(keep) {
    let allowed = null;
    try { const l = deviceBridge() ? NativeSpeech.supportedLocales() : []; if (l.length) allowed = new Set(l.map((x) => String(x).split(/[-_]/)[0].toLowerCase())); } catch (_) { allowed = null; }
    const out = [];
    for (const l of Registry.langs()) {
      const code = String(l.code).toLowerCase();
      const name = l.labelKey ? t(l.labelKey, l.label) : l.label;
      // 正选中那门照旧留着（与设置页同一条规则：不能把用户当前的选择从列表里抹掉）。
      const bad = !!(allowed && !allowed.has(code) && l.code !== keep);
      out.push({
        code: l.code,
        label: bad ? name + ' · ' + t('listen_lang_engine_unsupported', '当前引擎不支持') : name,
        disabled: bad,
        note: bad ? t('listen_lang_engine_unsupported', '当前引擎不支持') : '',
      });
    }
    return out;
  }

  /// 行上的「换引擎」由 shell 注入（它才拥有 openSettings）—— 与 §10 里「模型画控件、shell 管跳转」
  /// 同一条分工。听译页原来的出路只是一句「去设置里选」，用户 2026-10-04 裁定要**就地**给入口。
  let openEnginePicker = null;
  function setOpenEnginePicker(fn) { openEnginePicker = fn; }
  function changeEngine() { try { if (openEnginePicker) openEnginePicker(); } catch (_) {} }
  /// 这一页此刻有没有被引擎挡住的语言（有才显示「换引擎」）。
  function anyLangUnsupported() { return langOptions(null).some((o) => o.disabled); }
  // 语言对状态从盘上回填（wire 里 paintLangs 的存储读；wire 时调一次，storage.onChanged 的
  // listenMyLang/listenOtherLang 分支也会顺路经 refreshEntry 重探 —— 下拉的值以这里为准）。
  function keepLangSel() {
    try {
      chrome.storage.local.get(['listenOtherLang', 'listenMyLang', 'listenAutoSpeak', 'uiLang'], (s) => {
        s = s || {};
        const B = C.baseCode;
        otherSelVal = B(s.listenOtherLang) || 'en';
        mySelVal = B(s.listenMyLang) || B(s.uiLang !== 'auto' ? s.uiLang : '')
          || B(navigator.language) || 'zh';
        autoSpeakVal = s.listenAutoSpeak !== false;
        canvas.view('mode');
      });
    } catch (_) {}
  }
  // 行内「↔ 改语言」（原 wire 里两个 select 的 change handler）：对调规则在 ListenCore.langPatch。
  /** 注册表支持的语言短码（12 门）。LID 的闭集里有我们根本没有的（`nn`/`cy`/…），一律不认。 */
  function supportedCodes() { try { return (Registry.langs() || []).map((l) => l.code); } catch (_) { return []; } }
  function langOk(code) {
    if (!C.langSupported(code, supportedCodes())) return false;   // 注册表那 12 门之外一律不认
    // **设备支持**这一道（2026-10-07 批 28）：注册表里有、但这台设备的识别器没有的语言
    // （实测 Mac 上 fr/de 不在本机清单里）—— 自动跟随选到它 ⇒ 探针 `locale` 失败 ⇒ 整场 halt。
    // 设备报过清单就以它为准；没报过（老壳/还没探）只按注册表。
    let dev = [];
    try { dev = deviceBridge() ? NativeSpeech.supportedLocales() : []; } catch (_) { dev = []; }
    if (!dev.length) return true;
    return C.langSupported(code, dev);
  }

  /** 视图要的选项清单（与 langOptions 同一份；这里只是包一层，视图不必再读全局）。 */
  function langOptionsFor(cur) { try { return langOptions(cur); } catch (_) { return []; } }

  function langChange(which, value, opts) {
    const lo = opts || {};
    const prev = which === 'my'
      ? { myLang: (cfg && cfg.myLang) || '', otherLang: otherSelVal }
      : { myLang: mySelVal, otherLang: (cfg && cfg.otherLang) || '' };
    const p = C.langPatch(which, value, prev);
    const swapped = p.swapped; delete p.swapped;
    const otherVal = p.listenOtherLang;
    // 实时字幕里右边那个是「视频的语言」：同一套对调规则，存到 subtitleVideoLang（不动对话的语言对）
    if (mode === 'subtitle' && otherVal !== undefined) { p.subtitleVideoLang = otherVal; delete p.listenOtherLang; }
    chrome.storage.local.set(p);
    if (p.listenMyLang !== undefined) mySelVal = C.baseCode(p.listenMyLang);
    if (otherVal !== undefined) otherSelVal = C.baseCode(otherVal);
    if (cfg) {
      cfg.myLang = mySelVal; cfg.targetLang = mySelVal;
      cfg.otherLang = otherSelVal; cfg.lang = otherSelVal;
    }
    // 语言不下发给转写端（langs 恒为空数组，厂商自动检测），所以改语言**不重连**，
    // 只影响翻译方向与归属判断。已定稿的行不动 —— 要改用行尾的 ↔。
    if (swapped) note(t('listen_lang_swapped', '两边不能是同一种语言 — 已对调'), false);
    // **「译成」只改译文方向，一个识别器都不动** ⇒ 不重连、不补包（2026-10-07 真机批 28：
    // 改「译成」以前会走下面那条重连 ⇒ 顶部「正在下载离线模型 · 15%」、按钮卡在「准备中…」，
    // 甚至误报「本机识别器不支持这门语言」）。识别器由 LID 管，和「译成」无关。
    if (which === 'my') { canvas.view('mode'); if (session) canvas.view('state'); return; }
    // 本机路（§9.6.1）：一路识别器一个 locale，改语言**要重连**（只动识别器，麦克风不停）。
    // **先按新对补包再重连**（2026-10-06，92 号包真机）：zh/en 场里切泰语不触发泰语包下载、
    // 必须退出重进 —— 现在与进场同一段（ensurePacksForPair，复用 downloading/「准备中」态），
    // 缺什么下什么（只下新对），下好自动用新语言继续。
    if (session && sock && (phase === 'listening' || phase === 'preparing')) {
      const prevOther = C.baseCode((prev || {}).otherLang || cfg.otherLang);
      langRevert = { other: prevOther };
      closeSocket();
      const wasListening = phase === 'listening';
      if (wasListening) { phase = 'preparing'; }   // 与 beginPipeline 同一入口语义
      ensurePacksForPair({ skipTts: !!lo.skipTts }).then((ok) => {
        if (!ok) return;             // halt 已接管（具名态，与进场失败一致）
        openSocket();
        if (wasListening && phase === 'preparing') { phase = 'listening'; canvas.view('state'); }
      });
    }
    canvas.view('mode');   // 受控 select：mySelVal/otherSelVal 变了必须 bump，否则 React 把 DOM 值拉回去
    if (session) canvas.view('state');
  }
  function setAutoSpeak(on) {
    autoSpeakVal = on;
    chrome.storage.local.set({ listenAutoSpeak: on });
    if (cfg) cfg.autoSpeak = on;
    canvas.view('mode');   // 受控 checkbox：不 bump 会被 React 拉回旧值
  }
  function setSubsCapture(on) {
    subsCaptureVal = on;
    chrome.storage.local.set({ subtitleCapture: on });
    if (cfg && mode === 'subtitle') cfg.captureOn = on;
    canvas.view('mode');
  }
  function setEphemeral(on) { ephemeralChecked = !!on; canvas.view('state'); }

  // historyView：renderHistory 的数据版（视图映射 JSX；行动作经 model 动作回流）。
  function historyView() {
    const rows = session ? session.rows : [];
    const sub = mode === 'subtitle';   // 单向：不画归属标、↔、朗读、给对方看（§9.8）
    const starable = !(session && session.ephemeral);
    const out = rows.map((r) => ({
      row: r,
      who: r.who,
      guessed: !!(r.guessed && !r.pinned),
      whoTitle: t('listen_who_guessed', '按语言猜的 · 点 ↔ 改'),
      text: r.text,
      hasRaw: r.raw != null && r.raw !== r.text,
      showRaw: !!r.showRaw,
      raw: r.raw,
      trErr: !!r.trErr,
      tr: r.tr,
      trTemp: !!r.trTemp,
      trBusy: !!r.trBusy,
      canSpeak: !!(r.tr && !sub && ttsReady()),
      speaking: speakingRid === r.rid,
      ttsFallback: r.ttsFallback || '',
      starred: !!r.starred,
      starable,
    }));
    const qn = sq.size();
    return {
      rows: out,
      sub,
      emptyText: sub ? t('subtitle_history_empty', '每句定稿后会出现在这里。') : t('listen_history_empty', '双方随便说，每句定稿后会出现在这里；判错了点 ↔ 改边'),
      title: t('listen_history', '整句定稿') + (rows.length ? ' · ' + rows.length : ''),
      queueShown: !!qn,
      queueText: t('listen_read_queue_n', '朗读中 · 还有 {n} 句待读').replace('{n}', String(qn)),
      copyShown: !!rows.length,
      // 复制闪字期间视图自己持有 copied 态，这里不给文本（原 dataset.flash 的语义）
      swapToThem: t('listen_swap_to_them', '改成对方说的'),
      swapToMe: t('listen_swap_to_me', '改成我说的'),
      rawLabel: t('listen_raw_label', '识别原文'),
      trFailed: t('listen_tr_failed', '译文失败 · 重试'),
      pending: t('listen_pending', '⏳ 译文准备中…'),
      whoMe: t('listen_who_me', '我'),
      whoThem: t('listen_who_them', '对方'),
      reading: t('listen_reading', '朗读中'),
      readAloud: t('listen_read_aloud', '朗读'),
      showOther: t('listen_show_other', '给对方看'),
      ttsFallbackText: (lang) => t('tts_device_lang_fallback', '用系统语音朗读（离线模型不含{lang}）').replace('{lang}', langLabel(lang)),
      starLabel: t('listen_star', '加星'),
    };
  }
  function copyText() { return t('listen_copy_all', '复制全文'); }
  async function copyAll() {
    const text = C.transcriptText(session, t('listen_me_prefix', '我：'));
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
      // 无剪贴板 API 的宿主：退到选区复制
      try { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (_2) { ok = false; }
    }
    return ok;
  }
  // summaryView：renderSummary 的数据版。shown 收口在 summaryShown（open/start 收起、end 展开）——
  // 只看 session 的话，会话进行中小结卡会错误地亮出来（原 open :712 / start :887 都 hidden=true）。
  function summaryView() {
    if (!session || !summaryShown) return { shown: false };
    const s = C.summary(session, now());
    let body;
    if (session.mode === 'subtitle') {
      const keptSub = s.ephemeral ? t('listen_ephemeral_summary', '这次没有留下记录')
        : t('subtitle_summary_kept', '进复习（来源「实时字幕」）{k} 句 · 含 {s} 句加星').replace('{k}', String(s.written)).replace('{s}', String(s.starred));
      body = t('subtitle_summary_body', '时长 {t} · 共 {n} 句 · {kept}')
        .replace('{t}', C.fmtClock(s.seconds * 1000)).replace('{n}', String(s.them)).replace('{kept}', keptSub);
    } else {
      // 不留记录的那一场：把「进复习 N 句」换成一句话，**不显示 0** —— 0 会让人以为是
      // 没采集到，而不是「这一场本来就不留」。
      const kept = s.ephemeral
        ? t('listen_ephemeral_summary', '这次没有留下记录')
        : t('listen_summary_kept', '进复习（来源「对话」）{n} 句 · 含 {s} 句加星')
          .replace('{n}', String(s.written)).replace('{s}', String(s.starred));
      body = t('listen_summary_body2', '时长 {t} · 对方说了 {them} 句 · 我说了 {me} 句 · {kept}')
        .replace('{t}', C.fmtClock(s.seconds * 1000)).replace('{them}', String(s.them)).replace('{me}', String(s.me))
        .replace('{kept}', kept)
        // 改过边的次数是「归属判得准不准」的唯一体感指标：一直很大就说明这个语言对不适合自动判
        + (s.flips ? ' · ' + t('listen_summary_flips', '改过边 {n} 句').replace('{n}', String(s.flips)) : '');
    }
    return { shown: true, body };
  }
  function renderSummary() {
    summaryShown = true;
    canvas.view('summary');
  }
  function summaryAgain() { phase = 'idle'; start(); }
  function floatBtn() { if (bridged()) NativeAudio.subtitleFloat(); }
  function speakShownRow() {
    const row = session && session.rows.find((r) => r.rid === showRid);
    if (row) speakOut(foreignOf(row));
  }

  // ── 接线 ──────────────────────────────────────────────────────────────────
  // 原 wire() 的事件挂载与静态文案全部落到 listen-view.jsx（JSX + onClick）；
  // 这里只留 IO 订阅与初始探询。回调经 model 动作（导出的 open 等），与原 addEventListener
  // 挂的是同一批函数。
  function wire(opts) {
    // 「换引擎」就地入口（2026-10-04）：shell 拥有 openSettings，所以由它注入 —— 与
    // `AppDocs.wire({ openSettings })` 同一条分工（模型画控件、shell 管跳转）。
    if (opts && typeof opts.openSettings === 'function') {
      setOpenEnginePicker(() => opts.openSettings('stt-engine'));
    }
    refreshEntry();
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area && area !== 'local') return;
        // 语言变了要重探（本机识别器按 locale 判支持）；转写引擎那四键与这一页无关了（2026-09-17）
        if (['listenMyLang', 'listenOtherLang', 'subtitleVideoLang', 'uiLang'].some((k) => k in (changes || {}))) refreshEntry();
      });
    } catch (_) {}
    keepLangSel();
    if (bridged()) NativeAudio.onEvent(onNative);
    // tick（尖刺 S3）：主窗口隐藏时页面计时器被钳到 1 Hz，时钟改吃原生每 250 ms 一条的 tick
    if (bridged() && NativeAudio.onTick) NativeAudio.onTick(() => { if (document.hidden && session && phase !== 'ended') paintClock(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && session) paint(); });
  }

  return {
    canvas,
    wire, open, leave, start, pause, resume, end, refreshEntry,
    // 视图动作（原 addEventListener 的 handler 们）
    toggle, flipRow, toggleShowRaw, openShow, closeShow, speakNow, speakShownRow, floatBtn,
    summaryAgain, copyAll, langChange, setAutoSpeak, setSubsCapture, setEphemeral,
    retranslate, toggleStar,   // 历史行内的「重试译文」与加星（原 renderHistory 逐行挂的 handler）
    // 渲染数据（listen-view.jsx 渲染期调用）
    modeView, pillView, footView, langLineText, nowLabel, ephemeralView, toggleView,
    nowView: () => ({ partial: partial || '', partialTr: partial && partialTr ? partialTr + '…' : '' }),   // renderNow 的数据版
    // 受控表单现值（两个下拉 + 三个勾选框）：keepLangSel 回填与 setXxx 之后都要经 canvas bump
    formView: () => ({ my: mySelVal, other: otherSelVal, autoSpeak: autoSpeakVal, subsCapture: subsCaptureVal, ephemeral: ephemeralChecked }),
    noteView: () => ({ text: noteMsg, err: noteErr }),
    historyView, summaryView, showView, pipNoteText, pipFloatShown,
    entryView: (sfx) => ({ listen: entryState[sfx], subs: subsEntryState[sfx] }),
    langOptions, langLabel, copyText, isMacHost,
    setOpenEnginePicker, changeEngine, anyLangUnsupported,
    toggleLangEdit, langChangeManual, setLangAuto,
    // 视图直写 pip 预览矩形的通道（几何感知在画布，去重与发桥在模型）
    pipRectUpdate,
    _debug: () => ({ mode, subsReason, pipWindow, pipReason, phase, pauseReason, showRid, rows: session ? session.rows.slice() : [], partial, partialTr, id: session && session.id,
      lid: lidStable(), lidRaw: lidLang,   // §9.6.1.3：归属用的是**已稳住**的判词；lidRaw 是当前原始判词（诊断用）
      pcmFrames, pcmSent, sock: !!sock, bridged: bridged(), ctx: audioCtx ? audioCtx.state : null, track: stream && stream.getAudioTracks()[0] ? stream.getAudioTracks()[0].readyState : null,
      echoDropped: echo.dropped(), speakQueue: sq.size(), speakingRid, autoSpeakOff, lastSpoken, autoSkip, speakPumping,
    lat: C.latencySummary(session ? session.rows : []) }),
  };
})();

export default listenModel;
