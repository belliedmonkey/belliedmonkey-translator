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

  // plan(claimed, settings, reg, opts) → { writes, skipped, replaced, tests, marks }
  //   opts.overwrite：「改回免费额度」—— 三槽无论装着什么都换成额度（宿主先弹确认）。
  function plan(claimed, settings, reg, opts) {
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
      overwrite: !!(opts && opts.overwrite),
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


  // ── 卡面：状态 → 说什么、能点什么 ────────────────────────────────────────
  //
  // 做成**纯函数**是刻意的：render() 需要 DOM，跑不进纯逻辑套件，于是「哪个状态说哪句
  // 话」这件最容易说错的事就只有真机看得见。这里把它单独拎出来，让门禁看得见。
  // （同 quick-setup.js 把 tryVisible 单独具名的理由。）
  //
  // 每个状态**至多一个主按钮**。两个并列的主按钮等于没有主按钮 —— 用户要先做一次
  // 「该点哪个」的判断，而这张卡的全部意义就是省掉判断。
  function cardFor(status, opts) {
    // **没有额度就没有这张卡。** 这个守卫原来在三个宿主里各写了一遍（提前 return），
    // 而为了让中国版那张卡走到 render 里，那三处被删掉了 —— 于是 status('none')
    // （「有额度但没登录」）在**没有额度**的构建里也画出了一张「登录领免费额度」。
    // 守卫属于卡自己：调用方不该需要知道「先问 enabled 再问 status」。
    if (!enabled()) return null;
    const o = opts || {};
    const t = o.t || ((k, d) => d);
    const limit = Number((spec() && spec().limitUsd) || 0);
    const left = leftUsd(o.balance);
    const money = (v) => '$' + Number(v).toFixed(2);

    // 标题里**不写数字**（裁定：卡标题写「够翻几百页」）。数字只出现在进度那一行 ——
    // 标题里的金额会被当成承诺，而它是一个会变的运营参数。
    // 披露段里的 {vendor} 由这里代入。名字只在 backend.config.js 写一处 —— 抄进
    // 12 份 locale 就是 12 份会漂的副本（同 qs_privacy 用 {host} 的先例）。
    //
    // **退到厂商 id，绝不因为取不到名字就把整段丢掉。** 第一版写的是「代不出来就不出」，
    // 那等于在没有披露的情况下让人点「领取」—— 而这段话是 Gate F 的构成要件，
    // 是整个产品里唯一一条「你的文本会经过我们的服务器」的告知。少露一个好看的名字，
    // 远好过少说一件事。
    const sp0 = spec() || {};
    const vend = sp0.vendorLabel || sp0.vendor || '';
    const priv = vend
      ? t('grant_privacy', '免费额度（可选）。登录并领取后，你可以用我们出的 0.2 美元额度翻译、朗读、转写。这条路上，你的文本会经过我们的服务器转发到模型提供方（{vendor}），我们不保存、不记录内容，只记录每次花了多少；额度用完即停，不会自动收费。自带 key 的路径不变：文本仍从你的浏览器直接发往提供方，我们看不到。退出登录时额度在这台设备上停用；删除账号会一并删除额度记录。').replace('{vendor}', vend)
      : '';

    const base = { title: t('grant_title', '免费额度'), action: null, links: [], progress: null, note: '' };
    const byo = { id: 'byo', text: t('grant_byo', '用自己的 key') };
    const community = { id: 'community', text: t('grant_community', '加入社群问问') };

    switch (status) {
      case 'none':
        // 未登录、也从没领过。**登录是选项不是墙**（裁定 D2）：这张卡旁边永远并排
        // 站着「用自己的 key」，而「继续」始终可点。
        return Object.assign({}, base, {
          body: t('grant_body_signin', '登录之后可以领一份免费额度，够翻几百页。翻译、朗读、转写都能用。'),
          action: { id: 'signin', text: t('grant_signin', '登录领免费额度') },
          note: t('grant_no_live', '实时听译不在额度范围内 —— 它要实时接口，而这条中继只转发一次性请求。'),
          // 2026-09-11：那句话有了出口 —— 一键卡里的「实时转写（可选）」那一格。
          links: [{ id: 'live', text: t('grant_live_go', '另配实时引擎 →') }],
        });
      case 'signed_out':
        // 退出登录会停用额度（裁定 D4）。**先说余额还在**，否则用户以为钱没了。
        return Object.assign({}, base, {
          body: t('grant_body_signed_out', '退出登录后免费额度停用了。余额保留着 —— 用同一个账号再登录就回来。'),
          action: { id: 'signin', text: t('grant_signin_again', '重新登录') },
        });
      case 'unclaimed':
        return Object.assign({}, base, {
          body: t('grant_body_unclaimed', '你还没领这份免费额度。够翻几百页，翻译、朗读、转写都能用。'),
          action: { id: 'claim', text: t('grant_claim', '领取') },
          // Gate F 的披露段，**领取按钮之前**（同 qs_privacy 的位置）。
          note: priv,
        });
      case 'active':
      case 'low':
        return Object.assign({}, base, {
          body: status === 'low'
            ? t('grant_body_low', '免费额度快用完了。用完之后可以填一把自己的 key 继续。')
            : t('grant_body_active', '免费额度正在用。用完之后可以填一把自己的 key 继续。'),
          progress: left == null ? null : { left, limit, text: money(left) + ' / ' + money(limit) },
          links: [byo],
        });
      case 'exhausted':
        return Object.assign({}, base, {
          body: t('grant_body_exhausted', '免费额度已经用完了。填一把自己的 key 就能继续 —— 一把通吃翻译、朗读、转写。'),
          progress: { left: 0, limit, text: money(0) + ' / ' + money(limit) },
          links: [byo, community],
        });
      case 'unavailable':
        // **头一句先说不是你的问题。** 不说的话，用户会去查自己的账户 —— 查一晚上也
        // 查不出来，因为那边根本没有问题。
        return Object.assign({}, base, {
          body: t('grant_body_unavailable', '不是你用完了 —— 是我们这边的免费额度池空了，正在补。先用自己的 key，或者稍后再来。'),
          links: [byo, community],
        });
      case 'replaced':
        return Object.assign({}, base, {
          body: t('grant_body_replaced', '你现在用的是自己的 key。免费额度还留着，随时可以换回来。'),
          action: { id: 'restore', text: t('grant_restore', '改回免费额度') },
        });
      default:
        return null;                                   // 认不出的状态：什么都不画
    }
  }

  // ── 中国版那张卡（画布 A10 / G5）──────────────────────────────────────
  //
  // 中国版**没有**我们代领的额度（MT_GRANT 恒为 null）：中国用户的原文会经东京中转，
  // 而境内后端未就绪。所以那个位置放的是另一件真事 —— **阿里云百炼自己给的免费额度**。
  //
  // 三点必须说清，而且顺序就是这个顺序：
  //   1. 这份额度是阿里云给你的，**不经我们的手**。说反了就是替别人许诺。
  //   2. 具体额度以百炼页面为准。我们抄一个数字下来，它变了我们就在说假话。
  //   3. 我们**暂时**不提供代领的额度，原因是境内后端没就绪 —— 诚实地说出来，
  //      而不是让中国用户觉得这个功能对他不存在。
  //
  // 地址只从注册表取（keyUrl），文案里不出现任何境外平台名 —— 中国合规门会逐行扫。
  function officialCard(opts) {
    const o = opts || {};
    const t = o.t || ((k, d) => d);
    if (enabled()) return null;                        // 有我们自己的额度时不出这张
    if (o.flavor !== 'china') return null;
    if (!o.keyUrl) return null;                        // 没有可去的地址就不画一张点不动的卡
    return {
      title: t('grant_cn_title', '先领一份官方免费额度'),
      body: t('grant_cn_body', '注册后每个模型有一份免费额度，够用一阵子。它是阿里云给你的，不经我们的手。'),
      steps: [
        t('grant_cn_step1', '注册并打开控制台'),
        t('grant_cn_step2', '领免费额度（具体多少以它的页面为准）'),
        t('grant_cn_step3', '把 API Key 粘到下面，一键配好翻译、朗读、转写'),
      ],
      links: [{ id: 'keyurl', text: t('grant_cn_open', '去开通 ↗'), href: o.keyUrl }],
      note: t('grant_cn_why', '我们暂时不提供代领的免费额度：那需要一台境内的服务器，还没就绪。'),
    };
  }

  // ── 弹窗那一行（画布 A5）────────────────────────────────────────────────
  //
  // 弹窗是**只读的、活得极短的**一个面：它不发任何网络请求（余额只用缓存那一份），
  // 也不改配置。所以这里返回的是「说哪句话、点了去哪」，不是一个状态机。
  //
  // 与卡面共用 status()，但**说的不是同一批话**：卡上有位置解释来龙去脉，弹窗只有
  // 一行，而且用户是在「我要翻这一页」的路上顺手打开它的。所以这里只说三种**挡住他
  // 现在要做的事**的情况；「已领、还有余额」什么都不说 —— 一切正常时不该占那一行。
  //
  // `pinnedModel` 由调用方从注册表取（弹窗读不到 MT_GRANT.models 之外的东西）。
  function popupRow(settings, opts) {
    const o = opts || {};
    const t = o.t || ((k, d) => d);
    if (!enabled()) return null;
    const s = settings || {};
    if (!active(s)) return null;                 // 没在用额度：这一行不归它管
    // 模型被改（会撞 403 model_not_allowed）。**排在余额之前** —— 余额再多，
    // 模型不对也是一次都翻不出来，而后者是用户自己改出来的、也只有他能改回去。
    const pinned = String(o.pinnedModel || '');
    if (pinned && s.apiModel && String(s.apiModel) !== pinned) {
      return { kind: 'model', text: t('grant_popup_model', '免费额度只能用它指定的模型 —— 点这里改回去') };
    }
    const bal = s.grantBalance || null;
    const left = leftUsd(bal);
    if (left === 0) return { kind: 'exhausted', text: t('grant_popup_exhausted', '免费额度已用完 —— 点这里看怎么继续') };
    if (left != null && left < LOW_USD) {
      return { kind: 'low', text: t('grant_popup_low', '免费额度快用完了 —— 点这里看看') };
    }
    return null;                                  // 一切正常：不占那一行
  }

  // render(box, opts) —— 只画，不碰存储、不发请求。动作由 host 接。
  //   opts: { t, status, balance, onAction(id), busy }
  function render(box, opts) {
    if (!box) return null;
    const o = opts || {};
    const t = o.t || ((k, d) => d);
    const doc = box.ownerDocument;
    // 两张卡共用这一个位置：有我们的额度时画额度卡，中国版画官方额度那张。
    // 二者互斥（officialCard 在 enabled() 时返回 null），所以不会同时出现。
    const card = cardFor(o.status, o) || officialCard(o);
    box.textContent = '';
    if (!card) { box.hidden = true; return null; }
    box.hidden = false;
    injectGrantStyle(doc);

    const el = (tag, cls, txt) => {
      const n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (txt != null) n.textContent = txt;
      return n;
    };
    const wrap = el('div', 'gr-wrap');
    wrap.append(el('h3', 'gr-title', card.title));
    wrap.append(el('p', 'gr-body', card.body));

    if (card.progress) {
      const bar = el('div', 'gr-bar');
      const fill = el('div', 'gr-fill');
      const pct = card.progress.limit > 0
        ? Math.max(0, Math.min(100, (card.progress.left / card.progress.limit) * 100)) : 0;
      fill.style.width = pct + '%';
      bar.append(fill);
      wrap.append(bar);
      wrap.append(el('p', 'gr-num', card.progress.text));
    }

    if (card.action) {
      // secondary：并排还有别的填色按钮时降级。两个填色按钮并排等于没有主按钮 ——
      // 用户要先做一次「该点哪个」的判断，而这两张卡的意义就是省掉判断。
      const b = el('button', 'gr-action' + (o.secondary ? ' secondary' : ''),
        o.busy ? t('grant_claiming', '领取中…') : card.action.text);
      b.type = 'button';
      b.disabled = !!o.busy;
      // IO 在途时禁按（画布状态 S2）。不禁的话双击就是两次领取请求 —— 服务端幂等
      // 挡得住，但界面会闪两次，而用户读到的是「我是不是点坏了」。
      b.addEventListener('click', () => { if (o.onAction) o.onAction(card.action.id); });
      wrap.append(b);
    }

    if (card.steps && card.steps.length) {
      const ol = el('ol', 'gr-steps');
      for (const st of card.steps) ol.append(el('li', null, st));
      wrap.append(ol);
    }

    if (card.links.length) {
      const row = el('div', 'gr-links');
      for (const l of card.links) {
        const a = el('a', 'gr-link', l.text);
        // 带 href 的链接**就让它是链接**（中国版那张卡去的是外部控制台）：真链接可以
        // 长按复制、可以在新标签打开，而一个 href="#" 加 onclick 的假链接三样都做不到。
        if (l.href) { a.href = l.href; a.target = '_blank'; a.rel = 'noopener'; }
        else {
          a.href = '#';
          a.addEventListener('click', (e) => { e.preventDefault(); if (o.onAction) o.onAction(l.id); });
        }
        row.append(a);
      }
      wrap.append(row);
    }
    if (card.note) wrap.append(el('p', 'gr-note', card.note));
    box.append(wrap);
    return card;
  }

  let grantStyled = false;
  const GRANT_STYLE = `
    .gr-wrap { display:flex; flex-direction:column; gap:8px; }
    .gr-title { margin:0; font-size:1em; }
    /* 次要文字走 --text-secondary，不走 opacity：透明度把 4.5:1 压成 3.4:1，
       而三个宿主的样式表里没有一张管它（2026-09-06 深浅色核查的结论）。 */
    .gr-body { margin:0; font-size:.9em; color:var(--text-secondary, inherit); }
    .gr-note { margin:0; font-size:.85em; color:var(--text-secondary, inherit); }
    .gr-num { margin:0; font-size:.85em; color:var(--text-secondary, inherit); }
    .gr-bar { height:6px; border-radius:3px; background:var(--border, #ddd); overflow:hidden; }
    .gr-fill { height:100%; background:var(--accent, #6b8f71); }
    .gr-links { display:flex; gap:12px; flex-wrap:wrap; }
    .gr-steps { margin:0; padding-left:1.2em; font-size:.9em; color:var(--text-secondary, inherit); }
    .gr-steps li { margin:2px 0; }
    /* 链接必须自带颜色：这三个宿主原来没有一张样式表给 <a> 上色，
       浏览器默认蓝在深色底上是 1.9:1（2026-09-06 报障）。 */
    .gr-link { font-size:.85em; color:var(--link, inherit); text-decoration:underline; cursor:pointer; }
    .gr-action { align-self:flex-start; }
  `;
  function injectGrantStyle(doc) {
    if (grantStyled || !doc || !doc.head) return;
    const el = doc.createElement('style'); el.textContent = GRANT_STYLE; doc.head.appendChild(el);
    grantStyled = true;
  }

  return {
    spec, enabled, claim, plan, platform, status, active, activeIn,
    fresh, leftUsd, clearOnSignOut, tail, cardFor, officialCard, render, popupRow, CACHE_MS, LOW_USD,
  };
})();

if (typeof window !== 'undefined') window.LearnGrant = LearnGrant;
if (typeof module !== 'undefined' && module.exports) module.exports = LearnGrant;
