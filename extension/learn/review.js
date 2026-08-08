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
  let practicing = false;   // §5.3 — free practice: same card flow, asymmetric rule
  let donePractice = 0;
  let currentMode = 'read'; // §5.2 — which exercise form the card on screen is using
  let clozeState = null;    // write tier: { answers, inputs, checked }
  let ttsMode = 'off';  // 'off' | 'assist' | 'audio-first'
  let ttsAutoPlay = true;

  function todayKey(now) { return new Date(now).toISOString().slice(0, 10); }

  async function loadSettings() {
    return new Promise((resolve) => {
      // Explicit keys, never get(null): the same bucket holds the unbounded `tr:`
      // cache and the `lq:` outbox, and reading the whole thing here would drag
      // both along. (docs/learning-design.md §7.)
      resolve(PageSettings.read([
        'uiLang', 'learnEnabled', 'learnDailyNew',
        'ttsMode', 'ttsAutoPlay', 'ttsEngine', 'ttsBaseUrl', 'ttsApiKey', 'ttsModel', 'ttsVoice', 'ttsRate',
        // §9.2 — the translator's own engine config; the notes gate reads it.
        'provider', 'apiKey', 'apiBaseUrl', 'apiModel',
      ]).then(function (r) { return r.data; }));
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
      case 'no_voice_und': return t('tts_no_voice_und', '这张卡的语言未知 —— 在设置里选一个朗读语音后即可朗读');
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
    if (ttsAutoPlay || ttsMode === 'audio-first' || currentMode === 'listen') playCurrent(true);
  }

  // Card stages. Audio-first staging (original hidden until revealed) applies when
  // the user chose the audio-first SETTING — or when the ladder put this card at the
  // LISTEN tier (§5.2), which is the same staging arrived at by strength instead of
  // by preference. In 'assist'/'off' reading, the original shows from the start.
  function applyStage(stage) {
    const audioFirst = currentMode === 'listen' || ttsMode === 'audio-first';
    $('orig').hidden = audioFirst && stage < 1;
    $('reveal-orig').hidden = !(audioFirst && stage < 1);
    $('reveal').hidden = stage !== 1;
    $('answer').hidden = stage < 2;
  }

  // §5.1 — memory strength, always visible. 「已掌握」 gets its user-visible
  // definition here: strength reaching KNOWN_S days.
  function renderStrength(item) {
    const s = item.sched && item.sched.s ? item.sched.s : 0;
    const cap = sched.KNOWN_S || LearnScheduler.DEFAULTS.KNOWN_S;
    $('strength-bar').style.width = Math.min(100, Math.round((s / cap) * 100)) + '%';
    const shown = s >= 10 ? Math.round(s) : Math.round(s * 10) / 10;
    $('strength-label').textContent = t('learn_strength', '记忆强度')
      + ' ' + shown + ' / ' + cap + ' ' + t('learn_days_unit', '天');
  }

  // §5.1 — every grade button carries its consequence. previewIntervals runs the
  // same applyReview the press would run, so the label cannot drift from the act.
  //
  // In PRACTICE the same honesty rule cuts the other way: grades 1–3 will not be
  // granted an interval (§5.3), so promising one would be the lie §5.1 exists to
  // prevent. Their labels go blank and the one-line rule above the grades explains;
  // grade 0 keeps 「重新学」 only when the card has a schedule to lapse.
  function renderGradePreviews(item) {
    const iv = practicing ? null
      : LearnScheduler.previewIntervals(item.sched, Date.now(), sched);
    const hadSched = !!(item.sched && item.sched.s);
    document.querySelectorAll('.grade').forEach((b) => {
      const el = b.querySelector('.when');
      if (!el) return;
      const g = Number(b.dataset.grade);
      if (practicing) {
        el.textContent = g === 0 && hadSched ? t('learn_relearn', '重新学') : '';
      } else {
        el.textContent = g === 0 ? t('learn_relearn', '重新学') : fmtWhen(iv[g]);
      }
    });
    $('practice-note').hidden = !practicing;
  }

  // §5.2 skill badges. `listenPossible` feeds the 全面掌握 gate: a skill whose form
  // does not exist for this card (no voice for its language) is not a missing skill.
  function renderBadges(item, listenPossible) {
    const sk = item.skills || {};
    $('badge-read').classList.toggle('lit', !!sk.read);
    $('badge-listen').classList.toggle('lit', !!sk.listen);
    $('badge-listen').hidden = !listenPossible && !sk.listen;
    $('badge-write').classList.toggle('lit', !!sk.write);
    const cap = sched.KNOWN_S || LearnScheduler.DEFAULTS.KNOWN_S;
    const full = !!(item.sched && item.sched.s >= cap)
      && !!sk.read && !!sk.write && (!!sk.listen || !listenPossible);
    $('badge-full').hidden = !full;
  }

  // §5.2 write tier: the cloze UI, from the pure builder. Inputs in document order;
  // sizes track their answers so the layout does not telegraph less than it must.
  function buildClozeUI(item) {
    const c = LearnModel.clozeFor(item.text);
    const box = $('cloze');
    box.textContent = '';
    clozeState = { answers: [], inputs: [], checked: false };
    for (const p of c.parts) {
      if (p.t === 'text') { box.appendChild(document.createTextNode(p.v)); continue; }
      const inp = document.createElement('input');
      inp.className = 'cloze-blank';
      inp.size = Math.max(3, p.answer.length + 1);
      inp.autocapitalize = 'none'; inp.autocomplete = 'off'; inp.spellcheck = false;
      box.appendChild(inp);
      clozeState.answers.push(p.answer);
      clozeState.inputs.push(inp);
    }
    if (clozeState.inputs[0]) clozeState.inputs[0].focus();
  }

  // §9.2 — render the notes. Model output is UNTRUSTED: textContent only, never
  // innerHTML — a gloss is one prompt-injection away from being markup.
  function renderNotes(data) {
    const box = $('notes-box');
    box.textContent = '';
    const section = (title, rows, keyName) => {
      if (!rows || !rows.length) return;
      const h = document.createElement('p');
      h.className = 'notes-h';
      h.textContent = title;
      box.appendChild(h);
      for (const r of rows) {
        const line = document.createElement('p');
        line.className = 'notes-line';
        const b = document.createElement('b');
        b.textContent = r[keyName];
        line.appendChild(b);
        line.appendChild(document.createTextNode(' — ' + r.g));
        box.appendChild(line);
      }
    };
    section(t('learn_notes_words', '生词'), data.words, 'w');
    section(t('learn_notes_phrases', '短语搭配'), data.phrases, 'p');
    if (data.grammar) {
      const h = document.createElement('p');
      h.className = 'notes-h';
      h.textContent = t('learn_notes_grammar', '语法点');
      box.appendChild(h);
      const g = document.createElement('p');
      g.className = 'notes-line';
      g.textContent = data.grammar;
      box.appendChild(g);
    }
    box.hidden = false;
    $('notes-btn').hidden = true;
    $('notes-cost').hidden = true;
  }

  async function setupNotes(item) {
    const wrap = $('notes-wrap');
    wrap.hidden = !LearnNotes.capable();
    $('notes-box').hidden = true;
    $('notes-box').textContent = '';
    $('notes-btn').hidden = false;
    $('notes-btn').disabled = false;
    $('notes-cost').hidden = false;
    // The cost line doubles as the status line (loading / failure), so a new card
    // must reset it — or the last card's error haunts every card after it.
    $('notes-cost').textContent = t('learn_notes_cost', '使用你配置的 API，一次调用，永久缓存');
    if (wrap.hidden) return;
    // Cached notes render instantly — no spinner, no second charge
    // (interaction-spec 「解析」).
    const hit = await LearnNotes.cached(item.id);
    if (hit && hit.data && deck[idx] === item) renderNotes(hit.data);
  }

  async function show(sources) {
    currentSources = sources;
    const item = deck[idx];
    $('card').hidden = !item;
    $('empty').hidden = true;
    $('nothing-due').hidden = true;
    if (!item) return;

    LearnTTS.stop();
    $('orig').textContent = item.text;
    $('tr').textContent = item.tr;

    // The exercise form comes from the ladder (§5.2). Availability must be known
    // BEFORE staging: a listen card whose language cannot be spoken is a read card,
    // not a broken one.
    const av = ttsMode !== 'off' ? await LearnTTS.available(item.lang) : { ok: false };
    currentMode = LearnScheduler.tierFor(item, { listen: av.ok }, sched);

    renderStrength(item);
    renderBadges(item, av.ok);
    renderGradePreviews(item);

    const write = currentMode === 'write';
    clozeState = null;
    $('cloze').hidden = !write;
    $('write-prompt').hidden = !write;
    $('write-replaced').hidden = true;
    $('cloze-check').hidden = !write;
    $('cloze-check').disabled = false;
    $('shadow').hidden = currentMode !== 'listen';
    $('grades').hidden = write;   // write reveals the grades only after 检查
    document.querySelectorAll('.grade').forEach((b) => { b.disabled = false; });

    if (write) {
      // Translation up front, blanks to fill, no reveal step — 检查 is the reveal.
      buildClozeUI(item);
      $('orig').hidden = true;
      $('reveal').hidden = true;
      $('reveal-orig').hidden = true;
      $('answer').hidden = false;
    } else {
      applyStage(currentMode === 'listen' || ttsMode === 'audio-first' ? 0 : 1);
    }
    setupAudio(item);
    setupNotes(item);

    const src = $('src');
    src.textContent = '';
    src.appendChild(srcLine(item, sources));

    renderMedia(item, sources);

    $('progress').textContent = practicing
      ? t('learn_practice_progress', '练习 {i} / {n}')
          .replace('{i}', String(idx + 1)).replace('{n}', String(deck.length))
      : t('learn_progress', '本轮进度') + ' ' + (idx + 1) + ' / ' + deck.length;
  }

  async function grade(g, sources) {
    const item = deck[idx];
    if (!item) return;
    LearnTTS.stop();
    const now = Date.now();

    // §5.2 — a pass at ≥「记得」 lights this form's skill badge, on either path:
    // practice proves nothing about long-term MEMORY (§5.3), but demonstrating a
    // skill is demonstrating a skill. `lastSeenAt` bumps with it so the union
    // reaches other devices — `touchedAt` reads timestamps, not badge bits.
    const lightSkill = () => {
      if (g < 2) return false;
      if (item.skills && item.skills[currentMode]) return false;
      item.skills = Object.assign({}, item.skills);
      item.skills[currentMode] = 1;
      item.lastSeenAt = now;
      return true;
    };

    if (practicing) {
      // §5.3 — the asymmetric rule lives in a PURE function; this is just plumbing.
      // A fail on a scheduled card lapses it; everything else writes no schedule,
      // and a candidate is never introduced from here (that is the daily deck's job,
      // which is also why newToday is untouched on this path).
      const next = LearnScheduler.practiceOutcome(item.sched, g, now, sched);
      let dirty = false;
      if (next) {
        item.sched = next;
        item.state = LearnScheduler.stateFor(item, sched);
        dirty = true;
      }
      if (lightSkill()) dirty = true;
      if (dirty) await LearnStore.putItem(item);
      await LearnStore.recordReview(item.id, g, now, { practice: 1, mode: currentMode });
      donePractice++;
      idx++;
      if (idx >= deck.length) { await endPractice(); return; }
      show(sources);
      await refreshCounts();
      return;
    }

    const wasNew = !item.sched || !item.sched.s;

    item.sched = LearnScheduler.applyReview(item.sched, g, now, sched);
    item.state = LearnScheduler.stateFor(item, sched);
    lightSkill();
    await LearnStore.putItem(item);
    await LearnStore.recordReview(item.id, g, now, { mode: currentMode });

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

  // ─── §5.3 free practice ──────────────────────────────────────────────────

  async function startPractice() {
    const items = await LearnStore.allItems();
    const srcList = await LearnStore.allSources();
    const sources = new Map(srcList.map((s) => [s.id, s]));
    const pool = $('practice-pool').value;
    const limit = Number($('practice-batch').value) || 0;
    const practiceDeck = LearnScheduler.buildPracticeDeck(items, Date.now(), sched, { pool, limit });
    if (!practiceDeck.length) return;      // nothing matches the pool — leave the setup visible
    practicing = true;
    donePractice = 0;
    deck = practiceDeck;
    idx = 0;
    currentSources = sources;
    $('practice-setup').hidden = true;
    show(sources);
  }

  async function endPractice() {
    practicing = false;
    const n = donePractice;
    donePractice = 0;
    await start();
    $('progress').textContent = t('learn_practice_done', '练习完成 {n} 张。')
      .replace('{n}', String(n));
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
    // A rebuild is always a return to the SCHEDULED deck. pressure-fix (and anything
    // else that rebuilds) can fire mid-practice; leaving the flag up would apply the
    // practice rule to scheduled cards.
    practicing = false;
    $('practice-note').hidden = true;
    const { items } = await refreshCounts();
    const now = Date.now();

    const srcList = await LearnStore.allSources();
    const sources = new Map(srcList.map((s) => [s.id, s]));

    const rec = await LearnStore.getMeta('newToday', null);
    const newToday = rec && rec.day === todayKey(now) ? rec.n : 0;

    deck = LearnScheduler.buildDeck(items, now, sched, newToday);
    idx = 0;

    // Practice is offered whenever there is a corpus and no scheduled deck on
    // screen — the deck-done page stops being a dead end (§5.3). The footer link
    // can reveal it at any other time.
    $('practice-setup').hidden = !(items.length && !deck.length);

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
      // The cap has a dial (1–200, in settings); a wall nobody can see the dial
      // for reads as a defect (§5.1).
      $('cap-hint').textContent = t('learn_cap_hint', '每天新卡上限 {n} 张，可在设置里调整。')
        .replace('{n}', String(sched.dailyNew));
      $('progress').textContent = doneThisRun
        ? t('learn_done_run', '本次完成 {n} 张').replace('{n}', String(doneThisRun)) : '';
      return;
    }

    show(sources);
  }

  let currentSources = new Map();

  // §8.8 — the app enters this view without reloading the page (it is a long-lived
  // single page), so it needs a handle to rebuild the deck on entry. The extension
  // reloads per open and never calls this; exposing it there is harmless.
  window.LearnReview = { start };

  // ─── Boot ────────────────────────────────────────────────────────────────

  const settings = await loadSettings();
  PageI18n.setUiLang(settings.uiLang);
  PageI18n.applyI18n('learn_title_full');

  ttsMode = settings.ttsMode || 'off';
  ttsAutoPlay = settings.ttsAutoPlay !== false;
  // §9.2 — the notes gate reads the translator's own engine config. No chat-capable
  // engine (or no key) ⇒ capable() stays false ⇒ the entry point never renders.
  LearnNotes.configure({
    provider: settings.provider || '',
    apiKey: settings.apiKey || '',
    baseUrl: settings.apiBaseUrl || '',
    model: settings.apiModel || '',
  });
  const explainLang = settings.uiLang && settings.uiLang !== 'auto'
    ? settings.uiLang : (navigator.language || 'zh-CN');
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

  // §5.3 — free practice entries.
  $('practice-open').addEventListener('click', (e) => {
    e.preventDefault();
    $('practice-setup').hidden = false;
    $('practice-setup').scrollIntoView({ block: 'nearest' });
  });
  $('practice-start').addEventListener('click', () => { startPractice(); });

  // §9.2 — generate on demand. One call, cached forever; failures name themselves
  // in the cost line's place rather than leaving a dead button.
  $('notes-btn').addEventListener('click', async () => {
    const item = deck[idx];
    if (!item) return;
    $('notes-btn').disabled = true;
    $('notes-cost').textContent = t('learn_notes_loading', '解析中…');
    try {
      const r = await LearnNotes.get(item, explainLang);
      if (deck[idx] === item) renderNotes(r.data);
    } catch (_) {
      $('notes-cost').textContent = t('learn_notes_failed', '解析失败，稍后再试');
      $('notes-btn').disabled = false;
    }
  });

  // §5.2 write tier — 检查 is both the check and the reveal. The objective result
  // then CONSTRAINS the grades: after writing it correctly, 不记得 contradicts the
  // evidence on screen; after failing, so do 有点难/记得/太简单. Wrong blanks are
  // replaced with the right answer — the correction is the teaching moment.
  $('cloze-check').addEventListener('click', () => {
    if (!clozeState || clozeState.checked) return;
    let allOk = true;
    clozeState.inputs.forEach((inp, i) => {
      const okOne = LearnModel.clozeCheck(clozeState.answers[i], inp.value);
      inp.classList.add(okOne ? 'ok' : 'bad');
      if (!okOne) { allOk = false; inp.value = clozeState.answers[i]; }
      inp.disabled = true;
    });
    clozeState.checked = true;
    $('cloze-check').disabled = true;
    $('write-replaced').hidden = allOk;   // say so when corrections were made
    $('orig').hidden = false;
    $('grades').hidden = false;
    document.querySelectorAll('.grade').forEach((b) => {
      const g = Number(b.dataset.grade);
      b.disabled = allOk ? g === 0 : g > 0;
    });
  });

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

  // §8.8 — opening this page is the heartbeat. Fire-and-forget AFTER the first
  // deck is on screen: blocking start() on the network would hold the whole page
  // hostage to a slow sync the user never asked for. If the pull actually brought
  // something new AND no card is mid-review (empty / deck-done states — exactly
  // where fresh material matters most), rebuild; a card on screen is never yanked.
  if (typeof LearnSync !== 'undefined') {
    LearnSync.autoSync().then(async (r) => {
      if (r && r.pulled && (r.pulled.cards || r.pulled.reviews) && $('card').hidden) {
        await start();
      }
    }).catch(() => {});
  }

  // One-time explainer (§5.1): shown above the first card ever seen, non-blocking,
  // dismissed forever. Not shown over the empty state — grading advice before there
  // is anything to grade would explain the wrong thing.
  if (!$('card').hidden && !(await LearnStore.getMeta('howtoSeen', 0))) {
    $('howto').hidden = false;
  }
  $('howto-ok').addEventListener('click', async () => {
    $('howto').hidden = true;
    await LearnStore.setMeta('howtoSeen', 1);
  });
})();
