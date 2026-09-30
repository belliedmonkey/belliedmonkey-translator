// shared/quick-setup.js — 「一把 key 配好全部」（QuickSetup）的**纯逻辑层**（PR7b 起）。
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
//
// PR7b：原 extension/learn/quick-setup.js 收编为 ESM。渲染半边（render / runOne /
// slotLabel / 样式）在 src/shared/quick-setup-view.jsx；本文件只剩纯函数 —— vm 单测
// 直接 loadSrc 本文件，不需要 DOM。window.MT_* 的读口一律走 lib/registry.js
// （src-boundaries 门禁）；reg 覆盖参数保留（grant.plan 与旧测试都从它过）。

import Registry from '../lib/registry.js';

const hostOf = (url) => (typeof WireFormat !== 'undefined'
  ? WireFormat.hostOf(url)
  : '');   // 没有 WireFormat 就没有 host 判定，宁可一个平台都不给，也不另写一份

// 当前 flavor 的**生成物**，不是 build/*.config.js —— 后者是作者视角，用户手上的
// 是这份已经按 flavor 滤过、按 flavor 解析过 label 与 defaultEndpoint 的表。
// china 分支的 qwen 指向 dashscope.aliyuncs.com、global 分支指向 dashscope-intl，
// 两者是否与 qwen_tts/qwen_asr 同 host，只有生成物知道。
function registries(reg) {
  return {
    providers: (reg && reg.providers) || Registry.providers(),
    tts: (reg && reg.tts) || Registry.ttsEngines(),
    stt: (reg && reg.stt) || Registry.sttEngines(),
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
  // `grantOnly` 的条目（免费额度的中继，§8.10）**不是一个用户可以选的平台**：
  // 它没有可粘的 key —— 令牌是登录之后系统发的。放进这张卡里，用户会看到一个
  // 「把 key 粘进来」的输入框，而正确的动作是点「领取」。同理它也不该进任何下拉。
  // 少了这一条，一键配置会凭空多出第三个平台，而它一次都配不成功。
  if (e && e.grantOnly) return false;
  return !!e && e.needsKey === true && !e.requiresEndpoint && !!hostOf(e.defaultEndpoint || '');
}

// 自定义平台（#421 方案 C，2026-09-24，画布 9eu7Ysbss9WQ9NJCoEWPMS）。
//
// 它进不了下面那套推导，而且**两条都不成立**：没有 host（地址要用户自己填），
// 也没有配套的朗读 / 转写。把它挡在外面本来是对的 —— 直到发现代价：手里有一个
// 能用的兼容地址（自建网关、公司内网）的人，在这张卡上**无路可走**（#421：国际版
// 那两个平台在某些网络位置下一个直连打不开、一个默认模型被按地区 403）。
// ⚠️ 这段注释会原样进中国版产物，别在这里写厂商名（build/china-gate.js 会红）。
//
// 所以它单独加在**最后一项**，并且只承诺它真能做到的那一样：翻译。按钮文案、
// 隐私那句、结果行都跟着变 —— 一张说「一把 key 配好三样」的卡，配一样就得说一样。
// 条目本身从注册表找，**不写死 id**：判据是「要自己填地址的那条对话引擎」。
function customPlatform(reg) {
  const r = registries(reg);
  const e = (r.providers || []).find((x) => x && x.requiresEndpoint && x.needsKey === true
    && !x.grantOnly && (x.type === 'chat-compat' || x.type === 'messages-compat'));
  return e ? { host: '', custom: true, chat: e, tts: null, stt: null } : null;
}

function platforms(reg) {
  const r = registries(reg);
  // 有实测推荐的 host 排前面，其余按注册表顺序。
  //
  // 注册表顺序是**历史形成**的（先加进去的条目自然靠前），拿它当推荐序会让这张卡
  // 推荐一个我们从没为它跑过跨能力实测的平台，而官网教程推荐的是另一个。这份
  // 名单由 build.js 从 build/recommend.config.js 派生进生成物 —— 单一来源，
  // 且那张表已经有「每个 (平台, 能力) 必须有 default 轴」的门禁守着。
  const rec = (reg && reg.recommended) || Registry.recommendedHosts();
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
    }))
    .concat(customPlatform(reg) ? [customPlatform(reg)] : []);
}
// 2026-09-11 → 09-17 这里曾有「实时转写（可选）」一格：平台自身没有实时接口时另配一把
// 实时引擎的 key，填了就把转写槽整个换成那一家。实时转写自 2026-09-17 起固定为设备内置
// （learning-design §9.6 门控修订），注册表里没有 live* 字段，这一格连同 hasLive / liveFor
// 一起删除 —— 转写槽从此只表示「整段录音去哪儿」。

// 「这个组里的条目 needsKey 必须一致」—— 推导法唯一的自检。不一致说明这个 host
// 上不是一把 key 通吃，分组的前提已经不成立。
function consistent(p) {
  // 自定义组只有 chat（#421 C）—— 「一把 key 通吃三样」这条前提对它本来就不成立，
  // 它承诺的也只有翻译一样。自检退回到「它自己那一条要 key」。
  if (p && p.custom) return !!p.chat && p.chat.needsKey === true;
  return [p.chat, p.tts, p.stt].every((e) => e.needsKey === true);
}

// 官网地址的**唯一**来源。原先只写在 onboard.js 的「现在翻一页看看」那一步里；
// 设置页也要用，与其抄第二份 flavor→域名 的映射，不如把它放在两个 host 都加载
// 的这个文件里。content script 不在 chrome-extension:// 上跑，所以「去试一下」
// 必须落到一个真的 http(s) 页面 —— 官网那一页正是为此存在的（它检测到扩展会自己
// 亮绿灯，并露出一段可翻的英文）。
function siteUrl(path) {
  const flavor = Registry.flavor() || 'global';
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
  if (!l) l = Registry.defaultTargetLang();
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
//
// 2026-09-30（§8.10.3，issue #513）：chat 的占用判据**保持**「key 非空」，不改。
// 改过一版（provider 解析不出来就算「没配」），被 test/grant.test.js 拦下：
// **空 provider 是能用的配置**（走注册表默认；老安装里 provider 常常就是空的），
// 判它「没配」会让额度覆盖掉用户自己那把 key —— 那正是「绝不静默换掉别人的 key」
// 这条门禁守的东西。于是这次只改两处：去掉 shell-model 的守卫、让回执说真话
// （grantToast：chat 槽没被写就不许说「配好」）。
function state(s, reg) {
  s = s || {};
  const sttId = String(s.sttEngine || '');
  return {
    chat: has(s.apiKey) ? 'configured' : 'empty',
    tts: has(s.ttsApiKey) ? 'configured' : 'empty',
    stt: sttId ? 'configured' : 'empty',
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
// 尾八位。用它判「这一槽里装的是不是我们上次发的那枚令牌」——
// **只存尾八位**，因为判定不需要更多，而内容脚本里少一份完整凭证就少一处泄漏面。
function tailOf(v) { const x = String(v == null ? '' : v).trim(); return x ? x.slice(-8) : ''; }

function plan(input) {
  const p = input.platform;
  const key = String(input.key || '').trim();
  const s = input.settings || {};
  // ── 两个只给免费额度用的参数（§8.10）────────────────────────────────
  //
  // `pinModel`：写注册表默认模型，而不是留空。留空的语义是「走注册表默认」，
  //   对自带 key 是对的；但中继**按模型白名单放行**，而用户可能在「详细」里
  //   改过 apiModel —— 那时留空不会覆盖它，下一次请求就撞 403 model_not_allowed。
  //   把模型显式写进去，是让「领取」这个动作真的把配置带到可用状态。
  //
  // `replaceKeyTail`：尾八位命中的槽视为**可覆盖**。免费额度会重领（换设备、
  //   退出再登录），那时槽里装的是上一枚令牌 —— 它不是用户自己配的东西，
  //   拿新的盖掉是对的。而**别人自己粘的 key 一个字节都不许动**，所以判据是
  //   尾号命中，不是「反正是我们写的」。被覆盖的槽走 replaced 而不是 skipped，
  //   界面要如实说「替换了免费额度的 key」，不能假装是新配的。
  const pinModel = !!input.pinModel;
  const replaceTail = tailOf(input.replaceKeyTail);
  // `overwrite`：三槽**无论装着什么**都盖掉。只给「改回免费额度」用 —— 那个按钮的
  //   语义就是「替换掉我现在填的 key」，而且宿主在调用前已经弹过确认。2026-09-10
  //   用户实测：三槽都有自己的 key 时，领取一个字节都没写却弹「已配好」，而「改回」
  //   走同一条不覆盖的路，点了永远换不回来 —— 一个死按钮。
  const overwrite = !!input.overwrite;
  const overridable = (stored) => overwrite || (!!replaceTail && tailOf(stored) === replaceTail);
  const st0 = state(s, input.reg);
  const st = {
    chat: st0.chat === 'configured' && overridable(s.apiKey) ? 'empty' : st0.chat,
    tts: st0.tts === 'configured' && overridable(s.ttsApiKey) ? 'empty' : st0.tts,
    // 转写那一槽的「已配」判据是引擎而不是 key（免费引擎没有 key），所以
    // 尾号比对对它常常落空；overwrite 下不看 key。
    stt: st0.stt === 'configured' && (overwrite || overridable(s.sttApiKey)) ? 'empty' : st0.stt,
  };
  const replaced = [];
  if (st0.chat !== st.chat) replaced.push('chat');
  if (st0.tts !== st.tts) replaced.push('tts');
  if (st0.stt !== st.stt) replaced.push('stt');
  const writes = {};
  const skipped = [];
  const tests = [];

  if (!p || !key) return { writes, skipped, tests, replaced };

  // 平台可以不带朗读 / 转写（中国版的免费额度只有翻译，grant.js platform()）。缺的那一槽
  // **不写、不测**，记成 skipped/absent —— 绝不能拿翻译的 key 去配一个不存在的引擎。
  const ttsEngine = p.tts ? p.tts.id : '';
  const sttEngine = p.stt ? p.stt.id : '';

  // 端点 / 模型 / 音色写空是构成要件：留着上一个引擎的地址配新引擎的 key，正是
  // notes.js 明文禁止的「把 key 和一个不是发给它的端点配在一起」。空 = 走注册表
  // 默认 = 一个能工作的配置（wire-format 的两分支合同）。
  if (st.chat === 'empty') {
    // 自定义平台**必须**带地址，没有就什么都不写：一个没有端点的 requiresEndpoint
    // 引擎在运行时会被 wire-format 判成没配好，而卡上会显示「配好了」。
    if (p.custom && !has(input.baseUrl)) return { writes: {}, skipped, tests: [], replaced };
    writes.provider = p.chat.id;
    writes.apiKey = key;
    // 非自定义平台写空 = 走注册表默认（wire-format 两分支合同）；自定义写用户填的那一条。
    writes.apiBaseUrl = p.custom ? String(input.baseUrl).trim() : '';
    writes.apiModel = pinModel ? (p.chat.defaultModel || '') : '';
    tests.push('chat');
  } else {
    skipped.push({ slot: 'chat', reason: 'already', current: s.provider || '' });
  }

  if (!p.tts) {
    skipped.push({ slot: 'tts', reason: 'absent', current: s.ttsEngine || '' });
  } else if (st.tts === 'empty') {
    writes.ttsEngine = ttsEngine;
    writes.ttsApiKey = key;
    writes.ttsBaseUrl = '';
    writes.ttsModel = pinModel ? (p.tts.defaultModel || '') : '';
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

  if (!p.stt) {
    skipped.push({ slot: 'stt', reason: 'absent', current: s.sttEngine || '' });
  } else if (st.stt === 'empty') {
    writes.sttEngine = sttEngine;
    writes.sttApiKey = key;
    writes.sttBaseUrl = '';
    writes.sttModel = pinModel ? (p.stt.defaultModel || '') : '';
    tests.push('stt');
  } else {
    skipped.push({ slot: 'stt', reason: 'already', current: s.sttEngine || '' });
  }

  // 解析（notes）**一个键都不写**。notesProvider === '' 的语义是「整组跟随翻译
  // 引擎」（LearnNotes.resolveConfig 持有那条规则），那已经是正确且经过设计的
  // 默认。写 notesProvider 会永久打断 follow 关系：用户以后换翻译引擎，解析会
  // 留在这个平台上。结果区仍要**显式说出来**，不说它看起来就像被漏了。

  return { writes, skipped, tests, replaced };
}

// summarize(results) → { done, failed, ok }
// results: [{ slot, ok, error? }]
function summarize(results) {
  const list = results || [];
  const failed = list.filter((r) => !r.ok).map((r) => r.slot);
  return { done: list.filter((r) => r.ok).length, failed, ok: failed.length === 0 };
}

// 只在**翻译这一路真的通了**的时候给出口。翻译没通却请人去翻一页，是把失败推迟到
// 一个更难解释的地方发生。没测翻译（因为早就配过了）也算通 —— 那种情况下用户本来
// 就在用它。
//
// 单独具名，是因为它是视图层里唯一一处真正的判断，而视图层跑不进纯逻辑套件；
// 留在闭包里等于这个分支只有真机看得见。
function tryVisible(tests, results) {
  if (!Array.isArray(tests) || !tests.includes('chat')) return true;
  return (results || []).some((r) => r && r.slot === 'chat' && r.ok === true);
}

// 回显用：这个人现在的配置里，哪一把 key 在一个可一键的平台上？翻译那一路优先（它决定
// 「代表」谁），翻译不在可一键平台上时退到朗读、再退到转写 —— 三样里只要有一样配在
// 可一键的平台上，卡就该把那把 key 回显出来，而不是空着装作「你还没配」
// （2026-09-07 用户报：详细里有 key、快速里空着。翻译配在一家、转写配在另一家时
// `represents` 为 null，App 那边又根本没传 prefill）。
function prefill(settings, reg) {
  const s = settings || {};
  const rep = represents(s, reg);
  if (rep && has(s.apiKey)) {
    // 自定义平台按 id 认（它没有 host），并且要把地址一起回显 —— 少了地址，
    // 卡上看起来像「配好了」而那一格其实是空的。
    return rep.custom
      ? { host: '', custom: true, key: s.apiKey, baseUrl: s.apiBaseUrl || '', slot: 'chat' }
      : { host: rep.host, key: s.apiKey, slot: 'chat' };
  }
  for (const p of platforms(reg)) {
    if (has(s.ttsApiKey) && p.tts && p.tts.id === s.ttsEngine) return { host: p.host, key: s.ttsApiKey, slot: 'tts' };
    if (has(s.sttApiKey) && p.stt && p.stt.id === s.sttEngine) return { host: p.host, key: s.sttApiKey, slot: 'stt' };
  }
  return null;
}

export {
  hostOf, registries, eligible, customPlatform, platforms, consistent,
  siteUrl, TRY_LANGS, tryUrl, state, represents, tailOf, plan, summarize,
  tryVisible, prefill,
};
export default {
  platforms, plan, summarize, state, represents, prefill, consistent,
  siteUrl, tryUrl, TRY_LANGS, tryVisible, tailOf, _eligible: eligible,
};
