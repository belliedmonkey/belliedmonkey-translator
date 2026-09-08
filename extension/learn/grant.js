// learn/grant.js — 免费额度（docs/learning-design.md §8.10）。
//
// ── 它是什么 ────────────────────────────────────────────────────────────
//
// 每个**已登录**用户一份封顶 0.2 美元的额度。用户拿到的是一枚**令牌**（`bmg_…`），
// 不是提供方的 key —— 提供方的 key 只在边缘函数 `bt-relay` 的环境变量里，永不离开
// 服务器。请求经我们的中继转发并计量。用户 2026-09-08 的原话：「额度不走自带 key，
// 额度走我们服务端。我没有违反免费承诺。」
//
// ── 与 quick-setup.js 同一条纪律：**只算 patch，宿主写** ──────────────────
//
// 这个模块一个 `storage.set` 都不做。它算出「该写哪些键」，由调用它的那一页
// （扩展设置页 / App 设置页）连同它自己的其它字段一起保存。理由与一键配置相同：
// 两个宿主的保存路径不一样（`saveAll()` vs App 的分片保存），在这里写会绕过宿主
// 的一致性检查，且下一次任何字段变更就会把它清掉，静默且必然。
//
// ── 三个键，以及为什么内容脚本只看得到其中一个 ──────────────────────────
//
//   grant        领取记录（hash / userId / 时间 / 上限）—— **只在扩展页与 App 页**
//   grantTail    令牌尾八位 —— 内容脚本读它判「现在用的是不是额度」
//   grantBalance 余额缓存（10 分钟）—— 免得每次画卡都打一次网络
//
// 内容脚本拿到的只有 `grantTail`：八位数字字母，不含身份、不能用来请求任何东西。
// 完整记录留在扩展页（同 `learnUserId` 的先例）。

var LearnGrant = (function () {
  'use strict';

  const CACHE_MS = 10 * 60 * 1000;
  const LOW_USD = 0.02;                 // 「余额低」的线，只在设置页与弹窗提示（裁定 D5）

  // 构建期发射的那份规格。中国版恒为 null —— 不是「关着」而是「不存在」。
  function spec() {
    return (typeof window !== 'undefined' && window.MT_GRANT) || null;
  }
  function enabled() { return !!spec(); }

  const tail = (v) => {
    const x = String(v == null ? '' : v).trim();
    return x ? x.slice(-8) : '';
  };

  // ── 领取 ───────────────────────────────────────────────────────────────
  //
  // 幂等：服务端以 user_id 为主键，第二次回传**同一枚**令牌（裁定 D1）。所以「领取」
  // 与「读余额」是同一个调用 —— 不需要第二个端点，也就没有第二处会漂的判据。
  //
  // 头的写法照 sync.js:28-36，但**不 import LearnSync**：那个模块带着整套推拉状态机，
  // 而这里只需要一次 POST。抄三行比拉进一个状态机便宜。
  async function claim(deps) {
    const sp = spec();
    if (!sp) { const e = new Error('grant not available'); e.code = 'grant_unavailable'; throw e; }
    const auth = (deps && deps.auth) || (typeof LearnAuth !== 'undefined' ? LearnAuth : null);
    const backend = (deps && deps.backend) || (typeof MT_BACKEND !== 'undefined' ? MT_BACKEND : null);
    const fetchFn = (deps && deps.fetch) || (typeof fetch !== 'undefined' ? fetch : null);
    if (!auth || !backend || !fetchFn) { const e = new Error('no host'); e.code = 'grant_misconfigured'; throw e; }

    const token = await auth.token();
    if (!token) { const e = new Error('not signed in'); e.code = 'signed_out'; throw e; }

    let res;
    try {
      res = await fetchFn(sp.claimUrl, {
        method: 'POST',
        headers: { apikey: backend.anonKey, Authorization: 'Bearer ' + token },
      });
    } catch (_) {
      const e = new Error('offline'); e.code = 'offline'; throw e;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 服务端的具名 error 原样当 code 用。**不映射、不归并** —— 「今天领的人太多」
      // 与「这枚被停用了」对用户是两件不同的事，各有各的下一步。
      const e = new Error('claim ' + res.status);
      e.code = String(body && body.error) || 'server';
      e.status = res.status;
      throw e;
    }
    return {
      token: String(body.token || ''),
      limitUsd: Number(body.limit_usd || sp.limitUsd || 0),
      spentUsd: Number(body.spent_usd || 0),
      reused: !!body.reused,
    };
  }

  // ── 把令牌变成三槽配置 ─────────────────────────────────────────────────
  //
  // 走**现有的** QuickSetup.plan，只多两个参数。不写第二份 plan：那张表已经有
  // 「writes 的每个键都必须在 SETTINGS_KEYS 里」的门禁守着，而第二份实现会绕过它。
  //
  // 平台对象要自己拼：`platforms()` 按设计把 grantOnly 排除在外（那些条目不是用户
  // 能选的平台），所以这里按 id 直接取三条。
  function platform(reg) {
    const r = reg || (typeof window !== 'undefined' ? window : {});
    const pick = (list, id) => (list || []).find((e) => e.id === id) || null;
    const chat = pick(r.MT_PROVIDERS, 'grant');
    const tts = pick(r.MT_TTS_ENGINES, 'grant_speech');
    const stt = pick(r.MT_STT_ENGINES, 'grant_stt');
    if (!chat || !tts || !stt) return null;
    return { host: 'grant', chat, tts, stt };
  }

  // plan(claimed, settings, reg) → { writes, skipped, replaced, tests, marks }
  function plan(claimed, settings, reg) {
    const sp = spec();
    const p = platform(reg);
    const key = String((claimed && claimed.token) || '');
    if (!sp || !p || !key) return { writes: {}, skipped: [], replaced: [], tests: [], marks: {} };
    const qs = (typeof QuickSetup !== 'undefined') ? QuickSetup : null;
    if (!qs) return { writes: {}, skipped: [], replaced: [], tests: [], marks: {} };

    const s = settings || {};
    const out = qs.plan({
      platform: p, key, settings: s,
      pinModel: true,                 // 中继按白名单放行，留空会撞 403
      replaceKeyTail: tail(s.grantTail),
    });
    return Object.assign({}, out, {
      // 这三个键**不进** SETTINGS_KEYS（同 optDetailMode 的先例）：宿主 saveAll()
      // 之后单独 storage.set。放进去会让每一次普通保存都把它们重写一遍。
      marks: {
        grantTail: tail(key),
        grant: {
          vendor: sp.vendor,
          limitUsd: claimed.limitUsd,
          at: Date.now(),
          reused: !!claimed.reused,
        },
        grantBalance: { spentUsd: claimed.spentUsd, limitUsd: claimed.limitUsd, at: Date.now() },
      },
    });
  }

  // ── 现在用的是不是额度 ─────────────────────────────────────────────────
  //
  // 判据是**尾号命中**，不是「provider 等于 grant」：用户可能只把翻译换成了自己的
  // key 而朗读还留着额度，那时两个答案不一样，而扣费看的是每一路各自用了什么。
  function activeIn(s, slot) {
    const t = tail((s || {}).grantTail);
    if (!t) return false;
    const keyOf = { chat: 'apiKey', tts: 'ttsApiKey', stt: 'sttApiKey' }[slot];
    return !!keyOf && tail((s || {})[keyOf]) === t;
  }
  function active(s) {
    return activeIn(s, 'chat') || activeIn(s, 'tts') || activeIn(s, 'stt');
  }

  // ── 状态机 ─────────────────────────────────────────────────────────────
  //
  // 画布上那一列状态（S0–S12）落到一个纯函数上。**顺序即优先级**，最要紧的一条
  // 是 `unavailable` 排在 `exhausted` 前面：池子空了与用户用完了在界面上必须是
  // 两句话，而后者会让用户去查自己的账户 —— 查一晚上也查不出来。
  function status(s, opts) {
    const o = opts || {};
    if (!enabled()) return 'none';
    if (o.unavailable) return 'unavailable';
    const st = s || {};
    if (!o.signedIn) return st.grant ? 'signed_out' : 'none';
    if (!st.grant) return 'unclaimed';
    if (!active(st)) return 'replaced';               // 领过，但三槽都换成别的 key 了
    const bal = st.grantBalance || o.balance || null;
    if (bal && Number(bal.limitUsd) > 0) {
      const left = Number(bal.limitUsd) - Number(bal.spentUsd || 0);
      if (left <= 0) return 'exhausted';
      if (left < LOW_USD) return 'low';
    }
    return 'active';
  }

  // 余额缓存是否还新鲜。**过期不等于错** —— 过期时画的是上一次的数字加一个「刷新」，
  // 不是一片空白：空白会让人以为额度没了。
  function fresh(bal, now) {
    if (!bal || !bal.at) return false;
    return (now || Date.now()) - Number(bal.at) < CACHE_MS;
  }
  function leftUsd(bal) {
    if (!bal) return null;
    const l = Number(bal.limitUsd), sp2 = Number(bal.spentUsd || 0);
    if (!(l > 0)) return null;
    return Math.max(0, Math.round((l - sp2) * 10000) / 10000);
  }

  // 退出登录时要清掉的东西（裁定 D4：必须登录才能用）。
  // **`grant` 记录留着** —— 它只有 hash 与时间，没有令牌；留着才能在重新登录时
  // 认出「这台机器领过」，也才能诚实地说「余额保留，再登录就回来」。
  function clearOnSignOut(s) {
    const st = s || {};
    const writes = {};
    if (activeIn(st, 'chat')) { writes.apiKey = ''; writes.apiModel = ''; }
    if (activeIn(st, 'tts')) { writes.ttsApiKey = ''; writes.ttsModel = ''; }
    if (activeIn(st, 'stt')) { writes.sttApiKey = ''; writes.sttModel = ''; writes.sttEngine = ''; }
    return { writes, marks: { grantTail: '', grantBalance: null } };
  }

  return {
    spec, enabled, claim, plan, platform, status, active, activeIn,
    fresh, leftUsd, clearOnSignOut, tail, CACHE_MS, LOW_USD,
  };
})();

if (typeof window !== 'undefined') window.LearnGrant = LearnGrant;
if (typeof module !== 'undefined' && module.exports) module.exports = LearnGrant;
