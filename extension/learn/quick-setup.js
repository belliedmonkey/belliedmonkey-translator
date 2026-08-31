// learn/quick-setup.js — 「一把 key 配好全部」（QuickSetup）。
//
// 一个渲染器，两个 host：扩展设置页与扩展自己的首次运行引导。形状照 sources-view.js
// —— **它不碰 chrome.storage**。它算出一份 patch 交给 host，写盘属于 host。
//
// 这不是洁癖，是构成要件：options 的 saveAll() 是**整体覆盖式**的，DOM 才是真相源。
// 组件若自己写存储，用户下一次改任何一个字段（换个字号）就会用旧 DOM 把刚配好的
// 三组全部覆盖回去 —— 静默、立刻、100% 复现。
//
// ── 分组从 host 推导，不新增注册表字段 ────────────────────────────────────
//
// 「一把 key 覆盖哪些能力」已经在注册表里了：三个注册表的条目各带 defaultEndpoint，
// 同一个 host 就是同一把 key。今天的数据正反两向都成立 —— openrouter.ai 4 条、
// dashscope.aliyuncs.com 4 条各自一把 key 通吃；而 dashscope.aliyuncs.com 与
// dashscope-intl.aliyuncs.com 是同厂商**不同 host**，注册表明写「Qwen 的 key 是
// 分区域的」，host 不等 ⇒ key 不通用，推导恰好也对（moonshot.cn/.ai、
// bigmodel.cn/z.ai 同理）。
//
// 新增一个字段要动六处，其中 build.js 三个生成器的输出是 allowlist —— 漏了字段
// 永远到不了运行时**且没有任何测试会红**；而字段本身是 defaultEndpoint 的可推导
// 函数，就是 domain-design §7「单一注册表」要防的第二份副本。
//
// ⚠️ 代价说清楚：这是**推断不是声明**。厂商哪天在同一 host 上给翻译和语音发两把
// 不同的 key，推导会静默给出错误分组，今天没有门禁会红。platforms() 下面那条
// needsKey 一致性检查是唯一的缓解。

var QuickSetup = (() => {
  'use strict';

  const hostOf = (url) => (typeof WireFormat !== 'undefined'
    ? WireFormat.hostOf(url)
    : '');   // 没有 WireFormat 就没有 host 判定，宁可一个平台都不给，也不另写一份

  // 当前 flavor 的**生成物**，不是 build/*.config.js —— 后者是作者视角，用户手上的
  // 是这份已经按 flavor 滤过、按 flavor 解析过 label 与 defaultEndpoint 的表。
  // china 分支的 qwen 指向 dashscope.aliyuncs.com、global 分支指向 dashscope-intl，
  // 两者是否与 qwen_tts/qwen_asr 同 host，只有生成物知道。
  function registries(reg) {
    const w = (typeof window !== 'undefined') ? window : {};
    return {
      providers: (reg && reg.providers) || w.MT_PROVIDERS || [],
      tts: (reg && reg.tts) || w.MT_TTS_ENGINES || [],
      stt: (reg && reg.stt) || w.MT_STT_ENGINES || [],
    };
  }

  // 准入三条，缺一不可：
  //   1. 解得出 host —— requiresEndpoint 的条目（custom_chat / local tts / local stt）
  //      要用户自己填地址，「一把 key」对它们不成立。这个判据与
  //      test/perf-ledger.test.js:268 的豁免逐字相同，理由也相同：量不了一个还不
  //      存在的地址，也归不了一个还不存在的组。
  //   2. needsKey —— 不需要 key 的条目（google / browser TTS）不属于任何 key 组。
  //   3. 组必须三样齐全（见 platforms 末尾的 filter）。
  //
  // 注意这里**没有**再写一遍「什么算对话引擎」：providers 里同时满足「有 host」
  // 且「needsKey」的条目，今天全部是 chat-compat / messages-compat（google 被
  // needsKey 挡掉、custom_* 被 requiresEndpoint 挡掉）。多写一份 type 白名单就是
  // LearnNotes.chatEngines() 的第二份副本，而那正是它的注释在防的事。
  function eligible(e) {
    return !!e && e.needsKey === true && !e.requiresEndpoint && !!hostOf(e.defaultEndpoint || '');
  }

  function platforms(reg) {
    const r = registries(reg);
    // 有实测推荐的 host 排前面，其余按注册表顺序。
    //
    // 注册表顺序是**历史形成**的（先加进去的条目自然靠前），拿它当推荐序会让这张卡
    // 推荐一个我们从没为它跑过跨能力实测的平台，而官网教程推荐的是另一个。这份
    // 名单由 build.js 从 build/recommend.config.js 派生进生成物 —— 单一来源，
    // 且那张表已经有「每个 (平台, 能力) 必须有 default 轴」的门禁守着。
    const rec = (reg && reg.recommended)
      || (typeof window !== 'undefined' && window.MT_RECOMMENDED_HOSTS) || [];
    const order = [];
    const byHost = new Map();
    const take = (slot, e) => {
      if (!eligible(e)) return;
      const h = hostOf(e.defaultEndpoint);
      if (!byHost.has(h)) { byHost.set(h, { host: h, chat: [], tts: [], stt: [] }); order.push(h); }
      byHost.get(h)[slot].push(e);
    };
    for (const e of r.providers) take('chat', e);
    for (const e of r.tts) take('tts', e);
    for (const e of r.stt) take('stt', e);

    const rank = (h) => { const i = rec.indexOf(h); return i < 0 ? rec.length + order.indexOf(h) : i; };
    return order.slice().sort((a, b) => rank(a) - rank(b)).map((h) => byHost.get(h))
      // 三样齐全才算。只有 chat 的平台不进下拉：那一行的承诺（「一把 key 配好
      // 三样」）当场变假，而且它一点没省 —— 用现有的引擎卡配它操作数完全相同。
      .filter((g) => g.chat.length && g.tts.length && g.stt.length)
      .map((g) => ({
        host: g.host,
        // 同 host 多条时取**注册表第一条**：注册表顺序是作者维护的推荐序。
        // 落到实处的两个结果恰好都是对的 —— china 的 qwen 赢过 qwen_mt（后者是
        // 翻译专用模型，让它当组代表会顺带把「解析」也接到一个不做对话的模型上）；
        // openrouter_speech 赢过 openrouter_audio（专用语音端点，不是带音频输出
        // 的对话模型）。
        chat: g.chat[0], tts: g.tts[0], stt: g.stt[0],
        alt: { chat: g.chat.slice(1), tts: g.tts.slice(1), stt: g.stt.slice(1) },
      }));
  }

  // 「这个组里的条目 needsKey 必须一致」—— 推导法唯一的自检。不一致说明这个 host
  // 上不是一把 key 通吃，分组的前提已经不成立。
  function consistent(p) {
    return [p.chat, p.tts, p.stt].every((e) => e.needsKey === true);
  }

  const has = (v) => !!String(v == null ? '' : v).trim();

  // ── 「空」的判据 ─────────────────────────────────────────────────────
  // 每组各不相同，且必须与运行时判「这功能存不存在」的那个条件对齐。
  //
  //   翻译：非空 key 是「用户有意配过」的唯一无歧义证据。provider 不能当判据 ——
  //         'google' 来自 background.js 的 DEFAULT_SETTINGS，「选了 google」与
  //         「从没碰过」在存储里一模一样。
  //   朗读：同理。ttsEngine 缺省落到 browser，那是出厂值不是选择。
  //   转写：这一组不一样 —— '' 是 options.html 明确设计的哨兵（「未配置（不出说题）」），
  //         所以空 engine id 就是无歧义的「从没配过」。反过来，engine 已选而 key 为空
  //         的**半配**状态也算已配、不覆盖：录音去处是用户碰过的东西。
  function state(s) {
    s = s || {};
    return {
      chat: has(s.apiKey) ? 'configured' : 'empty',
      tts: has(s.ttsApiKey) ? 'configured' : 'empty',
      stt: String(s.sttEngine || '') ? 'configured' : 'empty',
    };
  }

  // plan({ platform, key, settings, pick }) → { writes, skipped, tests }
  //
  // `pick` 是「展开修改」里改过的值（模型 / 音色 / 换用同 host 的另一个条目），
  // 缺省即注册表默认。
  //
  // ⚠️ writes 的每个键都必须在 options.js 的 SETTINGS_KEYS 里 —— 不在里面的键
  // saveAll() 读不回来，下次任何字段变更就会把它清掉，静默且必然。
  // test/quick-setup.test.js 把这条做成了断言。
  function plan(input) {
    const p = input.platform;
    const key = String(input.key || '').trim();
    const s = input.settings || {};
    const pick = input.pick || {};
    const st = state(s);
    const writes = {};
    const skipped = [];
    const tests = [];

    if (!p || !key) return { writes, skipped, tests };

    const ttsEngine = pick.ttsEngine || p.tts.id;
    const sttEngine = pick.sttEngine || p.stt.id;

    // 端点 / 模型 / 音色写空是构成要件：留着上一个引擎的地址配新引擎的 key，正是
    // notes.js 明文禁止的「把 key 和一个不是发给它的端点配在一起」。空 = 走注册表
    // 默认 = 一个能工作的配置（wire-format 的两分支合同）。
    if (st.chat === 'empty') {
      writes.provider = pick.chatEngine || p.chat.id;
      writes.apiKey = key;
      writes.apiBaseUrl = '';
      writes.apiModel = pick.chatModel || '';
      tests.push('chat');
    } else {
      skipped.push({ slot: 'chat', reason: 'already', current: s.provider || '' });
    }

    if (st.tts === 'empty') {
      writes.ttsEngine = ttsEngine;
      writes.ttsApiKey = key;
      writes.ttsBaseUrl = '';
      writes.ttsModel = pick.ttsModel || '';
      writes.ttsVoice = pick.ttsVoice || '';
      // 不写 ttsMode，用户会看到上面说「朗读 ✓ 通了」而下面语音卡只剩一个「关闭」
      // 下拉 —— options.js 在 mode 为 off 时把整块 hidden。那是既有的坑，而这次
      // 会是**我们自己**造的。选 assist（显示原文、可点播放）而不是 audio-first
      // （隐藏原文）：一键配置永远不该改一个人怎么学习。
      if (!s.ttsMode || s.ttsMode === 'off') writes.ttsMode = 'assist';
      // ttsAutoPlay 的缺省是 true（options.js 读的是 `!== false`）。assist + 自动
      // 播放 = 每进一张卡自动合成一次 = 持续扣费。用户同意的是「配好并测一次」。
      // 只在从没设过时写 —— 与「只填空」同一条判据。
      if (s.ttsAutoPlay === undefined) writes.ttsAutoPlay = false;
      tests.push('tts');
    } else {
      skipped.push({ slot: 'tts', reason: 'already', current: s.ttsEngine || '' });
    }

    if (st.stt === 'empty') {
      writes.sttEngine = sttEngine;
      writes.sttApiKey = key;
      writes.sttBaseUrl = '';
      writes.sttModel = pick.sttModel || '';
      tests.push('stt');
    } else {
      skipped.push({ slot: 'stt', reason: 'already', current: s.sttEngine || '' });
    }

    // 解析（notes）**一个键都不写**。notesProvider === '' 的语义是「整组跟随翻译
    // 引擎」（LearnNotes.resolveConfig 持有那条规则），那已经是正确且经过设计的
    // 默认。写 notesProvider 会永久打断 follow 关系：用户以后换翻译引擎，解析会
    // 留在这个平台上。结果区仍要**显式说出来**，不说它看起来就像被漏了。

    return { writes, skipped, tests };
  }

  // summarize(results) → { done, failed, ok }
  // results: [{ slot, ok, error? }]
  function summarize(results) {
    const list = results || [];
    const failed = list.filter((r) => !r.ok).map((r) => r.slot);
    return { done: list.filter((r) => r.ok).length, failed, ok: failed.length === 0 };
  }


  // ── 渲染 ─────────────────────────────────────────────────────────────
  // 只渲染。onApply(plan) 由 host 实现，因为写盘属于 host（见文件头）。
  // 所有 id 加 qs- 前缀：App 构建对 id 冲突是硬失败。

  const STYLE = `
    .qs-wrap { display:flex; flex-direction:column; gap:10px; }
    .qs-sub { font-size:.9em; opacity:.75; margin:0; }
    .qs-privacy { font-size:.85em; opacity:.8; margin:0; }
    .qs-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .qs-row label { flex:0 0 auto; font-size:.85em; opacity:.75; min-width:3em; }
    .qs-row input, .qs-row select { flex:1 1 8em; min-width:0; }
    .qs-res { display:flex; flex-direction:column; gap:6px; margin:0; padding:0; list-style:none; }
    .qs-res li { font-size:.9em; line-height:1.5; white-space:pre-wrap; }
    .qs-res .qs-name { font-weight:600; }
    .qs-ok { color:var(--sage-text, #2f6b4f); }
    .qs-bad { color:var(--danger, #c0392b); }
    .qs-idle { opacity:.6; }
    .qs-res button { font-size:.8em; padding:2px 8px; width:auto; margin:0 0 0 6px; }
  `;
  let styled = false;
  function injectStyle(doc) {
    if (styled || !doc) return;
    const el = doc.createElement('style'); el.textContent = STYLE; doc.head.appendChild(el);
    styled = true;
  }

  const SLOTS = ['chat', 'tts', 'stt'];
  const SLOT_LABEL = {
    chat: ['qs_slot_chat', '翻译'], tts: ['qs_slot_tts', '朗读'], stt: ['qs_slot_stt', '转写'],
  };

  function render(box, opts) {
    const t = opts.t;
    const doc = box.ownerDocument;
    injectStyle(doc);
    box.textContent = '';

    const list = platforms();
    if (!list.length) { box.hidden = true; return; }   // 空壳不留
    box.hidden = false;

    const el = (tag, cls, txt) => {
      const n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (txt != null) n.textContent = txt;
      return n;
    };
    const wrap = el('div', 'qs-wrap');

    wrap.append(el('p', 'qs-sub', t('qs_sub',
      '下面这些平台，一把 key 能同时配好翻译、朗读、转写。其它引擎请在各自的卡片里单独配置。')));

    // 只有一项时不渲染 <select> —— 一个只有一个选项的下拉是在假装有选择。
    let current = list[0];
    if (list.length > 1) {
      const row = el('div', 'qs-row');
      row.append(el('label', null, t('qs_platform', '平台')));
      const sel = el('select'); sel.id = 'qs-platform';
      list.forEach((p, i) => {
        const o = doc.createElement('option');
        o.value = String(i);
        o.textContent = labelOf(p.chat, t) + ' · ' + p.host;
        sel.append(o);
      });
      sel.addEventListener('change', () => { current = list[Number(sel.value)] || list[0]; paintPicks(); });
      row.append(sel); wrap.append(row);
    } else {
      wrap.append(el('p', 'qs-sub', t('qs_only_one', '可用平台：{p}').replace('{p}',
        labelOf(current.chat, t) + ' · ' + current.host)));
    }

    const keyRow = el('div', 'qs-row');
    keyRow.append(el('label', null, t('qs_key', 'API Key')));
    const key = doc.createElement('input');
    key.id = 'qs-key'; key.type = 'password'; key.autocomplete = 'off';
    key.placeholder = t('qs_key_ph', '粘贴一次，三样一起配好');
    keyRow.append(key); wrap.append(keyRow);

    // 展开修改：收起时只是一行摘要，展开后可在**按下按钮之前**换模型与音色。
    const more = doc.createElement('details'); more.id = 'qs-more';
    const sum = doc.createElement('summary');
    sum.textContent = t('qs_more', '改一改用哪个模型');
    more.append(sum);
    const picks = {};
    const picksBox = el('div', 'qs-wrap');
    more.append(picksBox);
    wrap.append(more);

    function paintPicks() {
      picksBox.textContent = '';
      for (const slot of SLOTS) {
        const chosen = current[slot];
        const alts = [chosen].concat(current.alt[slot] || []);
        const row = el('div', 'qs-row');
        row.append(el('label', null, t(SLOT_LABEL[slot][0], SLOT_LABEL[slot][1])));
        if (alts.length > 1) {
          const s2 = doc.createElement('select');
          alts.forEach((e) => {
            const o = doc.createElement('option'); o.value = e.id; o.textContent = labelOf(e, t); s2.append(o);
          });
          s2.addEventListener('change', () => { picks[slot + 'Engine'] = s2.value; });
          row.append(s2);
        } else {
          row.append(el('span', null, labelOf(chosen, t)));
        }
        const m = doc.createElement('input');
        m.type = 'text'; m.placeholder = chosen.defaultModel || '';
        m.addEventListener('input', () => { picks[slot + 'Model'] = m.value.trim(); });
        row.append(m);
        picksBox.append(row);
      }
      privacy.textContent = t('qs_privacy',
        '转写会把你的**录音**发到 {host} 识别，识别完立即丢弃，不存储也不同步。')
        .replace('{host}', current.host).replace(/\*\*/g, '');
    }

    // 常显、不可折叠。「录音去哪儿必须是一次显式选择」这条裁定的落点从一个复选框
    // 挪到了这里 —— 按下之前就看得见的一句话，加上一个点名三样的按钮。
    const privacy = el('p', 'qs-privacy');
    wrap.append(privacy);

    const btn = doc.createElement('button');
    btn.id = 'qs-apply'; btn.type = 'button';
    btn.textContent = t('qs_apply', '配好翻译、朗读、转写');
    wrap.append(btn);

    const res = el('ul', 'qs-res'); res.id = 'qs-res'; res.hidden = true;
    wrap.append(res);

    if (opts.disabled) { btn.disabled = true; key.disabled = true; }
    paintPicks();
    box.append(wrap);

    btn.addEventListener('click', async () => {
      const k = key.value.trim();
      if (!k) { key.focus(); return; }
      const p = plan({ platform: current, key: k, settings: opts.settings || {}, pick: picks });
      btn.disabled = true;
      // 四行**在按下那一刻就存在**，不是「成功后才冒出来的绿框」—— 那种形状让失败
      // 看起来像什么都没发生。
      res.hidden = false;
      const rows = {};
      res.textContent = '';
      for (const slot of SLOTS) {
        const li = doc.createElement('li');
        const nm = el('span', 'qs-name', t(SLOT_LABEL[slot][0], SLOT_LABEL[slot][1]) + '：');
        const val = el('span', 'qs-idle', t('qs_testing', '测试中…'));
        li.append(nm, val); res.append(li); rows[slot] = val;
      }
      // 解析那一行恒定出现。不出现，它看起来就像被漏了。
      const nli = doc.createElement('li');
      nli.append(el('span', 'qs-name', t('qs_slot_notes', '解析') + '：'),
        el('span', 'qs-idle', t('qs_notes_follow', '跟随翻译引擎（未改动）')));
      res.append(nli);

      for (const sk of p.skipped) {
        rows[sk.slot].className = 'qs-idle';
        rows[sk.slot].textContent = t('qs_untouched', '— 没动 · 你已经配过了（{cur}）')
          .replace('{cur}', sk.current || t('qs_unknown', '已有配置'));
      }

      try { await opts.onApply(p); } catch (e) {
        for (const slot of p.tests) {
          rows[slot].className = 'qs-bad';
          rows[slot].textContent = '✗ ' + ((e && e.message) || 'save failed');
        }
        btn.disabled = false;
        return;
      }

      await Promise.all(p.tests.map((slot) => runOne(slot, p, current, rows[slot], t, doc)));
      btn.disabled = false;
    });
  }

  function labelOf(e, t) {
    return e.labelKey ? t(e.labelKey, e.label || e.id) : (e.label || e.id);
  }

  // 三条各自独立成败。失败**不回滚** —— 最常见的原因（key 少粘一位、限流、模型
  // 下架）恰恰重试就过；回滚只会浪费掉用户已经付出的那次粘贴。
  async function runOne(slot, p, platform, cell, t, doc) {
    const w = p.writes;
    const run = () => {
      if (slot === 'chat') {
        return EngineTest.translation({
          provider: w.provider, apiKey: w.apiKey, baseUrl: w.apiBaseUrl, model: w.apiModel,
          targetLang: (typeof window !== 'undefined' && window.__mtTargetLang) || 'zh-CN',
        });
      }
      if (slot === 'tts') {
        return EngineTest.tts({ engineId: w.ttsEngine, apiKey: w.ttsApiKey, baseUrl: w.ttsBaseUrl, model: w.ttsModel, voice: w.ttsVoice });
      }
      return EngineTest.stt({ engineId: w.sttEngine, apiKey: w.sttApiKey, baseUrl: w.sttBaseUrl, model: w.sttModel });
    };
    cell.className = 'qs-idle';
    cell.textContent = t('qs_testing', '测试中…');
    try {
      const r = await run();
      cell.className = 'qs-ok';
      cell.textContent = EngineTest.format(r, null, t)
        // 三条测试都不覆盖**播放**（自动播放策略、编解码、音量）。这道缝要点名，
        // 而不是让用户以为朗读整条都验过了。
        + (slot === 'tts' ? '\n' + t('qs_tts_untried', '（还没试听 —— 到下面的〈语音〉卡点「试听一句」听一次）') : '');
      return { slot, ok: true };
    } catch (e) {
      cell.className = 'qs-bad';
      cell.textContent = EngineTest.format(null, e, t)
        // 用户在隐私敏感项失败时的第一个念头就是「有东西已经发出去了吗」。
        + (slot === 'stt' ? '\n' + t('qs_stt_failed_note',
          '录音功能不会因此打开。刚才发出去的是一段 0.6 秒的正弦音，不是你的声音。') : '');
      const again = doc.createElement('button');
      again.type = 'button';
      again.textContent = t('qs_retry', '重试这一项');
      // 只重测，不重写 —— 配置已经保存了。
      again.addEventListener('click', () => { again.remove(); runOne(slot, p, platform, cell, t, doc); });
      cell.parentNode.append(again);
      return { slot, ok: false };
    }
  }

  return { platforms, plan, summarize, state, consistent, render, _eligible: eligible };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = QuickSetup;
