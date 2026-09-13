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
  const NOISE_WARMUP_MS = 2500;  // 开头这么久用来摸环境底噪
  const NOISE_FACTOR = 2.5;      // 门限 = 底噪 × 这个
  const NOISE_CEIL = 0.03;       // 门限上限：再吵也不能高到把正常说话判成静音
  const NOISE_DECAY = 0.98;      // 底噪估计的滑动系数（只用静音期的样本更新）
  const NOISE_STUCK_MS = 8000;   // 连续这么久「一直有声」= 环境变吵了，不是有人在说话
  const DEBOUNCE_MS = 900;       // 边说边译的防抖（与 subtitle-adapter 同值）
  const TITLE_CHARS = 12;        // 会话标题里摘第一句的前几个字
  const HISTORY_MAX = 200;       // 屏幕上保留的定稿行数；语料里不限

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(now) {
    const d = new Date(now);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // 会话 id：时间戳 + 注入的随机，不用 crypto（file:// 与内容脚本都可能不是安全上下文）。
  function newSession(now, rnd) {
    const r = Math.floor((typeof rnd === 'number' ? rnd : 0) * 0xffffff).toString(36);
    return {
      id: now.toString(36) + r,
      startedAt: now,
      rows: [],           // 定稿行 {rid, who, guessed, pinned, text, tr, at, starred, written}
      seq: 0,
      lastWho: '',        // 上一条定稿归了谁 —— 判不出语言时的粘性兜底
      ephemeral: false,   // 「这次不留记录」：这一场只在屏幕上存在（开始前决定，中途不可改）
      flips: 0,           // 点过几次 ↔ —— 归属判得准不准的唯一体感指标
      lastVoiceAt: now,   // 上一次听到声音（RMS 过门限）
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

  const ECHO_TAIL_MS = 1500;     // 播完之后还要防这么久（房间混响 + 桥上在飞的 PCM）
  const ECHO_KEEP_MS = 20000;    // 一条登记项活多久
  const ECHO_SIM = 0.6;          // 包含度门限
  const ECHO_MAX = 4;            // 最多同时记几条

  const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const DROP_PUNCT = /[\s.,!?;:'"()\[\]{}—–\-。，！？；：、「」『』（）《》…]+/gu;

  // 归一化成词/字的集合。中日韩按字切，其余按词切。
  // 混排（一句里既有汉字又有拉丁词）按**段**切：汉字逐字、拉丁按词。原来只要有一个汉字就整句逐字符切，
  // 于是「译：Delivery takes…」被切成一堆字母，和任何一句英文都有六成字母重合 —— 60 秒窗里的第二句
  // 英文译文被当成「刚读过」跳掉（2026-09-12 门禁 G6 抓到）。
  function echoTokens(text) {
    const t = String(text == null ? '' : text).toLowerCase().replace(DROP_PUNCT, ' ').trim();
    if (!t) return new Set();
    const out = new Set();
    let word = '';
    const flush = () => { if (word) { out.add(word); word = ''; } };
    for (const c of t) {
      if (/\s/.test(c)) { flush(); continue; }
      if (CJK_CHAR.test(c)) { flush(); out.add(c); continue; }
      word += c;
    }
    flush();
    return out;
  }

  function makeEchoGuard() {
    let items = [];        // { tokens, from, to }  to=0 表示还在读
    let dropped = 0;
    function sweep(at) { items = items.filter((it) => at - (it.to || at) < ECHO_KEEP_MS); }
    return {
      // 开始朗读一段文本
      speaking(text, at) {
        const tokens = echoTokens(text);
        if (!tokens.size) return;
        sweep(at);
        items.push({ tokens, from: at, to: 0 });
        if (items.length > ECHO_MAX) items.shift();
      },
      // 播完（或被打断）
      spoke(at) {
        for (let i = items.length - 1; i >= 0; i--) {
          if (!items[i].to) { items[i].to = at; break; }
        }
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
      // 同一行重复入队 ⇒ 后来的替换先前的（改边、重译）
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
  function addFinal(s, text, at, cfg, deps) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    // 本机路（§9.6.1）：归属由「哪一路识别器认出来的」直接给（deps.who），比按文字系猜准 ——
    // 同文字系语言对（en/fr）那时也能分开。没给就照旧按语言判。
    const a = deps && (deps.who === 'me' || deps.who === 'them')
      ? { who: deps.who, guessed: false }
      : attributeByLang(s, clean, at, cfg, deps);
    const row = {
      rid: ++s.seq, who: a.who,
      guessed: a.guessed,   // 判不出、靠粘性或兜底得来 ⇒ 界面标虚线，提示可以点 ↔ 改
      pinned: false,        // 用户点过 ↔ ⇒ 此后不再被任何自动逻辑改动
      text: clean, tr: '', at, starred: false, written: false,
    };
    s.rows.push(row);
    if (s.rows.length > HISTORY_MAX) s.rows.shift();
    if (!s.firstText && a.who === 'them') s.firstText = clean;
    s.lastWho = a.who;      // 粘性兜底的依据
    return row;
  }

  // 改边：翻转归属并钉住。返回翻转**之前**那一行的快照 —— 调用方要用旧方向算出旧语料
  // 卡的 id 才能回收它（语料里「学的永远是外语那一面」，改边会让两面互换）。
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
  function resume(s, now) { if (!s.resumedAt) { s.resumedAt = now; s.lastVoiceAt = now; } }
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
    return {
      text, tr,
      lang: me ? (cfg.otherLang || 'und') : (cfg.lang || 'und'),
      targetLang: cfg.targetLang || '',
      kind: 'sentence',
      sourceId: 'conv:' + s.id,
      anchor: { k: 'conv', sessionId: s.id, title: sessionTitle(s, cfg.label), startMs: Math.max(0, row.at - s.startedAt), endMs: Math.max(0, row.at - s.startedAt), who: row.who },
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
  function scriptOfLocale(locale) {
    const base = String(locale || '').split(/[-_]/)[0].toLowerCase();
    if (CJK_OF[base]) return CJK_OF[base];
    if (LATIN_LOCALE.test(base)) return 'Latin';
    return '';
  }
  // 两路识别器都会对同一段音频出 final：zh 路会把英文音频「认」成一串英文（错得离谱但置信度
  // 0.7–0.9），en 路对中文音频吐「Rugua, Ting」（置信度 0.05–0.27）—— 2026-09-12 实测。
  // 所以收 final 的规则是：**先看文字系，再看置信度**：
  //   · 文字系与这一路的语言对不上 ⇒ 丢（zh 路出拉丁字母、en 路出汉字）
  //   · 拉丁文字系且置信度 < LATIN_MIN_CONF ⇒ 丢（另一路的音频漏过来的碎片）
  //   · CJK 不按置信度丢：碎片（「家」0.34）也是正文的一部分，串起来才成句
  // 同文字系语言对（en/fr）这条规则分不开，那时靠调用方按 locale 归属 + 置信度高者。
  const LATIN_MIN_CONF = 0.4;
  function acceptDeviceFinal(f, deps) {
    const text = String((f && f.text) || '').trim();
    if (!text) return false;
    const want = scriptOfLocale(f.locale);
    const got = deps && deps.dominantScript ? deps.dominantScript(text) : null;
    if (want && got && got !== want) {
      // 标点/数字之类判不出文字系时 dominantScript 会给别的值；只在两边都是「字」时才否
      if (got === 'Latin' || got === 'Han' || got === 'Hangul' || got === 'Hiragana' || got === 'Katakana') {
        if (!(want === 'Han' && (got === 'Hiragana' || got === 'Katakana'))) return false;
      }
    }
    if (want === 'Latin' && typeof f.conf === 'number' && f.conf >= 0 && f.conf < LATIN_MIN_CONF) return false;
    return true;
  }
  // 识别器的 final 是时间片不是句子（会切在词中间），所以每个 locale 一路串起来、按句末标点
  // 切句；尾巴等不到标点就按超时放出（我们自己收口后的 final 常常不带句号）。
  // cut(text) 由调用方注入（生产里是 WsTranscribe.splitSentences 这类），返回 { done: [...], rest }。
  const STREAM_FLUSH_MS = 1200;
  const CJK_JOIN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。！？、；：]$/u;
  function makeStreamCutter(onSentence, opts) {
    const o = opts || {};
    const flushMs = o.flushMs || STREAM_FLUSH_MS;
    const setT = o.setTimeout || setTimeout, clearT = o.clearTimeout || clearTimeout;
    const streams = {};   // locale → { buf, timer }
    const join = (a, b) => (!a ? b : (CJK_JOIN.test(a) || /^[，。！？、；：,.!?]/.test(b) ? a + b : a + ' ' + b));
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
      emitDone(locale, st);
      const rest = st.buf.trim(); st.buf = '';
      if (rest && HAS_WORD.test(rest)) onSentence(locale, rest);
    }
    return {
      add(locale, text) {
        const t = String(text || '').trim(); if (!t) return;
        const st = streams[locale] || (streams[locale] = { buf: '', timer: 0 });
        st.buf = join(st.buf, t);
        emitDone(locale, st);
        if (st.timer) clearT(st.timer);
        st.timer = st.buf ? setT(() => { st.timer = 0; flush(locale); }, flushMs) : 0;
      },
      flushAll() { for (const l of Object.keys(streams)) flush(l); },
      pending(locale) { const st = streams[locale]; return st ? st.buf : ''; },
    };
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
      + '1. Correct recognition errors only: homophones, mis-segmented words, wrong numbers. Keep the speaker\'s wording, order and length; never paraphrase, never add or drop content. If it is already right, repeat it unchanged.\n'
      + '2. Then translate the corrected sentence into ' + dst + '.\n'
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
    const T = (s.match(/^\s*T\s*[:：]\s*(.+)$/m) || [])[1];
    const X = (s.match(/^\s*X\s*[:：]\s*(.+)$/m) || [])[1];
    if (T && X) return { text: T.trim(), tr: X.trim(), tagged: true };
    if (X) return { text: fallbackText, tr: X.trim(), tagged: false };
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

  return {
    latencySummary,

    LISTEN_PASS, LISTEN_CONTEXT_ROWS, buildListenPrompt, parseListenReply, acceptCorrection, contextRows,

    toLocale, scriptOfLocale, acceptDeviceFinal, makeStreamCutter, LATIN_MIN_CONF, STREAM_FLUSH_MS,

    SILENCE_MS, SILENCE_RMS, DEBOUNCE_MS, HISTORY_MAX,
    ECHO_TAIL_MS, ECHO_KEEP_MS, ECHO_SIM, SPOKEN_WINDOW_MS,
    NOISE_WARMUP_MS, NOISE_FACTOR, NOISE_CEIL, NOISE_STUCK_MS, SILENCE_RMS, noiseGate,
    newSession, sessionTitle, sourceFor, addFinal, flipWho, transcriptText,
    baseCode, scriptsOf, cjkLangOf, sideOf, attributeByLang, echoTokens, langPatch,
    makeEchoGuard, makeSpeakQueue,
    pause, resume, listenedMs, rmsOf, silenceCheck, draftFor, shouldWrite, summary, fmtClock,
    makeIncremental,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ListenCore;
