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

  return {
    SILENCE_MS, SILENCE_RMS, DEBOUNCE_MS, HISTORY_MAX, HOLD_TAIL_MS,
    newSession, sessionTitle, sourceFor, attribute, addFinal, holdStart, holdEnd,
    pause, resume, listenedMs, rmsOf, silenceCheck, draftFor, shouldWrite, summary, fmtClock,
    makeIncremental,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ListenCore;
