// app/vault-mirror.js — 把引擎配置镜像给 iOS 系统翻译扩展（docs/learning-design.md §9.9）。
// 原生半边：app/native/vault-bridge.swift（通道 mtVault，整份 #if os(iOS)）。
//
// 能力靠探测，不靠 UA：`webkit.messageHandlers.mtVault` 在就发，不在就整个不做 ——
// macOS、以及不认识这条通道的老原生壳都没有它。所以这份 JS 可以先于原生合入
// （与 quick-host.js 的 mtQuick 同一条纪律）。
//
// **镜像，不搬家**（§9.9 决策日志；也是 2026-08-23 评审通过的 Keychain 迁移第 1 步）：
// 真源仍然是 App 这边的 chrome.storage，扩展拿到的是一份只读快照。扩展改不了它，
// 也没有第二个写入者 —— 所以不存在「两份配置谁说了算」这个问题。
//
// **为什么是全量快照，不是增量**：iOS 的 Keychain 在 App 卸载后仍然留着。增量同步会
// 留下「扩展里有一把 key、而 App 里早就没配了」这种状态，而那一份 key 还会被拿去发请求。
// 全量的语义是「快照里没有的，原生侧删掉」，卸载重装之后也自洽。
(function (root) {
  'use strict';
  const CHANNEL = 'mtVault';

  // 与 vault-bridge.swift 逐字对表（test/build-scripts.test.js 的协议镜像门）。
  // 收件箱（§9.9）与配置镜像走**同一条通道**：两者都只在有系统翻译扩展的壳上存在，
  // 分两条通道等于把同一个「这台设备有没有那个扩展」的判断写两遍。
  const PROTOCOL = {
    toNative: ['vault-sync', 'vault-clear', 'inbox-drain', 'inbox-ack', 'inbox-clear'],
    fromNative: ['vault-ack', 'inbox-batch'],
  };

  // 快照里非机密的那部分。**逐项都是扩展真的要用的** —— 多镜像一个键，就是多一份
  // 躺在 Keychain 与 App Group 里、没人读却会被备份走的数据。
  //   provider/baseUrl/model  引擎三元组（已经过 LearnNotes.resolveConfig 解析）
  //   targetLang/uiLang       「译成」与界面语言（弹层里决定译成什么）
  //   req*                    超时、重试、并发 —— translation-api 从 storage 读它们
  //   grantTail               免费额度的尾号（只为显示「额度在用」，不是令牌本身）
  //   learnEnabled/learnLangs/handoffCapture  进不进复习库，由同一套门裁定
  //   flavor                  国际版 / 中国版（未配置态的主按钮不同）
  const NON_SECRET = ['provider', 'baseUrl', 'model', 'targetLang', 'uiLang',
    'reqTimeoutSec', 'reqRetries', 'reqConcurrency', 'reqBackoffMs', 'reqMaxChars',
    'grantTail', 'learnEnabled', 'learnLangs', 'handoffCapture', 'flavor'];

  // 读哪些原始键才能算出上面那些。`LearnNotes.resolveConfig` 的「解析引擎优先」规则
  // 留在 JS 里 —— Swift 不重写解析（§9.9：镜像的是**解析后的结果**）。
  const READ = ['provider', 'apiKey', 'apiBaseUrl', 'apiModel',
    'notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesModel',
    'targetLang', 'uiLang', 'reqTimeoutSec', 'reqRetries', 'reqConcurrency',
    'reqBackoffMs', 'reqMaxChars', 'grantTail', 'learnEnabled', 'learnRules',
    'handoffCapture'];

  // onChanged 上哪些键变了要重新镜像。别的键变了不发 —— 每一次 sync 都是一次
  // Keychain 写入，跟着无关的键抖没有意义。
  const WATCH = new Set(READ.concat(['learnRules']));

  let acked = null;   // 最近一次 vault-ack（键名列表 + OSStatus），**永不含 key 的值**
  const ackFns = [];  // 回执到了要通知的人（设置页那一块）—— 同步是异步的，先画出来的必然是「还没同步」
  let lastJson = '';  // 上一次发出去的快照，用来去重

  function port() { try { return root.webkit.messageHandlers[CHANNEL] || null; } catch (_) { return null; } }
  function post(payload) {
    const p = port();
    if (!p) return false;
    try { p.postMessage(payload); return true; } catch (_) { return false; }
  }
  const get = (keys) => new Promise((res) => chrome.storage.local.get(keys, (v) => res(v || {})));

  // 这个壳有没有这条通道。没有就整个不做 —— 不是「先存着等以后」，
  // 是这台设备上根本没有系统翻译扩展。
  function available() { return !!port(); }

  // 注册表里有没有「不用填 key 就能用」的条目。有 = 国际版。
  function hasFreeChannel() {
    const list = (typeof root.MT_PROVIDERS !== 'undefined' && root.MT_PROVIDERS) || [];
    return list.some((p) => p && p.needsKey === false);
  }

  // 从一份设置算出要镜像的快照。纯函数，测试直接调它，不经过桥。
  function snapshot(s, flavor) {
    s = s || {};
    const tr = (typeof LearnNotes !== 'undefined' && LearnNotes.resolveConfig)
      ? LearnNotes.resolveConfig(s)
      : { provider: s.provider || '', apiKey: s.apiKey || '', baseUrl: s.apiBaseUrl || '', model: s.apiModel || '' };

    // 引擎 id 先过注册表。**过期的 id 不许静默回落**到某个默认引擎 —— 那会让用户
    // 在弹层里用上一个他没选过的引擎（可能还是要花钱的那个），而界面上看不出来。
    // 认不出来就整份快照当作「没配」，扩展那边出未配置态、给「打开大肚猴翻译」。
    const known = (typeof EngineState !== 'undefined' && EngineState.byId)
      ? !!EngineState.byId(tr.provider) : !!tr.provider;
    const rules = (s.learnRules && typeof s.learnRules === 'object') ? s.learnRules : {};

    const nonSecret = {
      provider: known ? tr.provider : '',
      baseUrl: known ? (tr.baseUrl || '') : '',
      model: known ? (tr.model || '') : '',
      targetLang: s.targetLang || '',
      uiLang: s.uiLang || '',
      reqTimeoutSec: s.reqTimeoutSec,
      reqRetries: s.reqRetries,
      reqConcurrency: s.reqConcurrency,
      reqBackoffMs: s.reqBackoffMs,
      reqMaxChars: s.reqMaxChars,
      grantTail: s.grantTail || '',
      learnEnabled: s.learnEnabled !== false,
      learnLangs: rules.langs || null,
      handoffCapture: s.handoffCapture !== false,
      // 哪个 flavor：**按注册表实际内容判定，不按名字**（同 app.js 485 行那条纪律）。
      // 中国版的注册表里没有 google —— 那是 global-only 的免费通道，也是未配置态里
      // 「领免费额度」那个主按钮存在的前提。注册表哪天变了，这里自动跟着变。
      flavor: flavor || (hasFreeChannel() ? 'global' : 'china'),
      schema: 1,
    };
    // undefined 不进快照：JSON 里它会整个消失，而「没有这个键」与「键在但值是
    // undefined」在原生那边是两件事（前者=用默认值，后者=显式空）。统一成前者。
    for (const k of Object.keys(nonSecret)) if (nonSecret[k] === undefined) delete nonSecret[k];

    return { nonSecret, secret: { apiKey: known ? (tr.apiKey || '') : '' } };
  }

  // 发一次全量快照。`force` 跳过去重（清空之后重建时用）。
  async function sync(opts) {
    if (!available()) return false;
    const s = await get(READ);
    const snap = snapshot(s, (opts && opts.flavor) || '');
    const json = JSON.stringify(snap);
    if (!(opts && opts.force) && json === lastJson) return false;   // 没变就不写 Keychain
    const okSent = post(Object.assign({ type: 'vault-sync' }, snap));
    if (okSent) lastJson = json;
    return okSent;
  }

  // 「清除本机全部数据」要连这两处一起清（§9.9）。清完把去重记忆也清掉，
  // 否则下一次 sync 会因为「和上次一样」而不发，扩展那边就一直是空的。
  function clear() {
    lastJson = '';
    return post({ type: 'vault-clear' });
  }

  // ── 收件箱（§9.9）────────────────────────────────────────────────────────
  // 扩展翻完一句，抄一份写进 App Group 的 handoff-inbox/；App 这边启动与回前台时来收。
  // **先写库后删文件**：`ingestLive` 落定之后才 ack，原生这时才删。item id 是内容哈希、
  // merge 幂等，所以中途崩溃下次重来无害；反过来「先删后写」会在崩溃时静默丢句子。
  let draining = false;
  function drain() {
    if (!available() || draining) return false;
    draining = true;
    return post({ type: 'inbox-drain' });
  }
  // 「清除本机全部数据」/「清空学习库」要连收件箱一起清，否则 App 里看着清干净了，
  // 下一次打开又从收件箱里长出几十张卡。
  function clearInbox() { return post({ type: 'inbox-clear' }); }

  async function onBatch(msg) {
    draining = false;
    const list = Array.isArray(msg && msg.records) ? msg.records : [];
    if (!list.length) return { written: 0, names: [] };
    let out = { written: 0, names: [] };
    try {
      out = (typeof AppHandoff !== 'undefined')
        ? await AppHandoff.ingestLive(list)
        : { written: 0, names: [] };
    } catch (_) {
      // 写库失败就**什么都不 ack** —— 文件留着，下次重来。这比「吞掉并假装收过了」好：
      // 后者的症状是用户翻过的句子再也不会出现，而界面上没有任何地方会说。
      return { written: 0, names: [] };
    }
    if (out.names && out.names.length) post({ type: 'inbox-ack', names: out.names });
    // 收进过至少一句 = 用户**真的**把我们设成了默认翻译 App。系统不提供这个接口，
    // 这是唯一能证明它的事实（画布第 7 页 DiscoverWhen）。首页那张发现横幅据此变态。
    if (out.written > 0) {
      try { chrome.storage.local.set({ systransSeenAt: Date.now() }); } catch (_) {}
    }
    return out;
  }

  function onNative(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'inbox-batch') return onBatch(msg);
    if (msg.type !== 'vault-ack') return;
    // **回执里永远没有 key 的值**，只有键名与 OSStatus。真要出问题，能说出
    // 「写了哪几个键、系统怎么答的」就够定位了。
    acked = { keys: Array.isArray(msg.keys) ? msg.keys.slice() : [], status: msg.status };
    for (const fn of ackFns) { try { fn(acked); } catch (_) { /* 一个订阅者抛了不该连累别人 */ } }
    return undefined;
  }

  // 启动时一次 + 相关键变化时。别的键变了不发。
  // 收件箱在**启动与每次回到前台**时收一遍：扩展是在 App 不在前台时写的，
  // 只在启动时收，会让一个整天不重启 App 的人永远收不到。
  function start(opts) {
    if (!available()) return false;
    sync(opts);
    drain();
    try {
      chrome.storage.onChanged.addListener((ch) => {
        if (!ch) return;
        for (const k of Object.keys(ch)) if (WATCH.has(k)) { sync(opts); return; }
      });
    } catch (_) { /* 没有总线的宿主（测试）——启动那一次已经发过了 */ }
    try {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) drain(); });
    } catch (_) { /* 没有 document 的宿主（测试）——启动那一次已经收过了 */ }
    return true;
  }

  root.AppVault = {
    available, snapshot, sync, clear, start, onNative,
    drain, clearInbox, _onBatch: onBatch,
    onAck: (fn) => { if (typeof fn === 'function') ackFns.push(fn); },
    PROTOCOL, NON_SECRET, READ,
    ack: () => acked,
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
