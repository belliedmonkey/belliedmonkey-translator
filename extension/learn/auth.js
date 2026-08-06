// learn/auth.js — the ONLY module that knows what an identity provider is.
// See docs/learning-design.md §8.4.1.
//
// Surface is deliberately five functions wide — signIn / verify / token / signOut /
// deleteAccount. `sync.js` speaks PostgREST and never learns how the token was
// obtained, so changing identity provider is a one-file change. That is not
// speculative tidiness: the current backend is shared with another product and is
// expected to move (§8.4.1).
//
// Sign-in is a 6-DIGIT CODE, not a magic link. A link needs a page we host to catch
// the redirect, and we host nothing; a code is typed into the extension and needs no
// callback, no `identity` permission and no web navigation. This has a setup
// consequence worth stating where someone will find it: the provider's email template
// must render the code itself (GoTrue: `{{ .Token }}`) — the stock template sends a
// link, and a link cannot be completed from here.
//
// EXTENSION PAGES ONLY. The session lives in the extension's own IndexedDB rather
// than `chrome.storage.local` on purpose: content scripts can read the latter (they
// run in every page we translate), and a refresh token has no business being reachable
// from there.

var LearnAuth = (() => {
  const KEY = 'auth';
  // Refresh a minute early: a token that expires mid-request fails the request.
  const SKEW_MS = 60 * 1000;

  let cached = null;
  let loaded = false;
  let refreshing = null;               // single in-flight refresh, see token()
  const listeners = [];

  function api() { return MT_BACKEND.url + '/auth/v1'; }
  function baseHeaders() {
    return { apikey: MT_BACKEND.anonKey, 'Content-Type': 'application/json' };
  }

  // GoTrue reports failures in three different shapes depending on the endpoint and
  // the version. Normalising here keeps every caller from having to know that.
  function errorFrom(status, body) {
    const msg = (body && (body.error_description || body.msg || body.message ||
      body.error)) || ('HTTP ' + status);
    const e = new Error(msg);
    e.status = status;
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

  // ─── Session persistence ─────────────────────────────────────────────────

  async function load() {
    if (loaded) return cached;
    try { cached = await LearnStore.getMeta(KEY, null); } catch (_) { cached = null; }
    loaded = true;
    return cached;
  }

  async function store(next) {
    cached = next;
    loaded = true;
    try { await LearnStore.setMeta(KEY, next); } catch (_) { /* stays in memory */ }
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
      userId: (json.user && json.user.id) || null,
    };
  }

  // ─── The five ────────────────────────────────────────────────────────────

  // Asks the provider to email a code. `create_user` means signing in and signing up
  // are the same action: there is no password to choose, so a separate registration
  // step would be a form that asks for nothing.
  function signIn(email) {
    return post('/otp', { email: String(email || '').trim(), create_user: true })
      .then(() => ({ ok: true }));
  }

  async function verify(email, code) {
    const json = await post('/verify', {
      type: 'email',
      email: String(email || '').trim(),
      token: String(code || '').trim(),
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
      refreshing = post('/token?grant_type=refresh_token', { refresh_token: s.refreshToken })
        .then((json) => store(sessionFrom(json)))
        .catch(async (e) => {
          // A rejected refresh token is terminal: the session is gone and pretending
          // otherwise produces an app that retries forever while signed out.
          if (e.status === 400 || e.status === 401) { await store(null); return null; }
          throw e;
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
  function cachedSession() { return cached; }          // sync read for first paint
  function onChange(fn) {
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }
  function _reset() { cached = null; loaded = false; refreshing = null; listeners.length = 0; }

  return { signIn, verify, token, signOut, deleteAccount, current, cachedSession, onChange, _reset };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnAuth;
