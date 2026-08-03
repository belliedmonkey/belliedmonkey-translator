// review.js — the review surface (记忆层).
// Interaction rules: docs/interaction-spec.md 「复习 / Review」.
//
// Reveal is ALWAYS user-initiated: nothing auto-advances and nothing is timed.
// Media cards replay the ORIGINAL audio, never synthesized speech — by opening the
// source at the timestamp, since YouTube refuses to embed from an extension origin
// (see renderMedia).

(async () => {
  const $ = (id) => document.getElementById(id);
  const t = (k, fb) => PageI18n.t(k, fb);

  let deck = [];
  let idx = 0;
  let sched = {};       // scheduler config, merged over production DEFAULTS
  let doneThisRun = 0;
  let ttsMode = 'off';  // 'off' | 'assist' | 'audio-first'
  let ttsAutoPlay = true;

  function todayKey(now) { return new Date(now).toISOString().slice(0, 10); }

  async function loadSettings() {
    return new Promise((resolve) => {
      // Explicit keys, never get(null): the same bucket holds the unbounded `tr:`
      // cache and the `lq:` outbox, and reading the whole thing here would drag
      // both along. (docs/learning-design.md §7.)
      chrome.storage.local.get([
        'uiLang', 'learnEnabled', 'learnDailyNew',
        'ttsMode', 'ttsAutoPlay', 'ttsEngine', 'ttsBaseUrl', 'ttsApiKey', 'ttsModel', 'ttsVoice', 'ttsRate',
      ], (s) => resolve(s || {}));
    });
  }

  function srcLine(item, sources) {
    const s = sources.get(item.sourceId);
    const host = (() => { try { return new URL(s && s.url).hostname.replace(/^www\./, ''); } catch (_) { return ''; } })();
    const title = (s && s.title) || host || t('learn_unknown_source', '未知来源');
    const url = mediaUrl(item, s) || (s && s.url) || '';
    const label = host && host !== title ? host + ' · ' + title : title;
    if (!url) return document.createTextNode(label);
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = label;
    return a;
  }

  function mediaUrl(item, source) {
    const a = item.anchor;
    if (!a || a.k !== 'media') return null;
    const base = (source && source.url) || '';
    if (!base) return null;
    const sec = Math.max(0, Math.floor((a.startMs || 0) / 1000));
    try {
      const u = new URL(base);
      u.searchParams.set('t', String(sec));
      return u.toString();
    } catch (_) { return base; }
  }

  // Media cards replay the ORIGINAL audio — never synthesized speech. But they do it
  // by OPENING the source at the timestamp, not by embedding it.
  //
  // Why not an inline player: YouTube's embedded player only accepts an http(s)
  // embedding origin. From `chrome-extension://` it refuses with "错误 153 · 视频播放器
  // 配置错误". Measured 2026-08-02 across four variants — youtube-nocookie.com and
  // youtube.com, each with the default referrer policy and with `no-referrer` — all
  // four failed identically. The `no-referrer` runs also rule out a sandboxed
  // extension page (opaque origin, no referrer), which is the same condition. There
  // is no workaround inside an extension page, so this is a permanent constraint,
  // not a bug to retry. Do not re-add the iframe.
  function renderMedia(item, sources) {
    const box = $('media');
    box.hidden = true;
    box.textContent = '';
    const a = item.anchor;
    if (!a || a.k !== 'media') return;
    const url = mediaUrl(item, sources.get(item.sourceId));
    if (!url) return;

    const btn = document.createElement('a');
    btn.className = 'replay';
    btn.href = url;
    btn.target = '_blank';
    btn.rel = 'noopener noreferrer';
    btn.textContent = t('learn_replay', '▶ 重听这个片段');
    box.appendChild(btn);

    const hint = document.createElement('p');
    hint.className = 'fallback';
    hint.textContent = t('learn_replay_hint', '在新标签页打开原视频并跳到该处（那里也会有双语字幕）');
    box.appendChild(hint);
    box.hidden = false;
  }

  // Why an engine cannot speak, in the user's words. An engine that silently does
  // nothing is the worst possible outcome here — the user cannot tell a missing
  // voice from a broken key from a typo'd URL.
  function reasonText(reason) {
    switch (reason) {
      case 'no_voice': return t('tts_no_voice', '系统里没有这门语言的语音');
      case 'unsupported': return t('tts_unsupported', '这个浏览器不提供内置语音');
      case 'no_base': return t('tts_no_base', '还没填语音端点地址');
      case 'no_key': return t('tts_no_key', '还没填语音 API Key');
      case 'blocked': return t('tts_blocked', '浏览器拦下了自动播放，点一下播放');
      case 'http': return t('tts_http', '语音服务返回了错误');
      default: return t('tts_failed', '这句暂时读不出来');
    }
  }

  function setNote(msg) { $('audio-note').textContent = msg || ''; }

  async function playCurrent(auto) {
    const item = deck[idx];
    if (!item || ttsMode === 'off') return;
    const btn = $('play');
    btn.disabled = true;
    setNote(t('tts_playing', '播放中…'));
    const r = await LearnTTS.speak(item.text, item.lang);
    btn.disabled = false;
    if (r.ok) {
      setNote('');
      btn.textContent = t('tts_replay', '▶ 再听一遍');
      return;
    }
    // An autoplay block is not an error worth shouting about — the button is right
    // there. Everything else gets a plain explanation.
    setNote(auto && r.reason === 'blocked' ? '' : reasonText(r.reason));
  }

  // Render the audio row for this card, and decide whether it can work at all
  // BEFORE offering a button that would always fail.
  async function setupAudio(item) {
    const box = $('audio');
    setNote('');
    $('play').textContent = t('tts_play', '▶ 听一遍');
    if (ttsMode === 'off') { box.hidden = true; return; }
    box.hidden = false;
    const av = await LearnTTS.available(item.lang);
    $('play').disabled = !av.ok;
    if (!av.ok) { setNote(reasonText(av.reason)); return; }
    if (ttsAutoPlay || ttsMode === 'audio-first') playCurrent(true);
  }

  // Card stages. In 'audio-first' the ORIGINAL text starts hidden: you listen, then
  // reveal the text, then the translation. In 'assist'/'off' the original is visible
  // from the start and there are only two stages.
  function applyStage(stage) {
    const audioFirst = ttsMode === 'audio-first';
    $('orig').hidden = audioFirst && stage < 1;
    $('reveal-orig').hidden = !(audioFirst && stage < 1);
    $('reveal').hidden = stage !== 1;
    $('answer').hidden = stage < 2;
  }

  function show(sources) {
    currentSources = sources;
    const item = deck[idx];
    $('card').hidden = !item;
    $('empty').hidden = true;
    $('nothing-due').hidden = true;
    if (!item) return;

    LearnTTS.stop();
    $('orig').textContent = item.text;
    $('tr').textContent = item.tr;
    applyStage(ttsMode === 'audio-first' ? 0 : 1);
    setupAudio(item);

    const src = $('src');
    src.textContent = '';
    src.appendChild(srcLine(item, sources));

    renderMedia(item, sources);

    $('progress').textContent = t('learn_progress', '本轮进度')
      + ' ' + (idx + 1) + ' / ' + deck.length;
  }

  async function grade(g, sources) {
    const item = deck[idx];
    if (!item) return;
    LearnTTS.stop();
    const now = Date.now();
    const wasNew = !item.sched || !item.sched.s;

    item.sched = LearnScheduler.applyReview(item.sched, g, now, sched);
    item.state = LearnScheduler.stateFor(item, sched);
    await LearnStore.putItem(item);
    await LearnStore.recordReview(item.id, g, now);

    // The daily new-card cap has to survive page reloads, or "15 a day" silently
    // becomes "15 per session".
    if (wasNew) {
      const key = todayKey(now);
      const rec = (await LearnStore.getMeta('newToday', null)) || { day: key, n: 0 };
      const next = rec.day === key ? { day: key, n: rec.n + 1 } : { day: key, n: 1 };
      await LearnStore.setMeta('newToday', next);
    }

    doneThisRun++;
    idx++;
    refreshPressure();
    if (idx >= deck.length) { await start(); return; }
    show(sources);
    await refreshCounts();
  }

  // Storage pressure. Law 2 forbids telling the PAGE anything; it requires telling
  // a user who turned capture on. This is that surface.
  async function refreshPressure() {
    const box = $('pressure');
    if (!box) return;
    try {
      const p = await LearnStore.pressure();
      if (!p) { box.hidden = true; return; }
      let msg = '';
      if (p.dropped > 0) {
        msg = t('learn_pressure_dropped', '有 {n} 条采集内容没能存下来（学习库满时会发生）。')
          .replace('{n}', String(p.dropped));
      } else if (p.evicted > 0) {
        msg = t('learn_pressure_evicted', '学习库已满，已自动淘汰 {n} 张旧卡为新内容腾地方。')
          .replace('{n}', String(p.evicted));
      } else if (p.atCap || p.nearCap) {
        msg = t('learn_pressure_near', '学习库快满了（{n} / {cap}）。')
          .replace('{n}', String(p.total)).replace('{cap}', String(p.cap));
      }
      box.hidden = !msg;
      if (!msg) return;
      $('pressure-msg').textContent = msg;
      // Only offer the targeted cleanup when it would actually reclaim something.
      $('pressure-fix').hidden = p.reclaimable === 0;
    } catch (_) { box.hidden = true; }
  }

  async function refreshCounts() {
    const items = await LearnStore.allItems();
    const now = Date.now();
    const due = LearnScheduler.dueCount(items, now, sched);
    const st = await LearnStore.stats();
    $('counts').textContent =
      t('learn_count_due', '待复习') + ' ' + due + ' · ' +
      t('learn_count_learning', '学习中') + ' ' + (st.by.learning || 0) + ' · ' +
      t('learn_count_new', '候选') + ' ' + (st.by.candidate || 0) + ' · ' +
      t('learn_count_known', '已掌握') + ' ' + (st.by.known || 0);
    return { items, due, st };
  }

  function fmtWhen(ms) {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return t('learn_in_minutes', '约 {n} 分钟后').replace('{n}', String(Math.max(1, mins)));
    const hours = Math.round(mins / 60);
    if (hours < 24) return t('learn_in_hours', '约 {n} 小时后').replace('{n}', String(hours));
    return t('learn_in_days', '约 {n} 天后').replace('{n}', String(Math.round(hours / 24)));
  }

  async function start() {
    const { items } = await refreshCounts();
    const now = Date.now();

    const srcList = await LearnStore.allSources();
    const sources = new Map(srcList.map((s) => [s.id, s]));

    const rec = await LearnStore.getMeta('newToday', null);
    const newToday = rec && rec.day === todayKey(now) ? rec.n : 0;

    deck = LearnScheduler.buildDeck(items, now, sched, newToday);
    idx = 0;

    if (!items.length) {
      $('card').hidden = true; $('nothing-due').hidden = true; $('empty').hidden = false;
      $('progress').textContent = '';
      return;
    }
    if (!deck.length) {
      $('card').hidden = true; $('empty').hidden = true; $('nothing-due').hidden = false;
      // Say WHEN, rather than fabricating work by advancing cards early.
      const upcoming = items
        .filter((it) => it.sched && it.sched.dueAt)
        .map((it) => it.sched.dueAt - now)
        .filter((d) => d > 0)
        .sort((a, b) => a - b)[0];
      $('next-due').textContent = upcoming
        ? t('learn_next_due', '下一张卡片 {when}到期。').replace('{when}', fmtWhen(upcoming))
        : t('learn_alldone_body', '继续浏览和翻译，新的材料会自动进来。');
      $('progress').textContent = doneThisRun
        ? t('learn_done_run', '本次完成 {n} 张').replace('{n}', String(doneThisRun)) : '';
      return;
    }

    show(sources);
  }

  let currentSources = new Map();

  // ─── Boot ────────────────────────────────────────────────────────────────

  const settings = await loadSettings();
  PageI18n.setUiLang(settings.uiLang);
  PageI18n.applyI18n('learn_title_full');

  ttsMode = settings.ttsMode || 'off';
  ttsAutoPlay = settings.ttsAutoPlay !== false;
  LearnTTS.configure({
    engineId: settings.ttsEngine || LearnTTS.DEFAULTS.engineId,
    baseUrl: settings.ttsBaseUrl || '',
    apiKey: settings.ttsApiKey || '',
    model: settings.ttsModel || '',
    voice: settings.ttsVoice || '',
    rate: Number(settings.ttsRate) > 0 ? Number(settings.ttsRate) : 1,
  });

  sched = Object.assign({}, LearnScheduler.DEFAULTS, {
    dailyNew: Number(settings.learnDailyNew) > 0
      ? Number(settings.learnDailyNew)
      : LearnScheduler.DEFAULTS.dailyNew,
  });

  document.querySelectorAll('.grade').forEach((b) => {
    b.addEventListener('click', () => grade(Number(b.dataset.grade), currentSources));
  });
  // Reveal is user-initiated, always. Nothing auto-advances, nothing is timed.
  $('reveal').addEventListener('click', () => applyStage(2));
  $('reveal-orig').addEventListener('click', () => applyStage(1));
  $('play').addEventListener('click', () => playCurrent(false));
  // Platform voices load asynchronously and can land AFTER the first card was
  // rendered. Without this the card keeps the verdict it was given while the list
  // was still empty — a disabled button and "no built-in speech" on a machine that
  // has plenty. Re-decide for whatever card is on screen.
  LearnTTS.onVoicesChanged(() => { const it = deck[idx]; if (it) setupAudio(it); });
  const openOptions = (e) => {
    e.preventDefault();
    try { chrome.runtime.openOptionsPage(); }
    catch (_) { window.open(chrome.runtime.getURL('options/options.html'), '_blank'); }
  };
  $('open-settings').addEventListener('click', openOptions);
  $('empty-settings').addEventListener('click', openOptions);

  // Drain the outbox first — this page is one of the few places that can, since the
  // corpus lives in the extension origin and the service worker cannot be trusted
  // on Safari iOS.
  $('pressure-fix').addEventListener('click', async () => {
    const n = await LearnStore.clearKnown().catch(() => 0);
    await refreshPressure();
    await refreshCounts();
    if (!n) return;
    // The corpus changed underneath the deck, so rebuild rather than leaving a
    // card on screen that no longer exists.
    await start();
  });

  await LearnDrain.run();
  await refreshPressure();
  await start();
})();
