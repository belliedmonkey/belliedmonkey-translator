// learn-driving.js — pure logic for 播客模式 (podcast mode, 记忆层).
//
// ─── 名字：用户看到的是「播客模式」，代码里仍叫 drive/driving ────────────────
// 2026-08-18 改的只是**产品名**。标识符没跟着改，是权衡后的结果，不是偷懒：
//   · `drivePlaybackMode` / `drivePlayNotes` 是**已经落在用户设备上的存储键**。改名
//     等于再来一次迁移，而收益是零 —— 用户永远看不到键名。
//   · 这个仓库里 `podcast` 已经有主了：`content/content-podcast.js` 是扩展在播客网站上
//     的字幕翻译。把学习层这个模块也叫 podcast，两个不同的东西就会在代码里同名。
// 要读的人记住一件事就够：**drive* = 播客模式**。
// See docs/learning-design.md §9.5 and docs/interaction-spec.md 「播客模式」.
//
// PURE, like learn-exercises.js: the playlist order (`buildOrder` / `advance`), the
// per-card plan, the notes-to-speech rendering and the session state machine
// (`reduce`) are all deterministic functions of their inputs — the app orchestrator
// (app/driving.js) executes the effects and feeds events back. That split is what lets
// the vm harness walk the whole session without a DOM or a voice.
//
// ─── What this mode is, and what it is NOT ──────────────────────────────────
// It is a PLAYER for the deck: it reads cards aloud, back to back, in one of four
// playback orders, and it **writes nothing at all** — no review row, no skill stamp,
// no `lastSeenAt`, no scheduler call. Nothing here can move a card's curve.
//
// That is a deliberate reversal. The first version asked 「有没有疑问？」 after every
// card and offered a 跟读 exercise, so that a driver could push real progress
// hands-free. Both are gone: a recording window has to interrupt continuous playback
// to exist, and continuous playback is the entire point of listening while driving.
// The learning layer's write paths stay where a user can see what they are grading
// (the review surface); this surface only exposes material. See §12 for the record.
//
// Depends only on LearnModel (nothing from LearnScheduler any more — no write path
// means no scheduler contact).

var LearnDriving = (() => {
  // Playback orders, in the order the toggle cycles them. `shuffle` leads because it
  // is the default: a driver revisiting the same deck daily hears the same opening
  // three cards forever under any in-order mode, and that is precisely the material
  // they already know best.
  const MODES = ['shuffle', 'sequential', 'loop', 'repeat-one'];
  const DEFAULT_MODE = 'shuffle';

  const DEFAULTS = {
    mode: DEFAULT_MODE,
    // Reading the notes aloud is ON by default (user's call, 2026-08-18). It can COST
    // MONEY: a card that has never been parsed gets generated on the spot, against the
    // user's own key. §9.2's "one generation per card, ever" still holds — the charge
    // happens once and every later pass is cached — but with the default flipped on,
    // the FIRST session through a fresh deck parses every card in it. That is why the
    // cost sentence appears twice (beside the setting, and standing in the player
    // while it happens) rather than once.
    playNotes: true,
  };

  function cfgOf(cfg) { return Object.assign({}, DEFAULTS, cfg || {}); }
  function nextMode(mode) {
    const i = MODES.indexOf(mode);
    return MODES[(i < 0 ? 0 : i + 1) % MODES.length];
  }

  // ─── Playlist order ────────────────────────────────────────────────────────
  // The order is materialised once rather than computed per step, so `shuffle` means
  // "every card once, in a random order" instead of "a random card each time" — the
  // latter replays cards while others never come up, which on a 15-card deck is
  // immediately noticeable and reads as a bug.
  //
  // `rand` is injected (defaults to Math.random) so a test can pin an exact order.
  function buildOrder(n, mode, rand) {
    const order = [];
    for (let i = 0; i < n; i++) order.push(i);
    if (mode !== 'shuffle') return order;
    const r = rand || Math.random;
    for (let i = order.length - 1; i > 0; i--) {          // Fisher-Yates
      const j = Math.floor(r() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    return order;
  }

  // Advance one step. Returns the new position, possibly a NEW order (shuffle
  // reshuffles when it wraps, so the second lap is not the first lap again), and
  // `done` — true only for `sequential`, the one mode that ends.
  //
  // `force` is what the 下一张 button passes: a manual skip moves on even in
  // repeat-one, because a player that ignores its own next button is broken.
  function advance(pos, order, mode, rand, force) {
    if (mode === 'repeat-one' && !force) return { pos, order, done: false };
    const at = order.indexOf(pos);
    const next = at + 1;
    if (next < order.length) return { pos: order[next], order, done: false };
    if (mode === 'sequential') return { pos, order, done: true };
    const reshuffled = buildOrder(order.length, mode, rand);
    return { pos: reshuffled[0], order: reshuffled, done: false };
  }

  // Look one step ahead WITHOUT taking it. Prefetching the next card's audio (§9.5
  // 开卡并行预热) needs to know which card is next, and `advance` cannot answer that
  // question: it reshuffles at the wrap and consumes `rand`, so calling it to peek
  // would spend the random sequence before the user gets there.
  //
  // Pure: never touches `order`, never calls `rand`. Returns `null` rather than
  // guessing whenever the honest answer is unknown — at a shuffle/loop wrap the next
  // card is whatever the reshuffle decides, and warming a guess would fetch audio for
  // a card that is not next. `sequential`'s end is `null` for the same reason (there
  // is no next card at all), and `repeat-one` peeks at itself, which is exactly what
  // it will play.
  function peekNext(pos, order, mode) {
    if (!order || !order.length) return null;
    if (mode === 'repeat-one') return pos;
    const at = order.indexOf(pos);
    if (at < 0) return null;
    const next = at + 1;
    if (next < order.length) return order[next];
    return null;
  }

  // ─── Per-card plan: THREE passes ───────────────────────────────────────────
  //   1st  原句
  //   2nd  原句 + 译句 + 解析（解析可选）
  //   3rd  原句
  //
  // Returned FLAT — one array the state machine walks by index — but every segment
  // carries its `pass`, because once flattened the surface can no longer tell the
  // first pass's 原句 from the third's, and the status line has to say which one it
  // is. Adding or reordering a pass is therefore a data change, never a new state.
  //
  // A card with no translation gets three bare readings of its sentence. That is the
  // correct reading of "play it three times", not a degenerate case to special-case.
  //
  // `cfg.hasTr` overrides where the translation comes from, defaulting to the card's
  // own `tr`. §9.5's 补译文 caches a device-local translation for cards captured
  // without one; it deliberately never writes `item.tr` (that field records what the
  // page actually showed, and a value written here could never sync — see
  // learning-design §7.2), so the orchestrator passes the cache hit in instead.
  //
  // Media cards never reach this (the orchestrator skips them — synthetic speech
  // never replaces real speech, §11).
  const PASSES = 3;

  function cardPlan(item, cfg) {
    const c = cfgOf(cfg);
    const seg = (what, pass) => ({ what, pass });
    const hasTr = (c.hasTr === undefined) ? !!(item && item.tr) : !!c.hasTr;
    const segments = [seg('source', 1)];
    segments.push(seg('source', 2));
    if (hasTr) segments.push(seg('tr', 2));
    if (c.playNotes) segments.push(seg('notes', 2));
    segments.push(seg('source', 3));
    return { segments, passes: PASSES };
  }

  // ─── Notes → one spoken paragraph ──────────────────────────────────────────
  // The notes object is built for the EYE (three labelled lists). Spoken, that
  // structure has to become sentences, and the labels have to come from the caller:
  // this file holds no copy, in any language.
  //
  // Returns '' when there is nothing worth saying, and the caller then skips the
  // segment rather than speaking an empty string — a silent "playing notes" state is
  // indistinguishable from a stall.
  function notesToSpeech(notes, labels) {
    if (!notes) return '';
    const L = labels || {};
    const parts = [];
    const words = (notes.words || []).filter((w) => w && w.w && w.g);
    const phrases = (notes.phrases || []).filter((p) => p && p.p && p.g);
    if (words.length) {
      parts.push((L.words || '') + words.map((w) => w.w + '，' + w.g).join('。'));
    }
    if (phrases.length) {
      parts.push((L.phrases || '') + phrases.map((p) => p.p + '，' + p.g).join('。'));
    }
    if (notes.grammar && String(notes.grammar).trim()) {
      parts.push((L.grammar || '') + String(notes.grammar).trim());
    }
    return parts.join('。');
  }

  // ─── The session state machine ─────────────────────────────────────────────
  // reduce(state, event, ctx) → { state, effects } — a deterministic transition
  // table. Effects are descriptors the orchestrator executes:
  //   speak(what) · fetch_notes · advance(force) · stop_tts · note(code) · done
  //
  // `ctx.plan.segments` is the current card's plan; the machine walks it by index so
  // that adding a segment later is a data change, not a new pair of states.
  const ACTIVE = { speaking: 1, fetching_notes: 1 };

  function S(name, effects, extra) {
    return Object.assign({ state: Object.assign({ name }, extra || {}) }, { effects: effects || [] });
  }

  // Start (or restart) the segment at `seg` of the current card. `notes` needs its
  // text fetched first; everything else is already in hand.
  function playSegment(ctx, seg) {
    const segments = (ctx && ctx.plan && ctx.plan.segments) || [{ what: 'source', pass: 1 }];
    if (seg >= segments.length) return S('advancing', [{ t: 'advance' }]);
    const what = segments[seg].what;
    if (what === 'notes') return S('fetching_notes', [{ t: 'fetch_notes' }], { seg });
    return S('speaking', [{ t: 'speak', what }], { seg });
  }

  function reduce(state, ev, arg, ctx) {
    const st = (state && state.name) || 'idle';
    const seg = (state && state.seg) || 0;

    // ── Controls that work from anywhere ────────────────────────────────────
    // Stop and pause are INTERRUPTS, not second triggers, so they are exempt from
    // the "IO in flight ⇒ controls disabled" rule (interaction-spec 「播客模式」).
    if (ev === 'tap_stop') return S('idle', [{ t: 'stop_tts' }]);
    if (ev === 'hidden' || ev === 'tap_pause') {
      if (st === 'paused' || st === 'idle') return { state: state, effects: [] };
      return S('paused', [{ t: 'stop_tts' }], { seg });
    }
    if (ev === 'tap_resume' && st === 'paused') return playSegment(ctx, seg);
    // 暂停时的「解析这句」。只从 paused 进得去，且**读完回到 paused、seg 原样带回**：
    // 暂停的语义是「我在控制」，读完一段解析不该顺势把整场恢复。
    if (ev === 'tap_explain' && st === 'paused') {
      return S('explain_fetch', [{ t: 'fetch_notes', onDemand: true }], { seg });
    }
    // The mode toggle never interrupts audio — it only changes what happens at the
    // END of this card, which is the whole reason it is safe to press while moving.
    if (ev === 'tap_mode') return { state: state, effects: [{ t: 'mode_next' }] };

    if (ev === 'tap_next') return S('advancing', [{ t: 'stop_tts' }, { t: 'advance', force: true }]);
    if (ev === 'tap_repeat' && st !== 'idle') return playSegment(ctx, 0);

    switch (st) {
      case 'idle':
      case 'advancing':
        if (ev === 'card_ready') return playSegment(ctx, 0);
        if (ev === 'deck_done') return S('session_done', [{ t: 'done' }]);
        return { state: state, effects: [] };

      case 'speaking':
        if (ev === 'tts_done') return playSegment(ctx, seg + 1);
        if (ev === 'tts_fail') {
          // A whole-engine failure will fail on every card, so stopping is the honest
          // response. A per-CARD failure — no voice for THIS language — must not end a
          // session whose other cards are readable: say which card was skipped and keep
          // going. Never silent either way; a card that vanishes with no explanation
          // reads as data loss.
          //
          // The test is written as a CLOSED list of per-card reasons, not a closed list
          // of fatal ones (2026-08-23). It used to be `fatal = blocked || unsupported`,
          // which quietly made every OTHER engine-level reason per-card: with an
          // endpoint engine that could not be reached, a 20-card session skipped 20
          // times and reached 「本轮听完了」 in twelve seconds having played nothing.
          // Found on the iOS simulator while verifying §9.5's 出发前预载 — and that
          // feature makes the case NORMAL rather than exotic, because its whole purpose
          // is sessions where the endpoint is out of reach.
          const perCard = arg === 'no_voice' || arg === 'no_voice_und' || arg === 'empty';
          return perCard
            ? S('advancing', [{ t: 'note', code: arg, src: 'tts' }, { t: 'advance' }])
            : S('stopped_error', [{ t: 'stop_tts' }, { t: 'note', code: arg, src: 'tts' }]);
        }
        return { state: state, effects: [] };

      case 'fetching_notes':
        // Empty text is a skip, not a stall: speaking '' leaves the UI sitting in a
        // state that looks identical to a hang.
        if (ev === 'notes_ready') {
          return arg && String(arg).trim()
            ? S('speaking', [{ t: 'speak', what: 'notes', text: arg }], { seg })
            : playSegment(ctx, seg + 1);
        }
        if (ev === 'notes_fail') {
          // The card itself was already read; a missing analysis is a reason to move
          // on, not to end the drive. Named so the surface can say which one failed.
          return S('advancing', [{ t: 'note', code: arg || 'notes_failed', src: 'notes' }, { t: 'advance' }]);
        }
        return { state: state, effects: [] };

      // ── 按需解析（暂停中）───────────────────────────────────────────────
      // 与 fetching_notes 刻意分开而不是加一个 flag：两条路径的**去处**不同
      // （一个继续播下一段，一个回到暂停），用一个状态加布尔量表达，就是把「回哪里」
      // 藏进了一个容易被后来者漏掉的字段里。
      case 'explain_fetch':
        if (ev === 'notes_ready') {
          return arg && String(arg).trim()
            ? S('explain_speak', [{ t: 'speak', what: 'notes', text: arg }], { seg })
            : S('paused', [{ t: 'note', code: 'notes_empty', src: 'notes' }], { seg });
        }
        if (ev === 'notes_fail') {
          return S('paused', [{ t: 'note', code: arg || 'notes_failed', src: 'notes' }], { seg });
        }
        return { state: state, effects: [] };

      case 'explain_speak':
        if (ev === 'tts_done') return S('paused', [], { seg });
        if (ev === 'tts_fail') return S('paused', [{ t: 'note', code: arg, src: 'tts' }], { seg });
        return { state: state, effects: [] };

      default:
        return { state: state, effects: [] };
    }
  }

  // ─── 遥控 → 会话事件（§9.5「后台与锁屏播放」）────────────────────────────
  // 锁屏卡片、车机按键、耳机、macOS 的媒体键，按下去的东西和屏幕上那四个按钮**是同一件
  // 事的两个表面**，所以它们派发同一批 `tap_*` 事件。状态机因此一个新事件、一个新状态
  // 都不需要 —— 这不是巧合：`tap_*` 的语义本来就是「用户在控制」，从哪个表面控制的
  // 与状态机无关。
  const REMOTE_EVENTS = {
    play: 'tap_resume',
    pause: 'tap_pause',
    next: 'tap_next',
    // 「上一曲」= 🔁 再听一遍（回第一遍开头）。播客模式**没有「上一张」**：随机播放是
    // 一次性排列，往回退没有定义；给它接一个「上一张」就得记一条历史，而那条历史与
    // `order` 会在重洗时分叉。
    previous: 'tap_repeat',
  };

  // 用户看来仍然「停着」的几个状态。播放/暂停切换键要按这个判断往哪边倒，而 app/driving.js
  // 的按钮显隐也读它 —— 一处定义，两个表面，免得遥控和按钮对同一个状态给出相反的动作。
  const PAUSED_LIKE = ['paused', 'stopped_error', 'explain_fetch', 'explain_speak'];
  function isPausedLike(stateName) { return PAUSED_LIKE.indexOf(stateName) >= 0; }

  // 原生音频事件 → 会话事件。返回 null = 这条消息不该动播放器。
  function nativeEvent(msg, stateName) {
    if (!msg) return null;
    if (msg.type === 'remote') {
      if (msg.command === 'toggle') return isPausedLike(stateName) ? 'tap_resume' : 'tap_pause';
      return REMOTE_EVENTS[msg.command] || null;
    }
    if (msg.type === 'interrupt') {
      if (msg.phase === 'begin') return 'tap_pause';
      // 只有系统说 `.shouldResume` 才自动续播。一次真正的中断（来电、被别的 App 抢走
      // 音频）之后自作主张地重新开口，正是 2026-08-18 那条规约要防的事 —— 那条规约
      // 2026-08-24 缩窄到了这里，而不是被废掉：**切后台不是中断**。
      return msg.resume ? 'tap_resume' : null;
    }
    // 耳机被拔了 ⇒ 暂停。重连**不**自动播：拔掉耳机后从外放里冒出声音，是所有音乐 App
    // 都在避免的那件事。
    if (msg.type === 'route') return msg.change === 'device-lost' ? 'tap_pause' : null;
    return null;
  }

  return {
    DEFAULTS, MODES, DEFAULT_MODE, PASSES, nextMode,
    buildOrder, advance, peekNext, cardPlan, notesToSpeech, reduce,
    ACTIVE, REMOTE_EVENTS, PAUSED_LIKE, isPausedLike, nativeEvent,
  };
})();

if (typeof window !== 'undefined') window.LearnDriving = LearnDriving;
if (typeof module !== 'undefined' && module.exports) module.exports = LearnDriving;
