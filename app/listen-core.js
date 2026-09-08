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
  const SILENCE_RMS = 0.004;     // Int16 归一化后的 RMS 门限；环境底噪通常 < 0.002
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
      rows: [],           // 定稿行 {rid, who, text, tr, at, starred, written}
      seq: 0,
      speaking: false,    // 按住「我说」中
      holdStart: 0,       // 这一次按住从什么时候开始
      myPartial: '',      // 按住期间累积的中文（定稿 + 开口尾句）
      lastWho: '',        // 上一条定稿归了谁 —— 判不出语言时的粘性兜底
      lastVoiceAt: now,   // 上一次听到声音（RMS 过门限）
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

  // 归属：按住「我说」期间到达的定稿是我的；松手之后 800 ms 内到达的也算我的
  // （端点检测把最后一句闭合总是晚于松手）。
  const HOLD_TAIL_MS = 800;
  function attribute(s, at) {
    if (s.speaking) return 'me';
    if (s.holdStart && s.holdEnd && at >= s.holdStart && at <= s.holdEnd + HOLD_TAIL_MS) return 'me';
    return 'them';
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
  function echoTokens(text) {
    const t = String(text == null ? '' : text).toLowerCase().replace(DROP_PUNCT, ' ').trim();
    if (!t) return new Set();
    if (CJK_CHAR.test(t)) return new Set([...t].filter((c) => !/\s/.test(c)));
    return new Set(t.split(/\s+/).filter(Boolean));
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

  function addFinal(s, text, at) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    const who = attribute(s, at);
    const row = { rid: ++s.seq, who, text: clean, tr: '', at, starred: false, written: false };
    s.rows.push(row);
    if (s.rows.length > HISTORY_MAX) s.rows.shift();
    if (!s.firstText && who === 'them') s.firstText = clean;
    if (who === 'me') s.myPartial = (s.myPartial ? s.myPartial + ' ' : '') + clean;
    return row;
  }

  function holdStart(s, now) { s.speaking = true; s.holdStart = now; s.holdEnd = 0; s.myPartial = ''; }
  function holdEnd(s, now) { s.speaking = false; s.holdEnd = now; return s.myPartial; }

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
  // 每来一块 PCM 调一次；返回 true 表示已经静了 SILENCE_MS，该暂停了。
  function silenceCheck(s, rms, now) {
    if (rms >= SILENCE_RMS) { s.lastVoiceAt = now; return false; }
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
    return { seconds: Math.round(listenedMs(s, now) / 1000), them, me, written, starred };
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
  function transcriptText(session, mePrefix) {
    const rows = (session && session.rows) || [];
    return rows.map((r) => {
      const head = (r.who === 'me' ? (mePrefix || '') : '') + (r.text || '');
      return r.tr ? head + '\n' + r.tr : head;
    }).join('\n\n');
  }

  return {
    SILENCE_MS, SILENCE_RMS, DEBOUNCE_MS, HISTORY_MAX, HOLD_TAIL_MS,
    ECHO_TAIL_MS, ECHO_KEEP_MS, ECHO_SIM, SPOKEN_WINDOW_MS,
    newSession, sessionTitle, sourceFor, attribute, addFinal, holdStart, holdEnd, transcriptText,
    baseCode, scriptsOf, cjkLangOf, sideOf, attributeByLang, echoTokens, langPatch,
    makeEchoGuard, makeSpeakQueue,
    pause, resume, listenedMs, rmsOf, silenceCheck, draftFor, shouldWrite, summary, fmtClock,
    makeIncremental,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ListenCore;
