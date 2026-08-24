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
  let skillQueue = [];      // §5.4 — the skills this due date tests (1–2, rotation order)
  let extraMode = false;    // §5.4 — true while the appended second exercise is on screen
  let clozeState = null;    // write tier: { answers, inputs, checked, accept }
  let exState = null;       // §9.3 — current choice/pick exercise, or null (recall/cloze)
  let poolItems = [];       // §9.3 — corpus snapshot: local distractor/foil material
  let speakRec = null;      // §9.4 — live recording handle, or null
  let speakTimer = 0;       // §9.4 — elapsed-seconds repaint while recording
  let speakDenied = false;  // §9.4 — mic denied this session ⇒ the 说 form stops existing
  let ttsMode = 'off';  // 'off' | 'assist' | 'audio-first'
  let ttsAutoPlay = true;

  async function loadSettings() {
    return new Promise((resolve) => {
      // Explicit keys, never get(null): the same bucket holds the unbounded `tr:`
      // cache and the `lq:` outbox, and reading the whole thing here would drag
      // both along. (docs/learning-design.md §7.)
      resolve(PageSettings.read([
        'uiLang', 'learnEnabled', 'learnDailyNew', 'learnRules',
        'ttsMode', 'ttsAutoPlay', 'ttsEngine', 'ttsBaseUrl', 'ttsApiKey', 'ttsModel', 'ttsVoice', 'ttsRate',
        // §9.2 — the translator's engine config, plus the dedicated notes-engine
        // override group (notesProvider set ⇒ notes group wins; resolveConfig).
        'provider', 'apiKey', 'apiBaseUrl', 'apiModel',
        'notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesModel',
        // §9.4 — the transcription engine group. NEVER follows the translation or
        // notes group: where a recording goes is an explicit choice.
        'sttEngine', 'sttBaseUrl', 'sttApiKey', 'sttModel',
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

  // ─── 来源操作 (interaction-spec「来源治理」) ──────────────────────────
  // Law 2's fix-action surface: the place you NOTICE unwanted material is the
  // place you can act on it. A ⋯ button on the source line reveals two actions —
  // delete this site's cards (account-wide, §7.4) and stop capturing it (§8.9).

  function appendSrcActions(srcEl, item, sources) {
    const box = $('src-actions');
    if (!box || typeof LearnRules === 'undefined') return;
    box.hidden = true;
    box.textContent = '';
    const s = sources.get(item.sourceId);
    const host = (() => {
      try { return new URL(s && s.url).hostname.toLowerCase().replace(/^www\./, ''); }
      catch (_) { return ''; }
    })();
    if (!host) return;

    const more = document.createElement('button');
    more.className = 'src-more';
    more.textContent = '⋯';
    more.setAttribute('aria-label', t('learn_card_src_actions', '来源操作'));
    more.addEventListener('click', () => { box.hidden = !box.hidden; });
    srcEl.appendChild(more);

    const del = document.createElement('button');
    del.textContent = t('learn_src_delete', '删除已存') + ' · ' + host;
    del.addEventListener('click', async () => {
      // interaction-spec 全局原则: the whole handler is IDB reads + a bulk delete —
      // a second tap mid-flight would re-confirm and re-delete against a moving store.
      del.disabled = true;
      try {
        const [items, srcs] = await Promise.all([LearnStore.allItems(), LearnStore.allSources()]);
        const doomed = LearnRules.doomedFor(items, srcs, host);
        if (!doomed.itemIds.length) return;
        if (!window.confirm(t('learn_delete_confirm', '删除 {host} 的 {n} 张卡？会同步到所有设备，不可恢复。')
          .replace('{host}', host).replace('{n}', String(doomed.itemIds.length)))) return;
        await LearnStore.deleteItems(doomed.itemIds, Date.now());
        await LearnStore.deleteSourcesIfOrphan(doomed.sourceIds);
        // Account intent must reach the server promptly (§7.4); then rebuild —
        // the card on screen may no longer exist.
        if (typeof LearnSync !== 'undefined' && typeof MT_BACKEND !== 'undefined' && MT_BACKEND.enabled) {
          LearnSync.autoSync(Date.now(), { force: true }).catch(() => {});
        }
        await refreshCounts();
        await start();
      } finally { del.disabled = false; }
    });
    box.appendChild(del);

    const readRules = () => PageSettings.read(['learnRules']).then((r) => (r.data && r.data.learnRules) || null);
    const blk = document.createElement('button');
    readRules().then((rules) => {
      const blocked = LearnRules.isBlocked((s && s.url) || ('https://' + host + '/'), rules);
      blk.textContent = blocked ? t('learn_src_blocked', '已屏蔽') : (t('learn_src_block', '不再收录') + ' · ' + host);
      blk.disabled = blocked;
    });
    blk.textContent = t('learn_src_block', '不再收录') + ' · ' + host;
    blk.addEventListener('click', async () => {
      // interaction-spec 全局原则: disabled from the first await. On success it
      // STAYS disabled (已屏蔽 is a terminal state); restore only on failure.
      blk.disabled = true;
      try {
        const rules = await readRules();
        const base = rules || { v: 1, block: [], langs: null };
        if ((base.block || []).indexOf(host) < 0) {
          const next = Object.assign({}, base, {
            v: 1, block: (base.block || []).concat([host]), updatedAt: Date.now(),
          });
          await new Promise((r) => chrome.storage.local.set({ learnRules: next }, r));
          if (typeof LearnSync !== 'undefined' && typeof MT_BACKEND !== 'undefined' && MT_BACKEND.enabled) {
            LearnSync.autoSync(Date.now(), { force: true }).catch(() => {});
          }
        }
        blk.textContent = t('learn_src_blocked', '已屏蔽');
      } catch (e) { blk.disabled = false; throw e; }
    });
    box.appendChild(blk);
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
      // 这三条是 1.6.5 加的失败码，此前一直落到下面那句「暂时读不出来」。
      // 补上不是锦上添花：删掉屏幕上的原始异常之后，不具名它们等于把这些失败
      // 变得比清理前更没信息 —— 那是把清理做成回归。
      case 'timeout': return t('tts_timeout', '语音服务超时了 —— 检查网络，或换一个语音端点');
      case 'network': return t('tts_network', '连不上语音服务 —— 检查网络和端点地址');
      case 'empty': return t('tts_empty', '这张卡没有可朗读的文字');
      default: return t('tts_failed', '这句暂时读不出来');
    }
  }

  function setNote(msg) { $('audio-note').textContent = msg || ''; }

  // Play epoch: each playCurrent invocation takes a ticket; only the LATEST
  // invocation may re-enable ▶ on a superseded resolve. Without it, a voices-
  // changed re-play for the same card supersedes the first call, whose resolve
  // would hand the button back while the newer speak is still in flight.
  let playEpoch = 0;

  async function playCurrent(auto) {
    const item = deck[idx];
    if (!item || ttsMode === 'off') return;
    const myEpoch = ++playEpoch;
    const btn = $('play');
    // Interaction-spec rule (语音节, 2026-08-09 二): while an IO-bound operation
    // is in flight, its control is DISABLED — loading (fetch/synthesis) and the
    // playback that follows both count. The button re-enables only when the
    // attempt settles: failure, interruption, or playback finishing.
    btn.disabled = true;
    setNote(t('tts_loading', '正在加载音频…'));
    const r = await LearnTTS.speak(item.text, item.lang);
    // This resolve may be seconds late (blocked speak resolves via timeout). If
    // the user has moved on, card entry resets the button's state anyway. But a
    // supersede while the SAME card stays on screen must give the button back —
    // the superseding speak was not started from this (disabled) button, so
    // nothing else will re-enable it.
    if (deck[idx] !== item) return;
    if (r.reason === 'superseded') {
      if (myEpoch === playEpoch) btn.disabled = false;
      return;
    }
    if (r.ok) {
      setNote(t('tts_playing', '播放中…'));
      btn.textContent = t('tts_replay', '▶ 再听一遍');
      await (r.done || Promise.resolve());
      if (deck[idx] !== item) return;
      btn.disabled = false;
      setNote('');
      return;
    }
    btn.disabled = false;
    // Every failure names itself — auto attempts included. A blocked autoplay's
    // message already tells the user what to do (tap the button), and a failed
    // network fetch must not dead-end as a silently cleared loading line.
    //
    // 屏幕上只放**说人话的那一句**，外加 HTTP 状态码（401/403/429 是用户能据以行动的）。
    // 原始异常名、MIME、字节数只进控制台。这里原本挂着一条标了「临时诊断」的串，把
    // `NotAllowedError play() failed because… | audio/mpeg 20480B fresh` 原样渲染给
    // 手机上的用户看，而且**已经随 1.6.4/1.6.5/1.6.6 出货**。调试残留不会自己过期，
    // 只会一版一版地跟着出去。
    if (r.detail) console.warn('[mt-tts]', r.reason, r.status || '', r.detail);
    setNote(reasonText(r.reason) + (r.status ? ' (HTTP ' + r.status + ')' : ''));
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
    // §5.3 practice and §5.4's second exercise share the same honesty problem:
    // grades 1–3 will not be granted an interval, so promising one would be the
    // lie §5.1 exists to prevent. Grade 0 keeps 「重新学」 — practiceOutcome does
    // lapse a scheduled card on a fail, on both paths.
    const noAdvance = practicing || extraMode;
    const iv = noAdvance ? null
      : LearnScheduler.previewIntervals(item.sched, Date.now(), sched);
    const hadSched = !!(item.sched && item.sched.s);
    document.querySelectorAll('.grade').forEach((b) => {
      const el = b.querySelector('.when');
      if (!el) return;
      const g = Number(b.dataset.grade);
      if (noAdvance) {
        el.textContent = g === 0 && hadSched ? t('learn_relearn', '重新学') : '';
      } else {
        el.textContent = g === 0 ? t('learn_relearn', '重新学') : fmtWhen(iv[g]);
      }
    });
    $('practice-note').hidden = !practicing;
    $('extra-note').hidden = !extraMode;
  }

  // §5.2/§5.4 skill badges. `caps` feeds the 全面掌握 gate: a skill whose form does
  // not exist for this card (no voice for its language / no mic+engine) is not a
  // missing skill. Lit = ever verified; lit but past the freshness window = 待重验
  // (stale), never dark again — a badge that un-lights reads as a demotion.
  function renderBadges(item, caps) {
    const now = Date.now();
    const sk = item.skills || {};
    const one = (id, key, possible) => {
      const el = $(id);
      el.classList.toggle('lit', !!sk[key]);
      el.classList.toggle('stale',
        !!sk[key] && !LearnScheduler.skillFresh(item, key, now, sched));
      el.hidden = !possible && !sk[key];
    };
    one('badge-read', 'read', true);
    one('badge-listen', 'listen', !!(caps && caps.listen));
    one('badge-speak', 'speak', !!(caps && caps.speak));
    one('badge-write', 'write', true);
    $('badge-full').hidden = !LearnScheduler.fullyMastered(item, caps, now, sched);
  }

  // ─── §9.3 exercise variants (MCQ / 盲听选词 / 理解题) ─────────────────────

  function resetExercise() {
    exState = null;
    $('ex-prompt').hidden = true;
    $('ex-options').hidden = true;
    $('ex-options').textContent = '';
    $('ex-options').classList.remove('chips');
    $('ex-check').hidden = true;
    $('ex-status').hidden = true;
    $('ex-status').textContent = '';
    // §9.4 — leaving a card mid-recording releases the mic; the blob is discarded
    // unheard. A recording indicator that outlives its card is a trust bug.
    if (speakRec) { try { speakRec.cancel(); } catch (_) {} speakRec = null; }
    if (speakTimer) { clearInterval(speakTimer); speakTimer = 0; }
    $('speak-box').hidden = true;
    $('speak-status').textContent = '';
    $('speak-transcript').hidden = true;
    $('speak-transcript').textContent = '';
    $('speak-score').hidden = true;
    $('speak-score').textContent = '';
  }

  // §9.4 — why the speak attempt failed, in the user's words (reason convention
  // shared with reasonText above).
  function sttReasonText(code) {
    switch (code) {
      case 'no_engine':
      case 'no_base': return t('stt_no_base', '还没配置转写端点');
      case 'no_key': return t('stt_no_key', '还没填转写 API Key');
      case 'network': return t('stt_network', '连不上转写端点——检查地址是否可达；自建服务还需允许跨域访问（CORS）');
      case 'no_mic': return t('stt_no_mic', '这个浏览器拿不到麦克风');
      case 'mic_denied': return t('stt_mic_denied', '麦克风权限被拒绝——本次会话改用其他题型');
      case 'http': return t('stt_http', '转写服务返回了错误');
      case 'empty_transcript': return t('stt_empty', '没有识别到语音，再试一次');
      case 'unsupported': return t('stt_unsupported', '这个浏览器不支持录音');
      default: return t('stt_failed', '转写失败');
    }
  }

  // §9.4 说题卡: the original stays VISIBLE (this is reading aloud, not recall);
  // record → the user's own endpoint → speakScore constrains the grades.
  function renderSpeak(item) {
    exState = { kind: 'speak', decided: false };
    $('speak-box').hidden = false;
    $('ex-prompt').hidden = false;
    $('ex-prompt').textContent = t('learn_speak_prompt', '朗读这一句');
    $('speak-status').textContent = t('learn_speak_cost', '使用你配置的转写端点，每次录音一次调用');
    const btn = $('speak-record');
    btn.disabled = false;
    btn.textContent = t('learn_speak_record', '🎙 开始录音');
    $('orig').hidden = false;
    $('reveal').hidden = true;
    $('reveal-orig').hidden = true;
    $('answer').hidden = true;
    $('grades').hidden = true;
  }

  // §9.3 — one place turns an objective result into the allowed grade set,
  // mirroring the cloze 检查 rule.
  function applyGradeGate(allowed) {
    document.querySelectorAll('.grade').forEach((b) => {
      b.disabled = allowed.indexOf(Number(b.dataset.grade)) < 0;
    });
  }

  // §9.3 — which variant this render shows. Deterministic by (id, reps, skill) —
  // a reload re-asks the same question. Only 'comprehension' may charge (once per
  // card per PACK_VERSION, status line visible); every failure falls back to the
  // local variant of the same skill — a pack error never blocks a review.
  async function chooseVariant(item) {
    const reps = (item.sched && item.sched.reps) || 0;
    const canAI = typeof LearnExercisePack !== 'undefined' && LearnExercisePack.capable();
    const cachedPack = canAI ? await LearnExercisePack.cached(item.id) : null;
    let pack = cachedPack && cachedPack.data;
    const pick = LearnExercises.pickExercise(currentMode, item,
      { reps, poolSize: poolItems.length, hasAI: canAI });

    if (pick.needsPack && !pack) {
      $('ex-status').hidden = false;
      $('ex-status').textContent = t('learn_pack_loading',
        '正在用你配置的 API 生成本卡题目（一次调用，永久缓存）…');
      try {
        const r = await LearnExercisePack.get(item, explainLang);
        pack = r.data;
        if (deck[idx] === item) $('ex-status').hidden = true;
      } catch (e) {
        if (deck[idx] !== item) return null;
        // Named failure, then the LOCAL variant of the same skill renders below.
        $('ex-status').textContent = t('learn_pack_failed', '题目生成失败，已换用本地题型')
          + ' (' + ((e && e.code) || 'error') + ')';
      }
    }
    if (deck[idx] !== item) return null;

    if (pick.kind === 'mcq') {
      const q = LearnExercises.mcqFrom(item, poolItems,
        pack && pack.mcq && pack.mcq.distractors, reps);
      return q ? { kind: 'mcq', q } : { kind: 'recall' };
    }
    if (pick.kind === 'comprehension') {
      const qs = pack && pack.comprehension;
      if (qs && qs.length) return { kind: 'comprehension', q: qs[reps % qs.length] };
      return { kind: 'recall' };
    }
    if (pick.kind === 'listen-pick') {
      const q = LearnExercises.listenPickFrom(item, poolItems,
        pack && pack.listen && pack.listen.foils, reps);
      return q ? { kind: 'listen-pick', q } : { kind: 'listen-recall' };
    }
    return { kind: pick.kind };
  }

  // Single-tap choice exercises (译文选择题 / 理解题). The tap is both the answer
  // and the reveal; the objective result then constrains the grades — the cloze
  // rule, reused. Options are BUTTONS built with textContent: model output is
  // untrusted (§9.2), and so is corpus text on principle.
  function renderChoice(item, variant) {
    const isMcq = variant.kind === 'mcq';
    exState = { kind: variant.kind, decided: false };
    $('ex-prompt').hidden = false;
    $('ex-prompt').textContent = isMcq
      ? t('learn_mcq_prompt', '选出正确的译文')
      : variant.q.q;
    const box = $('ex-options');
    box.hidden = false;
    box.textContent = '';
    variant.q.options.forEach((opt, i) => {
      const b = document.createElement('button');
      b.className = 'ex-option';
      b.textContent = opt;
      b.addEventListener('click', () => {
        if (!exState || exState.decided) return;
        exState.decided = true;
        const okPick = i === variant.q.correct;
        Array.from(box.children).forEach((el, j) => {
          el.disabled = true;
          if (j === variant.q.correct) el.classList.add('ok');
        });
        if (!okPick) b.classList.add('bad');
        applyStage(2);
        $('orig').hidden = false;
        $('grades').hidden = false;
        applyGradeGate(LearnExercises.gradeGate(exState.kind, { correct: okPick }));
      });
      box.appendChild(b);
    });
    // The original stays visible (both variants test understanding OF it); the
    // translation stays hidden until the tap — the choice IS the reveal.
    $('orig').hidden = false;
    $('reveal').hidden = true;
    $('reveal-orig').hidden = true;
    $('answer').hidden = true;
    $('grades').hidden = true;
  }

  // 盲听选词: audio first, the original hidden; multi-select the words heard,
  // then 确认 locks the row, reveals, and gates the grades.
  function renderListenPick(item, variant) {
    exState = { kind: 'listen-pick', decided: false, sel: new Set(), q: variant.q };
    $('ex-prompt').hidden = false;
    $('ex-prompt').textContent = t('learn_listen_once', '先听一遍，再选出你听到的词');
    const box = $('ex-options');
    box.hidden = false;
    box.classList.add('chips');
    box.textContent = '';
    variant.q.options.forEach((opt, i) => {
      const b = document.createElement('button');
      b.className = 'ex-option chip';
      b.textContent = opt.w;
      b.addEventListener('click', () => {
        if (!exState || exState.decided) return;
        if (exState.sel.has(i)) { exState.sel.delete(i); b.classList.remove('sel'); }
        else { exState.sel.add(i); b.classList.add('sel'); }
      });
      box.appendChild(b);
    });
    $('ex-check').hidden = false;
    $('ex-check').disabled = false;
    $('orig').hidden = true;
    $('reveal-orig').hidden = true;
    $('reveal').hidden = true;
    $('answer').hidden = true;
    $('grades').hidden = true;
  }

  // §5.2 write tier: the cloze UI, from the pure builder. Inputs in document order;
  // sizes track their answers so the layout does not telegraph less than it must.
  // `accept` (§9.3, cached pack only — never generated for a cloze) widens the
  // checker with alternative forms; the answer of record stays the sentence's.
  // `kpOpts` (§5.4, cached notes only) makes the blanks rotate through the
  // card's knowledge points instead of the generic longest-word pick.
  function buildClozeUI(item, accept, kpOpts) {
    const c = LearnModel.clozeFor(item.text, kpOpts || undefined);
    const box = $('cloze');
    box.textContent = '';
    clozeState = { answers: [], inputs: [], checked: false, accept: accept || null };
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

    // The exercise form comes from the ladder + rotation (§5.2/§5.4). Availability
    // must be known BEFORE staging: a listen card whose language cannot be spoken
    // is a read card, not a broken one. `caps.speak` stays false until the speak
    // pipeline lands (§9.4).
    const av = ttsMode !== 'off' ? await LearnTTS.available(item.lang) : { ok: false };
    // §9.4 — speak exists only while an engine is configured AND the mic API is
    // present AND this session has not been denied the mic.
    const caps = {
      listen: av.ok,
      speak: !speakDenied && typeof LearnSpeech !== 'undefined' && LearnSpeech.capable(),
    };
    if (extraMode && skillQueue.length) {
      // Second exercise: same card, next queued skill — never recomputed, so the
      // queue the FIRST render promised is the queue the card delivers.
      currentMode = skillQueue[0];
    } else {
      extraMode = false;
      skillQueue = LearnScheduler.pickSkills(item, caps, Date.now(), sched);
      // §5.3 — practice reps stay single-exercise: the pool is user-sized and the
      // asymmetric rule already runs every rep; doubling them doubles nothing.
      if (practicing) skillQueue = skillQueue.slice(0, 1);
      currentMode = skillQueue[0];
    }

    renderStrength(item);
    renderBadges(item, caps);
    renderGradePreviews(item);

    const write = currentMode === 'write';
    clozeState = null;
    resetExercise();
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
      // A CACHED pack's accept alternates widen the checker (§9.3); the local
      // exercise never triggers a generation. CACHED notes (never generated here
      // either) supply the knowledge-point targets: the blanks rotate through the
      // card's parsed 生词/短语 as reps grow (§5.4 — 这次挖这个词).
      const packHit = (typeof LearnExercisePack !== 'undefined' && LearnExercisePack.capable())
        ? await LearnExercisePack.cached(item.id) : null;
      const noteHit = await LearnNotes.cached(item.id);
      const kp = noteHit && noteHit.data
        ? [].concat(
            (noteHit.data.phrases || []).map((x) => x.p),   // phrases first: the
            (noteHit.data.words || []).map((x) => x.w))     // longer unit wins overlaps
        : null;
      buildClozeUI(item, packHit && packHit.data && packHit.data.accept,
        kp && kp.length
          ? { targets: kp, seed: (item.sched && item.sched.reps) || 0 }
          : null);
      $('orig').hidden = true;
      $('reveal').hidden = true;
      $('reveal-orig').hidden = true;
      $('answer').hidden = false;
    } else {
      // §9.3 — the variant rotation. A choice/pick variant replaces the recall
      // staging; the recall variants keep the staging exactly as before.
      const variant = await chooseVariant(item);
      if (!variant || deck[idx] !== item) return;
      if (variant.kind === 'mcq' || variant.kind === 'comprehension') {
        renderChoice(item, variant);
      } else if (variant.kind === 'listen-pick') {
        renderListenPick(item, variant);
      } else if (variant.kind === 'speak') {
        renderSpeak(item);
      } else {
        applyStage(currentMode === 'listen' || ttsMode === 'audio-first' ? 0 : 1);
      }
    }
    setupAudio(item);
    setupNotes(item);

    const src = $('src');
    src.textContent = '';
    src.appendChild(srcLine(item, sources));
    appendSrcActions(src, item, sources);

    renderMedia(item, sources);

    $('progress').textContent = practicing
      ? t('learn_practice_progress', '练习 {i} / {n}')
          .replace('{i}', String(idx + 1)).replace('{n}', String(deck.length))
      : t('learn_progress', '本轮进度') + ' ' + (idx + 1) + ' / ' + deck.length;
  }

  async function grade(g, sources) {
    const item = deck[idx];
    if (!item) return;
    // interaction-spec 全局原则: the review-row write is IO — a double-tap on the
    // same grade would record the review twice and advance two cards. Disabled
    // here; the next card's render re-enables the whole row (show() does it).
    // The catch restores each button's PRIOR disabled state, not a blanket
    // enable: on a write-tier card 检查 left only the evidence-consistent grades
    // enabled, and a failure must not widen that gate.
    const gradeBtns = Array.from(document.querySelectorAll('.grade'));
    const wasDisabled = gradeBtns.map((b) => b.disabled);
    gradeBtns.forEach((b) => { b.disabled = true; });
    try {
      await gradeInner(g, sources, item);
    } catch (e) {
      gradeBtns.forEach((b, i) => { b.disabled = wasDisabled[i]; });
      throw e;
    }
  }

  async function gradeInner(g, sources, item) {
    LearnTTS.stop();
    const now = Date.now();

    // §5.2/§5.4 — a pass at ≥「记得」 stamps this form's skill timestamp, on every
    // path and EVERY time (the freshness window reads the stamp, so refreshing it
    // is the point — the old light-once behavior would make 待重验 permanent):
    // practice proves nothing about long-term MEMORY (§5.3), but demonstrating a
    // skill is demonstrating a skill. `lastSeenAt` bumps with it so the stamp
    // reaches other devices — `touchedAt` reads timestamps, not badge bits.
    const stampSkill = () => {
      if (g < 2) return false;
      item.skills = Object.assign({}, item.skills);
      item.skills[currentMode] = now;
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
      if (stampSkill()) dirty = true;
      if (dirty) await LearnStore.putItem(item);
      await LearnStore.recordReview(item.id, g, now, { practice: 1, mode: currentMode });
      donePractice++;
      idx++;
      if (idx >= deck.length) { await endPractice(); return; }
      show(sources);
      await refreshCounts();
      return;
    }

    // §5.4 — the appended second exercise. Asymmetric like practice (§5.3): a fail
    // is a real lapse, a pass refreshes the skill stamp and writes no schedule —
    // one due date advances one curve exactly once, which is the recorded boundary
    // against the rejected per-skill scheduling (§12).
    if (extraMode) {
      const next = LearnScheduler.practiceOutcome(item.sched, g, now, sched);
      let dirty = false;
      if (next) {
        item.sched = next;
        item.state = LearnScheduler.stateFor(item, sched);
        dirty = true;
      }
      if (stampSkill()) dirty = true;
      if (dirty) await LearnStore.putItem(item);
      await LearnStore.recordReview(item.id, g, now, { mode: currentMode, extra: 1 });
      extraMode = false;
      skillQueue = [];
      idx++;
      refreshPressure();
      if (idx >= deck.length) { await start(); return; }
      show(sources);
      await refreshCounts();
      return;
    }

    const wasNew = !item.sched || !item.sched.s;

    item.sched = LearnScheduler.applyReview(item.sched, g, now, sched);
    item.state = LearnScheduler.stateFor(item, sched);
    stampSkill();
    await LearnStore.putItem(item);
    await LearnStore.recordReview(item.id, g, now, { mode: currentMode });
    // The daily new-card budget is no longer written here: the review row just
    // recorded IS the ledger — introducedToday() derives today's spend from the
    // synced review log, so every device under one account agrees on the budget
    // (the old device-local `newToday` meta made each device promote its own
    // dailyNew, the last systematic cross-device count divergence).

    doneThisRun++;

    // §5.4 — a second stale skill re-renders the SAME card once more before the
    // deck moves on. Skipped after a fail: the card just lapsed and is coming back
    // soon anyway — piling a second test onto a lapse teaches only frustration.
    if (g > 0 && skillQueue.length > 1) {
      skillQueue = skillQueue.slice(1);
      extraMode = true;
      show(sources);
      await refreshCounts();
      return;
    }

    skillQueue = [];
    idx++;
    refreshPressure();
    if (idx >= deck.length) { await start(); return; }
    show(sources);
    await refreshCounts();
  }

  // ─── §5.3 free practice ──────────────────────────────────────────────────

  async function startPractice() {
    const items = await LearnStore.allItems();
    poolItems = items;   // §9.3 — same variant material on the practice path
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
    // 总计在前（interaction-spec「多设备同步一致性」：每设备显示总条目数 + 各状态数，
    // 同一账号同步后逐字一致）。
    $('counts').textContent =
      t('learn_count_total', '总计') + ' ' + (st.total || 0) + ' · ' +
      t('learn_count_due', '待复习') + ' ' + due + ' · ' +
      t('learn_count_learning', '学习中') + ' ' + (st.by.learning || 0) + ' · ' +
      t('learn_count_new', '候选') + ' ' + (st.by.candidate || 0) + ' · ' +
      t('learn_count_known', '已掌握') + ' ' + (st.by.known || 0);
    return { items, due, st };
  }

  // ─── 常驻同步状态行（interaction-spec「多设备同步一致性」，2026-08-09 用户裁定）──
  // 五态：同步中 / 同步完成·时间 / 离线 / 失败 / 未登录（仅本机数据）。公开构建
  // （MT_BACKEND 未编入或 enabled=false）整行隐藏——不存在的功能不许长死状态条。
  // 自动同步「可见但不打断」：IO 规则约束的是触发它的控件；自动路径没有触发控件，
  // 评分按钮永不因同步而禁用。
  function fmtClock(at) {
    try { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return ''; }
  }
  function renderSyncStatus(ev) {
    const line = $('sync-line');
    if (!line) return;
    if (typeof MT_BACKEND === 'undefined' || !MT_BACKEND.enabled) { line.hidden = true; return; }
    line.hidden = false;
    switch (ev.state) {
      case 'running':
        line.textContent = t('sync_status_running', '与服务器同步中…'); break;
      case 'done':
        line.textContent = t('sync_status_done_at', '同步完成 · {time}').replace('{time}', fmtClock(ev.at)); break;
      case 'offline':
        line.textContent = t('sync_status_offline', '当前网络离线，稍后自动重试。学习记录已保存在本机。'); break;
      case 'signed_out':
        line.textContent = t('sync_status_signed_out', '未登录，仅本机数据'); break;
      // A storage-read failure is NOT the signed-out state, and painting it as
      // one is the page-settings incident all over again (§8.4.1). Name it.
      case 'storage_error':
        line.textContent = t('sync_status_storage_error', '读不到登录状态（存储读取失败），稍后自动重试 —— 这不代表已退出登录。'); break;
      default:
        line.textContent = t('sync_status_error', '同步没能完成，稍后自动重试。'); break;
    }
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
    extraMode = false;         // §5.4 — a rebuild abandons any pending second exercise
    skillQueue = [];
    $('practice-note').hidden = true;
    const { items } = await refreshCounts();
    poolItems = items;   // §9.3 — local distractor/foil material for the variants
    const now = Date.now();

    const srcList = await LearnStore.allSources();
    const sources = new Map(srcList.map((s) => [s.id, s]));

    // Account-level daily budget: derived from the SYNCED review log (first
    // non-practice review per card, UTC day), not device-local meta — one
    // account, one budget, every device (interaction-spec「多设备同步一致性」).
    const newToday = LearnScheduler.introducedToday(await LearnStore.allReviews(), now);

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
  // §9.2 — the notes gate follows the translator's engine unless a dedicated
  // notes engine is configured (notesProvider set ⇒ whole notes group wins;
  // resolveConfig owns that rule). No chat-capable engine (or no key) ⇒
  // capable() stays false ⇒ the entry point never renders.
  LearnNotes.configure(LearnNotes.resolveConfig(settings));
  const explainLang = settings.uiLang && settings.uiLang !== 'auto'
    ? settings.uiLang : (navigator.language || 'zh-CN');
  // §9.4 — the transcription engine group. Empty engine ⇒ capable() false ⇒ the
  // speak form does not exist. Guarded: content-script-less test hosts may load
  // review.js without the speech module.
  if (typeof LearnSpeech !== 'undefined') {
    LearnSpeech.configure({
      engineId: settings.sttEngine || '',
      baseUrl: settings.sttBaseUrl || '',
      apiKey: settings.sttApiKey || '',
      model: settings.sttModel || '',
    });
  }
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
  $('practice-start').addEventListener('click', async (e) => {
    // Full-corpus IDB read (全局原则) — and startPractice() may settle to "pool
    // is empty, setup stays visible", which without the disable flicker was
    // indistinguishable from the click having done nothing at all.
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await startPractice(); } finally { btn.disabled = false; }
  });

  // §9.2 — generate on demand. One call, cached per prompt version (LearnNotes
  // regenerates only when a prompt fix invalidates the old output); failures
  // name themselves in the cost line's place rather than leaving a dead button.
  $('notes-btn').addEventListener('click', async () => {
    const item = deck[idx];
    if (!item) return;
    $('notes-btn').disabled = true;
    $('notes-cost').textContent = t('learn_notes_loading', '解析中…');
    try {
      const r = await LearnNotes.get(item, explainLang);
      if (deck[idx] === item) renderNotes(r.data);
    } catch (e) {
      // Same guard as the success branch: a failure landing after the user moved
      // on must not stamp the previous card's error onto the current card.
      if (deck[idx] !== item) return;
      // The failure line names its cause — "HTTP 401" and "bad_output" call for
      // opposite fixes (key vs retry), and a bare 解析失败 hides which one this is.
      const why = e && e.code === 'http' ? 'HTTP ' + e.status
        : e && e.code ? e.code
        : (e && e.name === 'TypeError' ? 'network' : 'error');
      console.error('[learn/notes] generation failed:', why, e);
      // empty_output gets its own sentence: "稍后再试" is a lie there — the fix
      // is switching to a chat model, and this line is where users will look.
      $('notes-cost').textContent = e && e.code === 'empty_output'
        ? t('learn_notes_failed_empty', '模型没有返回正文——思考（推理）型模型不适合句子解析，请在设置中改用对话模型。')
        : t('learn_notes_failed', '解析失败，稍后再试') + ' (' + why + ')';
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
      // §9.3 — pack `accept` alternates widen the check; the sentence's own
      // answer stays the answer of record (and the correction shown).
      const alts = (clozeState.accept && clozeState.accept[clozeState.answers[i]]) || [];
      const okOne = LearnModel.clozeCheck(clozeState.answers[i], inp.value)
        || alts.some((a) => LearnModel.clozeCheck(a, inp.value));
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

  // §9.4 说题卡 — one button, three states: start → stop(+elapsed) → 识别中.
  // IO 在途，控件不可用: from stop to the transcription settling, the whole speak
  // control is disabled with a named status. A mic denial collapses the speak
  // capability for the session and re-renders the card on its next eligible
  // skill — never a dead card. The recording blob is discarded after transcribe.
  const speakFail = (item, code) => {
    $('speak-status').textContent = sttReasonText(code) + ' (' + code + ')';
    if (code === 'mic_denied' || code === 'no_mic') {
      speakDenied = true;
      extraMode = false;
      skillQueue = [];
      show(currentSources);
      return true;
    }
    return false;
  };
  $('speak-record').addEventListener('click', async () => {
    const item = deck[idx];
    if (!item || !exState || exState.kind !== 'speak') return;
    const btn = $('speak-record');

    if (!speakRec) {
      // Start. Any TTS playback stops first — one audio channel at a time.
      LearnTTS.stop();
      btn.disabled = true;
      let rec;
      try {
        rec = await LearnSpeech.startRecording();
      } catch (e) {
        if (deck[idx] !== item) return;
        if (!speakFail(item, (e && e.code) || 'error')) btn.disabled = false;
        return;
      }
      if (deck[idx] !== item) { try { rec.cancel(); } catch (_) {} return; }
      speakRec = rec;
      const t0 = Date.now();
      const paint = () => {
        btn.textContent = t('learn_speak_stop', '■ 停止')
          + ' ' + Math.round((Date.now() - t0) / 1000) + 's';
      };
      paint();
      speakTimer = setInterval(paint, 1000);
      $('speak-status').textContent = t('learn_speak_recording', '录音中——读出上面的句子');
      btn.disabled = false;
      return;
    }

    // Stop → transcribe → score. Whole control disabled until the attempt settles.
    const rec = speakRec;
    speakRec = null;
    clearInterval(speakTimer);
    speakTimer = 0;
    btn.disabled = true;
    $('speak-status').textContent = t('learn_speak_busy', '识别中…');
    try {
      const out = await rec.stop();
      const transcript = await LearnSpeech.transcribe(out.blob, out.ext, item.lang);
      if (deck[idx] !== item) return;
      const r = LearnExercises.speakScore(item.text, transcript);
      exState.decided = true;
      $('speak-transcript').hidden = false;
      $('speak-transcript').textContent = transcript;
      $('speak-score').hidden = false;
      $('speak-score').textContent = t('learn_speak_score', '与原句匹配 {n}%')
          .replace('{n}', String(Math.round(r.score * 100)))
        + (r.missed.length
          ? ' · ' + t('learn_speak_missed', '漏读：') + r.missed.slice(0, 5).join(' ')
          : '');
      applyStage(2);
      $('grades').hidden = false;
      applyGradeGate(LearnExercises.gradeGate('speak', r));
      // Re-recording is allowed once the attempt settles (a better read re-gates);
      // the cost line returns so the next call is never a surprise charge.
      btn.textContent = t('learn_speak_again', '🎙 再录一次');
      btn.disabled = false;
      $('speak-status').textContent = t('learn_speak_cost', '使用你配置的转写端点，每次录音一次调用');
    } catch (e) {
      if (deck[idx] !== item) return;
      if (!speakFail(item, (e && e.code) || 'error')) {
        btn.textContent = t('learn_speak_again', '🎙 再录一次');
        btn.disabled = false;
      }
    }
  });

  // §9.3 盲听选词 — 确认 locks the selection, reveals, and gates the grades on
  // the objective result (exact set match: every heard word picked, no foil).
  $('ex-check').addEventListener('click', () => {
    if (!exState || exState.kind !== 'listen-pick' || exState.decided) return;
    exState.decided = true;
    $('ex-check').disabled = true;
    const q = exState.q;
    let allOk = true;
    Array.from($('ex-options').children).forEach((el, i) => {
      el.disabled = true;
      const hit = !!q.options[i].hit;
      const chosen = exState.sel.has(i);
      if (hit) el.classList.add('ok');
      if (chosen !== hit) {
        allOk = false;
        if (chosen && !hit) el.classList.add('bad');
      }
    });
    $('orig').hidden = false;
    applyStage(2);
    $('grades').hidden = false;
    applyGradeGate(LearnExercises.gradeGate('listen-pick', { correct: allOk }));
  });

  // Drain the outbox first — this page is one of the few places that can, since the
  // corpus lives in the extension origin and the service worker cannot be trusted
  // on Safari iOS.
  $('pressure-fix').addEventListener('click', async (e) => {
    // interaction-spec 全局原则: bulk IDB delete + three refreshes — disabled
    // until the whole settle, else a second tap races the rebuild.
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const n = await LearnStore.clearKnown().catch(() => 0);
      await refreshPressure();
      await refreshCounts();
      if (!n) return;
      // The corpus changed underneath the deck, so rebuild rather than leaving a
      // card on screen that no longer exists.
      await start();
    } finally { btn.disabled = false; }
  });

  // §7.5 — restore BEFORE drain and before the entry-forced sync: a UUID-rotated
  // (or otherwise emptied) corpus comes back from the local backup for signed-out
  // users; the pull below heals signed-in ones. Guarded: the app bundle
  // deliberately ships without LearnBackup.
  if (typeof LearnBackup !== 'undefined') {
    try { await LearnBackup.restoreIfEmpty(); } catch (_) {}
  }
  await LearnDrain.run();
  if (typeof LearnBackup !== 'undefined') {
    try { LearnBackup.maybeRun(); } catch (_) {}      // fire-and-forget snapshot
  }
  await refreshPressure();
  await start();

  // §8.8 修订版 — opening this page is an ENTRY, and entry FORCES a sync
  // (interaction-spec「多设备同步一致性」: 每次进入即同步，绕过节流). Still
  // fire-and-forget AFTER the first deck is on screen: blocking start() on the
  // network would hold the whole page hostage to a slow sync the user never asked
  // for. If the pull actually brought something new AND no card is mid-review
  // (empty / deck-done states — exactly where fresh material matters most),
  // rebuild; a card on screen is never yanked.
  if (typeof LearnSync !== 'undefined') {
    LearnSync.onStatus(async (ev) => {
      renderSyncStatus(ev);
      if (ev.state === 'done') {
        await refreshCounts();
        if (ev.pulled && (ev.pulled.cards || ev.pulled.reviews) && $('card').hidden) {
          await start();
        }
        // A sync that just landed material is a good, already-quiet moment to
        // refresh the local backup (§7.5) — throttled inside maybeRun.
        if (typeof LearnBackup !== 'undefined') {
          try { LearnBackup.maybeRun(); } catch (_) {}
        }
      }
    });
    // 初始态：还没跑同步之前，用上一次成功时间铺底；无记录且已登录则等首跑覆盖。
    (async () => {
      if (typeof MT_BACKEND !== 'undefined' && MT_BACKEND.enabled) {
        const lastOk = await LearnStore.getMeta(LearnSync.LAST_OK, 0).catch(() => 0);
        const session = await LearnAuth.current().catch(() => null);
        // Storage-read failure ≠ signed out (§8.4.1): the session may be fine
        // and merely unreadable this instant. Say that, never 「未登录」.
        if (!session && LearnAuth.lastLoadError()) renderSyncStatus({ state: 'storage_error', at: Date.now() });
        else if (!session) renderSyncStatus({ state: 'signed_out', at: Date.now() });
        else if (lastOk) renderSyncStatus({ state: 'done', at: lastOk });
      }
    })().catch(() => {});
    LearnSync.autoSync(Date.now(), { force: true }).catch(() => {});
    // 断网自愈：网络回来立刻补一次进入级同步，而不是等下一次打开页面。
    try {
      window.addEventListener('online', () => {
        LearnSync.autoSync(Date.now(), { force: true, online: true }).catch(() => {});
      });
    } catch (_) {}
  }

  // One-time explainer (§5.1): shown above the first card ever seen, non-blocking,
  // dismissed forever. Not shown over the empty state — grading advice before there
  // is anything to grade would explain the wrong thing.
  if (!$('card').hidden && !(await LearnStore.getMeta('howtoSeen', 0))) {
    $('howto').hidden = false;
  }
  $('howto-ok').addEventListener('click', async (e) => {
    // Meta write is IO too (全局原则) — though the panel hides first, so this is
    // belt-and-braces against a double-fire of the write.
    e.currentTarget.disabled = true;
    $('howto').hidden = true;
    await LearnStore.setMeta('howtoSeen', 1);
  });
})();
