// app/handoff.js — 「交来的文字」进复习库的**唯一写入者**（docs/domain-design.md §2.6 规则 6、§9.2 第六挂点；
// docs/learning-design.md §9.9）。只在 App 主页面里跑。
//
// 两个输入端都不开 LearnStore：iPhone 的系统翻译扩展是另一个进程（够不着 App 的 IndexedDB），
// Mac 的快译面板是第二个 WKWebView（学习库按账号分库，第二个打开者会握着过期的库名）。它们把
// 记录交到这里 —— iPhone 经 App Group 收件箱、Mac 经原生中继 —— 过的是同一道门。
//
// 记录的形状（收件箱里每个文件、中继的每条消息）：{ v, text, tr, lang, trLang, ts, via }，别的一概不收。
// 这里仍是 sink（Collector law 1）：只读别人已经显示过的译文，从不发起翻译。
(function (root) {
  'use strict';

  const VIAS = ['system', 'select', 'input', 'shot', 'service'];
  const MAX_CHARS = 2000;                       // 超过就是一篇文章，不是一张卡（画布裁定 10）
  const MAX_AGE_MS = 30 * 24 * 3600 * 1000;     // 收件箱里放了 30 天以上的不再收
  // 采集开关按入口分两把：iPhone 的系统翻译一把、Mac 的快速翻译一把（同 docCapture / listenCapture 的形状）。
  const captureKeyOf = (via) => (via === 'system' ? 'handoffCapture' : 'quickCapture');
  // 来源标题。via 是闭集，未知值在 valid() 就被拦下，不会走到这里。右键「服务」与快捷键划词对用户是
  // 同一件事，来源里不分两组。文案写成 t('key', '中文') 的字面形状，是为了让 no-hardcoded-copy 门看得见。
  function titleOf(via, t) {
    switch (via) {
      case 'system': return t('src_handoff_system', '系统翻译');
      case 'input': return t('src_handoff_input', '输入翻译');
      case 'shot': return t('src_handoff_shot', '截图翻译');
      default: return t('src_handoff_select', '划词翻译');
    }
  }
  const groupOf = (via) => (via === 'service' ? 'select' : via);

  function monthOf(ts) { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

  function valid(rec) {
    return !!rec && typeof rec.text === 'string' && typeof rec.tr === 'string'
      && VIAS.indexOf(rec.via) >= 0 && Number.isFinite(rec.ts) && rec.ts > 0;
  }

  // 按入口 + 月份一组：这是几十次零散的查词，不是一场会话 —— 每次一条来源会把来源管理刷成流水账。
  function sourceFor(rec, t) {
    const g = groupOf(rec.via); const m = monthOf(rec.ts);
    return { id: 'handoff:' + g + ':' + m, url: 'handoff://' + g + '/' + m, title: titleOf(rec.via, t || ((k, fb) => fb)) + ' · ' + m };
  }

  function draftFor(rec) {
    const g = groupOf(rec.via);
    return {
      text: rec.text, tr: rec.tr,
      lang: rec.lang || 'und', targetLang: rec.trLang || '',
      kind: 'sentence',
      sourceId: 'handoff:' + g + ':' + monthOf(rec.ts),
      // 显式新 kind（learning-design §9.9 / §12）：不复用 dom（没有 URL）、doc（没有页）、conv（没有会话也没有说话人）。
      // 不记来源 App、不记窗口标题 —— 系统本来也不给，给了也不记。
      anchor: { k: 'handoff', via: rec.via, at: rec.ts },
      playedThrough: true,          // 用户亲手要的译文 = 已消费（先例 doc-core / listen-core）
      dwellMs: 0,
      starred: false,
    };
  }

  // 返回 '' = 写；否则是不写的原因（给测试与日志看，不给用户看）。
  function whyNot(rec, cfg, deps, now) {
    if (!valid(rec)) return 'shape';
    if (!rec.text.trim() || !rec.tr.trim()) return 'empty';
    if (rec.text.trim() === rec.tr.trim()) return 'same';            // 译文等于原文 = 没翻出东西
    if (rec.text.length > MAX_CHARS) return 'long';
    if (now - rec.ts > MAX_AGE_MS) return 'stale';
    if (!cfg || cfg.learnEnabled === false) return 'learn-off';
    if (cfg[captureKeyOf(rec.via)] === false) return 'capture-off';
    const d = draftFor(rec);
    if (deps && deps.langAllowed && !deps.langAllowed(d.lang, d.text, cfg.langs, cfg.registry)) return 'lang';
    if (deps && deps.shouldCapture && !deps.shouldCapture(d)) return 'gate';
    return '';
  }

  // ingest(records, env) → { written, skipped: {原因: 条数}, names: [可以删的收件箱文件名] }
  //   env: { cfg, deps:{langAllowed, shouldCapture, makeItem, mergeBatch, t, once}, now }
  // **先写库后删文件**：names 只在 mergeBatch 落定之后才返回给调用方去 ack；item id 是内容哈希、
  // merge 幂等，所以中途崩溃下次重来无害。被门拦下的记录同样进 names —— 留着它们不会变得可写，
  // 只会成为用户看不见的积压（开关关着时尤其如此：丢弃并清空，不留暗箱）。
  async function ingest(records, env) {
    const out = { written: 0, skipped: {}, names: [] };
    const list = Array.isArray(records) ? records : [];
    const cfg = env.cfg || {}; const deps = env.deps || {}; const now = env.now || Date.now();
    const items = []; const sources = new Map();
    for (const r of list) {
      const rec = r && r.record ? r.record : r; const name = r && r.name;
      const why = whyNot(rec, cfg, deps, now);
      if (why) { out.skipped[why] = (out.skipped[why] || 0) + 1; if (name) out.names.push(name); continue; }
      const d = draftFor(rec);
      items.push({ item: deps.makeItem(d, rec.ts), name });
      const s = sourceFor(rec, deps.t); sources.set(s.id, s);
    }
    if (items.length) {
      await deps.mergeBatch(items.map((x) => x.item), Array.from(sources.values()));
      out.written = items.length;
      for (const x of items) if (x.name) out.names.push(x.name);
      try { if (deps.once) deps.once('capture_first'); } catch (_) {}
    }
    return out;
  }

  // 生产环境的接线：读设置、注入 LearnRules / LearnModel / LearnStore。输入端（收件箱、中继）在后续 PR 里接。
  async function ingestLive(records) {
    if (typeof LearnStore === 'undefined' || typeof LearnModel === 'undefined') return { written: 0, skipped: { 'no-store': (records || []).length }, names: [] };
    const s = await new Promise((res) => chrome.storage.local.get(['learnEnabled', 'learnRules', 'handoffCapture', 'quickCapture'], (v) => res(v || {})));
    const rules = s.learnRules && typeof s.learnRules === 'object' ? s.learnRules : {};
    return ingest(records, {
      cfg: { learnEnabled: s.learnEnabled, handoffCapture: s.handoffCapture, quickCapture: s.quickCapture, langs: rules.langs, registry: root.MT_LANGS || [] },
      deps: {
        langAllowed: typeof LearnRules !== 'undefined' ? LearnRules.langAllowed : null,
        shouldCapture: LearnModel.shouldCapture, makeItem: LearnModel.makeItem,
        mergeBatch: (items, sources) => LearnStore.mergeBatch(items, sources),
        t: (k, fb) => (typeof PageI18n !== 'undefined' ? PageI18n.t(k, fb) : fb),
        once: (n) => { if (typeof MTTelemetry !== 'undefined') MTTelemetry.once(n); },
      },
    });
  }

  // 面板页交来的「翻成了 / 失败了」（telemetry-design §3.5）：面板是第二个 WKWebView，不初始化遥测 ——
  // 否则两个页面各发一次心跳、各持一份队列。它每个面板会话至多交一条成功、每个码一条失败；这里只管代发。
  // 没有原文、没有地址：只有引擎 id、错误码、状态码、通路、毫秒数。
  function relayResult(msg, tracker) {
    const m = msg || {};
    const T = tracker || (typeof MTTelemetry !== 'undefined' ? MTTelemetry : null);
    if (!T) return '';
    const ms = Number.isInteger(m.ms) && m.ms >= 0 ? m.ms : 0;
    const provider = String(m.provider || '');
    try {
      if (m.ok === true) { T.track('translate_ok', { provider, kind: 'quick', ms }); return 'ok'; }
      T.track('translate_fail', {
        provider, code: typeof m.code === 'string' && m.code ? m.code : 'network',
        status: Number.isInteger(m.status) ? m.status : 0,
        route: m.route === 'proxy' ? 'proxy' : (m.route === 'direct' ? 'direct' : ''), ms,
      });
      return 'fail';
    } catch (_) { return ''; }
  }

  const api = { VIAS, MAX_CHARS, MAX_AGE_MS, captureKeyOf, monthOf, sourceFor, draftFor, whyNot, ingest, ingestLive, relayResult };
  root.AppHandoff = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
