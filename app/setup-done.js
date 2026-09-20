// app/setup-done.js —「配好了」的回执（画布第 7 页 · SetupDone / SetupFrom）。
//
// 用户 2026-09-20 在真机上报的：领完免费额度 / 填完 key 之后**没有任何一处告诉他配好了**，
// 也没说接下来回去做什么；原话还带一句「之前的新手引导也有这个问题」。
//
// 这一份不是新发明，是把仓库里已经对的两个形状搬到 App：
//
//   **形状 A · 配完就地自检**（`extension/learn/quick-setup.js:483-560`）——
//   按下那一刻**就先摆出占位行**，再逐行落成「✓ 通了 · 512ms」。那边的原注释说得最准：
//   「四行在按下那一刻就存在，不是成功后才冒出来的绿框 —— 那种形状让失败看起来像
//   什么都没发生」。所以这里也是先画行、再跑。
//
//   **形状 B · 按「从哪来」给下一步**（`extension/onboard/onboard.js:416-431` 的 fork 屏）——
//   人是被某件事推过来配置的，配完就该把他送回那件事。
//
// **任何一处说「配好了」之前，必须有一次真的成功。** 这与本仓「只信回读，不信没报错」
// 是同一条：领免费额度此前一次自检都不跑（`plan.tests` 只用来数槽位），却直接说
// 「免费额度已配好」—— 那句话没有证据。现在两条路都跑同一份自检。
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const t = (k, fb) => (typeof PageI18n !== 'undefined' ? PageI18n.t(k, fb) : fb);

  // 人是从哪被推过来的。只影响**下一步那一个按钮**，不影响回执本身。
  // 默认 'settings' —— 自己走进设置页的人没有「刚才那件事」可回。
  const FROMS = ['settings', 'systrans', 'quick'];
  let from = 'settings';
  let hooks = {};

  function mark(f) { if (FROMS.indexOf(f) >= 0) from = f; }
  function current() { return from; }

  const SLOT_LABEL = () => ({
    chat: t('qs_slot_chat', '翻译'),
    notes: t('qs_slot_notes', '解析'),
    tts: t('qs_slot_tts', '朗读'),
    stt: t('qs_slot_stt', '转写'),
  });

  // 下一步：一句话 + 一个按钮。**systrans 那一支只有话，没有按钮** ——
  // iOS 不允许我们把人送回刚才那个 App，给一个点了没用的按钮比不给更糟。
  function nextFor(f) {
    if (f === 'systrans') {
      return { line: t('setup_done_systrans', '引擎配好了。回到刚才那个 App，再点一次「翻译」即可 —— 这里不用再做什么。'), btn: null };
    }
    if (f === 'quick') {
      return { line: t('setup_done_quick', '引擎配好了。回到快速翻译面板，刚才那句可以重新翻一次。'), btn: null };
    }
    return { line: t('setup_done_settings', '引擎配好了。文档翻译、对话听译、实时字幕现在都能用了。'), btn: { text: t('setup_done_home', '回到首页'), run: () => { if (hooks.close) hooks.close(); } } };
  }

  function row(box, slot, labels) {
    const r = document.createElement('div');
    r.className = 'qs-row';
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = (labels[slot] || slot) + '：';
    const v = document.createElement('span');
    v.className = 'qs-idle';
    v.textContent = t('qs_testing', '测试中…');
    r.append(k, v);
    box.appendChild(r);
    return v;
  }

  // 跑一个槽的自检。判据与一键卡逐字相同（同一个 EngineTest、同一个 format），
  // 这里不另写一套「算不算通过」的规则。
  async function runSlot(slot, s) {
    if (typeof EngineTest === 'undefined') throw new Error('EngineTest not loaded');
    if (slot === 'chat') {
      return EngineTest.translation({
        provider: s.provider, apiKey: s.apiKey, baseUrl: s.apiBaseUrl, model: s.apiModel,
        targetLang: (typeof AppTargetLang !== 'undefined' && AppTargetLang.resolve(s, '', ''))
          || root.MT_DEFAULT_TARGET_LANG || 'zh-CN',
      });
    }
    if (slot === 'tts') {
      return EngineTest.tts({ engineId: s.ttsEngine, apiKey: s.ttsApiKey, baseUrl: s.ttsBaseUrl, model: s.ttsModel, voice: s.ttsVoice });
    }
    if (slot === 'stt') {
      return EngineTest.stt({ engineId: s.sttEngine, apiKey: s.sttApiKey, baseUrl: s.sttBaseUrl, model: s.sttModel });
    }
    // notes 跟随翻译，没有独立端点可测 —— 说出来，不假装测过。
    throw Object.assign(new Error('no test'), { code: 'no_test' });
  }

  /// 配完之后调一次。`slots` = 这一次真的写进去的槽（`plan.tests`）。
  /// 一个槽都没写就什么都不显示 —— 那不是「配好了」，只是「什么都没变」。
  ///
  /// `opts.results` = 调用方已经测过了（一键卡的 onResults 给的 `[{slot, ok}]`）。
  /// **给了就不再测一遍**：2026-09-20 真机实测，一键卡与这一块各跑一次 EngineTest，
  /// 屏幕上两块自检并排、内容还不同步，而且每次点「配好」发两倍的真实请求。
  /// 不给（领免费额度那条路本来就一次自检都不跑）才自己测，并自己画行。
  async function show(slots, opts) {
    const box = $('setup-done');
    if (!box) return { shown: false };
    const list = (Array.isArray(slots) ? slots : []).filter((x) => x !== 'notes');
    if (!list.length) { box.hidden = true; return { shown: false }; }
    const given = opts && Array.isArray(opts.results) ? opts.results : null;

    const rowsBox = $('setup-done-rows');
    const noteEl = $('setup-done-note');
    const actEl = $('setup-done-act');
    box.hidden = false;
    // **标题在测完之前是中性的。** 原来这里先写「可以用了」、等 Promise.all 全部落定
    // 之后才改口 —— 于是慢的那一项还在转、快的那一项已经 ✗ 时，屏幕上是「可以用了」
    // 压着一个红叉（2026-09-20 真机，挂了几十秒）。这正是这个文件开头那条规矩反过来犯：
    // 原话是「那种形状让失败看起来像什么都没发生」，那一版让**失败看起来像成功**。
    $('setup-done-title').textContent = given
      ? t('setup_done_title', '可以用了')
      : t('setup_done_checking', '正在检查…');
    rowsBox.textContent = '';
    noteEl.textContent = '';
    actEl.textContent = '';
    actEl.hidden = true;

    let allOk = true;
    // 第一个 ✗ 一落地就改口，不等别的项 —— 等下去的那段时间里标题说的是假话。
    const failNow = () => {
      allOk = false;
      $('setup-done-title').textContent = t('setup_done_failed_title', '还不能用');
    };

    if (given) {
      // 行由卡画了，这里只给结论 —— 同一件事不在同一屏上说两遍。
      if (given.some((r) => r && r.ok === false)) failNow();
    } else {
      const labels = SLOT_LABEL();
      const cells = {};
      for (const slot of list) cells[slot] = row(rowsBox, slot, labels);
      const s = await new Promise((res) => chrome.storage.local.get(null, (v) => res(v || {})));
      await Promise.all(list.map(async (slot) => {
        const cell = cells[slot];
        try {
          const r = await runSlot(slot, s);
          cell.className = 'qs-ok';
          cell.textContent = EngineTest.format(r, null, t);
        } catch (e) {
          failNow();
          cell.className = 'qs-no';
          cell.textContent = EngineTest.format(null, e, t);
        }
      }));
      if (allOk) $('setup-done-title').textContent = t('setup_done_title', '可以用了');
    }

    // **没通过就不说「可以用了」。** 失败时标题与话都换掉，出口是「回去改」而不是「回首页」。
    if (!allOk) {
      $('setup-done-title').textContent = t('setup_done_failed_title', '还不能用');
      noteEl.className = 'note w';
      noteEl.textContent = t('setup_done_failed', '上面标 ✗ 的那一项还没通。改完会自动再测一次。');
      return { shown: true, ok: false };
    }
    const nx = nextFor(from);
    noteEl.className = 'note';
    noteEl.textContent = nx.line;
    if (nx.btn) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'secondary';
      b.textContent = nx.btn.text;
      b.addEventListener('click', nx.btn.run);
      actEl.appendChild(b);
      actEl.hidden = false;
    }
    return { shown: true, ok: true };
  }

  function hide() { const box = $('setup-done'); if (box) box.hidden = true; }

  function wire(o) { hooks = o || {}; }

  const api = { mark, current, show, hide, wire, nextFor, FROMS };
  root.AppSetupDone = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
