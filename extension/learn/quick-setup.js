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
      }));
  }

  // 「这个组里的条目 needsKey 必须一致」—— 推导法唯一的自检。不一致说明这个 host
  // 上不是一把 key 通吃，分组的前提已经不成立。
  function consistent(p) {
    return [p.chat, p.tts, p.stt].every((e) => e.needsKey === true);
  }

  // 官网地址的**唯一**来源。原先只写在 onboard.js 的「现在翻一页看看」那一步里；
  // 设置页也要用，与其抄第二份 flavor→域名 的映射，不如把它放在两个 host 都加载
  // 的这个文件里。content script 不在 chrome-extension:// 上跑，所以「去试一下」
  // 必须落到一个真的 http(s) 页面 —— 官网那一页正是为此存在的（它检测到扩展会自己
  // 亮绿灯，并露出一段可翻的英文）。
  function siteUrl(path) {
    const flavor = (typeof window !== 'undefined' && window.MT_FLAVOR) || 'global';
    return 'https://' + (flavor === 'china' ? 'belliedmonkey.com' : 'belliedmonkey.cc') + (path || '/');
  }

  // 「现在翻一页看看」的落点。**按目标语言分页** —— 示例段落的价值在于「这段你读不顺，
  // 翻一下就顺了」，而把目标语言设成 English 的人打开一页英文示例，看到的是英文翻英文，
  // 什么都证明不了（2026-09-01 用户在真机上走到这一步时提的）。
  //
  // 页面由 scripts/gen-try-pages.js 从 build/try-pages.config.js 生成，目标语言全集
  // 与设置页那个下拉逐条一致（test/try-pages.test.js 钉住）。
  // 认不出的目标语言**回落 setup.html** —— 那一页永远存在，落一个 404 比落一页
  // 语言不对的示例更糟。
  const TRY_LANGS = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ar', 'pt', 'ru', 'it'];
  function tryUrl(targetLang) {
    let l = String(targetLang || '').trim();
    // **没值 ≠ 认不出。** 存储里没有 targetLang 的人（全新安装、或刚清过本机数据）
    // 翻译时走的是默认目标语言，所以试翻页也该走同一个 —— 原来这里跟「认不出的语言」
    // 混成一支，一起回落 setup.html，于是清完数据的人点「打开示例页面」又回到了那一页。
    // 2026-09-01 真机上实测到的。
    // 默认值从生成的注册表拿：设置页与引导页**都不加载 translation-core.js**，
    // 在那里读 TranslationCore.DEFAULT_TARGET_LANG 是空转（第一版就是这么写的）。
    if (!l) l = (typeof window !== 'undefined' && window.MT_DEFAULT_TARGET_LANG) || '';
    // 认不出的语言才回落。那一页永远存在，落一个 404 比落一页语言不对的示例更糟。
    return TRY_LANGS.indexOf(l) >= 0 ? siteUrl('/try/' + l + '.html') : siteUrl('/setup.html');
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

  // 「这份已存的配置，一键卡表示得了吗」——纯函数，给 host 决定默认落在哪个 tab。
  //
  // 一键卡能表示的只有一种形状：翻译引擎是某个一键平台的代表条目，且那把 key 非空。
  // 拿 DeepSeek（不在任何一键平台里）配好的人，快速视图**没有一个控件能显示他的配置**
  // —— 把他丢在那一页，等于让他对着一张空卡猜自己配没配过。
  //
  // 判据只看翻译那一路：朗读/转写用别的平台是常见且合理的（一键卡自己也允许你只配
  // 其中一样），不该因此把人赶去详细页。
  function represents(settings, reg) {
    const s = settings || {};
    if (!has(s.apiKey)) return null;                 // 没配过 ⇒ 谈不上表示不表示
    // 归一化之后再比：存值跨 flavor 时，同一页在别处早就迁移过了（options.js 的
    // `providerById(s.provider) ? s.provider : defaultProviderId()`），这里读迁移前的
    // 原值，会把一个 key 有效、引擎也有效的人推到「详细」去。
    const id = (typeof EngineState !== 'undefined') ? EngineState.resolve(s.provider) : s.provider;
    return platforms(reg).find((p) => p.chat.id === id) || null;
  }

  // plan({ platform, key, settings }) → { writes, skipped, tests }
  //
  // **没有「用哪个模型」这个入参。** 一键配置写的永远是注册表默认 —— 那正是
  // recommend.config.js 里有实测依据的那一个。卡里原本有一个「改一改用哪个模型」的
  // 折叠，2026-08-31 去掉了：它与下面那个（同样折叠着的）手动引擎配置重复，而一张
  // 承诺「最少操作」的卡里放一个模型选择器，本身就在跟这个承诺打架。改模型的路
  // 一条都没少 —— 设置页的详细配置里三样各有各的字段。
  //
  // ⚠️ writes 的每个键都必须在 options.js 的 SETTINGS_KEYS 里 —— 不在里面的键
  // saveAll() 读不回来，下次任何字段变更就会把它清掉，静默且必然。
  // test/quick-setup.test.js 把这条做成了断言。
  function plan(input) {
    const p = input.platform;
    const key = String(input.key || '').trim();
    const s = input.settings || {};
    const st = state(s);
    const writes = {};
    const skipped = [];
    const tests = [];

    if (!p || !key) return { writes, skipped, tests };

    const ttsEngine = p.tts.id;
    const sttEngine = p.stt.id;

    // 端点 / 模型 / 音色写空是构成要件：留着上一个引擎的地址配新引擎的 key，正是
    // notes.js 明文禁止的「把 key 和一个不是发给它的端点配在一起」。空 = 走注册表
    // 默认 = 一个能工作的配置（wire-format 的两分支合同）。
    if (st.chat === 'empty') {
      writes.provider = p.chat.id;
      writes.apiKey = key;
      writes.apiBaseUrl = '';
      writes.apiModel = '';
      tests.push('chat');
    } else {
      skipped.push({ slot: 'chat', reason: 'already', current: s.provider || '' });
    }

    if (st.tts === 'empty') {
      writes.ttsEngine = ttsEngine;
      writes.ttsApiKey = key;
      writes.ttsBaseUrl = '';
      writes.ttsModel = '';
      writes.ttsVoice = '';
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
      writes.sttModel = '';
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
    .qs-key-link { font-size:.85em; margin:0; }
    .qs-try { margin-top:4px; }
    .qs-try-note { font-size:.85em; opacity:.8; margin:0; }
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
  // 写成函数而不是 [key, 兜底串] 的表：兜底串放在数据结构里，
  // test/no-hardcoded-copy.test.js 认不出它是兜底位。而那条门禁曾经**看不见这一段**
  // （quick-setup.js 有 310 行被一个假块注释吞掉了，2026-08-31 修好扫描器后才露出来），
  // 所以这份写法一直没被拦过。
  const slotLabel = (slot, t) => (slot === 'chat' ? t('qs_slot_chat', '翻译')
    : slot === 'tts' ? t('qs_slot_tts', '朗读')
      : t('qs_slot_stt', '转写'));

  // 只在**翻译这一路真的通了**的时候给出口。翻译没通却请人去翻一页，是把失败推迟到
  // 一个更难解释的地方发生。没测翻译（因为早就配过了）也算通 —— 那种情况下用户本来
  // 就在用它。
  //
  // 单独具名，是因为它是 render() 里唯一一处真正的判断，而 render() 需要 DOM、跑不进
  // 纯逻辑套件；留在闭包里等于这个分支只有真机看得见。
  function tryVisible(tests, results) {
    if (!Array.isArray(tests) || !tests.includes('chat')) return true;
    return (results || []).some((r) => r && r.slot === 'chat' && r.ok === true);
  }

  function render(box, opts) {
    const t = opts.t;
    const doc = box.ownerDocument;
    injectStyle(doc);
    box.textContent = '';

    const list = platforms();
    if (!list.length) { box.hidden = true; return; }   // 空壳不留
    box.hidden = false;

    // 已经配过的，回显出来。空着的输入框在一个**已经配好**的页面上是假话：它看起来
    // 像「你还没配」，而用户此刻能做的唯一动作（粘一把新 key）会覆盖掉现有配置。
    // prefill 由 host 算好传进来（组件不碰存储）。
    const pre = opts.prefill || null;

    const el = (tag, cls, txt) => {
      const n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (txt != null) n.textContent = txt;
      return n;
    };
    const wrap = el('div', 'qs-wrap');

    // 副标题可由 host 覆盖。默认那句写的是「其它引擎请在各自的卡片里单独配置」——
    // 那在设置页上是真的（引擎/语音/学习各有一张卡），在引导页上不是：那里没有别的
    // 卡片，只有一个「手动填」的展开。一句指向不存在地方的说明比没有说明更糟。
    wrap.append(el('p', 'qs-sub', opts.sub || t('qs_sub',
      '下面这些平台，一把 key 能同时配好翻译、朗读、转写。其它引擎请在各自的卡片里单独配置。')));

    // 只有一项时不渲染 <select> —— 一个只有一个选项的下拉是在假装有选择。
    let current = (pre && pre.host && list.find((p) => p.host === pre.host)) || list[0];
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
      sel.value = String(list.indexOf(current));
      sel.addEventListener('change', () => { current = list[Number(sel.value)] || list[0]; paintPlatform(); });
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
    if (pre && pre.key) key.value = pre.key;
    keyRow.append(key); wrap.append(keyRow);

    // 「我还没有 key」是这张卡最常见的断点 —— 卡在这一步，前面省下的二十几次点击
    // 一次都用不上。地址由注册表给（keyUrl），**不在这里写死**：同一条规则挡的是
    // defaultEndpoint 的第二份副本，地址类的事实一律归注册表。没有 keyUrl 的平台
    // 就不显示这一行（隐藏而不是显示一个死链）。
    const keyLink = el('a', 'qs-key-link');
    keyLink.id = 'qs-key-link';
    keyLink.target = '_blank'; keyLink.rel = 'noopener noreferrer';
    wrap.append(keyLink);

    // 这张卡里**没有**模型选择器。原本有一个「改一改用哪个模型」的折叠，
    // 2026-08-31 去掉：它与下面那个（同样折叠着的）手动引擎配置重复，而一张承诺
    // 「最少操作」的卡里放一个模型选择器，本身就在跟这个承诺打架。写进去的永远是
    // 注册表默认 —— 那正是 recommend.config.js 里有实测依据的那一个。改模型的路
    // 一条都没少：设置页的详细配置里三样各有各的字段。
    //
    // 下面这个函数只重画**跟着平台变**的两处（申请入口、隐私那句），换平台时调用。
    function paintPlatform() {
      const ku = (current.chat && current.chat.keyUrl) || '';
      keyLink.hidden = !ku;
      if (ku) {
        keyLink.href = ku;
        keyLink.textContent = t('qs_get_key', '还没有 key？去 {p} 申请 ↗')
          .replace('{p}', labelOf(current.chat, t));
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

    // 三行绿勾之后，这张卡原本就到此为止了 —— 用户配好了，然后停在一个设置页上，
    // 没有任何东西告诉他下一步该干什么。翻译是在**网页**上发生的，而设置页不是网页
    // （content script 不在 chrome-extension:// 上跑），所以「去用」必须是一次真正的
    // 跳转，不能只写一句说明。
    //
    // opts.showTry 由 host 决定：引导页自己有「现在翻一页看看」那一屏，在那里再来
    // 一个同义按钮是重复。默认不显示 —— 忘了传的 host 拿到的是今天的行为，不是一个
    // 半成品出口。
    const tryNote = el('p', 'qs-try-note'); tryNote.hidden = true;
    const tryBtn = doc.createElement('button');
    tryBtn.id = 'qs-try'; tryBtn.type = 'button'; tryBtn.className = 'qs-try'; tryBtn.hidden = true;
    tryBtn.textContent = t('qs_try', '现在翻一页看看');
    tryNote.textContent = t('qs_try_note',
      '打开一页真实网页，点右下角的悬浮按钮，原文下面就会出现译文。');
    tryBtn.addEventListener('click', () => {
      try { window.open(tryUrl(opts.targetLang), '_blank', 'noopener'); } catch (_) {}
    });
    wrap.append(tryNote, tryBtn);

    if (opts.disabled) { btn.disabled = true; key.disabled = true; }
    paintPlatform();
    box.append(wrap);

    btn.addEventListener('click', async () => {
      const k = key.value.trim();
      if (!k) { key.focus(); return; }
      // **点下去那一刻才读设置。** 原来这里用的是 render 时传进来的快照，而那份快照
      // 在 options 上是页面加载时读的、之后永不更新（s0）。后果不是显示不对，是丢数据：
      // 用户在「详细」里敲了 key → 点这个按钮 → state() 按旧快照判「没配过」→ 覆盖那把
      // key，还报「✓ 通了」。反向亦然（清空了 key 却说「没动 · 你已经配过了」）。
      //
      // 现读一次就把这一整类关掉：跨标签、跨模式、重复点击全覆盖，不需要任何事件监听。
      // 读失败**什么都不写** —— 一个读不出设置的时刻不该被当成「用户没配过」。
      let cur = opts.settings || {};
      if (typeof opts.readSettings === 'function') {
        const r = await opts.readSettings();
        if (!r || r.ok === false) {
          btn.disabled = false;
          res.hidden = false;
          res.textContent = '';
          const li = doc.createElement('li');
          li.append(el('span', 'qs-bad', t('settings_read_failed_short',
            '读不到已保存的设置，请稍后再试')));
          res.append(li);
          return;
        }
        cur = r.data || {};
      }
      const p = plan({ platform: current, key: k, settings: cur });
      btn.disabled = true;
      // 四行**在按下那一刻就存在**，不是「成功后才冒出来的绿框」—— 那种形状让失败
      // 看起来像什么都没发生。
      res.hidden = false;
      const rows = {};
      res.textContent = '';
      for (const slot of SLOTS) {
        const li = doc.createElement('li');
        const nm = el('span', 'qs-name', slotLabel(slot, t) + '：');
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

      const results = await Promise.all(p.tests.map((slot) =>
        runOne(slot, p, current, rows[slot], t, doc, opts.targetLang)));
      btn.disabled = false;

      // 只在**翻译这一路真的通了**的时候给出口。翻译没通却请人去翻一页，是把失败
      // 推迟到一个更难解释的地方发生。没测翻译（因为早就配过了）也算通 —— 那种情况
      // 下用户本来就在用。
      const show = !!opts.showTry && tryVisible(p.tests, results);
      tryNote.hidden = !show;
      tryBtn.hidden = !show;
    });
  }

  function labelOf(e, t) {
    return e.labelKey ? t(e.labelKey, e.label || e.id) : (e.label || e.id);
  }

  // 三条各自独立成败。失败**不回滚** —— 最常见的原因（key 少粘一位、限流、模型
  // 下架）恰恰重试就过；回滚只会浪费掉用户已经付出的那次粘贴。
  // targetLang 是**参数**，不是从外层闭包读的。runOne 在 render 外面，`opts` 在这里
  // 根本不存在 —— 而它被 try/catch 包着，于是 ReferenceError 被印成了一行错误文案
  // 「✗ opts is not defined」，看上去像是 key 或网络出了问题（2026-09-02 用户报的）。
  async function runOne(slot, p, platform, cell, t, doc, targetLang) {
    const w = p.writes;
    const run = () => {
      if (slot === 'chat') {
        return EngineTest.translation({
          provider: w.provider, apiKey: w.apiKey, baseUrl: w.apiBaseUrl, model: w.apiModel,
          // 调用方传进来的目标语言。原来读 window.__mtTargetLang —— 那个全局**全仓
          // 没有任何一处赋值**，所以自检永远测 zh-CN。缺省仍回落到默认目标语言，
          // 但那是「调用方没传」的兜底，不是唯一的路。
          targetLang: targetLang
            || (typeof window !== 'undefined' && window.MT_DEFAULT_TARGET_LANG) || 'zh-CN',
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
      again.addEventListener('click', () => {
        again.remove(); runOne(slot, p, platform, cell, t, doc, targetLang);
      });
      cell.parentNode.append(again);
      return { slot, ok: false };
    }
  }

  return { platforms, plan, summarize, state, represents, consistent, render, siteUrl, tryUrl, TRY_LANGS, tryVisible, _eligible: eligible };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = QuickSetup;
