// app/listen-core.js — 「对话 · 实时听译」的纯逻辑（learning-design §9.6）。
//
// 这个文件不碰 DOM、不碰网络、不碰存储、不碰时钟 —— `now` 一律注入。它回答的是
// 那些不该等真机才能验的问题：
//   · 一句定稿归谁（对方 / 我）？—— 按住「我说」期间到达的句子是我的。
//   · 一句定稿要不要进语料？—— 采集开关 + 语言白名单 + §6 的门；加星绕过门与白名单。
//   · 进语料的形状是什么？—— 来源 `conv:<sessionId>`、锚点 `k:'conv'`，
//     对方说的 text=外语/tr=中文，我说的反过来（学的永远是外语那一侧）。
//   · 多久没声音算「该暂停以免计费」？—— 30 s。
//   · 会话小结的数字怎么来？
//
// IO 那一半在 app/listen.js。两边的边界与 learn-driving.js / driving.js 相同。
'use strict';

var ListenCore = (() => {
  const SILENCE_MS = 30000;      // 30 s 没声音 ⇒ 暂停（interaction-spec 停止态四）
  const SILENCE_RMS = 0.004;     // 安静房间的门限；也是自适应门限的**下限**
  const HEARD_RMS = 0.0001;      // 「采集链路是活的」：任何真实的麦克风 / 系统声音都远高于它
  const FIRST_SOUND_MS = 180000; // 字幕：一次声音都没听到过时，静音门等 3 分钟（#590 iOS 4）
  const LEVEL_GAP_MS = 2000;      // 电平帧断档超过它 ⇒ 断档那段不算「静音」（系统录音链路没声音时一帧都不发）
  const NOISE_WARMUP_MS = 2500;  // 开头这么久用来摸环境底噪
  const NOISE_FACTOR = 2.5;      // 门限 = 底噪 × 这个
  const NOISE_CEIL = 0.03;       // 门限上限：再吵也不能高到把正常说话判成静音
  const NOISE_DECAY = 0.98;      // 底噪估计的滑动系数（只用静音期的样本更新）
  const NOISE_STUCK_MS = 8000;   // 连续这么久「一直有声」= 环境变吵了，不是有人在说话
  const DEBOUNCE_MS = 900;       // 边说边译的防抖（与 subtitle-adapter 同值）
  const TITLE_CHARS = 12;        // 会话标题里摘第一句的前几个字
  const HISTORY_MAX = 200;       // 屏幕上保留的定稿行数；语料里不限

  // 「对话 · 实时听译」与「实时字幕」共用这一条管线（learning-design §9.8）。两种用法的差别
  // **全在这张表里** —— listen.js 只查表，不在各处判模式名。
  //   oneWay     : 每句都归对方（字幕里说话的永远是视频里的人）
  //   autoSpeak  : 允许自动朗读译文
  //   flip       : 允许 ↔ 换语言 / 给对方看
  //   staticGate : 静音门用固定下限，不自适应 —— 视频配乐是持续高能量，自适应那套会把它当成
  //                「环境变吵」抬门限，最后连台词都判成静音
  //   recognizers: 本机路开几路识别器（字幕只开「视频的语言」一路）
  //   profile    : 原生音频会话档（record-mode 带过去）
  //   captureKey : 「进复习」开关的设置键
  const MODES = {
    conv:     { id: 'conv',     oneWay: false, autoSpeak: true,  flip: true,  staticGate: false, recognizers: 2, profile: 'conv',     captureKey: 'listenCapture' },
    subtitle: { id: 'subtitle', oneWay: true,  autoSpeak: false, flip: false, staticGate: true,  recognizers: 1, profile: 'subtitle', captureKey: 'subtitleCapture' },
  };
  // 不认识的模式名一律退回对话 —— 老调用（不传模式）逐字节不变。
  function modeOf(s) { return MODES[(s && s.mode) === 'subtitle' ? 'subtitle' : 'conv']; }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(now) {
    const d = new Date(now);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // 会话 id：时间戳 + 注入的随机，不用 crypto（file:// 与内容脚本都可能不是安全上下文）。
  function newSession(now, rnd, mode) {
    const r = Math.floor((typeof rnd === 'number' ? rnd : 0) * 0xffffff).toString(36);
    return {
      id: now.toString(36) + r,
      mode: mode === 'subtitle' ? 'subtitle' : 'conv',
      startedAt: now,
      rows: [],           // 定稿行 {rid, who, guessed, pinned, text, tr, at, starred, written}
      seq: 0,
      lastWho: '',        // 上一条定稿归了谁 —— 判不出语言时的粘性兜底
      ephemeral: false,   // 「这次不留记录」：这一场只在屏幕上存在（开始前决定，中途不可改）
      flips: 0,           // 点过几次 ↔ —— 归属判得准不准的唯一体感指标
      lastVoiceAt: now,   // 上一次听到声音（RMS 过门限）
      // 这一场**有没有收到过一个非零样本**（#424）。与语音门限无关：底噪、配乐、隔壁的
      // 说话都算「拿得到声音」，**恒零（或低于 HEARD_RMS 的残渣）才是「拿不到」** —— 那是采集侧死了（Mac 上多半是
      // 系统录音权限），不是环境安静。两者的出口完全不同，所以必须分开记。
      heardAny: false,
      noiseFrom: 0,       // 环境底噪的摸底起点
      noiseMin: null,     // 摸底期内的最小 RMS（≈ 底噪）
      noiseFloor: null,   // 当前的底噪估计
      voiceFrom: 0,       // 连续判为「有声」的起点（用来发现环境变吵）
      voiceMin: null,     // 这段连续有声里的最小 RMS
      listenedMs: 0,      // 真正在听的毫秒数（暂停不计）
      resumedAt: now,     // 本段计时的起点；0 = 暂停中
      firstText: '',
    };
  }

  function sessionTitle(s, label) {
    const first = (s.firstText || '').replace(/\s+/g, ' ').trim();
    let head = first.slice(0, TITLE_CHARS + 4);
    // 拉丁文别切在词中间：超长时退到最后一个空格（至少留 8 个字符）
    if (first.length > head.length) { const sp = head.lastIndexOf(' '); if (sp >= 8) head = head.slice(0, sp); }
    // 来源标签由调用方传（走 i18n）；这里没有任何文案。
    return (label ? label + ' · ' : '') + stamp(s.startedAt) + (head ? ' ' + head : '');
  }
  function sourceFor(s, label) {
    return { id: 'conv:' + s.id, url: 'conv://' + s.id, title: sessionTitle(s, label) };
  }


  // ────────────────────────────────────────────────────────────────────────
  // 按语言归属（2026-09-08，取代按住说话）
  //
  // 「这句是谁说的」= 比两边语言的**文字系统**。判断器不在这里：dominantScript 由
  // 调用方经 deps 注入（生产里是 LearnRules.dominantScript，它已经在 App 包里），
  // 而每门语言写在哪些文字系统里，读的是语言注册表自己的 scripts 字段
  // （build/langs.config.js）—— 这里不重述任何语言列表，也不新写识别逻辑。
  // ────────────────────────────────────────────────────────────────────────

  function baseCode(lang) {
    return String(lang == null ? '' : lang).toLowerCase().split('-')[0];
  }

  // 一门语言写在哪些文字系统里。注册表不认识的语言 ⇒ 空集 ⇒ 判不出 ⇒ 走兜底。
  function scriptsOf(code, registry) {
    const want = baseCode(code);
    const list = Array.isArray(registry) ? registry : [];
    for (const e of list) {
      if (e && baseCode(e.code) === want) return new Set(e.scripts || []);
    }
    return new Set();
  }

  // 汉字圈消歧。**顺序是纪律**：日文里也有汉字，所以假名要先判；韩文同理。
  // 与 translation-core.js 的 SCRIPT_OF_TARGET 是姐妹表，两处顺序必须一致
  // （test/app-listen.test.js 有一条一致性用例钉着）。
  //
  // 注意这里是「出现即判」而不是「计数取多」—— 一句汉字很多的日文，
  // dominantScript 会说 Han，但只要有一个假名，它就是日文。
  const CJK_RULES = [
    ['ja', /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
    ['ko', /\p{Script=Hangul}/u],
    ['zh', /\p{Script=Han}/u],
  ];
  function cjkLangOf(text) {
    const t = String(text == null ? '' : text);
    for (const [lang, re] of CJK_RULES) if (re.test(t)) return lang;
    return '';
  }

  // 主判据。返回 'me' | 'them' | ''（空 = 判不出，由 attributeByLang 兜底）。
  //   cfg  { myLang, otherLang, registry }
  //   deps { dominantScript }
  function sideOf(text, cfg, deps) {
    const ds = deps && deps.dominantScript;
    if (typeof ds !== 'function' || !cfg) return '';
    const script = ds(text);
    if (!script) return '';                       // 纯数字、纯标点：没有文字系统可比
    const mine = scriptsOf(cfg.myLang, cfg.registry);
    const theirs = scriptsOf(cfg.otherLang, cfg.registry);
    const inMine = mine.has(script);
    const inTheirs = theirs.has(script);
    if (inMine && !inTheirs) return 'me';
    if (inTheirs && !inMine) return 'them';
    // 两边都含这个文字系统（中↔日、中↔韩 都含 Han）：再用汉字圈消歧试一次。
    if (inMine && inTheirs) {
      const lang = cjkLangOf(text);
      if (lang) {
        const my = baseCode(cfg.myLang);
        const other = baseCode(cfg.otherLang);
        if (lang === my && lang !== other) return 'me';
        if (lang === other && lang !== my) return 'them';
      }
    }
    return '';                                    // 拉丁对拉丁，或消歧也分不开
  }

  // 归属的完整阶梯。判不出时先粘性、再归对方。
  //
  // 为什么兜底是「对方」而不是「我」：归错成「我」会把这句译成对方的语言**并朗读
  // 出来**，等于当着客户念一句莫名其妙的话；归错成「对方」只是屏幕上多一行我看得懂
  // 的字。错误要往安静的方向倒。
  function attributeByLang(s, text, at, cfg, deps) {
    const side = sideOf(text, cfg, deps);
    if (side) return { who: side, guessed: false };
    if (s && s.lastWho) return { who: s.lastWho, guessed: true };
    return { who: 'them', guessed: true };
  }

  // 两边不能是同一种语言。选重了**不是拒绝，而是对调** —— 拒绝会让用户卡在一个
  // 他不知道怎么满足的规则上，对调则一次点击就到位。
  //
  // 为什么必须禁在源头：两边相同会同时坏三件事 —— sideOf 恒判不出（scripts 集合相同）、
  // 翻译变成中译中、朗读把原文念一遍；而且一件都不会报错，只会「看起来怪」。
  // 在下游处处防守比在这里禁掉贵得多。
  //   which  'my' | 'other'
  //   cur    { myLang, otherLang }
  // 返回要写进存储的 patch，外加 swapped 标记供界面出提示。
  function langPatch(which, code, cur) {
    const my = baseCode((cur && cur.myLang) || '');
    const other = baseCode((cur && cur.otherLang) || '');
    const next = baseCode(code);
    if (which === 'my') {
      return next === other
        ? { listenMyLang: code, listenOtherLang: (cur && cur.myLang) || '', swapped: true }
        : { listenMyLang: code, swapped: false };
    }
    return next === my
      ? { listenOtherLang: code, listenMyLang: (cur && cur.otherLang) || '', swapped: true }
      : { listenOtherLang: code, swapped: false };
  }

  // ────────────────────────────────────────────────────────────────────────
  // 回声闸
  //
  // 朗读的是**译文**，而译文的语言恰好是对话另一边的语言 —— 所以朗读一旦被自己的
  // 麦克风录回去，它会被 sideOf 判成「另一个人说的」，再翻译、再朗读，形成闭环。
  // 原生回声消除是第一道防线，这是第二道：**它不能依赖原生那道成立**。
  //
  // 用包含度而不是 Jaccard：回声常常只截到我们朗读内容的一段（消除器半路才收敛）。
  // ────────────────────────────────────────────────────────────────────────

  const ECHO_TAIL_MS = 3000;     // 播完之后还要防这么久（房间混响 + 桥上在飞的 PCM）。
                                 // 2026-10-05 真机（#565 二轮）：1500 不够 —— 系统语音（AVSpeechSynthesizer）
                                 // 的出声比 didFinish 晚、Dictation 转写器的定稿又晚落，回声定稿经常落在
                                 // 窗外被当成新句子。3000 覆盖「念完 → 定稿」这一整段；误杀仍由 60% 包含度挡着。
  const ECHO_KEEP_MS = 20000;    // 一条登记项活多久
  const ECHO_SIM = 0.35;         // 包含度门限。
                                 // 2026-10-05（#565 四轮）从 0.6 降：扬声器→空气→麦克风→DictationTranscriber
                                 // 一圈的识别质量劣化让 bigram 重合度掉到 0.6 以下（三轮静麦/时序修复都没解决，
                                 // 说明不是时间窗的问题，是文本本身对不上）。0.35 仍然足够高 —— 两个完全不同的
                                 // 句子（对方说的话 vs 我们念的译文）的 bigram 重合度几乎不可能超过 0.2。
  const ECHO_MAX = 4;            // 最多同时记几条
  // 「朗读进行中」兜底上限：正常由 spoke() 把 to 置上；万一没等到，也不能让这道闸永远拦下去。
  const ECHO_PLAY_MAX_MS = 15000;

  const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  // 无词间空格的文字（泰/老挝/高棉/缅甸）：正字法只在句间用空格，整句会被下面的循环拼成**一个**
  // 巨型「词」，包含度判定退化成「整串一字不差才命中」—— 语音识别自己念出去的话几乎必然有
  // 字符/分词差异 ⇒ 回声闸对泰语失明（2026-10-04 真机：自己念的泰语被当成新句子翻回中文）。
  // 按**字符二元组（bigram）**切：识别差异只丢几个 bigram，60% 门限照常工作。
  const NOSPACE_SCRIPT = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
  const DROP_PUNCT = /[\s.,!?;:'"()\[\]{}—–\-。，！？；：、「」『』（）《》…]+/gu;

  // 归一化成词/字的集合。中日韩按字切，无空格文字（泰文等）按字符二元组切，其余按词切。
  // 混排（一句里既有汉字又有拉丁词）按**段**切：汉字逐字、拉丁按词。原来只要有一个汉字就整句逐字符切，
  // 于是「译：Delivery takes…」被切成一堆字母，和任何一句英文都有六成字母重合 —— 60 秒窗里的第二句
  // 英文译文被当成「刚读过」跳掉（2026-09-12 门禁 G6 抓到）。
  function echoTokens(text) {
    const t = String(text == null ? '' : text).toLowerCase().replace(DROP_PUNCT, ' ').trim();
    if (!t) return new Set();
    const out = new Set();
    let word = '';   // 拉丁/其他按词积累
    let ns = '';     // 无空格文字的连续段，段断时按二元组展开
    const flushWord = () => { if (word) { out.add(word); word = ''; } };
    const flushNs = () => {
      if (!ns) return;
      if (ns.length === 1) out.add(ns);
      else for (let i = 0; i + 1 < ns.length; i++) out.add(ns.slice(i, i + 2));
      ns = '';
    };
    for (const c of t) {
      if (/\s/.test(c)) { flushWord(); flushNs(); continue; }
      if (CJK_CHAR.test(c)) { flushWord(); flushNs(); out.add(c); continue; }
      if (NOSPACE_SCRIPT.test(c)) { flushWord(); ns += c; continue; }
      flushNs();
      word += c;
    }
    flushWord();
    flushNs();
    return out;
  }

  function makeEchoGuard() {
    let items = [];        // { tokens, from, to }  to=0 表示还在读
    let dropped = 0;
    function sweep(at) { items = items.filter((it) => at - (it.to || at) < ECHO_KEEP_MS); }
    return {
      // 开始朗读一段文本（lang = 这门语言的短码；「朗读进行中」那道闸要用它）
      speaking(text, at, lang) {
        const tokens = echoTokens(text);
        if (!tokens.size) return;
        sweep(at);
        items.push({ tokens, from: at, to: 0, lang: String(lang || '').split(/[-_]/)[0].toLowerCase() });
        if (items.length > ECHO_MAX) items.shift();
      },
      // 播完（或被打断）
      spoke(at) {
        for (let i = items.length - 1; i >= 0; i--) {
          if (!items[i].to) { items[i].to = at; break; }
        }
      },
      // 此刻**正在朗读**哪些语言。这道闸比文字比对硬 —— 真机（2026-10-06，95/96 号包）实测：
      // 我们自己朗读的声音被扬声器→空气→麦克风采回时，识别会劣化到文字比对（ECHO_SIM）拦不住，
      // 于是多出一行；但那条定稿**总在播放进行中到**（`speak` 记的是播放开始，回声约 +500ms），
      // 且**与朗读同语言**。所以：播放进行中 + 同一门语言 ⇒ 这条识别就是我们自己的声音。
      // 朗读**结束之后**的窗口仍走原来的文字比对（对方在我们念完后回话照收，M4 钉着）。
      playingLangs(at) {
        const out = new Set();
        for (const it of items) {
          if (it.to) continue;                              // 已播完
          if (at - it.from >= ECHO_PLAY_MAX_MS) continue;   // 没等到 spoke() 的兜底
          if (it.lang) out.add(it.lang);
        }
        return out;
      },
      // 这一句是不是我们自己刚读出去的？
      isEcho(text, at) {
        const b = echoTokens(text);
        if (!b.size) return false;
        for (const it of items) {
          const until = (it.to || at) + ECHO_TAIL_MS;
          if (at < it.from || at > until) continue;
          let hit = 0;
          for (const tk of b) if (it.tokens.has(tk)) hit++;
          if (hit / b.size >= ECHO_SIM) { dropped++; return true; }
        }
        return false;
      },
      dropped() { return dropped; },
      size() { return items.length; },
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // 朗读队列
  //
  // 队列不是为了优雅：朗读引擎每次开口前都会先掐掉上一次，并发调用会互相打断。
  // 裁定 7 是「排队逐句读完，不漏句」。
  // ────────────────────────────────────────────────────────────────────────

  const SPOKEN_WINDOW_MS = 60000;   // 同一段文本这么久内不再读第二遍（回声第二道闸）
  const SPOKEN_MAX = 8;

  function makeSpeakQueue() {
    let q = [];
    let spoken = [];      // { tokens, at }
    return {
      // 同一行重复入队 ⇒ 后来的替换先前的（换语言、重译）
      push(job) {
        if (!job || !job.text) return;
        const i = q.findIndex((x) => x.rid === job.rid);
        if (i >= 0) q[i] = job; else q.push(job);
      },
      next() { return q.shift() || null; },
      drop(rid) { q = q.filter((x) => x.rid !== rid); },
      clear() { q = []; },
      size() { return q.length; },
      peek() { return q[0] || null; },
      // 第二道回声闸：这段话我们最近读过吗
      spokenRecently(text, at) {
        const b = echoTokens(text);
        if (!b.size) return false;
        for (const it of spoken) {
          if (at - it.at > SPOKEN_WINDOW_MS) continue;
          let hit = 0;
          for (const tk of b) if (it.tokens.has(tk)) hit++;
          if (hit / b.size >= ECHO_SIM) return true;
        }
        return false;
      },
      noteSpoken(text, at) {
        const tokens = echoTokens(text);
        if (!tokens.size) return;
        spoken = spoken.filter((it) => at - it.at <= SPOKEN_WINDOW_MS);
        spoken.push({ tokens, at });
        if (spoken.length > SPOKEN_MAX) spoken.shift();
      },
    };
  }

  // 归属由 attributeByLang 给（见上）。**这里不再有第二个真值来源** —— 2026-09-08 之前
  // 是按「按住『我说』的时间窗」判的，那条机制连同 speaking / holdStart / myPartial 一起
  // 删掉了：两套判据并存，必然漂。
  // 识别器在停顿处吐出的碎片定稿（「.」「a..」「.....」，#590 I）：没有字母数字，或拼音文字里
  // 只有一个字母。汉字/假名/谚文/泰文一个字也可能是一句话（「好」「嗯」），不算碎片；数字也不算。
  function junkFinal(text) {
    const core = String(text || '').replace(/[^\p{L}\p{N}]/gu, '');
    if (!core) return true;
    if (core.length > 1 || CJK_CHAR.test(core) || NOSPACE_SCRIPT.test(core) || /\p{N}/u.test(core)) return false;
    return true;
  }
  function addFinal(s, text, at, cfg, deps) {
    // 行首的悬空标点是识别器吞掉句首后留下的（「, you, and you risk…」，#590 L）—— 不留在行上
    const clean = String(text || '').replace(/\s+/g, ' ').trim().replace(/^[,.;:!?，。、；：！？…]+\s*/u, '');
    if (!clean || junkFinal(clean)) return null;
    // 本机路（§9.6.1）：归属由「哪一路识别器认出来的」直接给（deps.who），比按文字系猜准 ——
    // 同文字系语言对（en/fr）那时也能分开。没给就照旧按语言判。
    // 字幕模式单向：每句都归对方，连识别器给的 who 也不认（§9.8）。
    const a = modeOf(s).oneWay ? { who: 'them', guessed: false }
      : deps && (deps.who === 'me' || deps.who === 'them')
        ? { who: deps.who, guessed: false }
        : attributeByLang(s, clean, at, cfg, deps);
    const row = {
      rid: ++s.seq, who: a.who,
      guessed: a.guessed,   // 判不出、靠粘性或兜底得来 ⇒ 界面标虚线，提示可以点 ↔ 改
      // 用户点过 ↔ ⇒ 此后不再被任何自动逻辑改动；按住说的行**出生即 pinned**（语言是人指定的，
      // 没有「判错」这回事 ⇒ 界面也不给 ↔，见 listen-view 的 HistoryRows）。
      pinned: !!(deps && deps.pinned),
      text: clean, tr: '', at, starred: false, written: false,
    };
    s.rows.push(row);
    if (s.rows.length > HISTORY_MAX) s.rows.shift();
    if (!s.firstText && a.who === 'them') s.firstText = clean;
    s.lastWho = a.who;      // 粘性兜底的依据
    return row;
  }

  // 换语言：翻转归属并钉住。返回翻转**之前**那一行的快照 —— 调用方要用旧方向算出旧语料
  // 卡的 id 才能回收它（语料里「学的永远是外语那一面」，换语言会让两面互换）。
  function flipWho(row) {
    const before = { who: row.who, text: row.text, tr: row.tr };
    row.who = row.who === 'me' ? 'them' : 'me';
    row.guessed = false;
    row.pinned = true;
    return before;
  }

  function pause(s, now) {
    if (s.resumedAt) { s.listenedMs += Math.max(0, now - s.resumedAt); s.resumedAt = 0; }
  }
  function resume(s, now) { if (!s.resumedAt) { s.resumedAt = now; s.lastVoiceAt = now; s.lastLevelAt = 0; } }
  function listenedMs(s, now) { return s.listenedMs + (s.resumedAt ? Math.max(0, now - s.resumedAt) : 0); }

  // Int16 PCM 的归一化 RMS（0..1）。
  function rmsOf(pcm) {
    if (!pcm || !pcm.length) return 0;
    let acc = 0;
    for (let i = 0; i < pcm.length; i++) { const v = pcm[i] / 32768; acc += v * v; }
    return Math.sqrt(acc / pcm.length);
  }
  // 静音门限是**自适应**的，不是写死的 0.004。
  //
  // 为什么必须自适应：那个常量的注释写着「环境底噪通常 < 0.002」，这在安静房间成立，
  // 在咖啡厅、展会、马路边不成立 —— 底噪一直高过门限，于是「30 秒没声音就暂停以免计费」
  // **永远不会触发**，而那是这个模式里防止一直烧钱的唯一闸门。
  //
  // 怎么摸底噪：开头 2.5 秒取**最小值**而不是平均 —— 这几秒里可能已经有人在说话，
  // 而说话是断续的，最小值落在停顿处，比平均值更接近真正的底噪。之后用**静音期**的
  // 样本做慢速滑动平均，所以从安静走到嘈杂（或反过来）都跟得上。
  // 上下都有夹：下限是安静房间的 0.004，上限 0.03 —— 再吵也不能高到把正常说话判成静音。
  function noiseGate(s) {
    const floor = s.noiseFloor == null ? null : s.noiseFloor;
    if (floor == null) return SILENCE_RMS;
    return Math.min(NOISE_CEIL, Math.max(SILENCE_RMS, floor * NOISE_FACTOR));
  }

  // 每来一块 PCM 调一次；返回 true 表示已经静了 SILENCE_MS，该暂停了。
  function silenceCheck(s, rms, now) {
    // 顺手记「这一场拿到过真样本没有」（#424）。判据是 **> 0**，不是过不过语音门限 ——
    // 房间里的麦克风永远不会给出恒零，给出恒零的只有一条死掉的采集链路。
    // 门槛是 HEARD_RMS（约 -80 dBFS）而不是 0：Mac 的系统录音链路没授权时交上来的是极小的非零
    // 样本，`> 0` 会把它当成「听到过」，于是指向权限的提示永远不出（#590 A）。
    if (rms > HEARD_RMS) s.heardAny = true;
    // 字幕模式：静态门限（见 MODES.staticGate）。持续的配乐就是「有声」，不摸底噪、不抬门限。
    if (modeOf(s).staticGate) {
      // Mac 系统录音在没有任何进程出声时**一帧都不发**：静音只能从「收到了帧、帧里没声」里数，
      // 断档那段没有信息、也没有请求在花钱。不扣掉的话，静了很久之后第一帧（声音刚起头、还没过门限）
      // 一到就当场判停（#590 Mac 复验 2026-10-13）。
      if (!s.lastLevelAt) s.lastVoiceAt = now;
      else if (now - s.lastLevelAt > LEVEL_GAP_MS) s.lastVoiceAt += now - s.lastLevelAt;
      s.lastLevelAt = now;
      if (rms >= SILENCE_RMS) { s.lastVoiceAt = now; s.voiceEver = true; return false; }
      // 还没听到过一次声音：人多半还在找视频、等加载、跳广告 —— 这时没有任何请求在花钱，
      // 30 秒就停只会吞掉开场（#590 iOS 4）。改等 FIRST_SOUND_MS。
      return now - s.lastVoiceAt >= (s.voiceEver ? SILENCE_MS : FIRST_SOUND_MS);
    }
    if (!s.noiseFrom) s.noiseFrom = now;
    if (s.noiseFloor == null) {
      // 摸底期：只收最小值
      s.noiseMin = s.noiseMin == null ? rms : Math.min(s.noiseMin, rms);
      if (now - s.noiseFrom >= NOISE_WARMUP_MS) s.noiseFloor = s.noiseMin;
    }
    const gate = noiseGate(s);
    if (rms >= gate) {
      s.lastVoiceAt = now;
      // 门限只靠「低于门限的样本」修正是不够的：环境一变吵，所有底噪都高过旧门限、
      // 全被当成语音，底噪估计就再也升不上去了（2026-09-08 被单测逼出来的漏洞）。
      // 补一条相反方向的判据：**持续稳定的高能量是噪声，不是语音** —— 没人能连说
      // 8 秒不带一次落到底噪的停顿。真说话会在停顿处把这个计时清掉。
      if (!s.voiceFrom) { s.voiceFrom = now; s.voiceMin = rms; }
      else s.voiceMin = Math.min(s.voiceMin == null ? rms : s.voiceMin, rms);
      if (now - s.voiceFrom >= NOISE_STUCK_MS) {
        s.noiseFloor = s.voiceMin;      // 这段时间的最小值就是新的底噪
        s.voiceFrom = 0; s.voiceMin = null;
      }
      return false;
    }
    s.voiceFrom = 0; s.voiceMin = null;   // 静下来了：连续有声的计时作废
    // 低于门限 = 这一块是环境音，用它慢慢修正底噪估计（环境变安静也跟得上）
    if (s.noiseFloor != null) s.noiseFloor = s.noiseFloor * NOISE_DECAY + rms * (1 - NOISE_DECAY);
    return now - s.lastVoiceAt >= SILENCE_MS;
  }

  // 进语料的草稿（LearnModel.makeItem 的输入）。学的永远是外语那一侧：
  // 对方说的 text=原文（外语）/tr=中文；我说的 text=译出的外语/tr=我说的中文。
  function draftFor(row, s, cfg) {
    const me = row.who === 'me';
    const text = me ? row.tr : row.text;
    const tr = me ? row.text : row.tr;
    const anchor = { k: 'conv', sessionId: s.id, title: sessionTitle(s, cfg.label), startMs: Math.max(0, row.at - s.startedAt), endMs: Math.max(0, row.at - s.startedAt), who: row.who };
    // 字幕句子沿用 k:'conv'（不新增 kind），只多一个 mode —— 对话的锚点逐字节不变（§9.8）。
    if (s.mode === 'subtitle') anchor.mode = 'subtitle';
    return {
      text, tr,
      lang: me ? (cfg.otherLang || 'und') : (cfg.lang || 'und'),
      targetLang: cfg.targetLang || '',
      kind: 'sentence',
      sourceId: 'conv:' + s.id,
      anchor,
      playedThrough: true,
      dwellMs: 0,
      starred: !!row.starred,
    };
  }

  // 要不要写。`deps` 注入 LearnModel / LearnRules 的两个纯函数，测试里可以假。
  //   captureOn : 「对话进复习」开关
  //   rules     : learnRules（langs 白名单）
  //   registry  : window.MT_LANGS
  function shouldWrite(row, s, cfg, deps) {
    if (!row || row.written) return false;
    // 「这次不留记录」在**星之前**拦：星的语义是「绕过一切门确保进复习」，而这一场
    // 根本不写盘 —— 所以界面上那颗星也不该出现（listen.js 的 renderHistory 里）。
    if (s && s.ephemeral) return false;
    if (!row.tr || !row.text) return false;            // 译文没到不写：卡要两面都有
    if (row.starred) return true;                        // 星绕过一切门
    if (!cfg.captureOn) return false;
    const d = draftFor(row, s, cfg);
    if (deps && deps.langAllowed && !deps.langAllowed(d.lang, d.text, cfg.langs, cfg.registry)) return false;
    if (deps && deps.shouldCapture && !deps.shouldCapture(d)) return false;
    return true;
  }

  // 「实时字幕」首页入口（interaction-spec M2；learning-design §9.8 协议补充决定；2026-09-17 修订）。
  //   env.caps         : 原生回的 audio-caps；没有 = 老原生壳不认识这个功能 ⇒ 'hidden'（整行不显示）
  //   env.deviceOk     : 本机识别器可用（实时转写固定为设备内置，没有云端路，也没有 key 可填）
  //   env.deviceReason : 不可用的原因，'locale'（语言不支持）或其它（系统太旧 / 无桥）
  // 返回 '' = 可用；否则按 ① device-os / locale ② os（Mac 系统声音版本）的顺序给第一个原因。
  // 2026-09-17 之前这里还有 no-live / no-key 两条（转写引擎没实时接口 / 没填 key）—— 随云端实时档一起删。
  function entryGate(env) {
    const e = env || {};
    if (!e.caps) return 'hidden';
    if (!e.deviceOk) return e.deviceReason === 'locale' ? 'locale' : 'device-os';
    if (e.caps.system === 'os') return 'os';
    return '';
  }

  // 声音从哪来。**没收到 audio-caps.system === 'ok' 绝不给 'system'** —— 老原生壳会无视
  // source 字段、静默打开麦克风（§9.8）。iOS 报 'unsupported' ⇒ 麦克风听外放；其余一律 null（不开始）。
  function captureSource(caps) {
    if (!caps) return null;
    if (caps.system === 'ok') return 'system';
    if (caps.system === 'unsupported') return 'mic';
    return null;
  }

  function summary(s, now) {
    let them = 0, me = 0, written = 0, starred = 0;
    for (const r of s.rows) {
      if (r.who === 'me') me++; else them++;
      if (r.written) written++;
      if (r.starred) starred++;
    }
    return { seconds: Math.round(listenedMs(s, now) / 1000), them, me, written, starred,
      flips: s.flips || 0, ephemeral: !!s.ephemeral };
  }

  function fmtClock(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(sec / 60), ss = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
  }

  // 边说边译的策略（与 subtitle-adapter 同型，抽成纯函数）：
  //   · 防抖 900 ms；同一时刻只有一个在飞；
  //   · 闭合时若定稿文本 == 最近一次临时译文的原文，直接复用，不再发一次。
  function makeIncremental(translate, opts) {
    const wait = (opts && opts.debounceMs) || DEBOUNCE_MS;
    const setT = (opts && opts.setTimeout) || setTimeout;
    const clearT = (opts && opts.clearTimeout) || clearTimeout;
    let timer = 0, inFlight = false, pendingText = '', lastText = '', lastTr = '';
    let onResult = null;
    function fire() {
      timer = 0;
      if (inFlight || !pendingText) return;
      const text = pendingText; pendingText = '';
      inFlight = true;
      Promise.resolve().then(() => translate(text)).then((tr) => {
        inFlight = false;
        if (tr) { lastText = text; lastTr = tr; if (onResult) onResult(text, tr); }
        if (pendingText) fire();
      }, () => { inFlight = false; if (pendingText) fire(); });
    }
    return {
      onPartial(text) {
        pendingText = String(text || '').trim();
        if (!pendingText) return;
        if (timer) clearT(timer);
        timer = setT(fire, wait);
      },
      // 闭合：返回可复用的译文，或 ''。
      close(text) {
        if (timer) { clearT(timer); timer = 0; }
        pendingText = '';
        return (text && text === lastText) ? lastTr : '';
      },
      reset() { if (timer) clearT(timer); timer = 0; pendingText = ''; lastText = ''; lastTr = ''; },
      result(fn) { onResult = fn; },
      busy() { return inFlight; },
    };
  }

  // 「复制全文」：整段对话的纯文本。一行原文、一行译文、空行分段；我说的行带前缀；没译出来的
  // 行只有原文（不写 ⏳ 之类的界面词进剪贴板）。
  // ── 本机转写路（§9.6.1）────────────────────────────────────────────────────
  // 系统识别器一路一个 locale；语言代码 → 识别器 locale。注册表只给短码，这张表是
  // 「短码 → 系统最常见的地区变体」，不认识的原样返回（识别器自己会做等价匹配）。
  const LOCALE_OF = { zh: 'zh-CN', 'zh-cn': 'zh-CN', 'zh-tw': 'zh-TW', 'zh-hk': 'zh-HK', yue: 'yue-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR',
    fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT', pt: 'pt-BR', 'pt-br': 'pt-BR', 'pt-pt': 'pt-PT' };
  function toLocale(code) {
    const c = String(code || '').trim();
    if (!c) return '';
    return LOCALE_OF[c.toLowerCase()] || c;
  }
  // 每个 locale 的文字系（决定「这路识别器认出来的字对不对得上它的语言」）。
  const LATIN_LOCALE = /^(en|fr|de|es|it|pt|nl|sv|da|nb|fi|pl|cs|tr|id|ms|vi)\b/i;
  const CJK_OF = { zh: 'Han', yue: 'Han', ja: 'Han', ko: 'Hangul' };
  // 非拉丁、非 CJK 的脚本。**名字必须与 LearnRules.dominantScript 返回的一致**，也要与
  // build/langs.config.js 的 scripts 字段一致（注册表里 th=Thai、ru=Cyrillic、ar=Arabic）。
  // 2026-10-06（真机「说中文转成泰文」追根）：老表**只有** CJK + 拉丁，泰/俄/阿 locale 的
  // want 恒为空 ⇒ 文字系这道检查对整条泰语路**跳过一次都不做**。
  const SCRIPT_OF_BASE = {
    th: 'Thai',
    ru: 'Cyrillic', uk: 'Cyrillic', be: 'Cyrillic', bg: 'Cyrillic', sr: 'Cyrillic',
    ar: 'Arabic', fa: 'Arabic', ur: 'Arabic', he: 'Hebrew', hi: 'Devanagari', el: 'Greek',
  };
  function scriptOfLocale(locale) {
    const base = String(locale || '').split(/[-_]/)[0].toLowerCase();
    if (CJK_OF[base]) return CJK_OF[base];
    if (LATIN_LOCALE.test(base)) return 'Latin';
    return SCRIPT_OF_BASE[base] || '';
  }
  // 两路识别器都会对同一段音频出 final：zh 路会把英文音频「认」成一串英文（错得离谱但置信度
  // 0.7–0.9），en 路对中文音频吐「Rugua, Ting」（置信度 0.05–0.27）—— 2026-09-12 实测。
  // 所以收 final 的规则是：**先看文字系，再看置信度**：
  //   · 文字系与这一路的语言对不上 ⇒ 丢（zh 路出拉丁字母、en 路出汉字）
  //   · 拉丁文字系且置信度 < LATIN_MIN_CONF ⇒ 丢（另一路的音频漏过来的碎片）
  //   · CJK 不按置信度丢：碎片（「家」0.34）也是正文的一部分，串起来才成句
  // 同文字系语言对（en/fr）这条规则分不开，那时靠调用方按 locale 归属 + 置信度高者。
  const LATIN_MIN_CONF = 0.4;
  // rejectDeviceFinal(f, deps) → '' | 'empty' | 'script' | 'conf'（空串 = 收）
  function rejectDeviceFinal(f, deps) {
    const text = String((f && f.text) || '').trim();
    if (!text) return 'empty';
    const want = scriptOfLocale(f.locale);
    const got = deps && deps.dominantScript ? deps.dominantScript(text) : null;
    // want/got 都是已知脚本名且不同 ⇒ 文字系不对。dominantScript 对纯标点/数字回 null，
    // 所以这里不需要再用白名单兜（老白名单只列了 5 种，泰/俄/阿文字漏网）。
    if (want && got && got !== want) {
      // ja 写在 Han 与 Kana 两种文字里，本表给 ja 的 want 是 Han ⇒ Kana 放行。
      if (!(want === 'Han' && got === 'Kana')) return 'script';
    }
    if (want === 'Latin' && typeof f.conf === 'number' && f.conf >= 0 && f.conf < LATIN_MIN_CONF) return 'conf';
    return '';
  }
  function acceptDeviceFinal(f, deps) { return !rejectDeviceFinal(f, deps); }

  // ── 低置信拉丁句头闸（2026-09-18 建；2026-10-11 第七轮：扣住必须有确定去处）────────────
  // 低置信的短拉丁片先扣住，等紧接着的下一片（跨过中文尾巴的句头）。但**不许无限扣住**：
  // 扣住后起一个与空闲判定同一个参数（idleMs，默认 1.5s）的计时器，到点裁决 ——
  //   · 期间**另一门语言**（中文侧）有归属到**时间重叠**的定稿 ⇒ 这片是错语言的垃圾：丢弃（gate:drop）；
  //   · 否则 ⇒ 放行进账本（gate:release）。
  const HOLD_MAX_MS = 1500, HOLD_MAX_WORDS = 2, HOLD_GAP_MS = 120;
  const EMBED_MAX_WORDS = 4;   // 句内夹词：自上一片汉字起最多接上这么多个拉丁词（更长的是另起的一句）
  const EMBED_MIXED_MAX_WORDS = 8;   // 同一片里既有汉字又有拉丁词：拉丁词超过这么多就当成识别器把英文句认错了
  const HOLD_DUP_GAP_MS = 300;   // R14 ③：临时稿与上一条正式 final 的音频邻接容差（dup-prev）
  const CJK_WAIT_MS = 400;       // 两路同刻交定稿时拉丁路先到的那几毫秒（实测 < 10 ms）
  const LEAD_PUNCT = /^[\s,.\u2026;:!?、。，…]+/u;
  const HAS_LETTER = /[\p{L}\p{N}]/u;

  // ── 时间重叠的**唯一定义**（R12 第十三轮修 · 方案 1 的判据）────────────────────────
  // 音频区间按半开区间 [t0,t1) 理解：只有**真正交叠**（交叠时长 > 0）才算重叠。
  // `b0 == a1`（首尾相接）是识别器把一句话切成两片时最常见的形态 —— 后一片的 t0 正好等于前一片
  // 的 t1。那是**续接**，不是「同一段音频的重识别」。旧的 `a0<=b1 && b0<=a1` 把首尾相接也算重叠，
  // 方案 1 的替换逻辑于是把句首片换成续接片（r12 §4.1，P1-en-auto-1 丢 `Please make 3 copies of this`）。
  // 有限数检查保留：缺 t0/t1 的片一律不算重叠（由调用方各自决定怎么处置）。
  // **这是全文件唯一的区间重叠判据** —— rescue 替换/裁剪、句头闸 overlapCjk、noteOtherText
  // 都调它；只有「紧接」（HOLD_GAP_MS 内的邻接）与「时长」两类判据不用它（见各自注释）。
  function overlapTs(a0, a1, b0, b1) {
    if (!(Number.isFinite(a0) && Number.isFinite(a1) && Number.isFinite(b0) && Number.isFinite(b1))) return false;
    return a0 < b1 && b0 < a1;
  }

  // 两条路都适用（自动听 / 按住说）；按住说另有 pause() 关麦前的立即放行，停止/换边/结束也是立即裁决。
  // 扣住时记 gate:hold。静置后闸里不得残留任何记录。
  function makeFinalGate(deps) {
    const d = deps || {};
    const now = d.now || (() => Date.now());
    const setT = d.setTimeout || setTimeout, clearT = d.clearTimeout || clearTimeout;
    const idleMs = d.idleMs || SEG_IDLE_MS;
    const held = {};   // locale → { text, t0, t1, timer, conflict }
    const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;
    const head = (t) => String(t || '').replace(LEAD_PUNCT, '').trim();

    function diag(kind, text, why) { if (d.onDiag) { try { d.onDiag(kind, text, why || ''); } catch (_) {} } }
    // 方案 3（R12 第十轮）：同 locale 已扣住的片**不许被新片替换** —— 先后扣住的片按时间顺序
    // 拼接、一起裁决。h.parts 保留每一片的 {text,t0,t1}；h.text 是拼接后的可读文本。
    // R14 ③：拼接**前**先做一次「临时稿是不是上一条正式 final 的结尾」检查（同一判据、同一容差）——
    // Yes please 第 10 次的 `Yes, please.` + 补救片 `Please`（同一词在 final 与下一段 partial 各出现
    // 一次）就在这里被去掉，否则会拼成 `Yes, please. Please` 拆成两行。返回 { text, parts }（parts
    // 去掉被丢的片，调用方据此更新 held 记录，避免下次再判/再拼）。
    function heldJoin(locale, parts) {
      const sorted = (parts || [])
        .slice()
        .sort((a, b) => (Number(a && a.t0) || 0) - (Number(b && b.t0) || 0));
      let acc = '', prevT1 = null;
      const kept = [];
      for (const p of sorted) {
        const hd = head(p && p.text);
        if (!hd) continue;
        if (p && p.rescued) {
          const pT0 = Number(p && p.t0);
          const gap = (Number.isFinite(pT0) && Number.isFinite(prevT1)) ? pT0 - prevT1 : NaN;
          if (isTailDup(acc, hd, gap, HOLD_DUP_GAP_MS)) {
            diag('rescue:dup-prev', hd, 'held');
            continue;   // 临时稿 = 上一条正式 final 的结尾 ⇒ 丢掉这一片（不是替换，是去重）
          }
        }
        acc = joinFrag(acc, hd);
        kept.push(p);
        const pT1 = Number(p && p.t1);
        if (Number.isFinite(pT1)) prevT1 = pT1;
      }
      return { text: acc, parts: kept };
    }
    function heldT(parts, which) {
      let v = null;
      for (const p of parts || []) {
        const x = Number(p && p[which]);
        if (!Number.isFinite(x)) continue;
        v = v === null ? x : (which === 't0' ? Math.min(v, x) : Math.max(v, x));
      }
      return v === null ? NaN : v;
    }
    const HOLD_MAX_PARTS = 16;   // 防御：真正超量时整体放行（放行不算丢弃，绝不静默丢字）
    function settleHeld(locale, how, why) {   // 裁决一条：how ∈ 'release' | 'drop'
      const h = held[locale]; if (!h) return '';
      delete held[locale];
      if (h.timer) { clearT(h.timer); h.timer = 0; }
      const t = head(h.text);
      // 纯标点/空白：直接丢 —— 也算一次丢弃，记原因（方案 2：所有丢弃分支都留痕，不静默）。
      if (!HAS_LETTER.test(t)) { diag('gate:drop', h.text, 'punct'); return ''; }
      if (how === 'release') {
        if (d.onRelease) { try { d.onRelease(locale, t, { rescued: !!h.rescued, t0: h.t0, t1: h.t1 }); } catch (_) {} }
        diag('gate:release', t, why);
      } else diag('gate:drop', t, why);
      return t;
    }
    function arm(locale, ms) {
      const h = held[locale]; if (!h) return;
      if (h.timer) clearT(h.timer);
      h.timer = setT(() => { const x = held[locale]; if (x) x.timer = 0; resolve(locale, 'idle'); }, ms || idleMs);
    }
    // 到点/冲突时的裁决：有冲突 ⇒ 丢弃；否则放行
    function resolve(locale, why) {
      const h = held[locale]; if (!h) return;
      settleHeld(locale, h.conflict ? 'drop' : 'release', why);
    }
    // 已入口接收、含汉字、且时间重叠的**中文侧**定稿（重叠裁决的判据，方案 1）。
    // 第九轮（r9 C3-en-1）：低置信拉丁片被**丢弃**（>2 词 / >1500 ms）之前，必须先看这段时间中文侧
    // 有没有一条**真的被接收**（过了 intakeDecide 的归属/回声闸）且**含汉字**的定稿 —— 有 ⇒ 这片是
    // 错语言的垃圾，丢；没有 ⇒ 放行进账本（用户说的正确内容常整段只在 partial 兜底里）。
    // 被 attrib 拒掉的中文侧拉丁垃圾**不算**重叠（它从来没被接收过）。
    const OTHER_KEEP_MS = 5000, OTHER_MAX = 8;
    const otherAdm = [];   // { base, t0, t1, at }
    const lastFormal = {}; // R14 ③：locale → { text, t1 } 上一条正式 final（临时稿 dup-prev 的比对对象）
    const CJK_RE_G = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
    function hasCjk(s) { return CJK_RE_G.test(String(s || '')); }
    function overlapCjk(base, t0, t1) {
      if (!Number.isFinite(t0) || !Number.isFinite(t1)) return false;
      for (let i = otherAdm.length - 1; i >= 0; i--) {
        const o = otherAdm[i];
        if (o.base === base) continue;   // 同一门语言不算「另一门」
        if (overlapTs(o.t0, o.t1, t0, t1)) return true;   // 统一的区间重叠判据（真交叠）
      }
      return false;
    }
    // §9.6.1.13 规则 3：非拉丁那一路吐出的拉丁片，若与这一路上一片汉字（或已接上的拉丁片）紧接
    // （≤ HOLD_GAP_MS；实测句内夹词恰为 0 ms、另起的英文句 1.3–2 s），就是这句话里夹的词。
    // chain：locale → { t1, latin }（latin = 自上一片汉字以来接上的拉丁词数，上限 EMBED_MAX_WORDS）。
    const chain = {};
    function hasScript(want, text) {
      if (want === 'Han') return hasCjk(text);
      try { return new RegExp('\\p{Script=' + want + '}', 'u').test(String(text || '')); } catch (_) { return false; }
    }
    function latinWords(text) { return (String(text || '').match(/[A-Za-z][A-Za-z'’-]*/g) || []).length; }
    function embeddedIn(locale, text, t0) {
      const want = scriptOfLocale(locale);
      if (!want || want === 'Latin') return false;
      const got = d.dominantScript ? d.dominantScript(String(text || '')) : null;
      if (got !== 'Latin') return false;
      // 这一片自己就带着这一路的文字（「这个 project deadline」：2 个汉字、15 个拉丁字母）⇒ 中文句里夹词，
      // 不用看它和上一片接没接上（实测这种片与上一句隔 1.9 s，按紧接判会被当成英文碎片丢掉）。
      if (hasScript(want, text)) return latinWords(text) <= EMBED_MIXED_MAX_WORDS;
      const ch = chain[locale];
      if (!ch || !Number.isFinite(t0) || !Number.isFinite(ch.t1)) return false;
      if (Math.abs(t0 - ch.t1) > HOLD_GAP_MS) return false;
      return ch.latin + words(head(text)) <= EMBED_MAX_WORDS;
    }
    function noteChain(locale, text, t1, embed) {
      if (!Number.isFinite(t1)) return;
      if (hasCjk(text)) chain[locale] = { t1, latin: 0 };
      else if (embed && chain[locale]) { chain[locale].t1 = t1; chain[locale].latin += words(head(text)); }
    }
    return {
      // push(f) → [text, …] 这一片应当交给串句器的文字（可能带着救回的句头），空数组 = 什么都别加
      push(f) {
        const locale = String((f && f.locale) || '');
        const text = String((f && f.text) || '').trim();
        const base = baseCode(locale);
        const rescued = !!(f && f.rescued);
        let why = rejectDeviceFinal(f, deps);
        const t0 = Number(f && f.t0), t1 = Number(f && f.t1);
        const tsOk = Number.isFinite(t0) && Number.isFinite(t1);
        const letterHead = HAS_LETTER.test(head(text));
        const embed = why === 'script' && embeddedIn(locale, text, t0);
        if (embed) { why = ''; diag('gate:embed', head(text)); }
        // §9.6.1.13 规则 2：两路且对方是汉字一路时，拉丁这一路与「已收的汉字定稿」时间重叠 ⇒ 是同一段
        // 中文音频的另一份转写，丢（不论置信度；按键锁定语言时 scriptFirst 为假，不走这里）。
        if (d.scriptFirst && d.scriptFirst() && scriptOfLocale(locale) === 'Latin' && tsOk && letterHead && overlapCjk(base, t0, t1)) {
          diag('gate:drop', head(text), 'cjk-overlap');
          return [];
        }
        // 方案 1（2026-10-11 第九轮）：rescued（partial 救回的文字）与**所有低置信拉丁片**
        // 不再按 conf 直接丢，改**按重叠裁决**：同时间段中文侧有「已被入口接收且含汉字」的定稿
        // 才丢（gate:drop reason=cjk-overlap），否则放行。
        // 分两种粒度、与旧的扣住规则同一形状：
        //   · 短片（≤2 词且 ≤1500 ms）**扣住**，1.5s 内等中文侧的重叠裁决，到点没有就放行；
        //     收口（点停/换边/结束）时 drainGateHeld 立即放行（why=forced）。
        //   · 长片（>2 词或 >1500 ms）没有可等的余地，**当场**按重叠裁决：有重叠 ⇒ 丢，没有 ⇒ 放行。
        // 这一条正是 r9 C3-en-1（`them to Mr. Zhang's office before 5 p.m.` 8 词 3000ms 被丢弃）的修法。
        const confLate = why === 'conf' && (rescued || scriptOfLocale(locale) === 'Latin');
        // 两路且对方是汉字一路时，拉丁路的低置信长片也扣住等中文侧：两路的定稿常在同一刻交来、
        // 拉丁路先到几毫秒，当场裁决时重叠表里还没有那条中文 ⇒ 错语言的长片被放行成一行
        // （中国版 Mac 录屏 cn4：「Take a project of deadline Xi.」紧跟着「这个 project 的 deadline 是周五」）。
        // 只等那几毫秒的先后差（CJK_WAIT_MS），不按句头闸的 1.5 s 扣：自动两路里拉丁路过半定稿低于 0.5。
        const waitCjk = confLate && tsOk && d.scriptFirst && d.scriptFirst() && scriptOfLocale(locale) === 'Latin';
        const shortPiece = tsOk && t1 - t0 <= HOLD_MAX_MS && words(head(text)) <= HOLD_MAX_WORDS;
        const shortEnough = shortPiece || waitCjk;
        const holdMs = waitCjk && !shortPiece ? CJK_WAIT_MS : 0;
        // R14 ③：临时稿整段是**紧挨着的上一条正式 final** 的结尾 ⇒ 丢掉（不是替换，是去重）。
        // 这一道在**扣住之前**做：临时稿常因低置信被扣 1.5s 才放行，到路由器时「上一条正式 final」
        // 可能已经变了；Yes please 第 10 次的 `Please` 就是在这里被去掉的（另有 heldJoin 兜一层）。
        if (rescued && letterHead) {
          const lf = lastFormal[locale];
          const gap = (lf && Number.isFinite(lf.t1) && tsOk) ? t0 - lf.t1 : NaN;
          if (lf && isTailDup(lf.text, head(text), gap, HOLD_DUP_GAP_MS)) {
            diag('rescue:dup-prev', head(text), 'push');
            return [];
          }
        }
        if (!rescued && letterHead) lastFormal[locale] = { text: head(text), t1: tsOk ? t1 : null };
        // ① 跨语言重叠 ⇒ 丢弃（**只有这一条**能让低置信拉丁片丢）
        if (confLate && !shortEnough && tsOk && overlapCjk(base, t0, t1)) {
          const h = held[locale]; delete held[locale];
          if (h && h.timer) { clearT(h.timer); h.timer = 0; }
          if (h && HAS_LETTER.test(head(h.text))) diag('gate:drop', head(h.text), 'cjk-overlap');
          if (letterHead) diag('gate:drop', head(text), 'cjk-overlap');
          return [];
        }
        // ② 缺 t0/t1（缺字段或 NaN）：重叠判据不可用 ⇒ 视为「另一门语言没认到」放行、不静默丢字。
        //    仍保留原文（方案 1：不再在 drop 分支里丢掉放行返回的空数组）。
        if (confLate && !tsOk) {
          const h = held[locale]; delete held[locale];
          if (h && h.timer) { clearT(h.timer); h.timer = 0; }
          const out = [];
          if (h) { const hd = head(h.text); if (hd && HAS_LETTER.test(hd)) out.push(hd); }
          if (letterHead) { out.push(text); diag('gate:release', head(text), 'no-ts'); }
          return out;
        }
        // ③ 过了闸，或**长**的低置信拉丁片（没有中文重叠，已裁决放行）：放行。
        //    扣住的那片（若有）先按「紧接」判据接回：有字母的当句头并进来，纯标点的丢掉（不留碎片）。
        if ((!why && letterHead) || (confLate && !shortEnough)) {
          const h = held[locale]; delete held[locale];
          if (h && h.timer) { clearT(h.timer); h.timer = 0; }
          const out = [];
          if (h) {
            const hd = head(h.text);
            // 这里判的是「**紧接**」（两片端点相距 ≤ HOLD_GAP_MS 的邻接），不是时间重叠 ——
            // 所以不用 overlapTs（它要求真交叠）。邻接恰恰是 overlapTs 判 false 的那种关系。
            const merge = tsOk && Number.isFinite(h.t1) && t0 - h.t1 <= HOLD_GAP_MS && t0 >= h.t1 - HOLD_GAP_MS && hd && HAS_LETTER.test(hd);
            // 补救来的扣住片要带着自己的 rescued/t0/t1 单独先入账：混进返回值就按**这一片**的标记入账，
            // 账本认不出它和随后的正式定稿是同一段音频 ⇒ 同一句两行（中国版 Mac 录屏 c6）。
            const own = h.rescued && d.onRelease && HAS_LETTER.test(hd);
            if (own && !h.conflict) {
              try { d.onRelease(locale, hd, { rescued: true, t0: h.t0, t1: h.t1 }); } catch (_) {}
              diag('gate:release', hd, merge ? 'rescued-merge' : 'rescued-gap');
            }
            else if (merge) out.push(hd);
            // 不紧接也不丢（1.19.4 r6，真机「英文丢前 1–2 个词」）：低置信拉丁片只有跨语言重叠能丢
            // （见本闸开头 ①）。识别器常把句首单出成一片 `Hello.`，后半句隔 >120 ms 才到 —— 以前这里
            // 记 gate:drop/gap 把句首扔了。已被中文侧判重叠的（conflict）照旧丢。
            else if (HAS_LETTER.test(hd)) {
              if (h.conflict) diag('gate:drop', hd, 'cjk-overlap');
              else { out.push(hd); diag('gate:release', hd, 'gap'); }
            }
            else diag('gate:drop', h.text, 'punct');
          }
          if (letterHead) { out.push(text); if (confLate) diag('gate:release', head(text), rescued ? 'rescued' : 'latin-no-cjk'); }
          if (!rescued) noteChain(locale, text, t1, embed);
          return out;
        }
        // ④ 其余（短的低置信片 / 文字系不符 / 纯标点）：先看**这条自己**有没有中文重叠 ——
        //    有 ⇒ 连它带扣住的那片一起丢（cjk-overlap）；没有 ⇒ 扣住一小片等后续裁决。
        if (!shortEnough) {
          const h = held[locale]; delete held[locale];
          if (h && h.timer) { clearT(h.timer); h.timer = 0; }
          if (h && HAS_LETTER.test(head(h.text))) diag('gate:drop', head(h.text), why);
          if (letterHead) diag('gate:drop', head(text), why);
        } else if (confLate && overlapCjk(base, t0, t1)) {
          const h = held[locale]; delete held[locale];
          if (h && h.timer) { clearT(h.timer); h.timer = 0; }
          if (h && HAS_LETTER.test(head(h.text))) diag('gate:drop', head(h.text), 'cjk-overlap');
          if (letterHead) diag('gate:drop', head(text), 'cjk-overlap');
        } else if (d.replaceHeld) {
          // 变异钩子（仅测试注入）：退回「同 locale 直接替换上一片」——用于证明方案 3 的测试抓得住。
          const h = held[locale];
          if (h && h.timer) { clearT(h.timer); h.timer = 0; }
          held[locale] = { parts: [{ text, t0, t1 }], text, t0, t1, timer: 0, conflict: false, rescued };
          arm(locale);
          diag('gate:hold', text, why || (rescued ? 'rescued' : 'latin-low-conf'));
        } else {
          // 方案 3（R12）：同 locale 已扣住的片**不许被替换** —— 先后扣住的片按时间顺序拼接、
          // 一起裁决（r10 B auto-3：'Yes.'(conf .312) 先扣，'please.'(conf .005) 到点把 'Yes.' 静默挤掉）。
          const cur = held[locale];
          if (cur && cur.parts && cur.parts.length >= HOLD_MAX_PARTS) {
            settleHeld(locale, 'release', 'hold-overflow');   // 超量先整体放行（不丢字），再扣新的
          }
          const now_ = held[locale];
          if (now_) {
            if (now_.timer) { clearT(now_.timer); now_.timer = 0; }
            now_.parts.push({ text, t0, t1, rescued });
            const j = heldJoin(locale, now_.parts);
            now_.parts = j.parts;
            now_.text = j.text;
            now_.t0 = heldT(now_.parts, 't0');
            now_.t1 = heldT(now_.parts, 't1');
            now_.rescued = now_.rescued || rescued;
            arm(locale);
            diag('gate:hold', now_.text, (why || (rescued ? 'rescued' : 'latin-low-conf')) + ':' + now_.parts.length);
          } else {
            held[locale] = { parts: [{ text, t0, t1, rescued }], text, t0, t1, timer: 0, conflict: false, rescued };
            arm(locale, holdMs);
            diag('gate:hold', text, why || (rescued ? 'rescued' : 'latin-low-conf'));
          }
        }
        return [];
      },
      // noteOtherText(locale, text, t0, t1)：另一门语言的一条**已被入口接收**的定稿（带文字）。
      // 方案 1 的**唯一**跨语言裁决（2026-10-11 第九轮补正）：短片与长片**共用这一套判定** ——
      //   · 含汉字（中文侧） ⇒ 记入重叠表（后续低置信拉丁片按 overlapCjk 裁决），并当场把
      //     时间重叠的扣住片判为错语言垃圾（conflict ⇒ 到点丢弃）；
      //   · 不含汉字（纯拉丁/数字） ⇒ **什么都不算**，扣住的片到点照常放行。
      // 被 attrib 拒掉的拉丁垃圾根本不会调到这里。
      noteOtherText(locale, text, t0, t1) {
        const base = baseCode(locale);
        if (!base) return;
        // 变异钩子（仅测试注入）：把判定换回「任何另一门定稿都算冲突」，用于证明上一条测试抓得住。
        const cjk = d.anyOtherConflict ? true : hasCjk(text);
        if (!cjk) return;
        otherAdm.push({ base, t0: Number(t0), t1: Number(t1), at: now() });
        if (otherAdm.length > OTHER_MAX) otherAdm.splice(0, otherAdm.length - OTHER_MAX);
        for (const k of Object.keys(held)) {
          const h = held[k]; if (!h || k === locale) continue;
          if (overlapTs(t0, t1, h.t0, h.t1)) {   // 统一判据：真交叠才算「同时间段」
            h.conflict = true;
            resolve(k, 'cjk-overlap');   // 当场裁决（丢弃）—— 与长片同一条判据、同一个 reason 名
          }
        }
      },
      // 这一片是不是「句内夹的另一门语言的词」（只读，给入口闸的归属判定用；§9.6.1.13 规则 2/3）
      embedded(f) { return embeddedIn(String((f && f.locale) || ''), String((f && f.text) || '').trim(), Number(f && f.t0)); },
      held(locale) { const h = held[locale]; return h ? h.text : ''; },
      heldLocales() { return Object.keys(held).filter((k) => !!held[k]); },
      // 立即放行（按住说的停止 / 换边 / 结束）：关麦前把扣住的片放出去，不丢。
      flushHeld(locale) { return settleHeld(locale, 'release', 'forced'); },
      flushAll() { for (const k of Object.keys(held)) settleHeld(k, 'release', 'forced'); },
      cancelAll() { for (const k of Object.keys(held)) { const h = held[k]; if (h && h.timer) clearT(h.timer); delete held[k]; } },
    };
  }

  // 半句层的归属、跨语言定稿仲裁、置信度三档分（pickPartial / makeFinalArbiter / arbScore）
  // **2026-10-07 全部退场** —— 判「这段音频是哪门语言」改由端上 LID 模型给（§9.6.1.3），
  // 见下面的 lidBase / sideMatchesLid 与 src/app/listen-model.js 的两处闸。留下的是**同一路之内**
  // 的文字质量闸（acceptDeviceFinal / makeFinalGate）与串句器（makeStreamCutter）。

  // ── 语种识别（LID，§9.6.1.3）的归属判据 ────────────────────────────────────
  // 端上模型（sherpa-onnx SLID）给的语言码与识别器 locale 的短码对齐（zh / th / en / yue…）。
  function lidBase(lang) { return baseCode(lang); }
  // 这一路识别器（locale）是不是 LID 判定的那门语言。**LID 还没判出来（空）⇒ false**：
  // 宁可不显示，也不先按谁先到就先画 —— 「半句闪错语言」就是那么来的。
  function sideMatchesLid(locale, lid) {
    const b = baseCode(locale), l = baseCode(lid);
    if (!b || !l) return false;
    return b === l;
  }
  /** 这门语言**我们支持**吗（`codes` 是注册表的短码清单）。
   *  为什么必须有这一道：LID 是 **99 类闭集**，会吐我们根本没有的语言 —— 实测 **`nn`**
   *  （挪威尼诺斯克）在静音/噪声/短音频上很常见。2026-10-07 真机（批 28）：
   *  自动跟随把 `nn` 当成「对方的语言」，再拿它去探本机识别器 ⇒ `unsupported/locale`
   *  ⇒ **整场 halt**（屏上「本机识别器不支持这门语言 —— 换一种语言试试」，而「对方说的」
   *  显示成 `nn`）。归属与自动跟随都只认这里放行的语言。 */
  function langSupported(code, codes) {
    const b = baseCode(code);
    if (!b) return false;
    return (codes || []).some((c) => baseCode(c) === b);
  }

  // （跨语言定稿仲裁 makeFinalArbiter / arbScore / ARB_TRUST_CONF / ARB_WINDOW_MS 已在
  //   2026-10-07 随 LID 接入删除 —— 原来靠「置信度三档分」猜哪一路是对的，现在由端上 LID
  //   模型直接给出语言，错语言那一路根本进不了串句器，见 src/app/listen-model.js。）

  // 识别器的 final 是时间片不是句子（会切在词中间），所以每个 locale 一路串起来、按句末标点
  // 切句；尾巴等不到标点就按超时放出（我们自己收口后的 final 常常不带句号）。
  // cut(text) 由调用方注入（生产里是 WsTranscribe.splitSentences 这类），返回 { done: [...], rest }。
  const STREAM_FLUSH_MS = 1200;
  // 一段缓冲**最多**滞留多久。尾部防抖有一个致命形态（2026-10-06 真机「说完很久都不进对话
  // 历史，也就不播放译文朗读」）：只要识别器持续吐片（人不停地说），add 每来一片就把定时器往后
  // 推 ⇒ 定时器永远不触发 ⇒ 整段话永不落行、不翻译、不朗读。泰文还没有句末标点，emitDone 也切不动。
  // 所以除「最后一片之后 flushMs」的闲置防抖外，再给缓冲一个**绝对上限**：到点就发出去，
  // 无论后面还来不来的新片。上限只管「迟迟等不到标点/停顿」的尾巴，正常停顿仍按 idle 走。
  const STREAM_MAX_MS = 4000;
  const CJK_JOIN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。！？、；：]$/u;
  // 片段拼接的**唯一规则**（串句器 / 路由器 / 实时框共用）：中日韩或标点直接接，拉丁之间补一个空格。
  function joinFrag(a, b) { return !a ? b : (!b ? a : (CJK_JOIN.test(a) || /^[，。！？、；：,.!?]/.test(b) ? a + b : a + ' ' + b)); }
  function makeStreamCutter(onSentence, opts) {
    const o = opts || {};
    const flushMs = o.flushMs || STREAM_FLUSH_MS;
    const maxAgeMs = o.maxAgeMs || STREAM_MAX_MS;
    const setT = o.setTimeout || setTimeout, clearT = o.clearTimeout || clearTimeout;
    const streams = {};   // locale → { buf, timer, hard }
    const join = joinFrag;
    // 只有标点/空白的「句子」（识别器把上一句的句号单独吐出来时常见）不算句子 —— 真机上会成一行「.」
    const HAS_WORD = /[\p{L}\p{N}]/u;
    function emitDone(locale, st) {
      let buf = st.buf;
      const TERM = /[。！？!?]["'”’)\]]?|\.(?=\s|$)/g;
      let last = 0, m;
      while ((m = TERM.exec(buf))) {
        const end = m.index + m[0].length;
        const sent = buf.slice(last, end).trim();
        if (sent && HAS_WORD.test(sent)) onSentence(locale, sent);
        last = end;
      }
      st.buf = buf.slice(last).replace(/^\s+/, '');
    }
    function flush(locale) {
      const st = streams[locale]; if (!st) return;
      if (st.timer) { clearT(st.timer); st.timer = 0; }
      if (st.hard) { clearT(st.hard); st.hard = 0; }
      emitDone(locale, st);
      const rest = st.buf.trim(); st.buf = '';
      if (rest && HAS_WORD.test(rest)) onSentence(locale, rest);
    }
    return {
      add(locale, text) {
        const t = String(text || '').trim(); if (!t) return;
        const st = streams[locale] || (streams[locale] = { buf: '', timer: 0, hard: 0 });
        st.buf = join(st.buf, t);
        emitDone(locale, st);
        if (st.timer) { clearT(st.timer); st.timer = 0; }
        if (!st.buf) { if (st.hard) { clearT(st.hard); st.hard = 0; } return; }
        // 绝对上限：缓冲从「空」变「非空」时起算一次，之后**不再重置** —— 这一点正是
        // 修「持续说话 ⇒ 定时器永远被推后 ⇒ 永不落行」的关键。落空后自动重新计时。
        if (!st.hard) st.hard = setT(() => { st.hard = 0; flush(locale); }, maxAgeMs);
        st.timer = setT(() => { st.timer = 0; flush(locale); }, flushMs);
      },
      flushAll() { for (const l of Object.keys(streams)) flush(l); },
      pending(locale) { const st = streams[locale]; return st ? st.buf : ''; },
    };
  }

  // ── 模型断句（2026-10-10 用户批准）：final 只进缓冲，行由「断句+翻译」一次调用给出 ──
  //
  // 背景（第三十二批 Mac 效果验收）：旧路的行界由「0.4s 静音定稿 / 5s 强制定稿 / 句末标点」
  // 决定，一句被切成 2–4 行（Mr./p.m. 切开、数字切成「三台」+「1850」、切口重复词）。
  // 新路：识别器的 final 只是**文字进缓冲**，行界改由用户配置的翻译模型在一次调用里
  // 语义断句 + 翻译（{"segments":[{"source","translation"}],"remainder"}）。
  //
  // 触发只有两种（用户裁定 2026-10-10）：
  //   (a) 长度：中文约 30 字 / 英文约 20 词 / 泰文约 60 字符；
  //   (b) 缓冲最后一次进新文字后 idleMs（默认 1.5s，可调 1–2s；自动朗读期间不计时）。
  // 切语言 / 点停止 ⇒ force=true（remainder 必须为空，违规时兜底放行，零丢失）。
  // 兜底：失败/超时先不断；攒到硬上限（60 字 / 40 词 / 120 泰文字符）或连续两次失败 ⇒
  // 按标点硬切（缩写白名单），每段走旧的修正+翻译契约（passRow）。
  // 只用于通用对话模型：google / qwen_mt / 翻译专用模型名（qwen-mt-*，判法同
  // wire-format 的 MODEL_SHAPES：formatFor 返回 translate-compat）⇒ 旧路；运行时连续
  // 两条非法 JSON 也降级旧路（诊断计数）。免费额度（grant，chat-compat）走新路。
  const SEG_SOFT = { cjk: 30, words: 20, thai: 60 };   // 触发 (a)
  const SEG_HARD = { cjk: 60, words: 40, thai: 120 };  // 兜底硬切的上限
  const SEG_IDLE_MS = 1500;                            // 触发 (b)，可调 1–2s
  const SEG_RELEASE_MS = 800;                          // 自动听：预送扣住后到出行（第二次空闲），独立参数
  const SEG_JSON_BAD_MAX = 2;                          // 连续非法 JSON ⇒ 降级
  const SEG_FAIL_MAX = 2;                              // 连续失败 ⇒ 硬切
  const SEG_RATIO_MIN = 0.55, SEG_RATIO_MAX = 1.8;     // 漂移门：拼回文本与缓冲的长度比

  // 一段文字的三种计量：汉字数（含假名/谚文）、泰文字符数、空格分词数。触发看**任何一种**
  // 先到线 —— 中英混说时哪边先够就先送，不用先猜「主导文字系」。
  function segCounts(text) {
    const s = String(text || '');
    let cjk = 0, thai = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x3040 && c <= 0x30ff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff)) cjk++;
      else if (c >= 0x0e00 && c <= 0x0e7f) thai++;
    }
    const words = s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    return { cjk, thai, words };
  }
  function segOver(counts, lim) { return counts.cjk >= lim.cjk || counts.words >= lim.words || counts.thai >= lim.thai; }

  // 路由判定（纯）：这一场走模型断句还是旧的「标点+长度」切分。
  //   providerId/providerType：注册表条目（google / qwen_mt 直接旧路）
  //   fmt：WireFormat.formatFor(端点, type, 模型) 的返回值 —— 翻译专用模型（qwen-mt-*）
  //        在 dashscope 主机上会被它判成 'translate-compat'。
  //   translationModel：模型名命中翻译专用前缀（host 无关，WireFormat.translationModelName）
  //        —— 自定义端点里填 qwen-mt-* 也要拦住（P0-1）。
  //   grant（免费额度）是 chat-compat ⇒ 新路。
  function segRouteOf(o) {
    const p = o || {};
    if (p.providerId === 'google' || p.providerType === 'google') return 'legacy';
    if (p.providerId === 'qwen_mt') return 'legacy';
    if (p.translationModel) return 'legacy';
    if (p.fmt === 'translate-compat' || p.fmt === 'google' || p.fmt === 'browser') return 'legacy';
    if (p.fmt === 'chat-compat' || p.fmt === 'messages-compat' || p.fmt === 'responses-compat') return 'model';
    return 'model';   // 拿不到形状（没配端点等）⇒ 默认新路，由调用方保证 cfg 完整
  }
  // 组装路由判定所需的全部输入并给结论（P0-1 的可测形状）：provider 是**注册表条目对象**
  // （EngineState.byId 的结果），formatOf/resolveEndpoint/isTranslationModel 由调用方注入真
  // WireFormat —— listen-model 与测试走**同一条装配线**，杜绝「判据没接上」这类漏。
  function segRouteFor(o) {
    const p = (o && o.provider) || null;
    const model = (o && o.model) || (p && p.defaultModel) || '';
    let fmt = '';
    if (p && typeof o.formatOf === 'function') {
      const url = (typeof o.resolveEndpoint === 'function') ? o.resolveEndpoint((o && o.baseUrl) || '', p) : '';
      fmt = url ? o.formatOf(url, p.type, model) : '';
    }
    const translationModel = (o && typeof o.isTranslationModel === 'function') ? !!o.isTranslationModel(model) : false;
    return segRouteOf({ providerId: (o && o.providerId) || (p && p.id) || '', providerType: p ? p.type : '', model, fmt, translationModel });
  }

  // 收到一条 final 时的接受判定（P1-5 的可测形状）：
  //   · 换边宽限：换键后 1.5s 内、**换之前那门**的**第一条** final 放行（收口片），用完即止；
  //   · 否则按 LID 归属：不是这一路 ⇒ 丢。
  const SEG_SWITCH_GRACE_MS = 1500;
  function finalAdmit(o) {
    const base = baseCode(o && o.base), lid = baseCode(o && o.lid);
    const sw = o && o.pttSwitch;
    if (sw && !sw.used && base && base === baseCode(sw.from) && ((o.now || 0) - sw.at) <= SEG_SWITCH_GRACE_MS) return { admit: true, markUsed: true };
    if (!base || !lid || base !== lid) return { admit: false, markUsed: false };
    return { admit: true, markUsed: false };
  }
  // §9.6.1.13 规则 2：两路、且一路是非拉丁文字、另一路是拉丁时，**文字系先于 LID**。
  // 这一路的定稿以自己的文字为主（或是句内夹的拉丁词，embedded）⇒ 归这一路，不看 LID 此刻判什么
  // （实测 LID 在句内的英文词上一翻就停 4.5–5.5 s）。其余返回空串 = 照旧按 LID。
  // o = { locale, partnerLocale, text, dominantScript(fn), embedded(bool) }
  function scriptFirstLid(o) {
    const p = o || {};
    const want = scriptOfLocale(p.locale), other = scriptOfLocale(p.partnerLocale);
    if (!want || want === 'Latin' || other !== 'Latin') return '';
    const got = typeof p.dominantScript === 'function' ? p.dominantScript(String(p.text || '')) : null;
    if (got === want || (want === 'Han' && got === 'Kana')) return baseCode(p.locale);
    if (got === 'Latin' && p.embedded) return baseCode(p.locale);
    return '';
  }
  // 识别定稿的**唯一闸**（纯，方案 §四）：两条路（模型断句 / 旧路）都走这一个函数，按顺序
  //   ① 正在朗读这门语言 ⇒ 丢（防回声的老规则，保留到做回声消除）
  //   ② 换边宽限 / LID 归属（finalAdmit）
  //   ③ 回声文本相似度（只按文本，不按置信度 ⇒ 不会因为朗读丢用户自己的话）
  // 返回 { admit, markUsed, force, reason }。force = 换边宽限放进来的收口片（强制收尾送）。
  function intakeDecide(o) {
    const p = o || {};
    const base = baseCode(p.base);
    if (!base) return { admit: false, markUsed: false, force: false, reason: 'nolang', xfer: false };
    const playing = p.playing;
    if (playing && typeof playing.has === 'function' && playing.has(base)) return { admit: false, markUsed: false, force: false, reason: 'speaking', xfer: false };
    const adm = finalAdmit({ base, lid: p.lid, pttSwitch: p.pttSwitch, now: p.now });
    const text = String(p.text || '').replace(/\s+/g, ' ').trim();
    // R14 ②：被归属闸拒掉的结果，可能是「中文路把英文短句听成中文」——多返回一个「可转交」标记
    // （只是**可**：等待期间英文路一有带字母的结果就丢弃）。方向只有中文路 → 英文路一个。
    if (!adm.admit) return { admit: false, markUsed: false, force: false, reason: 'attrib', xfer: isXferCandidate({ base, lid: p.lid, text }) };
    if (!text) return { admit: false, markUsed: adm.markUsed, force: false, reason: 'empty', xfer: false };
    if (typeof p.isEcho === 'function' && p.isEcho(text)) return { admit: false, markUsed: adm.markUsed, force: false, reason: 'echo', xfer: false };
    return { admit: true, markUsed: adm.markUsed, force: !!adm.markUsed, reason: '', xfer: false };
  }

  // 断句+翻译 prompt（规则五条 2026-10-10 用户批准，措辞可微调、规则不改）。
  // 模板由调用方注入：生产里 listen-model 用 t('listen_seg_system', '<中文模板>') 传进来
  // （出货代码的中文只许出现在 t() 的 fallback 位，而 listen-core 没有 t）；这里的
  // ASCII 兜底模板是给测试与「拿不到模板」时的形状保护，规则条数与语义与中文版一致。
  //   占位：{src} {dst}（system）/ {ctx} {buffer} {force}（user）。
  const SEG_SYS_FALLBACK = 'You are the segmentation+translation stage of a live interpreter. Source language: {src}, target language: {dst}.\n'
    + 'Rules:\n'
    + '1 Split only at semantically complete points; never inside a number; never between a title and a name; a.m./p.m./Mr./Dr. are not sentence ends.\n'
    + '2 Do not split around a comma within one clause.\n'
    + '3 Put a semantically incomplete tail in remainder, untranslated; when force=true, remainder MUST be empty.\n'
    + '4 You may fix obvious recognition errors from context (homophones, proper nouns, numbers) without adding or dropping meaning.\n'
    + '5 The speaker may embed words of another language (often English), possibly misspelled in Latin letters by the recognizer: restore their correct spelling, keep them inline, never split a sentence around them, translate the sentence as a whole.\n'
    + '6 Output JSON only, nothing else: {"segments":[{"source":"...","translation":"..."}],"remainder":""}';
  const SEG_USER_FALLBACK = 'Finalized context (reference only, do not repeat):\n{ctx}\n\nText to process:\n{buffer}\n\nForce finalize: {force}';
  // 同语言（§9.8.1 ②）：只把「同上」写进目标语言名时，qwen-plus 原样抄 source、有时还译成英文
  // （2026-10-13 中国版实测）。「不是真词的拉丁字母串 = 听错的英文词」要明说：只说「还原拼错的夹词」时
  // qwen-plus 一个都不改；明说了它又会改错（envoice → envelope、leftor → leftover），所以要「没把握就原样留」。
  // 改得回几个取决于模型（同一提示 qwen-max 改回 invoice / laptop，qwen-flash 一个不改）。
  const SEG_SAME_RULE = '\nThe source and target language are the same: do NOT translate. Any run of Latin letters that is not a real word '
    + 'is the recognizer mis-hearing an English word the speaker said: replace it with the real English word that best fits the sentence '
    + '(keep it in Latin letters, in place) — but only when the sentence makes that word clearly the intended one; '
    + 'if you are not sure, leave the letters exactly as they are. Also fix misheard characters and numbers from context. '
    + 'Put the corrected sentence in source and copy it into translation.';
  function buildSegPrompt(p) {
    const src = p.srcName || p.srcLang || '', dst = p.dstName || p.tgtName || p.dstLang || '';
    const ctx = (p.context || []).filter((c) => c && c.text);
    const sysTmpl = p.sysTmpl || SEG_SYS_FALLBACK;
    const userTmpl = p.userTmpl || SEG_USER_FALLBACK;
    const system = sysTmpl.split('{src}').join(src).split('{dst}').join(dst) + (p.same ? SEG_SAME_RULE : '');
    const ctxText = ctx.length ? ctx.map((c) => '- [' + (c.who === 'me' ? 'me' : 'them') + '] ' + c.text + (c.tr ? '  => ' + c.tr : '')).join('\n') : '';
    const user = userTmpl.split('{ctx}').join(ctxText)
      .split('{buffer}').join(String(p.buffer || ''))
      .split('{force}').join(p.force ? 'true' : 'false');
    return { system, user };
  }

  // 解析模型回复：{ ok:true, segments, remainder } | { ok:false, reason }
  //   reason ∈ 'empty' | 'json' | 'schema' | 'drift'（诊断用；调用方按失败兜底）。
  // 容错：```json 围栏、JSON 前后的废话、全角引号包裹的键（部分中转会转写）。
  function parseSegReply(raw, o) {
    const opts = o || {};
    let s = String(raw || '').trim();
    if (!s) return { ok: false, reason: 'empty' };
    s = s.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return { ok: false, reason: 'json' };
    let j;
    try { j = JSON.parse(s.slice(a, b + 1)); } catch (_) { return { ok: false, reason: 'json' }; }
    if (!j || typeof j !== 'object' || !Array.isArray(j.segments)) return { ok: false, reason: 'schema' };
    const segs = [];
    for (const it of j.segments) {
      if (!it || typeof it !== 'object') return { ok: false, reason: 'schema' };
      const source = String(it.source || '').trim(), tr = String(it.translation || '').trim();
      if (!source || !tr) return { ok: false, reason: 'schema' };
      segs.push({ source, translation: tr });
    }
    const remainder = typeof j.remainder === 'string' ? j.remainder.trim() : '';
    if (typeof j.remainder !== 'string' && j.remainder != null) return { ok: false, reason: 'schema' };
    // 漂移门：只有**给了段**时才校验（拼回的段应≈缓冲去掉合法 remainder 的前缀）。空段 + 只有
    // remainder 的回复不是漂移，是「还没有完整的句子」—— 由路由器按「没进展」处理。
    if (opts.buffer && segs.length) {
      const buf = String(opts.buffer).trim();
      // 后缀判定与 onResult 用**同一个**判据（去标点空白后逐字后缀）—— 否则解析器认下的 remainder
      // 在 onResult 里又被判成 mismatch，同一份回复两个结论。
      // 补正（2026-10-11）：切 target 用 remSuffixRaw 的**原文位置**（raw.start），
      // 不再用模型清洗后 remainder.length —— 两者长度不同时会把 target 切错、漂移比失真。
      // R14 方案 C：**先**切掉模型 source 里与上一条已出行行重复的前缀（与 flush 的 trimDupRows
      // 同一判据、同一个 trimDupSource），**再**算漂移比例。否则模型按上下文补回整句时，比例
      // 先超过上限被判 drift，而那段重复本该在出行时就切掉（r13 英文长句第 1 次：17 词对 6 词）。
      const lastEmitText = String(opts.last || '');
      const srcs = segs.map((x) => {
        if (!lastEmitText) return x.source;
        const rest = trimDupSource(lastEmitText, x.source, buf);
        return rest || x.source;
      });
      const raw = remainder ? remSuffixRaw(buf, remainder) : null;
      const target = raw ? buf.slice(0, raw.start) : buf;
      const joined = srcs.join('');
      const unit = (c) => Math.max(c.cjk, c.thai, c.words, 1);
      const ratio = unit(segCounts(joined)) / unit(segCounts(target));
      if (ratio < SEG_RATIO_MIN || ratio > SEG_RATIO_MAX) return { ok: false, reason: 'drift' };
    }
    return { ok: true, segments: segs, remainder };
  }

  // 标点硬切（兜底）：句末标点处切，缩写/小数白名单不切。
  //   白名单：Mr./Mrs./Ms./Dr./Prof./Sr./Jr./St./a.m./p.m./e.g./i.e./U.S./U.K./No. 与「数字.数字」。
  //   泰文没有句末标点 ⇒ 整段作为一条返回（长度上限由调用方在送进来之前把关）。
  const SEG_ABBR = /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|e\.g|i\.e|a\.m|p\.m|U\.S|U\.K|No|Nos|Fig|Approx|Inc|Ltd|Co|Jr)\.$/i;
  function hardCutSentences(text) {
    const buf = String(text || '').trim();
    if (!buf) return [];
    const out = [];
    let last = 0;
    const re = /[。！？!?；;]|\.(?=\s|$)/g;
    let m;
    while ((m = re.exec(buf))) {
      const end = m.index + m[0].length;
      // 白名单：句点是缩写的一部分（Mr. Zhang）⇒ 不是句末；下一个非空白字符是数字（3.5 的
      // 小数点已被 (?=\s|$) 挡住，这里再兜「句点后紧跟数字」的漏网）⇒ 也不是句末。
      const after = buf.slice(end).match(/^\s+(\S)/);
      if (m[0] === '.' && (SEG_ABBR.test(buf.slice(0, end)) || (after && /^\d/.test(after[1])))) continue;
      const sent = buf.slice(last, end).trim();
      if (sent && /[\p{L}\p{N}]/u.test(sent)) out.push(sent);
      last = end;
    }
    const rest = buf.slice(last).trim();
    if (rest && /[\p{L}\p{N}]/u.test(rest)) out.push(rest);
    return out;
  }

  // ── 文字账本路由器（第五轮：批次级扣住 + 单一调度函数）────────────────────────
  // 一本全局有序账本（记录按**上屏顺序**排）。每条记录是一段**识别原文**：
  //   { id, locale, text, at, state:'wait'|'sending'|'held', calls, commit }
  // 调度**只有一个函数 schedule()**：每个事件（新字/回复/错误/朗读开关/settle/到点）处理完都调它，
  // 它从账本 + 时间戳重新算出「下一步该干什么」，并且只设一个计时器 —— 「忘了重新计时」在结构上
  // 不可能发生。按序只约束**上屏顺序**：后面的语言可以先发送、结果先扣着，等前面的提交了再上屏。
  //
  // 触发：(a) 长度到线立即送（**不受朗读影响**）；(b) 空闲：最后一次进字后 idleMs。碎片（原文末尾
  // 无句末标点且短）在第一次空闲**预送并扣住**：结果挂在那一批请求上，到 `sentAt+idleMs` 或
  // 期间又来了新字时**当场核对** —— 有新字就作废、跟新字一起重送；没有就出行。朗读**只暂停空闲计时**，
  // 扣住结果的出行不受影响。
  // 失败梯度：第 1 次不切、第 2 次按标点硬切全部交旧路；每字最多 SEG_MAX_CALLS 次调用。
  // 生命周期 open → closing(原因) → closed，收尾只有 settle()；dispose 在 closed 之后，账本非空经 onLeak。
  const SEG_MAX_CALLS = 3;        // 每个字最多参与几次模型调用
  const SEG_END_WAIT_MS = 3000;   // 「结束」时等在飞请求的上限
  // 碎片：末尾无句末标点且很短（按**识别原文**判；模型补的标点不算）
  function segIsFragment(text) {
    const s = String(text || '').trim();
    if (!s) return false;
    if (/[。！？!?]$|[.]$/.test(s)) return false;
    const c = segCounts(s);
    const n = c.cjk + c.thai;
    return n > 0 ? n < 6 : c.words < 4;
  }
  function stripTailPunct(s) { return String(s || '').replace(/[.。!！?？\s]+$/g, ''); }
  // ── R12（第十轮 · 方案 2/5）：短片判定 + 相邻行重复的归一化 ───────────────────
  const SEG_PARTIAL_MS = 2500;    // 「partial 还在到达」的判活窗口（与 listen-model 的 PARTIAL_TTL_MS 同值）
  const SEG_SHORT_CJK = 4, SEG_SHORT_WORDS = 2;   // 「≤2 词」片：拉丁按空格词、汉字圈按字
  const SEG_DUP_MIN = 3;          // 相邻两行归一化后至少重合这么多字符才算「重复片段」
  // R14：已出行的临时稿（partial 补救）只对**同一段话**有效 —— 真机实测（g3 第 2 次）：两句
  // 重复的 `Yes please.` 间隔约 14s，若按 15s 保留，后一句会被前一句的已出行临时稿整条去重掉。
  // 去重本身按文字（R14），这个窗口只界定「同一段话」的范围。
  // R15：界定「同一段话」改用**音频区间**（trimAgainstRescueOut）——正式 final 与临时稿真交叠、
  // 或 final.t0 - 临时稿.t1 ≤ GAP，才允许按文字裁剪；否则清掉临时稿、两条都留。真机 g3 的句距
  // 音频 3.6–5.1s 由此与「同句续接片（0–1.0s）」分开。SEG_RESCUE_KEEP_MS 只在正式 final 或
  // 临时稿缺 t0/t1 时兜底（到达间隔 ≤ 本值）。
  const SEG_RESCUE_KEEP_MS = 1500;
  const SEG_RESCUE_GAP_MS = 1500;   // 音频区间版「同一句」的相邻容差（final.t0 − ro.t1）
  // 「≤2 词的片」：空格分词 ≤2；无空格文字（中日韩泰）按字数 ≤4（否则整句无空格会恒算 1 词）。
  function segShortPiece(text) {
    const c = segCounts(text);
    const n = c.cjk + c.thai;
    return n > 0 ? n <= SEG_SHORT_CJK : c.words <= SEG_SHORT_WORDS;
  }
  // 相邻行去重用的归一化：折大小写、只留字母/数字（忽略标点空白）。与 normSuffixText 不同 ——
  // 后者不折大小写（remainder 后缀比对要求数字/大小写逐字一致），这里的判据是「同一串字」。
  function normDupText(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
  // 归一化后数到第 n 个字，返回它在原文里的下标（含该字符之后）。
  function rawIndexAfterNorm(s, n) {
    const str = String(s == null ? '' : s);
    let cnt = 0;
    for (let i = 0; i < str.length; i++) {
      if (/[\p{L}\p{N}]/u.test(str.charAt(i))) { cnt++; if (cnt >= n) return i + 1; }
    }
    return str.length;
  }
  // last 的归一化**后缀** == 新文本的归一化**前缀** 的最长长度（≥SEG_DUP_MIN 才算，否则 0）。
  function dupPrefixLen(lastNorm, newNorm) {
    const max = Math.min(lastNorm.length, newNorm.length);
    for (let k = max; k >= SEG_DUP_MIN; k--) if (lastNorm.slice(-k) === newNorm.slice(0, k)) return k;
    return 0;
  }
  // 新文本的归一化**前缀**出现在 hay 归一化文本里的最长长度（用于「补救文字已出行 ⇒ 只追加不
  // 重叠部分」：' Please make' / ' 3' 都已被已出行的补救文字覆盖 ⇒ 整条不追加）。
  function normSubstrPrefixLen(hay, neu) {
    const max = Math.min(hay.length, neu.length);
    for (let k = max; k >= SEG_DUP_MIN; k--) if (hay.indexOf(neu.slice(0, k)) >= 0) return k;
    return 0;
  }

  // ── R14：临时稿（partial 补救文字）与正式 final 的**文字对齐** ─────────────────
  // 第十二、十三轮按音频区间判「同一段音频」——前提不成立：识别器的 partial 没有时间戳，
  // 而且覆盖的音频通常比那条坏 final 长得多，于是修法在「丢句首」与「重复」之间摆。R14 改成
  // 按文字对齐：
  //   · 临时稿 = 从 partial 救回的文字（rescued），不再信它的 t0/t1，只记到达时刻；
  //   · 后来的正式 final 在临时稿里对齐 ⇒ 临时稿让位（只留对齐点之前的部分，空则删）；
  //   · 对不上 ⇒ 两条都留（宁可偶尔重复，也不丢字），记 rescue:nomatch；
  //   · 两条**正式 final** 之间永不去重（真说了两遍就都留）。
  const ALIGN_MIN_RUN = 2;    // 至少连续对齐这么多词才算「对上了」（单词噪音不算）
  const ALIGN_FUZZ_MIN = 4;   // 允许 1 处字母差异的词的长度下限（短词只许完全相等，避免 of/to 这类误配）
  const ALIGN_NUM_WORDS = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
    hundred: 100, thousand: 1000,
  };
  // 对齐用的「词」：拉丁/数字连成一段；中日韩**逐字**（没有空格，整段连写没法按空格分）。
  const ALIGN_CJK_CH = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const ALIGN_WORD_CH = /[\p{L}\p{N}]/u;
  function alignTokens(text) {
    const s = String(text == null ? '' : text);
    const out = [];
    let cur = '', curAt = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charAt(i);
      if (ALIGN_CJK_CH.test(ch)) {
        if (cur) { out.push({ w: cur, at: curAt }); cur = ''; }
        out.push({ w: ch, at: i });
      } else if (ALIGN_WORD_CH.test(ch)) {
        if (!cur) curAt = i;
        cur += ch;
      } else if (cur) { out.push({ w: cur, at: curAt }); cur = ''; }
    }
    if (cur) out.push({ w: cur, at: curAt });
    return out;
  }
  function alignWords(s) { return alignTokens(s).map((t) => t.w.toLowerCase()); }
  function canonWord(w) {
    const x = String(w || '');
    if (/^\d+$/.test(x)) { const n = parseInt(x, 10); return Number.isFinite(n) ? '#' + n : x; }
    if (Object.prototype.hasOwnProperty.call(ALIGN_NUM_WORDS, x)) return '#' + ALIGN_NUM_WORDS[x];
    return x;
  }
  function editLE1(a, b) {
    if (a === b) return true;
    const m = a.length, n = b.length;
    if (!m || !n || Math.abs(m - n) > 1) return false;
    let i = 0, j = 0, diff = 0;
    while (i < m && j < n) {
      if (a.charAt(i) === b.charAt(j)) { i++; j++; continue; }
      if (++diff > 1) return false;
      if (m > n) i++; else if (n > m) j++; else { i++; j++; }
    }
    return diff + (m - i) + (n - j) <= 1;
  }
  // 两个词算不算同一个：数字 = 英文数词（3 == three）；长词允许 1 处**字母**差异（Zang/Zhang）。
  // 带数字的词（`make93`）只认完全相等 —— 数字是识别器最容易听错、又最要紧的内容，不做模糊。
  function wordNear(a, b) {
    const A = canonWord(a), B = canonWord(b);
    if (A === B) return true;
    if (A.charAt(0) === '#' || B.charAt(0) === '#') return false;   // 数字词只认归一，不模糊
    if (/\d/.test(A) || /\d/.test(B)) return false;                  // 带数字的其它词也只认完全相等
    if (A.length < ALIGN_FUZZ_MIN || B.length < ALIGN_FUZZ_MIN) return false;
    return editLE1(A, B);
  }
  // temp 原文里第 wi 个规范词**之前**的那段（去掉前导标点空白）。
  function alignBeforeWord(text, wi) {
    const toks = alignTokens(text);
    if (wi < 0 || wi >= toks.length) return null;
    return String(text).slice(0, toks[wi].at).replace(LEAD_PUNCT, '').trim();
  }
  // 把 final 的文字在 temp 里对齐：从 final 首词开始找最长连续匹配（数字归一 / 长词 1 字母差）。
  // 返回 { hi, len, before }（before = temp 中对齐点之前的原文；可能为 ''）或 null（对不上）。
  function alignFinalInTemp(temp, finalText) {
    const hay = alignWords(temp), needle = alignWords(finalText);
    if (!hay.length || !needle.length) return null;
    let best = 0, bestHi = -1;
    for (let i = 0; i < hay.length; i++) {
      let k = 0;
      while (i + k < hay.length && k < needle.length && wordNear(hay[i + k], needle[k])) k++;
      if (k > best) { best = k; bestHi = i; }
    }
    const need = Math.min(needle.length, hay.length, ALIGN_MIN_RUN);
    if (best < need || bestHi < 0) return null;
    return { hi: bestHi, len: best, before: alignBeforeWord(temp, bestHi) };
  }
  // 临时稿整段是不是「紧挨着的上一条正式 final」的结尾（归一化后缀 + 音频邻接）。
  function isTailDup(prevText, tempText, gapMs, maxGap) {
    const p = normDupText(prevText), t = normDupText(tempText);
    if (!p || !t || !p.endsWith(t)) return false;
    return !Number.isFinite(gapMs) || gapMs <= maxGap;
  }
  // final 的某个词后缀在 temp 里必须一直对齐到 final 的最后一个词。从最长的后缀试起，
  // 取第一个整段对上的（≥ ALIGN_MIN_RUN）。ni = 后缀在 final 词序列上的起点（0 = 从首词开始）。
  function alignSuffixToEnd(temp, finalText) {
    const hay = alignWords(temp), needle = alignWords(finalText);
    if (hay.length < ALIGN_MIN_RUN || needle.length < ALIGN_MIN_RUN) return null;
    for (let ni = 0; ni <= needle.length - ALIGN_MIN_RUN; ni++) {
      const needLen = needle.length - ni;
      for (let i = 0; i <= hay.length - needLen; i++) {
        let k = 0;
        while (k < needLen && wordNear(hay[i + k], needle[ni + k])) k++;
        if (k === needLen) return { ni, hi: i, len: needLen, before: alignBeforeWord(temp, i) || '' };
      }
    }
    return null;
  }
  // R14 ⑤：以标点开头的正式 final（识别器把句首吞了）—— 把 final 文字在 partial 里对齐，取
  // 对齐位置**之前**的部分作为句首临时稿补回（对不上 / 不以标点开头 ⇒ 返回 ''）。
  // #590 L：首词本身可能是垃圾（`, you, and you risk…` 的 you 对不上 partial 里紧跟着的 and）。
  // 从首词对不上时，改对齐「一直到末词」的最长后缀；留下的词必须多于切掉的，免得句尾两个词
  // 碰巧相同就把前半句丢了。不以标点开头的不走这里 —— 开头那几个词可能是真说的。
  function rescueLeadCut(finalText, partialText) {
    const ft = String(finalText == null ? '' : finalText);
    if (!LEAD_PUNCT.test(ft)) return null;
    const al = alignSuffixToEnd(partialText, ft);
    if (al && al.ni > 0 && al.len > al.ni) {
      const toks = alignTokens(ft);
      const text = ft.slice(toks[al.ni].at).replace(/^\s+/, '');
      if (!HAS_LETTER.test(text)) return null;
      return { lead: al.before || '', text };
    }
    if (al && al.ni === 0 && al.before) return { lead: al.before, text: ft };
    const fromStart = alignFinalInTemp(partialText, ft);
    if (fromStart && fromStart.before) return { lead: fromStart.before, text: ft };
    return null;
  }
  function rescueLead(finalText, partialText) {
    const cut = rescueLeadCut(finalText, partialText);
    return (cut && cut.lead) ? cut.lead : '';
  }
  // 模型 source 与上一条已出行行的重复前缀裁剪（方案 2，R12 第十轮）——**唯一判据**，出行时
  // （trimDupRows）与漂移检查前（parseSegReply，R14 方案 C）共用。只有这段前缀**不在本批缓冲里**
  // （= 模型按上下文补回来的、不是我们喂进去的）才切。
  function trimDupSource(lastText, src, bufText) {
    const s = String(src == null ? '' : src);
    const sN = normDupText(s);
    if (!sN) return s;
    const L = dupPrefixLen(normDupText(lastText), sN);
    if (!L) return s;
    const bufN = normDupText(bufText);
    const legit = L <= bufN.length && bufN.slice(0, L) === sN.slice(0, L);
    if (legit) return s;
    return s.slice(rawIndexAfterNorm(s, L)).replace(LEAD_PUNCT, '').trim();
  }

  // ── R14 ②：中文路 → 英文路的候补转交（只允许这一个方向）───────────────────────
  const XFER_MAX_WORDS = 3;   // 候补最多 3 个词（长句里的拉丁垃圾一律不转交）
  const XFER_CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const XFER_PUNCT_MAP = { '。': '.', '，': ',', '、': ',', '！': '!', '？': '?', '；': ';', '：': ':',
    '…': '...', '（': '(', '）': ')', '「': '"', '」': '"', '『': '"', '』': '"', '《': '<', '》': '>',
    '“': '"', '”': '"', '‘': "'", '’': "'" };
  // 中文标点换成英文（`Yes。` → `Yes.`），再去掉所有非 ASCII 可见字符。
  function xferClean(t) {
    const s = String(t == null ? '' : t)
      .replace(/[。，、！？；：…（）「」『』《》“”‘’]/g, (c) => (XFER_PUNCT_MAP[c] || ''))
      .replace(/([,;:])(?=\S)/g, '$1 ')
      .replace(/[^\x20-\x7E]+/g, ' ').replace(/\s+/g, ' ').trim();
    return /[A-Za-z0-9]/.test(s) ? s : '';   // 清洗后连字母/数字都没有 ⇒ 不是候补（不喂空串）
  }
  // 归属语言是英文（lid=en）时，被 attrib 拒掉的中文路结果够不够当候补：一个汉字都没有、有字母、
  // 最多 3 个词。够 ⇒ 才允许等一次空闲 / 等停止收音再决定转交。
  function isXferCandidate(o) {
    const p = o || {};
    const lid = baseCode(p.lid), base = baseCode(p.base);
    if (lid !== 'en' || !base || base === 'en') return false;   // 只限中文路 → 英文路
    const t = String(p.text || '');
    if (XFER_CJK_RE.test(t)) return false;                      // 一个汉字（含假名/谚文）都没有
    if (!/[A-Za-z]/.test(t)) return false;                      // 有字母
    const words = (t.match(/[A-Za-z0-9']+/g) || []).length;
    return words > 0 && words <= XFER_MAX_WORDS;
  }
  // 候补计时器（纯逻辑，可测）：归属英文时，中文路的纯拉丁短结果先当候补。
  //   · 英文路在候补前 waitMs 内、或等待期间给了任何带字母的结果（含补救文字）⇒ 丢弃候补；
  //   · 到点（自动听一次空闲）或 stop()（点停等到停止收音）⇒ 转交；
  //   · canXfer 由接线方给（归属仍是英文、断句路可用）。
  function makeTransferGate(deps) {
    const d = deps || {};
    const now = d.now || (() => Date.now());
    const setT = d.setTimeout || setTimeout, clearT = d.clearTimeout || clearTimeout;
    const waitMs = d.waitMs || SEG_IDLE_MS;
    let cand = null, lastEn = -Infinity;
    const diag = (reason, extra) => { if (d.onDiag) { try { d.onDiag('intake:' + reason, extra); } catch (_) {} } };
    function clearCand() { if (cand && cand.timer) clearT(cand.timer); cand = null; }
    function fire(c) {
      if (now() - lastEn <= waitMs) { diag('xfer-drop', { text: 'en-letter', rem: c.text }); return false; }
      if (d.canXfer && !d.canXfer(c)) { diag('xfer-drop', { text: 'not-ready', rem: c.text }); return false; }
      // 第 5 轮（提案 §3.0 0-b，L2）：转交**进目标通道之前**同样过一遍回声闸 —— 以前候补绕过了
      // intakeDecide 的 ①朗读中同语言硬闸 与 ③文字回声检查，于是「App 正读英文、中文路把读声收成
      // she. / theafternew.」这类拉丁短句被原样转进英文通道，成了多余的行。目标语言恒为 en
      // （canXfer 只放行这一路），但用 targetLang 注入以便测试与将来扩展。
      const tgt = d.targetLang ? baseCode(d.targetLang(c)) : 'en';
      const playing = d.playing ? d.playing() : null;
      if (tgt && playing && typeof playing.has === 'function' && playing.has(tgt)) {
        diag('xfer-echo', { text: 'speaking', rem: c.text }); return false;
      }
      if (d.isEcho) {
        let hit = false;
        try { hit = !!d.isEcho(c.text); } catch (_) { hit = false; }
        if (hit) { diag('xfer-echo', { text: 'echo', rem: c.text }); return false; }
      }
      diag('xfer', { text: c.text });
      if (d.onXfer) { try { d.onXfer(c.text, c.locale, c); } catch (_) {} }
      return true;
    }
    return {
      // 英文路给了带字母的结果（含补救文字 / 临时稿）⇒ 记时刻；已有候补则就地丢弃。
      noteEnLetter() {
        lastEn = now();
        if (cand) { clearCand(); diag('xfer-drop', { text: 'en-letter-now' }); }
      },
      offer(o) {
        if (cand) { clearCand(); diag('xfer-drop', { text: 'replaced' }); }
        const c = { text: String((o && o.text) || ''), locale: (o && o.locale) || '', t0: o && o.t0, t1: o && o.t1 };
        if (!c.text) return false;
        if (now() - lastEn <= waitMs) { diag('xfer-drop', { text: 'en-letter-pre', rem: c.text }); return false; }
        c.timer = setT(() => { if (cand === c) { cand = null; fire(c); } }, waitMs);
        cand = c;
        return true;
      },
      stop() {   // 点停：等到停止收音为止（立即结算）
        const c = cand; if (!c) return false;
        if (c.timer) clearT(c.timer);
        cand = null;
        return fire(c);
      },
      cancel() { clearCand(); },
      pending() { return !!cand; },
    };
  }

  // 已出行的临时稿：正式 final 去掉已出行的重叠前缀、只追加剩余（**按文字**，R14）。
  // 匹配按**整词**（不是逐字符）—— 否则「已出行的 `this15`」会把新片的 `this32` 切掉半个词。
  function tokenPrefixInHay(hay, needle) {
    let best = 0;
    for (let i = 0; i < hay.length; i++) {
      let k = 0;
      while (i + k < hay.length && k < needle.length && wordNear(hay[i + k], needle[k])) k++;
      if (k > best) best = k;
    }
    return best;
  }
  function alignAfterTokens(text, k) {
    const toks = alignTokens(text);
    if (k <= 0) return String(text == null ? '' : text);
    if (k >= toks.length) return '';
    return String(text).slice(toks[k].at).replace(LEAD_PUNCT, '').trim();
  }

  // remainder 后缀比对（方案 3，2026-10-11 第九轮）：模型会把 remainder「清洗」成与识别原文不逐字
  // 一致的写法（补/删标点、把 `,` 写成 `, `），于是 `buf.endsWith(rem)` 为假 → remainder-mismatch
  // → 两次就硬切交旧路（r9 C-en-4：buffer 以 `.....` 结尾、模型只回 `... say, to`）。
  // 判据改成**去掉标点与空白后**逐字后缀比对；数字/大小写/词仍必须一致（归一化只去标点空白，
  // 不折大小写、不换算数字）。比对通过后由 remSuffixRaw 按**原文位置**取回 remainder 原文，
  // 账本守恒不靠模型给的写法。
  const SUFFIX_STRIP = /[^\p{L}\p{N}]+/gu;
  function normSuffixText(s) { return String(s == null ? '' : s).replace(SUFFIX_STRIP, ''); }
  // 归一化后的 rem 是不是 buf 的后缀？从**末尾**逐字符对齐（O(n)），不受重复词影响。
  function isSuffixLoose(buf, rem) {
    const r = normSuffixText(rem);
    if (!r) return false;
    const b = normSuffixText(buf);
    if (r.length >= b.length) return r === b;
    return b.slice(b.length - r.length) === r;
  }
  // 按**原文位置**取回末尾这段（= rem 归一化后对应的原文切法），返回 { text, start } 或 null。
  // text 是原文里那一段（可能带标点/空白），start 是它在本批文本里的下标。
  function remSuffixRaw(buf, rem) {
    const R = normSuffixText(rem);
    if (!R) return null;
    const B = String(buf == null ? '' : buf);
    let i = B.length, cnt = 0;
    while (i > 0 && cnt < R.length) { i--; if (/[\p{L}\p{N}]/u.test(B.charAt(i))) cnt++; }
    if (cnt < R.length) return null;
    const bTail = normSuffixText(B.slice(i));
    if (bTail !== R) return null;   // 数字/大小写/词不一致 ⇒ 不是后缀
    return { text: B.slice(i), start: i };
  }
  function mergeSegFragments(segs) {
    const out = [];
    for (let i = 0; i < segs.length; i++) {
      const cur = segs[i];
      if (i < segs.length - 1 && segIsFragment(stripTailPunct(cur.source))) {
        segs[i + 1] = { source: joinFrag(stripTailPunct(cur.source), segs[i + 1].source), translation: joinFrag(stripTailPunct(cur.translation), segs[i + 1].translation) };
        continue;
      }
      out.push(cur);
    }
    return out;
  }

  // 断句路由器（每场一个；conv 路专用）。纯逻辑，不含 fetch —— call 由调用方注入。
  //   feed(locale, text, opts) / settle(reason) / pending(locale) / setSpeaking(on) / dispose() / state()
  function makeSegmentRouter(deps) {
    const d = deps || {};
    const idleMs = d.idleMs || SEG_IDLE_MS;
    const autoReleaseMs = d.releaseMs || SEG_RELEASE_MS;
    const endWaitMs = d.endWaitMs || SEG_END_WAIT_MS;
    const soft = d.soft || SEG_SOFT, hard = d.hard || SEG_HARD;
    const now = d.now || (() => Date.now());
    const setT = d.setTimeout || setTimeout, clearT = d.clearTimeout || clearTimeout;
    const ledger = [];
    const meta = {};        // locale → { lastFeedAt, force, extraWaited, fails, retryForce, retryUsed, retryAt, partialAt }
    const lastEmit = {};    // locale → 最近一次上屏的行文本（方案 2：模型 source 句首重复裁剪的比对对象）
    const rescueOut = {};   // locale → { text, t0, t1, at } 已出行的 partial 补救文字（R14：按**文字**只追加不重叠部分；R15：带音频区间界定「同一句」）
    const lastFormalRec = {};   // locale → { text, t1, at }：上一条正式 final（R14 ③ dup-prev 的比对对象）
    let seq = 0, posSeq = 0, disposed = false, speaking = false, pttMode = false, holdMode = false;   // pttMode=正在按键收音（方案 1 的接线点，只作状态）；holdMode=旧「按住说」（第二次空闲用 idleMs）。默认自动听（autoReleaseMs）。
    let phase = 'open', closeReason = '';
    let inFlight = null;    // 请求在飞：{ locale, ids, text, sentAt, force, hold, voided, settled }
    let authStopped = false; // 额度 / key 停机：账本只出原文，不再调用（#590 K）
    const heldBatch = {};   // locale → 扣住的结果（请求已回、等出行）：{ ids, text, sentAt, held:{segs,rem,ms}, releaseAt }
    let timer = 0, endTimer = 0;
    let calls = 0, emits = 0, fallbacks = 0;
    const failCounts = {};  // 诊断：单次失败原因计数（不含内容）

    function M(lc) { return meta[lc] || (meta[lc] = { lastFeedAt: 0, force: false, extraWaited: false, fails: 0, retryForce: false, retryUsed: false, retryAt: 0, partialAt: 0 }); }
    function L(lc) { return ledger.filter((r) => r.locale === lc); }
    function byId(id) { for (const r of ledger) if (r.id === id) return r; return null; }
    function locales() { const s = new Set(Object.keys(meta)); for (const r of ledger) s.add(r.locale); return [...s]; }
    function pendRecs(lc) { return L(lc); }   // 账本里所有记录（含已挂提交、等按序 flush 的）都是「未上屏」文字
    function joinAll(recs) { return recs.map((r) => r.text).reduce((a, b) => joinFrag(a, b), ''); }
    function pendingText(lc) { return joinAll(pendRecs(lc)); }
    function pendingAll() { return locales().map((lc) => ({ locale: lc, text: pendingText(lc) })).filter((x) => x.text); }
    // 该语言账本里**连续**的待处理段（批/旧路提交都不跨别的语言的记录 —— 上屏顺序才严格）
    function runsOf(lc) {
      const runs = []; let cur = null;
      for (const r of ledger) {
        const ok = r.locale === lc && r.state === 'wait' && !r.commit;
        if (ok) { if (!cur) { cur = []; runs.push(cur); } cur.push(r); }
        else cur = null;
      }
      return runs;
    }
    function headRun(lc) { const rs = runsOf(lc); return rs.length ? rs[0] : []; }
    function legacyPayload(text) { return { kind: 'legacy', texts: hardCutSentences(text) }; }
    // 额度 / key 停机：原文照出、译文留空。走 emit，不走 fallback（fallback 会再翻译一次）。
    function unsentRow(text, meta) {
      const m = meta || {};
      return { kind: 'rows', rows: [{ source: text, translation: '' }], ms: 0, force: !!m.force, orig: text, feedAt: m.feedAt || 0, sentAt: m.sentAt || 0 };
    }
    function attach(ids, payload) {
      const recs = ids.map(byId).filter(Boolean);
      if (!recs.length) return;
      if (!recs[0].commit) recs[0].commit = payload;
      for (let i = 1; i < recs.length; i++) if (!recs[i].commit) recs[i].commit = { kind: 'none' };
    }
    function commit(ids, payload) { attach(ids, payload); flush(); }
    // **先定状态，再通知**（A1）：先把要出的行挪进「待通知队列」、账本状态全部改完，再逐条通知界面层；
    // 每条通知各自 try/catch，出错只记一条诊断（零内容），绝不影响路由器状态。
    function flush() {
      const queue = [];
      while (ledger.length && ledger[0].commit && !ledger[0].commit.held) {
        const rec = ledger.shift();
        const c = rec.commit;
        if (c.kind === 'rows') {
          // 方案 2（R12）：模型 source 句首多出与上一条已出行尾部重复的内容 ⇒ 切掉该前缀（emit:trim-dup）
          const rows = trimDupRows(rec.locale, c.rows || [], c.orig);
          if (rec.rescued) rescueOut[rec.locale] = { text: String(c.orig || rec.text || ''), t0: rec.t0, t1: rec.t1, at: now() };
          if (rows.length) {
            lastEmit[rec.locale] = String(rows[rows.length - 1].source || '');
            emits += rows.length;
            queue.push({ type: 'rows', rows, meta: { locale: rec.locale, ms: c.ms, force: c.force, orig: c.orig, pos: rec.pos, feedAt: c.feedAt, sentAt: c.sentAt } });
          }
        } else if (c.kind === 'legacy') {
          for (const t of c.texts) { fallbacks++; lastEmit[rec.locale] = t; queue.push({ type: 'legacy', text: t, locale: rec.locale }); }
          // 补救片可能只是这一批里的一条（legacy 载荷挂在**批首**记录上）——载荷里带着「这批含补救片」
          // 的标记，按整批上屏的文字做 rescueOut（R14：已出行 ⇒ 后续正式 final 只追加不重叠部分）。
          if (c.rescue || rec.rescued) {
            const rt0 = Number.isFinite(c.rescueT0) ? c.rescueT0 : rec.t0;
            const rt1 = Number.isFinite(c.rescueT1) ? c.rescueT1 : rec.t1;
            rescueOut[rec.locale] = { text: (c.texts || []).join(' '), t0: rt0, t1: rt1, at: now() };
          }
        }
      }
      // stop/switch 的收尾：账本清空（且无在飞/扣住）⇒ 回到 open（可以继续听）
      if (phase === 'closing' && (closeReason === 'stop' || closeReason === 'switch') && !ledger.length && !inFlight && !Object.keys(heldBatch).length) {
        phase = 'open'; closeReason = '';
        for (const lc of Object.keys(meta)) meta[lc].force = false;
      }
      notify(queue);
    }
    // ── 方案 2（R12）：模型 source 与上一条已出行行的重复前缀裁剪 ────────────────
    // 归一化后比较；只有当这段前缀**不在本批缓冲里**（= 模型按上下文补回来的、不是我们喂进去的）
    // 才切。这样 fuzz 里「模型恒返回 source==buffer」不会被误切。
    function trimDupRows(lc, rows, orig) {
      const list = rows || [];
      let last = lastEmit[lc] || '';
      if (!last) return list;
      const out = [];
      for (let row of list) {
        let src = String((row && row.source) || '');
        const rest = trimDupSource(last, src, orig);
        if (rest && rest !== src) {
          const L = normDupText(src).length - normDupText(rest).length;
          if (d.onDiag) { try { d.onDiag('emit:trim-dup', { text: src, why: 'n=' + L }); } catch (_) {} }
          src = rest;
          row = Object.assign({}, row, { source: rest });
        }
        last = src;
        out.push(row);
      }
      return out;
    }

    // ── R14：临时稿（partial 补救文字）按**文字对齐**让位给正式 final ─────────────
    // 第十二、十三轮按音频区间去重 —— 前提不成立（partial 没有时间戳、覆盖音频比坏 final 长），
    // 于是「丢句首」与「重复」来回摆。R14 全部改成按文字：
    //   · 未出行的临时稿：正式 final 在它里面对齐 ⇒ 只留对齐点之前的部分（空则删），记 rescue:trim；
    //     对不上 ⇒ 两条都留（宁可重复不丢字），记 rescue:nomatch；
    //   · 已出行的临时稿：正式 final 去掉已出行的重叠前缀，只追加剩余（trimAgainstRescueOut）；
    //   · 临时稿整段是紧挨着的上一条正式 final 的结尾 ⇒ 丢掉临时稿（rescue:dup-prev）；
    //   · 两条**正式 final** 之间永不去重。
    const RESCUE_DUP_GAP_MS = 300;   // 「紧挨着」的音频邻接容差（与句头闸 HOLD_DUP_GAP_MS 同值）
    function findRescueWait(lc) {
      for (let i = ledger.length - 1; i >= 0; i--) {
        const r = ledger[i];
        if (r.locale !== lc || !r.rescued) continue;
        if (r.state !== 'wait' || r.commit) continue;
        return r;
      }
      return null;
    }
    function anyRescueRec(lc) {
      for (let i = ledger.length - 1; i >= 0; i--) { const r = ledger[i]; if (r.locale === lc && r.rescued) return r; }
      return null;
    }
    // 补救片已经在飞 / 被扣住 ⇒ 先作废那一批（recs 回 wait），再按文字对齐替换。
    // **不能**只改文字 —— 在飞批次用的是发送时的旧文本，改了会丢掉正式 final 的新增部分。
    function reopenRescueBatch(lc) {
      const ib = inFlight;
      if (ib && ib.locale === lc && ib.ids.some((id) => { const r = byId(id); return r && r.rescued; })) {
        ib.voided = true; inFlight = null; recsToWait(ib);
        if (ib.settled) { const f = ib.settled; ib.settled = null; try { f(); } catch (_) {} }
      }
      const hb = heldBatch[lc];
      if (hb && hb.ids.some((id) => { const r = byId(id); return r && r.rescued; })) {
        delete heldBatch[lc]; recsToWait(hb);
        if (hb.settled) { const f = hb.settled; hb.settled = null; try { f(); } catch (_) {} }
      }
    }
    // 正式 final 与未出行的临时稿做文字对齐。返回 'trim' | 'nomatch' | 'emitted' | 'none'。
    function trimRescueByAlign(lc, t) {
      let temp = findRescueWait(lc);
      if (!temp) {
        const any = anyRescueRec(lc);
        if (any && !any.commit && (any.state === 'sending' || any.state === 'sent' || any.state === 'held')) {
          reopenRescueBatch(lc); temp = findRescueWait(lc);
        }
        if (!temp && any && any.commit) {
          // 已挂提交但还没出行（被前面别的语言的在飞批次挡住 flush）⇒ 马上上屏，按「已出行」处理。
          const ctext = (any.commit.kind === 'legacy' && any.commit.texts && any.commit.texts.length)
            ? any.commit.texts.join(' ') : (any.commit.orig || any.text);
          rescueOut[lc] = { text: ctext, t0: any.t0, t1: any.t1, at: now() };
          return 'emitted';
        }
      }
      if (!temp) return 'none';
      const al = alignFinalInTemp(temp.text, t);
      if (!al) {
        if (d.onDiag) { try { d.onDiag('rescue:nomatch', { text: t, rem: String(temp.text).slice(0, 200) }); } catch (_) {} }
        return 'nomatch';
      }
      if (d.onDiag) { try { d.onDiag('rescue:trim', { text: t, rem: al.before || '' }); } catch (_) {} }
      if (!al.before) { const i = ledger.indexOf(temp); if (i >= 0) ledger.splice(i, 1); }
      else { temp.text = al.before; temp.at = now(); }
      return 'trim';
    }
    // 已出行的补救文字：返回「可追加的剩余部分」（'' = 整条重复、不追加；原样 = 无可去重）。
    // **按文字**去重（R14）；时间只用来界定「是不是同一句」（R15）：
    //   · 正式 final 与临时稿都有 t0/t1 ⇒ 只有音频区间真交叠（overlapTs）或 final.t0 − ro.t1 ≤
    //     SEG_RESCUE_GAP_MS 才允许按文字裁剪；
    //   · 有一边缺 t0/t1 ⇒ 退回「到达间隔 ≤ SEG_RESCUE_KEEP_MS」的窗口；
    //   · 不同句 ⇒ 清掉这条临时稿、两条都留（宁可重复不丢字）。
    function sameRescueSentence(ro, t0, t1) {
      const fOk = Number.isFinite(t0) && Number.isFinite(t1);
      const rOk = Number.isFinite(ro && ro.t0) && Number.isFinite(ro && ro.t1);
      if (fOk && rOk) return overlapTs(t0, t1, ro.t0, ro.t1) || (t0 - ro.t1) <= SEG_RESCUE_GAP_MS;
      return (now() - (ro.at || 0)) <= SEG_RESCUE_KEEP_MS;
    }
    function trimAgainstRescueOut(lc, t, t0, t1) {
      const ro = rescueOut[lc];
      if (!ro || !ro.text) return t;
      if (!sameRescueSentence(ro, t0, t1)) { delete rescueOut[lc]; return t; }
      const rT = alignWords(ro.text), tT = alignWords(t);
      if (!rT.length || !tT.length) return t;
      const k = tokenPrefixInHay(rT, tT);
      if (!k) {
        delete rescueOut[lc];
        if (d.onDiag) { try { d.onDiag('rescue:append', { text: t, why: 'no-dup' }); } catch (_) {} }
        return t;
      }
      const rest = alignAfterTokens(t, k);
      if (d.onDiag) { try { d.onDiag('rescue:append', { text: t, why: rest ? ('trim=' + k) : 'all-dup' }); } catch (_) {} }
      return rest;
    }
    function notify(queue) {
      for (const n of queue) {
        try {
          if (n.type === 'rows') d.emit(n.rows, n.meta);
          else d.fallback(n.text, { locale: n.locale });
        } catch (e) {
          // 界面层出行报错：只记一条诊断，路由器状态已经落定，后面的话照常出行。
          noteFail('notify');
          if (d.onNotifyError) { try { d.onNotifyError(String((e && e.message) || e || '')); } catch (_) {} }
        }
      }
    }
    function legacyRecs(recs) {
      if (!recs.length) return;
      // 这一批里若有 partial 补救片，把「这批含临时稿」带进 legacy 载荷（R14：已出行后按文字去重）。
      const resc = recs.filter((r) => r.rescued).pop();
      const p = legacyPayload(joinAll(recs));
      if (resc) { p.rescue = true; p.rescueT0 = resc.t0; p.rescueT1 = resc.t1; }
      commit(recs.map((r) => r.id), p);
    }

    // ── 唯一的调度函数 ────────────────────────────────────────────────────────
    function schedule() {
      if (timer) { clearT(timer); timer = 0; }
      if (disposed) return;
      for (let guard = 0; guard < 64; guard++) {
        const t = now();
        let acted = false;
        // ① 扣住的结果（按语言）：新字 ⇒ 作废；到点 ⇒ 出行。不受朗读影响。
        for (const lc of Object.keys(heldBatch)) {
          const hb = heldBatch[lc];
          if (!hb) continue;
          if (hasNewer(hb)) { voidHeld(lc); acted = true; break; }
          if (t >= hb.releaseAt) { releaseHeld(lc); acted = true; break; }
        }
        if (acted) { /* 继续下一轮 */ }
        if (disposed) return;
        // ② 发送：全局只一个在飞；按最早到期挑语言（发送顺序不要求按账本）。
        //   closing(stop/switch) 期间仍要发送（remainder 按 force 送），账本清空后回到 open。
        if (!acted && !inFlight && canSend()) {
          const cand = nextSend(t);
          if (cand) { doSend(cand.lc, cand.hold, cand.force, cand.retry); acted = true; }
        }
        if (!acted) break;
      }
      if (disposed) return;
      // ③ 算下一个时刻，只设一个计时器（用**可发送的连续段**，不含在飞/已提交的记录）
      const t = now();
      let when = Infinity;
      // 只对**未来**的时刻设计时器：本拍到期的动作在上面已经执行过；执行不了（在飞/被扣住）的
      // 靠事件（回复/新字/朗读开关/settle）重新唤醒 —— 不轮询、不忙循环。
      for (const lc of Object.keys(heldBatch)) {
        const hb = heldBatch[lc];
        if (hb && !hasNewer(hb) && hb.releaseAt > t) when = Math.min(when, hb.releaseAt);
      }
      if (!inFlight && canSend()) {
        for (const lc of locales()) {
          const du = dueOf(lc, t);
          if (du && du.due > t) when = Math.min(when, du.due);
        }
      }
      if (when < Infinity) timer = setT(schedule, Math.max(1, when - t));
    }
    // 某语言的到期信息（纯查询，不改状态）：run = 可发送的连续段；due = 该动作的时刻
    // ── 方案 2（R12）：partial 是否还在到达（人还在说）────────────────────────────
    // notePartial 由 listen-model 在每条 partial 上调用；命中窗口内的短片留在缓冲与后文合并，
    // 不强制补调 / 不硬切 / 不走旧路上屏。
    function partialSpeaking(lc, since) {
      const st = M(lc);
      if (!st.partialAt) return false;
      if (since && st.partialAt < since) return false;
      return (now() - st.partialAt) <= SEG_PARTIAL_MS;
    }
    function waitForMore(lc) { const st = M(lc); st.fails = 0; st.lastFeedAt = now(); }
    // 到硬切之前统一走这里：短且人还在说 ⇒ 留在缓冲等后文（方案 2），否则硬切交旧路。
    function maybeHardCut(lc, b) {
      const st = M(lc);
      if (b && segShortPiece(b.text) && partialSpeaking(lc, b.sentAt)) { waitForMore(lc); return false; }
      hardCut(lc); return true;
    }
    function dueOf(lc, t) {
      const run = headRun(lc);
      if (!run.length) return null;
      const txt = joinAll(run);
      const st = M(lc);
      // 强制补调额度（方案 4/5，R12）：retryForce 只在**真正发出**补调时被 doSend 消费；
      // 「人还在说 + 短片」时不许强制补调，留缓冲与后文合并（方案 2）。
      if (st.retryForce) {
        if (segShortPiece(txt) && partialSpeaking(lc, st.retryAt)) { /* 等后文，不补调 */ }
        else return { lc, due: t, hold: false, run, txt, force: true, retry: true };   // 补调＝「全部切完」的同一提示词
      }
      if (st.force) return { lc, due: t, hold: false, run, txt };
      if (segOver(segCounts(txt), soft)) return { lc, due: t, hold: false, run, txt };
      if (speaking) return null;   // 朗读只暂停空闲计时：没有到期动作（长度/force 已在上面放行）
      if (t >= st.lastFeedAt + idleMs) {
        const frag = segIsFragment(txt);
        // 方案 5（R12）：≤2 词的片到空闲时直接用「全部切完」（force=true）发送，省掉一次
        // 「整段 remainder → 再 force 补调」的往返。人还在说（partial 活跃）时退回预送扣住，
        // 等后文合并（方案 2）。
        const shortForce = !d.noShortForce && frag && segShortPiece(txt) && !partialSpeaking(lc, st.lastFeedAt);
        return { lc, due: t, hold: frag && !st.extraWaited && !shortForce, run, txt, force: shortForce };
      }
      return { lc, due: st.lastFeedAt + idleMs, hold: false, run, txt };
    }
    function canSend() { return !authStopped && (phase === 'open' || (phase === 'closing' && (closeReason === 'stop' || closeReason === 'switch'))); }
    function hasNewer(b) {
      for (const r of ledger) {
        if (r.locale !== b.locale || b.ids.indexOf(r.id) >= 0) continue;
        if (r.at > b.sentAt) return true;
      }
      return false;
    }
    function nextSend(t) {
      let best = null;
      for (const lc of locales()) {
        const du = dueOf(lc, t);
        if (!du || du.due > t) continue;
        const lead = ledger.indexOf(du.run[0]);
        if (!best || du.due < best.due || (du.due === best.due && lead < best.lead)) best = { lc, due: du.due, lead, hold: du.hold, force: du.force, retry: !!du.retry };
      }
      return best;
    }
    function doSend(lc, hold, forceOverride, retry) {
      const st = M(lc);
      const run = headRun(lc);
      if (!run.length) return;
      const overIdx = run.findIndex((r) => r.calls >= SEG_MAX_CALLS);
      if (overIdx === 0) { legacyRecs(run); schedule(); return; }
      const ok = overIdx < 0 ? run : run.slice(0, overIdx);
      if (overIdx >= 0) legacyRecs(run.slice(overIdx));
      if (!ok.length) return;
      const force = !!forceOverride || !!st.force;
      st.force = false;
      // 方案 5（R12）：补调**真正发出**时就地消费额度（旧实现只在 :1278 的死条件里清，永不执行）；
      // 每句最多一次补调（retryUsed），再失败直接硬切。变异钩子 noRetryConsume 模拟「去掉消费」。
      if (retry && !d.noRetryConsume) { st.retryForce = false; st.retryUsed = true; }
      if (hold) st.extraWaited = true;
      const text = joinAll(ok);
      ok.forEach((r) => { r.state = 'sending'; r.calls++; });
      calls++;
      const sentAt = now();
      const b = { locale: lc, ids: ok.map((r) => r.id), text, sentAt, force, hold: !!hold, held: null, releaseAt: hold ? sentAt + (holdMode ? idleMs : autoReleaseMs) : 0, voided: false, settled: null };
      inFlight = b;
      const t0 = now();
      Promise.resolve().then(() => d.call(buildSegPrompt(Object.assign({ buffer: text, force }, d.ctx ? d.ctx(lc) : {})), { locale: lc, buffer: text, force }))
        .then((raw) => onResult(b, raw, t0), (err) => onError(b, err));
    }
    function finishBatch(b) {
      if (inFlight === b) inFlight = null;
      if (b.settled) { const f = b.settled; b.settled = null; try { f(); } catch (_) {} }
      schedule();
    }
    // ── 「整段 remainder」/「空回复」的立即强制补调（方案 2/4，2026-10-11 第九轮）──────────
    // 触发条件（r9 C-zh-2 8.36 s、A-yes-7 4.50 s）：模型把**整批**都回成 remainder（段为空、
    // remainder 就是整个 buffer），或干脆回 `{segments:[],remainder:''}`；而且**这次调用期间
    // 账本没有再进新话**。原实现只把 lastFeedAt 拨到 now，于是**从头再等一个 idleMs** 才重发，
    // 每轮多付 1.5 s，直到 SEG_MAX_CALLS=3 硬切交旧路。
    // 现在：这种「没有新信息、也没有新话」的情况下立刻用 force（与「全部切完」/stop flush 同一
    // 提示词）补调一次；期间有新话进账本 ⇒ 按原逻辑等 idle（新话本来就该等）。共**一次**额度
    // （st.retryForce），用完还失败就 hardCut 交旧路 —— 不许无限循环。
    function latestRecAt(lc) { let mx = 0; for (const r of ledger) if (r.locale === lc && r.at > mx) mx = r.at; return mx; }
    // n = 这次调用期间有没有新话进账本
    function demandAllRemainder(lc, b, n, extra) {
      if (!ledger.length) return false;
      if (d.noRetry) {   // 测试注入的变异钩子：退回「调大 lastFeedAt 重等」（见 R9 变异检查）
        const sx = M(lc); sx.fails = 0; sx.lastFeedAt = now();
        return true;     // 「已处理，只是等下一次空闲」——与旧行为一致
      }
      const st = M(lc);
      if (!n) {
        if (segShortPiece(b && b.text) && partialSpeaking(lc, b && b.sentAt)) {   // 方案 2：人还在说
          noteFail('all-remainder', extra); waitForMore(lc); return true;
        }
        // 没有新话进账本 ⇒ 等 idle 毫无意义：立刻 force 补调一次（一次额度，真正发出时才消费）。
        if (!st.retryUsed) {
          noteFail('all-remainder', extra);
          st.retryForce = true; st.retryAt = (b && b.sentAt) || now(); st.extraWaited = true; schedule();
          return true;
        }
        noteFail('all-remainder', extra);
        hardCut(lc);   // 额度用完仍整段 remainder ⇒ 硬切交旧路（不再一轮一轮等）
        return true;
      }
      st.fails = 0;                 // 有新话进账本 ⇒ 按原逻辑：等下一次空闲，跟新话一起送
      M(lc).lastFeedAt = now();
      return false;
    }
    // 模型什么都没给（段与 remainder 都空）。单独记 fail:empty-reply（不再误导成 remainder-mismatch，
    // 工程问题 5），并走同一条补调额度。
    function demandEmptyReply(lc, b, n, extra) {
      if (!ledger.length) return false;
      if (d.noRetry) {   // 同上的变异钩子
        const sx = M(lc); sx.fails = 0; sx.lastFeedAt = now();
        return true;
      }
      const st = M(lc);
      if (!n && !st.retryUsed) {
        if (segShortPiece(b && b.text) && partialSpeaking(lc, b && b.sentAt)) {   // 方案 2：人还在说
          noteFail('empty-reply', extra); waitForMore(lc); return true;
        }
        noteFail('empty-reply', extra);
        st.retryForce = true; st.retryAt = (b && b.sentAt) || now(); st.extraWaited = true; schedule();
        return true;
      }
      st.fails++; noteFail('empty-reply', extra);   // 已有新话或额度用完 ⇒ 走普通失败梯度
      if (st.fails >= SEG_FAIL_MAX || st.retryUsed) hardCut(lc);   // 方案 5：补调再失败 ⇒ 直接硬切
      return false;
    }
    function onResult(b, raw, t0) {
      if (b.voided || disposed) { finishBatch(b); return; }
      const lc = b.locale, st = M(lc);
      const parsed = parseSegReply(raw, { buffer: b.text, last: lastEmit[lc] || '' });
      const closingEnd = phase === 'closing' && (closeReason === 'end' || closeReason === 'degrade');
      const bt = String(b.text || '').trim();
      // 方案 3：按位置取回 remainder 原文（去标点空白后比对），不再要求逐字 endsWith。
      const remRaw = (parsed.ok && parsed.remainder) ? remSuffixRaw(bt, parsed.remainder) : null;
      const remSuffix = !!remRaw;                 // remainder 是原文后缀（宽松比对）
      const rem0Raw = remSuffix ? remRaw.text : '';
      const remOk = !!(remSuffix && parsed.segments.length);
      // 调用期间账本有没有再进新话（remainder / 空回复的补调判据）
      const newDuring = (() => { const mx = latestRecAt(lc); return mx > 0 && mx > (b.sentAt || 0); })();
      if (!parsed.ok || !parsed.segments.length) {
        recsToWait(b);
        // 收尾（end/degrade）期间回来的空/仅 remainder 回复：直接交旧路（下面两个补调不介入）
        if (closingEnd) { settleBatchToLegacy(b); return; }
        // 模型回 {segments:[],remainder:''}：什么都没给 —— 单独记 empty-reply，补调一次（方案 4）
        if (parsed.ok && !parsed.remainder) {
          demandEmptyReply(lc, b, newDuring, segDiagExtra(b, parsed, raw));
          finishBatch(b); return;
        }
        if (!parsed.ok) {
          st.fails++;
          noteFail(parsed.reason);
          if ((parsed.reason === 'json' || parsed.reason === 'empty') && bumpJson() >= SEG_JSON_BAD_MAX) { degradeAll('json'); return; }
          if (st.fails >= SEG_FAIL_MAX) maybeHardCut(lc, b);
        } else if (remSuffix) {
          // 「整段 remainder」：段为空、remainder 就是整个 buffer（模型没断出任何完整句）。
          // 判据用**同样的宽松比对**（模型可能清洗标点），r9 C-zh-2 三次都是这个形态。
          const allRem = normSuffixText(bt) === normSuffixText(String(parsed.remainder || ''));
          if (allRem) {
            // 方案 2/4/5 共用额度：立即 force 补调一次；已有额度/已有新话则按原逻辑处理。
            if (!demandAllRemainder(lc, b, newDuring, segDiagExtra(b, parsed, raw))) { /* 等下一次空闲 */ }
            finishBatch(b); return;
          }
          st.fails = 0;                  // 「还没说完」（段为空、remainder 是原文后缀）不是错误：留着等下次触发
          M(lc).lastFeedAt = now();      // 它仍是一段没出行的文字 —— 空闲计时从这一刻重新起算
        } else {
          st.fails++; noteFail('remainder-mismatch', segDiagExtra(b, parsed, raw));
          if (st.fails >= SEG_FAIL_MAX) maybeHardCut(lc, b);
        }
        finishBatch(b); return;
      }
      jsonBad = 0; st.fails = 0; st.retryForce = false; st.retryUsed = false;
      // 显示分段：把模型返回的**前导**短碎片并入后一段（去模型补的标点）。
      // **不**把末段并进 remainder —— 模型改写过的 source 不是原文后缀，拿它裁剪会裁错（丢字）。
      // consumed 一律由**校验过的后缀**（remSuffix 的原文 remainder）算。
      const segs0 = mergeSegFragments(parsed.segments.slice());
      const rem0 = remOk ? rem0Raw : '';
      if (parsed.remainder && !remOk) noteFail('remainder-mismatch', segDiagExtra(b, parsed, raw));
      if (phase === 'closing') {
        // 收尾期间回来的回复：不再走「预送扣住」（settle 已经扫过一遍账本，扣下就没人提交了）——
        // closing(end/degrade) 交旧路；closing(stop/switch) 正常出行（remainder 按 force 送）。
        applyResult(b, segs0, rem0, now() - t0, !!b.force);
        finishBatch(b);
        return;
      }
      if (b.hold) {   // 预送：结果挂在**这一批**上，等 schedule 到点或新字时当场核对（不依赖 feed 作废）
        if (parsed.remainder && !remOk) noteFail('remainder-mismatch', segDiagExtra(b, parsed, raw));
        b.held = { segs: segs0, rem: rem0, ms: now() - t0 };
        b.ids.forEach((id) => { const r = byId(id); if (r) r.state = 'held'; });
        heldBatch[lc] = b;             // 请求结束（结果扣着）：别的语言可以继续发送
        inFlight = null;
        schedule();
        return;
      }
      applyResult(b, segs0, rem0, now() - t0, !!b.force);
      finishBatch(b);
    }
    function applyResult(b, segs, rem, ms, force) {
      const lc = b.locale;
      const bt = String(b.text || '').trim();
      const carried = Math.max(0, ...L(lc).filter((r) => b.ids.indexOf(r.id) >= 0).map((r) => r.calls));
      const consumed = rem ? bt.slice(0, bt.length - rem.length) : bt;
      const closingEnd = phase === 'closing' && (closeReason === 'end' || closeReason === 'degrade');
      attach(b.ids, { kind: 'rows', rows: segs, ms, force, orig: consumed, feedAt: batchFeedAt(b), sentAt: b.sentAt });
      if (rem) {
        trimBatchTail(b, rem);   // 先把 remainder 这段从批记录尾部去掉（否则账本里同一段文字出现两次）
        insertAfter(b.ids[b.ids.length - 1], closingEnd
          ? { id: ++seq, pos: remPos(b), locale: lc, text: rem, at: now(), state: 'wait', calls: carried, commit: legacyPayload(rem) }
          : { id: ++seq, pos: remPos(b), locale: lc, text: rem, at: now(), state: 'wait', calls: carried });
        M(lc).lastFeedAt = now();   // remainder 是新到的待处理文字：空闲计时从它重新起算
      }
      M(lc).extraWaited = false;
      if (!closingEnd && rem && (closeReason === 'stop' || closeReason === 'switch') && phase === 'closing') M(lc).force = true;
      flush();
      if (phase === 'closing' && !ledger.length && !inFlight && (closeReason === 'end' || closeReason === 'degrade')) finishClosing();
    }
    function releaseHeld(lc) {   // 到点：没有新字 ⇒ 出行
      const b = heldBatch[lc]; if (!b) return;
      delete heldBatch[lc];
      applyResult(b, b.held.segs, b.held.rem, b.held.ms, false);
      finishBatch(b);
    }
    function voidHeld(lc) {      // 新字来了 ⇒ 作废这次结果，跟新字一起重送
      const b = heldBatch[lc]; if (!b) return;
      delete heldBatch[lc];
      recsToWait(b);
      finishBatch(b);
    }
    function recsToWait(b) { b.ids.forEach((id) => { const r = byId(id); if (r) r.state = 'wait'; }); }
    // 把批记录的**尾部**按 remainder 的码点数裁掉（remainder 是批文本的后缀）：裁完 join(批记录) == consumed。
    function trimBatchTail(b, rem) {
      let left = Array.from(String(rem)).length;
      for (let i = b.ids.length - 1; i >= 0 && left > 0; i--) {
        const r = byId(b.ids[i]); if (!r) continue;
        const chars = Array.from(r.text);
        const take = Math.min(left, chars.length);
        r.text = chars.slice(0, chars.length - take).join('');
        left -= take;
      }
    }
    // remainder 的说话位置 = 它出自的那批记录的**最后一个位置**（不另发编号 —— 编号不代表说话顺序）
    function batchFeedAt(b) { let mx = 0; for (const id of b.ids) { const r = byId(id); if (r && r.at > mx) mx = r.at; } return mx; }
    function remPos(b) { const last = byId(b.ids[b.ids.length - 1]); return last ? last.pos : ++posSeq; }
    function insertAfter(id, rec) {
      const i = ledger.findIndex((r) => r.id === id);
      if (i >= 0) ledger.splice(i + 1, 0, rec); else ledger.push(rec);
    }
    // 额度用完 / key 被拒：与网页引擎同一个判据（e.grant || e.halt）。
    // 没有具名正文的 HTTP 402 也停 —— 中继的 402 只有「你用完了」一个意思；正文若在路上丢了，
    // 再交给旧路会按每句继续请求（#590 K，第三轮约 2 次/秒）。
    function quotaSignal(err) {
      if (!err) return null;
      const tagged = (e) => (e && (e.grant || e.halt) ? e : null);
      const hit = tagged(err) || tagged(err.cause);
      if (hit) return hit;
      const status = err.status || (err.cause && err.cause.status);
      if (status !== 402) return null;
      const src = err.status === 402 ? err : err.cause;
      const code = src && typeof src.code === 'string' && src.code !== 'http' ? src.code : 'credit_exhausted';
      return { grant: true, code, status: 402 };
    }
    // 把账本里还没出行的原文一次性交出（译文空），然后告诉宿主停机。不再 fallback。
    function authStop(err) {
      phase = 'closing'; closeReason = 'auth'; authStopped = true;
      if (inFlight) {
        inFlight.voided = true;
        if (endTimer) { clearT(endTimer); endTimer = 0; }
        const settled = inFlight.settled; inFlight.settled = null; inFlight = null;
        if (settled) { try { settled(); } catch (_) {} }
      }
      for (const lc of Object.keys(heldBatch)) releaseHeld(lc); // 已经译好的结果照出，不另发请求
      let guard = 0;
      while (ledger.some((r) => !r.commit) && guard++ < 64) {
        const i = ledger.findIndex((r) => !r.commit);
        const lc = ledger[i].locale;
        const ids = [];
        for (let j = i; j < ledger.length; j++) {
          const r = ledger[j];
          if (r.commit || r.locale !== lc) break;
          ids.push(r.id);
        }
        const recs = ids.map(byId).filter(Boolean);
        const text = joinAll(recs);
        if (!String(text || '').trim()) { commit(ids, { kind: 'none' }); continue; }
        const last = recs[recs.length - 1];
        commit(ids, unsentRow(text, { feedAt: last ? last.at : 0 }));
      }
      noteFail(err && err.code ? err.code : 'auth');
      if (d.onQuota) { try { d.onQuota(err); } catch (_) {} }
      finishClosing();
    }
    function onError(b, err) {
      if (b.voided || disposed) { finishBatch(b); return; }
      const lc = b.locale, st = M(lc);
      const status = err && (err.status || (err.cause && err.cause.status));
      const stop = quotaSignal(err);
      if (stop) { authStop(stop); return; }
      // 没有额度/key 标记的 401/403（网关、预检）仍交旧路，原文不丢。
      if (status === 401 || status === 403) { degradeAll('auth'); return; }
      // 超时：这一次已经发出去，服务端可能还在算、已经计费。原文照出、译文留空，不再自动重送（#590 H）。
      const timedOut = !!(err && (err.code === 'timeout' || (err.cause && err.cause.code === 'timeout')));
      if (timedOut) {
        noteFail('timeout');
        commit(b.ids, { kind: 'rows', rows: [{ source: b.text, translation: '' }], ms: 0, force: !!b.force, orig: b.text, feedAt: batchFeedAt(b), sentAt: b.sentAt });
        finishBatch(b);
        return;
      }
      recsToWait(b);
      if (phase === 'closing' && (closeReason === 'end' || closeReason === 'degrade')) { settleBatchToLegacy(b); return; }
      st.fails++; noteFail(status ? ('http-' + status) : 'network');
      if (st.fails >= SEG_FAIL_MAX) maybeHardCut(lc, b);
      finishBatch(b);
    }
    function settleBatchToLegacy(b) {
      commit(b.ids, legacyPayload(b.text));
      flush();
      if (phase === 'closing' && !ledger.length && !inFlight && (closeReason === 'end' || closeReason === 'degrade')) finishClosing();
    }
    // 诊断附加内容（各截到 200 字）：识别原文、模型给的 remainder、原始回复
    function segDiagExtra(b, parsed, raw) {
      const cut = (x) => String(x == null ? '' : x).slice(0, 200);
      return { text: cut(b && b.text), rem: cut(parsed && parsed.remainder), raw: cut(raw) };
    }
    function noteFail(reason, extra) { const k = String(reason || 'unknown'); failCounts[k] = (failCounts[k] || 0) + 1; if (d.onFail) { try { d.onFail(k, extra || null); } catch (_) {} } }
    let jsonBad = 0;
    function bumpJson() { jsonBad++; return jsonBad; }

    // ── 硬切 / 降级 / 收尾 ─────────────────────────────────────────────────────
    function hardCut(lc) {
      const st = M(lc); st.force = false; st.extraWaited = false; st.fails = 0; st.retryForce = false; st.retryUsed = false;
      if (inFlight && inFlight.locale === lc) { voidInflightToLegacy(); }
      if (heldBatch[lc]) { const b = heldBatch[lc]; delete heldBatch[lc]; recsToWait(b); }
      for (const run of runsOf(lc)) legacyRecs(run);
      flush();
    }
    function voidInflightToLegacy() {
      const b = inFlight; if (!b) return;
      b.voided = true; inFlight = null;
      if (endTimer) { clearT(endTimer); endTimer = 0; }
      commit(b.ids, legacyPayload(b.text));
      flush();
      if (b.settled) { const f = b.settled; b.settled = null; try { f(); } catch (_) {} }
      if (phase === 'closing' && !ledger.length && (closeReason === 'end' || closeReason === 'degrade')) finishClosing();
    }
    function degradeAll(reason) {
      phase = 'closing'; closeReason = 'degrade';
      if (inFlight) voidInflightToLegacy();
      for (const lc of Object.keys(heldBatch)) { commit(heldBatch[lc].ids, legacyPayload(heldBatch[lc].text)); delete heldBatch[lc]; }
      for (const run of allRuns()) legacyRecs(run);
      flush();
      if (d.onDegrade) d.onDegrade(reason);
      finishClosing();
    }
    function allRuns() { const out = []; for (const lc of locales()) for (const r of runsOf(lc)) out.push(r); return out; }
    function finishClosing() { phase = 'closed'; if (timer) { clearT(timer); timer = 0; } if (endTimer) { clearT(endTimer); endTimer = 0; } }
    function settle(reason) {
      if (phase === 'closed' || disposed) return Promise.resolve();
      if (timer) { clearT(timer); timer = 0; }
      if (reason === 'degrade') { degradeAll('settle-degrade'); return Promise.resolve(); }
      if (phase === 'open') { phase = 'closing'; closeReason = reason; }
      else if (reason === 'end' && closeReason !== 'degrade') closeReason = 'end';
      const jobs = [];
      if (closeReason === 'end') {
        // 等待中的：立即交旧路。扣住的结果（还没出行）：也交旧路（会话要关了）
        for (const lc of Object.keys(heldBatch)) { const b = heldBatch[lc]; delete heldBatch[lc]; commit(b.ids, legacyPayload(b.text)); }
        for (const lc of locales()) for (const run of runsOf(lc)) legacyRecs(run);
        flush();
        if (inFlight) {
          const b = inFlight;
          jobs.push(new Promise((resolve) => {
            b.settled = resolve;
            endTimer = setT(() => { endTimer = 0; if (inFlight === b) voidInflightToLegacy(); resolve(); }, endWaitMs);
          }));
        } else if (!ledger.length) { finishClosing(); }
      } else if (closeReason !== 'degrade') {   // stop | switch
        for (const lc of Object.keys(heldBatch)) releaseHeld(lc);   // 扣住的结果直接出行（不受朗读影响）
        // force 只给**还有字在等**的那一路：账本已空时置上的 force 没人消费，会漏到下一次收音，
        // 把下一句的首片（`Please`）当场单独收尾送出 —— 句首独自成行（1.19.4 r6 Mac 实测）。
        for (const lc of locales()) { if (runsOf(lc).length) M(lc).force = true; }
        if (!ledger.length && !inFlight && !Object.keys(heldBatch).length) { phase = 'open'; closeReason = ''; }
        schedule();
      }
      return Promise.all(jobs);
    }

    return {
      feed(lc, text, opts) {
        let t = String(text || '').trim();
        if (!t || disposed) return;
        if (authStopped) {
          // 停机之后迟到的定稿：原文照出，不再请求。
          const rec = { id: ++seq, pos: ++posSeq, locale: lc, text: t, at: now(), state: 'wait', calls: 0, commit: unsentRow(t, { feedAt: now() }) };
          ledger.push(rec); flush(); return;
        }
        if (phase === 'closed' && closeReason !== 'degrade') return;   // 结束/离开后的迟到定稿丢弃
        const o = opts || {};
        const rescued = !!o.rescued;
        const t0 = Number(o.t0), t1 = Number(o.t1);
        const tsOk = Number.isFinite(t0) && Number.isFinite(t1);
        // R14：临时稿（partial 补救文字）不再按音频区间去重，改成按**文字**——
        //   ① 临时稿整段等于紧挨着的上一条正式 final 的结尾 ⇒ 丢掉临时稿（rescue:dup-prev）；
        //   ② 正式 final 来：先按已出行的临时稿文字去掉重叠前缀，再在未出行的临时稿里对齐让位。
        // R15：已出行临时稿与正式 final 是否「同一句」由**音频区间**界定（trimAgainstRescueOut），
        // 跨句（g3 句距 3.6–5.1s）不再按文字整条去重。
        // 变异钩子 noRescueDedup 退回「照单全收」（第十二/十三轮的账本级重复）。
        if (rescued) {
          const lf = lastFormalRec[lc];
          const gap = (lf && Number.isFinite(lf.t1) && tsOk) ? t0 - lf.t1 : NaN;
          if (!d.noRescueDedup && lf && isTailDup(lf.text, t, gap, RESCUE_DUP_GAP_MS)) {
            if (d.onDiag) { try { d.onDiag('rescue:dup-prev', { text: t, why: 'feed' }); } catch (_) {} }
            return;
          }
        } else if (!d.noRescueDedup) {
          // 两种状态互斥：有**未出行**的临时稿 ⇒ 文字对齐让它让位；临时稿都已出行 ⇒ 只追加不重叠部分。
          const al = trimRescueByAlign(lc, t);
          if (al === 'none' || al === 'emitted') {
            const rest = trimAgainstRescueOut(lc, t, t0, t1);
            if (!rest) return;      // 整条都是已出行补救文字的重复 ⇒ 不追加
            t = rest;
          }
        }
        const rec = { id: ++seq, pos: ++posSeq, locale: lc, text: t, at: now(), state: 'wait', calls: 0, commit: null, rescued, t0, t1 };
        if (!rescued && normDupText(t)) lastFormalRec[lc] = { text: t, t1, at: now() };
        if (degradedNow() || (phase === 'closing' && (closeReason === 'end' || closeReason === 'degrade'))) {
          rec.commit = legacyPayload(t); ledger.push(rec); flush(); return;
        }
        ledger.push(rec);
        const st = M(lc);
        // 方案 4：句头闸放行时已经为这一片等过 idleMs（默认 1.5s）。这段等待算作「已等过一次空闲」：
        //   · lastFeedAt 回拨 idleMs ⇒ 空闲触发当场到期（直接送模型，不再等）；
        //   · extraWaited=true ⇒ 碎片不再走「预送并扣住」，结果一回来就出行（不再等第二次空闲）。
        if (o.waited) { st.lastFeedAt = now() - idleMs; st.extraWaited = true; }
        else { st.lastFeedAt = now(); st.extraWaited = false; }
        st.retryForce = false; st.retryUsed = false;   // 方案 5：额度只由**真正新话**重置（每次新话可再补一次）
        if (o.force) st.force = true;
        // 到硬上限：直接把这一路的待处理段硬切交旧路（在飞的批次先作废）
        if (segOver(segCounts(pendingText(lc)), hard)) { hardCut(lc); return; }
        schedule();
      },
      settle,
      // 方案 2（R12）：标记这条 locale 的 partial 还在到达（listen-model 的 onPartial 调用）。
      notePartial(lc) { const st = M(lc); st.partialAt = now(); },
      setSpeaking(on) { speaking = !!on; schedule(); },   // 只影响空闲计时；扣住结果的出行/长度触发照常
      // 方案 1：这两个键开始/结束收音时只调 setPtt；它只记录「正在按键收音」，不再选空闲参数
      // （第七轮把按键收音、不点停的第二次空闲定为 0.8s，接线后不得变慢 —— 见 setHold）。
      setPtt(on) { pttMode = !!on; schedule(); },
      // 旧「按住说」的第二次空闲参数（1.5s）。当前 App 不用；保留给对照/测试，与 setPtt 解耦。
      setHold(on) { holdMode = !!on; schedule(); },
      pending(lc) { return pendingText(lc); },
      dispose() {
        if (timer) { clearT(timer); timer = 0; }
        if (endTimer) { clearT(endTimer); endTimer = 0; }
        const left = pendingAll();
        if (left.length && d.onLeak) { try { d.onLeak(left); } catch (_) {} }
        disposed = true;
      },
      state() {
        const heldN = ledger.filter((r) => r.state === 'held' && !r.commit).length;
        const heldLcs = Object.keys(heldBatch);
        return { phase, closeReason, degraded: degradedNow(), jsonBad, calls, emits, fallbacks, busy: !!inFlight, speaking, ptt: pttMode, idleMs, releaseMs: autoReleaseMs,
          hold: heldLcs.length > 0, held: heldN, inflight: inFlight ? inFlight.text.length : 0,
          fails: Object.assign({}, failCounts),
          recs: ledger.map((r) => ({ locale: r.locale, pos: r.pos, calls: r.calls, state: r.state, committed: !!r.commit, rescued: !!r.rescued })),
          bufs: locales().map((lc) => ({ locale: lc, len: pendingText(lc).length })) };
      },
    };
    function degradedNow() { return phase === 'closing' && closeReason === 'degrade' || phase === 'closed' && closeReason === 'degrade'; }
  }

  // ── 远程「修正 + 翻译」一次调用（§9.6.1 契约）────────────────────────────────
  // 本机识别的错几乎全是同音字与数字（尖刺实证：定进/到张/报家/信用正业/电灰/7045天），
  // 系统热词零效果，所以纠错放在远程、和翻译合成一次往返（DeepSeek p50 ≈ 100 ms）。
  // 契约用行标签不用 JSON：小模型 JSON 易碎，而两行标签丢了任何一行都能兜住（原文不丢）。
  const LISTEN_PASS = 'one';        // 'one' = 修正+翻译一次调用；'two' = 先修正再走普通 translate（备用，非设置项）
  const LISTEN_CONTEXT_ROWS = 6;    // 带给修正的上下文行数
  const CORRECT_RATIO_MIN = 0.7, CORRECT_RATIO_MAX = 1.3;   // 修正接受门：token 长度比
  function buildListenPrompt(p) {
    const src = p.srcName || p.srcLang || '', dst = p.dstName || p.dstLang || '';
    const system = 'You are the correction stage of a live conversation interpreter. The user message is ONE sentence of a raw on-device speech-recognition transcript in ' + src
      + ', plus the last few sentences of the conversation for context, and optionally recognizer candidates.\n'
      + '1. Correct recognition errors only: homophones, mis-segmented words, wrong numbers. Keep the speaker\'s wording, order and length; never paraphrase, never add or drop content. If it is already right, repeat it unchanged. '
      + 'The speaker may embed words of another language (often English); the recognizer may spell them wrongly in Latin letters. Restore their correct spelling and keep them inline.\n'
      + (p.same
        ? '2. The target language is the same as the source: repeat the corrected sentence on the X line.\n'
        : '2. Then translate the corrected sentence into ' + dst + ' as a whole.\n')
      + 'Output exactly two lines and nothing else:\n'
      + 'T: <corrected sentence in ' + src + '>\n'
      + 'X: <translation in ' + dst + '>';
    const ctx = (p.context || []).filter((c) => c && c.text);
    const alts = (p.alts || []).map((a) => String(a || '').trim()).filter(Boolean);
    const user = (ctx.length ? 'Context (earlier sentences, oldest first):\n' + ctx.map((c) => '- [' + (c.who === 'me' ? 'me' : 'them') + '] ' + c.text + (c.tr ? '  ⇒ ' + c.tr : '')).join('\n') + '\n\n' : '')
      + (alts.length ? 'Recognizer candidates: ' + [...new Set(alts)].slice(0, 12).join(' | ') + '\n\n' : '')
      + 'Transcript sentence:\n' + String(p.text || '');
    return { system, user };
  }
  // 解析：双标签 ⇒ { text, tr }；只有 X / 无标签 ⇒ text 用原文、tr 取整段（原文永不丢）。
  function parseListenReply(raw, fallbackText) {
    const s = String(raw || '').replace(/\r/g, '').trim();
    // 行内空白只认空格/制表符：`\s*` 会跨过换行，空的「T:」就把下一行「X: …」吞成修正稿（#590 iOS 7）
    const line = (tag) => { const m = s.match(new RegExp('^[ \\t]*' + tag + '[ \\t]*[:：][ \\t]*(.*)$', 'm')); return m ? m[1].trim() : null; };
    const T = line('T'), X = line('X');
    if (T && X) return { text: T, tr: X, tagged: true };
    if (X) return { text: fallbackText, tr: X, tagged: false };
    // 有标签却没有译文（空的「X:」或只回了「T:」）：这句没译出来，别把标签行当译文上屏
    if (T !== null || X !== null) return { text: fallbackText, tr: '', tagged: false };
    // 无标签：整段当译文（去掉可能的围栏与前缀）
    const tr = s.replace(/^```[a-z]*\n?|```$/g, '').trim();
    return { text: fallbackText, tr, tagged: false };
  }
  // 修正接受门：长度比 0.7–1.3 且文字系不变；不过门 ⇒ 弃修正只取译文。
  function acceptCorrection(orig, corrected, deps) {
    const a = String(orig || '').trim(), b = String(corrected || '').trim();
    if (!b || a === b) return false;
    const n = (x) => (CJK_CHAR.test(x) ? [...x.replace(DROP_PUNCT, '')].length : x.split(/\s+/).filter(Boolean).length) || 1;
    const ratio = n(b) / n(a);
    if (ratio < CORRECT_RATIO_MIN || ratio > CORRECT_RATIO_MAX) return false;
    const ds = deps && deps.dominantScript;
    if (ds) { const sa = ds(a), sb = ds(b); if (sa && sb && sa !== sb) return false; }
    return true;
  }
  // 给修正当上下文的最近几行（不含这一行本身），最老的在前。
  function contextRows(rows, row, n) {
    const out = [];
    for (let i = rows.length - 1; i >= 0 && out.length < (n || LISTEN_CONTEXT_ROWS); i--) {
      const r = rows[i]; if (r === row || !r.text) continue;
      out.push({ who: r.who, text: r.text, tr: r.tr || '' });
    }
    return out.reverse();
  }

  // 时延汇总（纯函数）：每行的 lat.pass / lat.ttsStart 取 p50/p90，给 _debug 与真机读回。
  function latencySummary(rows) {
    const pick = (k) => (rows || []).map((r) => r && r.lat && r.lat[k]).filter((v) => typeof v === 'number' && v >= 0).sort((a, b) => a - b);
    const q = (xs, f) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(xs.length * f))] : null);
    const out = { n: (rows || []).filter((r) => r && r.lat).length };
    for (const k of ['pass', 'ttsStart']) { const xs = pick(k); out[k] = { n: xs.length, p50: q(xs, 0.5), p90: q(xs, 0.9), max: xs.length ? xs[xs.length - 1] : null }; }
    const engines = {};
    for (const r of rows || []) { const e = r && r.lat && r.lat.ttsEngine; if (e) engines[e] = (engines[e] || 0) + 1; }
    out.ttsEngines = engines;
    return out;
  }

  function transcriptText(session, mePrefix) {
    const rows = (session && session.rows) || [];
    return rows.map((r) => {
      const head = (r.who === 'me' ? (mePrefix || '') : '') + (r.text || '');
      return r.tr ? head + '\n' + r.tr : head;
    }).join('\n\n');
  }

  // ── 进度句填空（第 5 轮 C1）──────────────────────────────────────────────
  // 「English下载中」「English已就绪」中间要补一个空格；汉字结尾不补。模板是各语言的，
  // 判据只看「值最后一个字符」与「模板里紧挨着的那个字符」是不是分属拉丁 / 汉字。
  function fillPrepDetail(tmpl, name, pct, ready) {
    const s = String(tmpl == null ? '' : tmpl);
    const pad = (val, at) => {
      const v = String(val == null ? '' : val);
      if (!v) return v;
      const after = s.charAt(at);
      if (after && !CJK_CHAR.test(v.slice(-1)) && CJK_CHAR.test(after)) return v + ' ';
      return v;
    };
    const wi = s.indexOf('{what}');
    const ri = s.indexOf('{ready}');
    let out = s.replace('{pct}', String(pct));
    if (wi >= 0) out = out.replace('{what}', pad(name, wi + '{what}'.length));
    if (ri >= 0) out = out.replace('{ready}', pad(ready, ri + '{ready}'.length));
    return out;
  }

  // ── 识别语言名额（改稿 H，第 5 轮 A）──────────────────────────────────────
  // 三种状态：ready（占名额，资产 .installed）/ recoverable（装过、名额已让出，可补回）/
  // absent（没装过）。真值来源：原生报的 reserved + 我们记住的 onceInstalled（本机持久化）。
  // 「已用 N / 上限」的 N = reserved ∩ 本表语言（系统可能还有别模块的预留，不数进来）。
  const QUOTA_STATES = ['ready', 'recoverable', 'absent'];
  function quotaStateOf(code, o) {
    const c = baseCode(code);
    const p = o || {};
    if (!c) return 'absent';
    if ((p.reserved || []).map(baseCode).indexOf(c) >= 0) return 'ready';
    if ((p.installed || {})[c]) return 'recoverable';
    return 'absent';
  }
  function quotaRows(o) {
    const p = o || {};
    const reserved = (p.reserved || []).map(baseCode);
    const max = Math.max(1, Number(p.max) || 5);
    const rows = [];
    let used = 0;
    for (const item of (p.catalog || [])) {
      const c = baseCode(typeof item === 'string' ? item : item && item.code);
      if (!c) continue;
      const st = quotaStateOf(c, { reserved, installed: p.installed });
      if (st === 'ready') used++;
      rows.push({ code: c, label: (item && item.label) || c, state: st, holds: st === 'ready' });
    }
    return { rows, used, max, full: used >= max };
  }
  // 满员时默认让出「最久没用」的那一门；当前语言对的两门永远不能选（改稿 H 第 3、5 张）。
  function canYield(code, pair) {
    const c = baseCode(code);
    if (!c) return false;
    return (pair || []).map(baseCode).indexOf(c) < 0;
  }
  function pickYield(reserved, pair, lastUsed) {
    const lu = lastUsed || {};
    let best = '', bestAt = Infinity;
    for (const code of (reserved || [])) {
      const c = baseCode(code);
      if (!c || !canYield(c, pair)) continue;
      const at = Number(lu[c]);
      const v = Number.isFinite(at) ? at : 0;   // 没记录 = 最久（0），与「今天/昨天」档一致
      if (v < bestAt) { bestAt = v; best = c; }
    }
    return best;
  }
  // 首启多选：已就绪的先占名额，其余按勾选顺序填到上限，超出的标 later（未就绪·第 N 门）。
  function quotaSelectPlan(o) {
    const p = o || {};
    const max = Math.max(1, Number(p.max) || 5);
    const reserved = (p.reserved || []).map(baseCode);
    const installed = p.installed || {};
    const sel = [];
    for (const x of (p.selected || [])) { const c = baseCode(x); if (c && sel.indexOf(c) < 0) sel.push(c); }
    const keep = [];
    // 已用从**全部**预留起算（r6）：系统的上限数的是本 App 占着的每一门，不只是这次勾了的。
    // 只数「勾了且占着」的会少算 —— 占着 th 却没勾它时，第 6 门照样撞 Code=11。
    let used = new Set(reserved.filter(Boolean)).size;
    for (const c of sel) { if (reserved.indexOf(c) >= 0) keep.push(c); }
    const later = [];
    for (const c of sel) {
      if (reserved.indexOf(c) >= 0) continue;
      if (used < max) { keep.push(c); used++; }
      else later.push({ code: c, state: installed[c] ? 'recoverable' : 'absent', nth: used + later.length + 1 });
    }
    return { keep, later, used, max };
  }

  return {
    latencySummary,

    LISTEN_PASS, LISTEN_CONTEXT_ROWS, buildListenPrompt, parseListenReply, acceptCorrection, contextRows,

    SEG_SOFT, SEG_HARD, SEG_IDLE_MS, SEG_RELEASE_MS, SEG_MAX_CALLS, SEG_END_WAIT_MS, SEG_PARTIAL_MS, segCounts, segRouteOf, segRouteFor, segIsFragment, segShortPiece, normDupText, joinFrag, finalAdmit, scriptFirstLid, intakeDecide, buildSegPrompt, parseSegReply, hardCutSentences, makeSegmentRouter,

    toLocale, scriptOfLocale, acceptDeviceFinal, rejectDeviceFinal, makeFinalGate, makeStreamCutter, LATIN_MIN_CONF, STREAM_FLUSH_MS, STREAM_MAX_MS,
    overlapTs,
    alignWords, canonWord, wordNear, alignFinalInTemp, alignBeforeWord, isTailDup, trimDupSource,
    rescueLead, rescueLeadCut, isXferCandidate, xferClean, makeTransferGate, XFER_MAX_WORDS,
    fillPrepDetail,
    QUOTA_STATES, quotaStateOf, quotaRows, canYield, pickYield, quotaSelectPlan,
    lidBase, sideMatchesLid, langSupported,

    SILENCE_MS, SILENCE_RMS, HEARD_RMS, FIRST_SOUND_MS, DEBOUNCE_MS, HISTORY_MAX,
    ECHO_TAIL_MS, ECHO_KEEP_MS, ECHO_SIM, SPOKEN_WINDOW_MS,
    NOISE_WARMUP_MS, NOISE_FACTOR, NOISE_CEIL, NOISE_STUCK_MS, SILENCE_RMS, noiseGate,
    MODES, modeOf, entryGate, captureSource,
    newSession, sessionTitle, sourceFor, addFinal, junkFinal, flipWho, transcriptText,
    baseCode, scriptsOf, cjkLangOf, sideOf, attributeByLang, echoTokens, langPatch,
    makeEchoGuard, makeSpeakQueue,
    pause, resume, listenedMs, rmsOf, silenceCheck, draftFor, shouldWrite, summary, fmtClock,
    makeIncremental,
    // 实时字幕条的三档字号（§9.8 协议补充决定 9）：A− / A+ 在这三档之间走，走到头不动；
    // 存着的值不在档上（手改过 / 老版本）时先就近落档再走。
    FONT_STEPS: [0.85, 1, 1.2],
    fontStep(scale, dir) {
      const S = [0.85, 1, 1.2];
      const v = Number(scale) || 1;
      let i = 0;
      for (let k = 1; k < S.length; k++) if (Math.abs(S[k] - v) < Math.abs(S[i] - v)) i = k;
      const d = dir > 0 ? 1 : dir < 0 ? -1 : 0;
      return S[Math.max(0, Math.min(S.length - 1, i + d))];
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ListenCore;




