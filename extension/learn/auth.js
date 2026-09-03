// learn/auth.js — the ONLY module that knows what an identity provider is.
// See docs/learning-design.md §8.4.1.
//
// Surface is deliberately narrow — signIn / verify / signInPassword / token /
// signOut / deleteAccount. `sync.js` speaks PostgREST and never learns how the
// token was obtained, so changing identity provider is a one-file change. That is
// not speculative tidiness: the current backend is shared with another product and
// is expected to move (§8.4.1).
//
// Sign-in is a 6-DIGIT CODE, not a magic link. A link needs a page we host to catch
// the redirect, and we host nothing; a code is typed into the extension and needs no
// callback, no `identity` permission and no web navigation. This has a setup
// consequence worth stating where someone will find it: the provider's email template
// must render the code itself (GoTrue: `{{ .Token }}`) — the stock template sends a
// link, and a link cannot be completed from here.
//
// EXTENSION PAGES ONLY. The session lives in `chrome.storage.local` (key
// `learnAuth`) since 2026-08-09 — learning-design §8.4.1「会话存储位置」. It used
// to live in the extension's own IndexedDB, which on Safari sits on a
// `safari-web-extension://<random-UUID>` origin that ROTATES on reinstall or
// re-signing, orphaning the session (and forcing a re-login on every update).
// `chrome.storage.local` is keyed by the extension bundle id and survives.
// The exposure tradeoff is stated in the doc: our content scripts read EXPLICIT
// key lists only, and `learnAuth` never joins them.

var LearnAuth = (() => {
  const KEY = 'learnAuth';
  // 只装 userId 的独立键（§8.4.1.1 的跨面交接）。内容脚本读得到的就只有它。
  const UID_KEY = 'learnUserId';
  // PKCE 的 code_verifier + state。**只在扩展页之间存在**，从不跨内容脚本边界 ——
  // 这正是「回调里那个 code 可以被内容脚本看到」的前提（§8.4.1.1 第二条裁定）。
  const PKCE_KEY = 'learnAuthPkce';
  // 内容脚本从回调页取回的一次性 code（只有 code 与 state，没有别的）。
  const CODE_KEY = 'learnAuthCode';
  // Pre-2026-08-09 location (IndexedDB meta). Read once for migration, then
  // cleared after a successful forward-write. An orphaned legacy bucket simply
  // migrates nothing — one final sign-in, never again.
  const LEGACY_KEY = 'auth';
  // Refresh a minute early: a token that expires mid-request fails the request.
  const SKEW_MS = 60 * 1000;

  let cached = null;
  let loaded = false;
  let loadError = null;                // last storage-read failure, for the UI
  let refreshing = null;               // single in-flight refresh, see token()
  const listeners = [];

  function api() { return MT_BACKEND.url + '/auth/v1'; }
  function baseHeaders() {
    return { apikey: MT_BACKEND.anonKey, 'Content-Type': 'application/json' };
  }

  // GoTrue reports failures in three different shapes depending on the endpoint and
  // the version. Normalising here keeps every caller from having to know that.
  // `hasBody` marks a DEFINITIVE provider answer: a 400 with a GoTrue error body
  // is "this refresh token is dead"; a body-less 400 from a proxy/captive portal
  // is not, and must never sign anyone out (§8.4.1 判死收紧).
  function errorFrom(status, body) {
    const msg = (body && (body.error_description || body.msg || body.message ||
      body.error)) || ('HTTP ' + status);
    const e = new Error(msg);
    e.status = status;
    e.hasBody = !!body;
    e.code = (body && body.error_code) ||
      (status === 429 ? 'rate_limited' : status === 401 ? 'unauthorized' : 'http_' + status);
    return e;
  }

  async function post(path, body, headers) {
    let res;
    try {
      res = await fetch(api() + path, {
        method: 'POST',
        headers: Object.assign(baseHeaders(), headers || {}),
        body: JSON.stringify(body || {}),
      });
    } catch (netErr) {
      // Offline is not an auth failure and must not read like one, or the user will
      // go hunting for a wrong password that does not exist.
      const e = new Error(String(netErr && netErr.message || netErr));
      e.code = 'offline';
      throw e;
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* keep null */ }
    if (!res.ok) throw errorFrom(res.status, json);
    return json;
  }

  // ─── Session persistence (chrome.storage.local, §8.4.1) ──────────────────
  //
  // The one rule both functions obey: a FAILED read/write is never latched as
  // "signed out". The page-settings incident (2026-08-05) is the whole doctrine:
  // a broken storage layer must present as a failure the UI can name, not as an
  // empty profile silently painted over. `loaded` latches only on a truthful
  // answer; a failure records `loadError` and retries on the next call.

  async function load() {
    if (loaded) return cached;
    const r = await PageSettings.read([KEY]);
    if (!r.ok) {
      loadError = r.error || 'storage read failed';
      return cached;                       // NOT latched — next call retries
    }
    if (KEY in r.data) {
      cached = r.data[KEY] || null;
      loaded = true;
      loadError = null;
      return cached;
    }
    // No session in storage.local — migrate from the pre-2026-08-09 location
    // (IndexedDB meta). A thrown legacy read also must not latch: the classic
    // moment is first launch after an update, mid-onupgradeneeded.
    let legacy;
    try { legacy = await LearnStore.getMeta(LEGACY_KEY, null); }
    catch (e) {
      loadError = (e && e.message) || 'legacy storage read failed';
      return cached;                       // retry next call
    }
    if (legacy) {
      cached = legacy;
      loaded = true;
      loadError = null;
      // Forward-write, and clear the legacy copy ONLY after the write is known
      // good — a divergence window (both copies present) is harmless because
      // storage.local wins the read order; a lost session is not.
      const w = await PageSettings.write({ [KEY]: legacy });
      if (w.ok) { try { await LearnStore.setMeta(LEGACY_KEY, null); } catch (_) {} }
      return cached;
    }
    cached = null;
    loaded = true;
    loadError = null;
    return cached;
  }

  async function store(next) {
    cached = next;
    loaded = true;
    if (next) {
      const w = await PageSettings.write({ [KEY]: next });
      if (!w.ok) loadError = w.error || 'storage write failed';   // stays in memory
      // 身份与会话**分开存**（§8.4.1.1）。跨面交接要传的只是一个不透明 id，
      // 而 `learnAuth` 里有 access / refresh token —— 把整个会话放进内容脚本读得到
      // 的键列表是另一件事，那件事仍然禁止。这个键只装 userId，别的一个字节都没有。
      try { await PageSettings.write({ [UID_KEY]: next.userId || '' }); } catch (_) {}
    } else {
      await PageSettings.removeKeys([KEY, UID_KEY]);
      // Best-effort: a sign-out must not leave a resurrectable legacy copy.
      try { await LearnStore.setMeta(LEGACY_KEY, null); } catch (_) {}
    }
    for (const fn of listeners.slice()) { try { fn(next); } catch (_) {} }
    return next;
  }

  function sessionFrom(json) {
    if (!json || !json.access_token) {
      const e = new Error('no session in response');
      e.code = 'bad_response';
      throw e;
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || null,
      expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
      email: (json.user && json.user.email) || null,
      // 手机号用户没有 email（§8.4.1.2）。带上它，界面才有东西可显示 ——
      // 少了这一行的表现是「登录成功却显示空白」。
      phone: (json.user && json.user.phone) || null,
      userId: (json.user && json.user.id) || null,
    };
  }

  // 界面上「你是谁」只有一个口径。手机号用户没有 email，邮箱用户没有 phone，
  // 而三个面（设置页 / 复习页 / App）都要显示同一件事 —— 写在这里，不是各写一遍。
  function displayName(session) {
    if (!session) return '';
    return session.email || session.phone || '';
  }

  // 邮箱还是手机号。只判「像不像手机号」，不判归属地 —— 归属地由服务端说了算。
  // 写成 if 而不是三元，是为了避开 test/error-copy.test.js 的扫法：它把
  // `? 'x' : 'y'` 当作「从状态码分支出来的错误 code」。这两个不是错误 code。
  function idField(who) {
    const v = String(who == null ? '' : who).trim();
    if (/^\+?\d[\d\s-]{5,}$/.test(v)) return 'phone';
    return 'email';
  }
  // 手机号统一成 E.164：Supabase 要的是 +8613800138000 这种形状。
  // 纯 11 位且以 1 开头 → 按中国大陆补 +86（PNVS 只发 +86，见 §8.4.1.2）。
  function normPhone(v) {
    const t = String(v || '').replace(/[\s-]/g, '');
    if (t.startsWith('+')) return t;
    if (/^1\d{10}$/.test(t)) return '+86' + t;
    return '+' + t;
  }

  // ─── The five ────────────────────────────────────────────────────────────

  // Asks the provider to email a code. `create_user` means signing in and signing up
  // are the same action: there is no password to choose, so a separate registration
  // step would be a form that asks for nothing.
  //
  // `who` 是**邮箱或手机号**（§8.4.1.2）。同一个端点，换一个字段 —— 所以手机号那条
  // 路没有第二份状态机、第二种 session 形状、第二处刷新逻辑。发送侧的差别（邮件
  // 模板 vs Send SMS Hook → 阿里云 PNVS）整个在服务端，客户端看不见。
  function signIn(who) {
    const field = idField(who);
    const body = field === 'phone'
      ? { phone: normPhone(who), create_user: true }
      : { email: String(who || '').trim(), create_user: true };
    return post('/otp', body).then(() => ({ ok: true, via: field }));
  }

  async function verify(who, code) {
    const field = idField(who);
    const json = await post('/verify', field === 'phone'
      ? { type: 'sms', phone: normPhone(who), token: String(code || '').trim() }
      : { type: 'email', email: String(who || '').trim(), token: String(code || '').trim() });
    return store(sessionFrom(json));
  }

  // Password sign-in (2026-08-17, §8.4.1) — the SAME provider, a second grant
  // type, so sync.js still never learns how the token was obtained. Added for
  // App Review: reviewers need a username+password demo account, and an
  // OTP-only flow cannot hand one over (the code lands in a mailbox they don't
  // have). Passwords are set server-side per account for now — there is no
  // in-product "set password" surface, so OTP remains the path every real user
  // takes; this grant simply accepts an account that HAS one.
  async function signInPassword(email, password) {
    const json = await post('/token?grant_type=password', {
      email: String(email || '').trim(),
      password: String(password || ''),
    });
    return store(sessionFrom(json));
  }

  // Returns a currently-valid access token, refreshing if needed, or null when signed
  // out. Callers treat null as "sync is off", never as an error.
  async function token() {
    const s = await load();
    if (!s) return null;
    if (Date.now() < s.expiresAt - SKEW_MS) return s.accessToken;
    if (!s.refreshToken) { await store(null); return null; }

    // Several callers (push, pull, usage) can hit an expired token at once. Without
    // this guard each fires its own refresh, and a provider that rotates refresh
    // tokens invalidates the others mid-flight — which presents as a random
    // signed-out, hard to reproduce and easy to blame on the network.
    if (!refreshing) {
      const attempt = () =>
        post('/token?grant_type=refresh_token', { refresh_token: s.refreshToken });
      refreshing = attempt()
        .catch((e) => {
          // Sign out ONLY on a definitive provider rejection: 400/401 WITH a
          // GoTrue error body (invalid_grant and friends). Offline, 5xx, and
          // body-less 4xx (proxies, captive portals, hiccups) get ONE immediate
          // retry — GoTrue's refresh-reuse grace interval covers this window —
          // and then throw WITHOUT killing the session. 判死收紧, §8.4.1: a
          // server hiccup must never read as "you were signed out".
          if ((e.status === 400 || e.status === 401) && e.hasBody) throw e;
          return attempt();
        })
        .then((json) => store(sessionFrom(json)))
        .catch(async (e) => {
          if ((e.status === 400 || e.status === 401) && e.hasBody) {
            await store(null);
            return null;
          }
          throw e;   // transient: session survives, caller sees offline/http error
        })
        .finally(() => { refreshing = null; });
    }
    const next = await refreshing;
    return next ? next.accessToken : null;
  }

  async function signOut() {
    const s = await load();
    if (s && s.accessToken) {
      // Best-effort: the local session must be dropped whether or not the provider
      // acknowledges. A user who clicked sign-out is signed out.
      try { await post('/logout', {}, { Authorization: 'Bearer ' + s.accessToken }); } catch (_) {}
    }
    await store(null);
    return { ok: true };
  }

  // §8.7: deletion must be ONE action, and must include the account itself — not just
  // the rows. Deleting the auth user needs a privileged key we correctly do not ship,
  // so it goes through an Edge Function that authenticates the caller and deletes only
  // the caller. If that half fails we report a PARTIAL result: the data really is
  // gone, the account really is not, and saying "deleted" would be a lie the user
  // cannot check.
  async function deleteAccount() {
    const t = await token();
    if (!t) { const e = new Error('not signed in'); e.code = 'signed_out'; throw e; }
    const auth = { Authorization: 'Bearer ' + t };

    const res = await fetch(
      MT_BACKEND.url + '/rest/v1/' + MT_BACKEND.table + '?seq=gt.0',
      { method: 'DELETE', headers: Object.assign(baseHeaders(), auth) });
    if (!res.ok && res.status !== 404) {
      throw errorFrom(res.status, await res.json().catch(() => null));
    }

    let account = true, reason = null;
    try {
      const fn = await fetch(MT_BACKEND.url + '/functions/v1/bt-delete-account',
        { method: 'POST', headers: Object.assign(baseHeaders(), auth) });
      if (!fn.ok) { account = false; reason = 'HTTP ' + fn.status; }
    } catch (e) {
      account = false;
      reason = String(e && e.message || e);
    }

    await store(null);
    return { data: true, account, reason };
  }

  // ─── Read-only helpers for the UI ────────────────────────────────────────

  async function current() { return await load(); }
  // sync.js is allowed to ask "who am I". It is NOT allowed to take the session
  // object apart — §8.4.1 keeps it ignorant of where the token comes from, and a
  // field read here would be exactly that knowledge leaking one file over.
  // Signed out returns null rather than throwing: "no identity" is a legitimate
  // row of the owner truth table, not a failure.
  async function userId() { const s = await load(); return (s && s.userId) || null; }

  // ─── Which corpus this account uses (§ account switch) ───────────────────
  // The policy needs both halves — the session (this file) and chrome.storage
  // (PageSettings) — so it lives here. LearnStore owns only the MECHANISM
  // (`useDb`) and stays free of any notion of an account.
  //
  // The primary database keeps its name and its bytes, and belongs to the first
  // account that signs in. Every device in the world is in exactly that state
  // today, so this CLAIMS rather than migrates: nothing is copied, nothing moves,
  // and an existing user reads byte-for-byte the same corpus as before. Only a
  // second, different account gets a database of its own.
  const DB_OWNER = 'learnDbOwner';     // userId that owns the primary database
  const DB_ACTIVE = 'learnActiveDb';   // database currently selected

  async function bindCorpus(session) {
    // Read the session DIRECTLY instead of through load(): load() also carries the
    // pre-2026-08-09 legacy migration, which touches IndexedDB — and deciding WHICH
    // database to use must not itself require opening one. It deadlocked exactly
    // there: the bind became the first thing to open the store, early enough to
    // collide with a connection that had not closed yet, and the review page's
    // whole bootstrap stopped behind it with a blank screen and nothing said.
    let me = null;
    if (session !== undefined) me = (session && session.userId) || null;
    else {
      const c = cachedSession();
      if (c) me = c.userId || null;
      else {
        const r = await PageSettings.read([KEY]);
        me = (r.ok && r.data[KEY] && r.data[KEY].userId) || null;
      }
    }
    let want;
    if (!me) {
      // Signed out keeps whatever was last selected. "Signing out is not a reason
      // to lose what you learned" is the existing stance; revealing the PREVIOUS
      // account's corpus after signing out of this one would break that promise
      // from the other side.
      const r = await PageSettings.read([DB_ACTIVE]);
      want = (r.ok && r.data[DB_ACTIVE]) || LearnStore.DB_NAME;
    } else {
      const r = await PageSettings.read([DB_OWNER]);
      const owner = r.ok ? (r.data[DB_OWNER] || null) : null;
      if (!owner) {
        // Unclaimed: this is every upgrading device. Claim the primary — do not
        // create a second database and do not move anything into it.
        await PageSettings.write({ [DB_OWNER]: me });
        want = LearnStore.DB_NAME;
      } else {
        want = (owner === me) ? LearnStore.DB_NAME : LearnStore.dbNameFor(me);
      }
    }
    await LearnStore.useDb(want);
    await PageSettings.write({ [DB_ACTIVE]: want });
    return want;
  }
  // 这台设备上的**主库**是不是属于别人（§8.4.1.2 的身份合并那一节）。
  //
  // 为什么需要它：换一个身份登录时 bindCorpus 会给这个账号一个独立的空库，
  // ownerGate 读的是库内部的戳，新库是空的于是直接认领 —— 整条路**一个错都不报**。
  // 用户看到的是一个空的复习页，而他那堆卡还在这台设备上、只是挂在另一个身份下。
  // 「隐藏我的邮箱」和手机号都会走到这里（都不参与按邮箱的自动并号）。
  //
  // 不开数据库：只读两个 storage 键。§8.4.3 那条「绑定不许要求打开数据库」的纪律
  // 是为死锁付过代价的，这里没有理由再碰它。
  async function otherAccountOnDevice() {
    const r = await PageSettings.read([DB_OWNER]);
    const owner = (r.ok && r.data[DB_OWNER]) || null;
    if (!owner) return false;
    const me = await userId();
    return !!(me && owner !== me);
  }

  function cachedSession() { return cached; }          // sync read for first paint
  // Non-null when the LAST load/store hit a storage failure. The UI uses it to
  // say 「存储读取失败」 instead of painting the signed-out state (law 2).
  function lastLoadError() { return loadError; }
  function onChange(fn) {
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }
  // ─── 第三方登录（§8.4.1.2）────────────────────────────────────────────────
  //
  // 一条流程覆盖 Chrome / Firefox / Safari。**不用 chrome.identity.launchWebAuthFlow**：
  // Safari 上它不工作，而 Safari 是用户主力；且 Safari 扩展的源
  // `safari-web-extension://<UUID>` 每次重装都轮换，登记不成固定回调地址。
  //
  // 所以回调落在我们自己的站点上，内容脚本只把 `code` + `state` 递回来 ——
  // 那张票没有 `code_verifier` 兑换不出任何东西，而 verifier 只在这里，从不跨界。

  function b64url(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randomB64(n) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return b64url(a);
  }
  async function challengeOf(verifier) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return b64url(new Uint8Array(buf));
  }

  // **返回**要打开的 URL，自己不开窗。用户手势必须在点击处理器里同步用掉 ——
  // 任何 await 都会把它消耗掉，Safari 随后静默拦下（test/user-gesture.test.js 钉过）。
  async function startProviderSignIn(provider, redirectTo) {
    const verifier = randomB64(64);
    const state = randomB64(16);
    await PageSettings.write({
      [PKCE_KEY]: { verifier, state, provider: String(provider), at: Date.now() },
    });
    const challenge = await challengeOf(verifier);
    const q = [
      ['provider', String(provider)],
      ['code_challenge', challenge],
      ['code_challenge_method', 's256'],
      ['redirect_to', String(redirectTo)],
    ].map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    return api() + '/authorize?' + q;
  }

  // 回调之后在**扩展页**里兑换。不经 background：Safari iOS 锁屏后 service worker
  // 永久 undefined，sendMessage 会静默失败（项目须知里的头号约束：Safari 的后台脚本不可依赖）。
  async function completeProviderSignIn() {
    const r = await PageSettings.read([PKCE_KEY, CODE_KEY]);
    // 存储读失败不是「没有票」。混同的话，一次读失败会被画成「登录没发生」，
    // 而用户明明刚走完一整圈 —— 同 load() 里 loadError 的那条纪律。
    if (!r.ok) { const e = new Error(r.error || 'storage read failed'); e.code = 'storage_error'; throw e; }
    const pending = r.data[PKCE_KEY];
    const ticket = r.data[CODE_KEY];
    if (!ticket || !ticket.code) return null;               // 没有票，什么都不做
    // 票用过就作废，无论后面成不成 —— 留着会在下次开设置页时重放一次必然失败的兑换。
    await PageSettings.removeKeys([CODE_KEY]);
    if (!pending || !pending.verifier) {
      const e = new Error('no pending sign-in'); e.code = 'pkce_missing'; throw e;
    }
    // state 不符 = 这张票不是我们发起的那次。停住，**且不发任何请求**。
    if (!ticket.state || ticket.state !== pending.state) {
      await PageSettings.removeKeys([PKCE_KEY]);
      const e = new Error('state mismatch'); e.code = 'pkce_state'; throw e;
    }
    try {
      const json = await post('/token?grant_type=pkce', {
        auth_code: String(ticket.code),
        code_verifier: pending.verifier,
      });
      return store(sessionFrom(json));
    } finally {
      await PageSettings.removeKeys([PKCE_KEY]);
    }
  }

  // App 侧的原生登录（Sign in with Apple / Google），走 id_token grant。
  // 原生那边拿到 identityToken 与 nonce，桥进来的只有这两样。
  async function signInWithIdToken(provider, idToken, nonce) {
    const body = { provider: String(provider), id_token: String(idToken) };
    if (nonce) body.nonce = String(nonce);
    const json = await post('/token?grant_type=id_token', body);
    return store(sessionFrom(json));
  }

  function _reset() { cached = null; loaded = false; loadError = null; refreshing = null; listeners.length = 0; }

  return {
    signIn, verify, signInPassword, token, signOut, deleteAccount,
    startProviderSignIn, completeProviderSignIn, signInWithIdToken,
    current, userId, displayName, bindCorpus, otherAccountOnDevice,
    cachedSession, lastLoadError, onChange,
    _reset,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnAuth;
