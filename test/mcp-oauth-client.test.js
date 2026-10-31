// test/mcp-oauth-client.test.js — BEL-151 MCP OAuth public client (PKCE).
//
// What this pins (ACCEPT-T1/T2/T5/T6):
//   · flavor → frozen host + the App's own scheme as redirect; DCR is a public
//     client (token_endpoint_auth_method=none) with client_name/redirect/scopes;
//   · authorization_code + PKCE S256, state checked when the transport carries it;
//   · the refresh token lands in the system Keychain slot (mt.mcp.oauth), never in
//     the non-secret meta, and never in the device store with device_cred;
//   · refresh once on expiry; a definitive invalid_grant clears both slots; a
//     network failure keeps them (a blip must not read as "revoked");
//   · cancel and missing-channel paths send no token request, and none of them can
//     produce a device register;
//   · the end-to-end host wiring uses the MCP access token as the Bearer — the
//     LearnAuth/GoTrue token never appears on that wire.

const fs = require('fs');
const path = require('path');
const { describe, test, loadSrc, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const M = loadSrc('src/app/mcp-oauth-client.js', 'McpOAuth', { TextEncoder, URLSearchParams, crypto: globalThis.crypto }).McpOAuth;
const Host = loadSrc('src/app/device-bridge-host.js', 'DeviceBridgeHost', { URLSearchParams, TextEncoder }).DeviceBridgeHost;
const bridge = require('../agent/device-bridge');
const copy = require('../agent/copy');

const INTL = 'https://mcp.belliedmonkey.cc';
const CHINA = 'https://mcp.belliedmonkey.com';

function json(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function memoryKeychain(seed) {
  const data = new Map(Object.entries(seed || {}));
  const calls = [];
  return {
    calls,
    persistent: true,
    available: () => true,
    async get(account) { calls.push(['get', account]); return data.has(account) ? data.get(account) : null; },
    async set(account, value) { calls.push(['set', account]); data.set(account, String(value)); return true; },
    async clear(account) { calls.push(['clear', account]); data.delete(account); return true; },
    dump() { return Object.fromEntries(data); },
  };
}

function memoryMeta(seed) {
  const data = Object.assign({}, seed || {});
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    dump: () => Object.assign({}, data),
  };
}

function harness(extra) {
  const state = {
    clock: 1700000000000,
    token: json(200, {
      access_token: 'mcp-access-1',
      refresh_token: 'mcp-refresh-1',
      expires_in: 3600,
      token_type: 'Bearer',
    }),
    register: json(201, { client_id: 'client-1' }),
    calls: [],
    authUrl: '',
    openAuthCalls: 0,
  };
  const fetch = async (url, init) => {
    const u = String(url);
    state.calls.push({ url: u, init: init || {} });
    if (u === INTL + '/oauth/register' || u === CHINA + '/oauth/register') {
      return typeof state.register === 'function' ? state.register() : state.register;
    }
    if (u === INTL + '/oauth/token' || u === CHINA + '/oauth/token') {
      return typeof state.token === 'function' ? state.token() : state.token;
    }
    return json(404, { error: 'not_found' });
  };
  const keychain = (extra && extra.keychain) || memoryKeychain();
  const meta = (extra && extra.meta) || memoryMeta();
  const openAuth = extra && Object.prototype.hasOwnProperty.call(extra, 'openAuth') ? extra.openAuth
    : async ({ url, state: st }) => {
      state.openAuthCalls += 1;
      state.authUrl = url;
      return { code: 'good-code', state: st };
    };
  const client = M.createClient({
    flavor: () => (extra && extra.flavor) || 'global',
    fetch,
    keychain,
    meta,
    openAuth,
    now: () => state.clock,
    crypto: globalThis.crypto,
  });
  return { state, fetch, keychain, meta, client };
}

function tokenForm(call) {
  return new URLSearchParams(String(call.init.body || ''));
}

describe('MCP OAuth: PKCE and the redirect', () => {
  test('RFC 7636 S256 vector', async () => {
    const challenge = await M.pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    eq(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  test('intl and china use their frozen host and the App scheme already registered', () => {
    const intl = M.createClient({ flavor: () => 'global', keychain: memoryKeychain(), meta: memoryMeta() });
    eq(intl.baseUrl(), INTL);
    eq(intl.scheme(), 'belliedmonkey');
    eq(intl.redirectUri(), 'belliedmonkey://oauth/mcp/callback');

    const china = M.createClient({ flavor: () => 'china', keychain: memoryKeychain(), meta: memoryMeta() });
    eq(china.baseUrl(), CHINA);
    eq(china.scheme(), 'belliedmonkeycn');
    eq(china.redirectUri(), 'belliedmonkeycn://oauth/mcp/callback');
  });

  test('a deep-link callback is parsed; anything else stays with its owner', () => {
    eq(
      JSON.stringify(M.callbackFromUrl('belliedmonkey://oauth/mcp/callback?code=abc&state=s1')),
      JSON.stringify({ code: 'abc', state: 's1', error: '' }),
    );
    eq(M.callbackFromUrl('belliedmonkey://oauth/mcp/callback?error=access_denied').error, 'access_denied');
    eq(M.callbackFromUrl('belliedmonkey://auth?code=x'), null);
    eq(M.callbackFromUrl('belliedmonkey://agent/v1/open_setup?step=login'), null);
    eq(M.callbackFromUrl('evil://oauth/mcp/callback?code=x'), null);
    eq(M.callbackFromUrl('not a url'), null);
  });
});

describe('MCP OAuth: DCR + authorization_code', () => {
  test('DCR is a public client with the App callback and the frozen scopes', async () => {
    const h = harness();
    const out = await h.client.connect({ account: 'u1' });
    eq(out.ok, true);
    eq(out.skipped, 'consent');

    const dcrCall = h.state.calls[0];
    eq(dcrCall.url, INTL + '/oauth/register');
    eq(dcrCall.init.method, 'POST');
    const body = JSON.parse(dcrCall.init.body);
    eq(body.token_endpoint_auth_method, 'none');
    eq(body.client_name.includes('belliedmonkey-app'), true, 'client_name has no app marker: ' + body.client_name);
    eq(body.client_name.includes('global'), true, 'client_name has no flavor: ' + body.client_name);
    eq(JSON.stringify(body.redirect_uris), JSON.stringify(['belliedmonkey://oauth/mcp/callback']));
    eq(JSON.stringify(body.grant_types), JSON.stringify(['authorization_code', 'refresh_token']));
    eq(body.scope, 'mcp:read mcp:write offline_access');
    eq(h.meta.getItem('mcp_oauth_client_id'), 'client-1');
  });

  test('the authorize URL carries PKCE S256, state, scope and the same redirect', async () => {
    const h = harness();
    await h.client.connect({ account: 'u1' });
    const u = new URL(h.state.authUrl);
    eq(u.origin + u.pathname, INTL + '/authorize');
    eq(u.searchParams.get('response_type'), 'code');
    eq(u.searchParams.get('client_id'), 'client-1');
    eq(u.searchParams.get('redirect_uri'), 'belliedmonkey://oauth/mcp/callback');
    eq(u.searchParams.get('scope'), 'mcp:read mcp:write offline_access');
    eq(u.searchParams.get('code_challenge_method'), 'S256');
    ok((u.searchParams.get('state') || '').length >= 20, 'no state on the authorize URL');
    ok((u.searchParams.get('code_challenge') || '').length >= 43, 'no S256 challenge');
  });

  test('the token request is form-encoded and the verifier matches the challenge', async () => {
    const h = harness();
    await h.client.connect({ account: 'u1' });
    const tokenCall = h.state.calls.find((c) => c.url.endsWith('/oauth/token'));
    ok(!!tokenCall, 'no token request');
    eq(tokenCall.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
    const form = tokenForm(tokenCall);
    eq(form.get('grant_type'), 'authorization_code');
    eq(form.get('code'), 'good-code');
    eq(form.get('client_id'), 'client-1');
    eq(form.get('redirect_uri'), 'belliedmonkey://oauth/mcp/callback');
    const challenge = new URL(h.state.authUrl).searchParams.get('code_challenge');
    eq(await M.pkceChallenge(form.get('code_verifier')), challenge);
  });

  test('refresh and access go to the Keychain slot; the non-secret meta holds no token', async () => {
    const h = harness();
    await h.client.connect({ account: 'u1' });
    eq(await h.keychain.get('mcp_refresh'), 'mcp-refresh-1');
    eq(await h.keychain.get('mcp_access'), 'mcp-access-1');
    eq(h.meta.getItem('mcp_oauth_account'), 'u1');
    ok(Number(h.meta.getItem('mcp_oauth_expires_at')) > h.state.clock, 'no expiry written');
    const metaJson = JSON.stringify(h.meta.dump());
    ok(!metaJson.includes('mcp-refresh-1'), 'the refresh token leaked into the non-secret meta');
    ok(!metaJson.includes('mcp-access-1'), 'the access token leaked into the non-secret meta');
  });

  test('a valid same-account access token skips DCR and the browser (still needs the confirm outside)', async () => {
    const h = harness();
    await h.client.connect({ account: 'u1' });
    const before = h.state.calls.length;
    const opened = h.state.openAuthCalls;
    const out = await h.client.connect({ account: 'u1' });
    eq(out.skipped, 'access');
    eq(h.state.calls.length, before, 'connect fetched again despite a valid access token');
    eq(h.state.openAuthCalls, opened, 'connect opened the browser despite a valid access token');
  });

  test('china DCR/authorize use mcp.belliedmonkey.com and the cn scheme', async () => {
    const h = harness({ flavor: 'china' });
    await h.client.connect({ account: 'u1' });
    eq(h.state.calls[0].url, CHINA + '/oauth/register');
    const u = new URL(h.state.authUrl);
    eq(u.origin + u.pathname, CHINA + '/authorize');
    eq(u.searchParams.get('redirect_uri'), 'belliedmonkeycn://oauth/mcp/callback');
  });

  test('the user cancelling the consent is a cancel, not a token failure', async () => {
    const h = harness({ openAuth: async () => ({ error: 'canceled' }) });
    const out = await h.client.connect({ account: 'u1' });
    eq(out.code, 'cancelled');
    ok(!h.state.calls.some((c) => c.url.endsWith('/oauth/token')), 'cancel still hit the token endpoint');
    eq(await h.keychain.get('mcp_refresh'), null);
  });

  test('a state mismatch is refused before the code is exchanged', async () => {
    const h = harness({ openAuth: async () => ({ code: 'code-x', state: 'not-ours' }) });
    const out = await h.client.connect({ account: 'u1' });
    eq(out.code, 'unsupported_action');
    eq(out.detail, 'oauth_state');
    ok(!h.state.calls.some((c) => c.url.endsWith('/oauth/token')), 'a mismatched state was exchanged');
  });

  test('DCR refused → dependency, no authorize, no token', async () => {
    const h = harness();
    h.state.register = json(403, { error: 'registration_disabled' });
    const out = await h.client.connect({ account: 'u1' });
    eq(out.ok, false);
    eq(out.code, 'unsupported_action');
    eq(out.dependency, true);
    ok(/client_registration/.test(out.detail), 'detail lost: ' + out.detail);
    eq(h.state.openAuthCalls, 0, 'the browser opened without a client_id');
    ok(!h.state.calls.some((c) => c.url.endsWith('/oauth/token')), 'a token request followed a refused DCR');
    eq(h.meta.getItem('mcp_oauth_client_id'), null);
  });

  test('a shell without the auth bridge is a dependency, not a fake cancel', async () => {
    const h = harness({ openAuth: null });
    const out = await h.client.connect({ account: 'u1' });
    eq(out.code, 'unsupported_action');
    eq(out.detail, 'no_auth_channel');
    eq(h.state.calls.length, 0, 'a shell without a bridge still sent HTTP');
  });
});

describe('MCP OAuth: refresh, expiry and 401 fallout', () => {
  test('an expired access token refreshes once (single-flight) and rotates the refresh token', async () => {
    const h = harness();
    await h.client.connect({ account: 'u1' });
    h.state.clock += 3600 * 1000;
    h.state.token = json(200, {
      access_token: 'mcp-access-2', refresh_token: 'mcp-refresh-2', expires_in: 3600,
    });
    h.state.calls.length = 0;
    const [a, b] = await Promise.all([
      h.client.accessToken({ account: 'u1' }),
      h.client.accessToken({ account: 'u1' }),
    ]);
    eq(a, 'mcp-access-2');
    eq(b, 'mcp-access-2');
    const tokenCalls = h.state.calls.filter((c) => c.url.endsWith('/oauth/token'));
    eq(tokenCalls.length, 1, 'two concurrent callers each refreshed');
    const form = tokenForm(tokenCalls[0]);
    eq(form.get('grant_type'), 'refresh_token');
    eq(form.get('refresh_token'), 'mcp-refresh-1');
    eq(await h.keychain.get('mcp_refresh'), 'mcp-refresh-2');
    eq(await h.keychain.get('mcp_access'), 'mcp-access-2');
  });

  test('invalid_grant clears BOTH Keychain slots and the owner', async () => {
    const h = harness();
    await h.client.connect({ account: 'u1' });
    h.state.clock += 3600 * 1000;
    h.state.token = json(400, { error: 'invalid_grant' });
    const token = await h.client.accessToken({ account: 'u1' });
    eq(token, '');
    eq(await h.keychain.get('mcp_refresh'), null);
    eq(await h.keychain.get('mcp_access'), null);
    eq(h.meta.getItem('mcp_oauth_account'), null);
    eq(h.client.state().lastError, 'invalid_grant');
  });

  test('a network failure keeps the grant and is reported as network', async () => {
    const h = harness();
    await h.client.connect({ account: 'u1' });
    h.state.clock += 3600 * 1000;
    h.state.token = async () => { throw new Error('offline'); };
    const token = await h.client.accessToken({ account: 'u1' });
    eq(token, '');
    eq(await h.keychain.get('mcp_refresh'), 'mcp-refresh-1');
    eq(h.client.state().lastError, 'network');
    const out = await h.client.connect({ account: 'u1' });
    eq(out.code, 'network_unavailable');
  });

  test('connect() on a network failure returns network, not a consent flow', async () => {
    const h = harness();
    await h.client.connect({ account: 'u1' });
    h.state.clock += 3600 * 1000;
    h.state.token = async () => { throw new Error('offline'); };
    const opened = h.state.openAuthCalls;
    const out = await h.client.connect({ account: 'u1' });
    eq(out.code, 'network_unavailable');
    eq(h.state.openAuthCalls, opened, 'a network blip opened a new consent');
  });

  test('another account never reuses the stored grant', async () => {
    const h = harness();
    await h.client.connect({ account: 'u1' });
    eq(await h.client.accessToken({ account: 'u2' }), '');
    eq(h.state.calls.filter((c) => c.url.endsWith('/oauth/token')).length, 1,
      'u2 caused a refresh with u1 refresh token');
    eq(await h.keychain.get('mcp_refresh'), 'mcp-refresh-1');
  });
});

// ─── end-to-end: the host, the real OAuth client, a mock OAuth + device cloud ───
function integration(extra) {
  const order = [];
  const keychain = memoryKeychain();
  const meta = memoryMeta();
  const store = bridge.memoryStore();
  const calls = [];
  const fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init: init || {} });
    if (u.endsWith('/oauth/register')) { order.push('oauth-register'); return json(201, { client_id: 'client-it' }); }
    if (u.endsWith('/oauth/token')) {
      order.push('oauth-token');
      return json(200, { access_token: 'mcp-it-access', refresh_token: 'mcp-it-refresh', expires_in: 3600 });
    }
    if (u.endsWith('/api/mcp/device-sessions/register')) {
      order.push('device-register');
      return json(200, { ok: true, device_cred: 'dc-it', ttl_sec: 900 });
    }
    return json(404, {});
  };
  const oauth = M.createClient({
    flavor: () => 'global',
    fetch,
    keychain,
    meta,
    now: () => 1700000000000,
    crypto: globalThis.crypto,
    openAuth: async ({ url, state: st }) => {
      order.push('authorize-sheet');
      return { code: 'it-code', state: st };
    },
  });
  const ui = {
    confirm: async () => { order.push('confirm'); return { allow: true }; },
    show: async () => {},
  };
  const host = Host.createHost({
    auth: {
      current: async () => ({ userId: 'u1', accessToken: 'gotrue-it-token' }),
      token: async () => 'gotrue-it-token',
    },
    oauth,
    store,
    fetch,
    ui,
    flavor: () => 'global',
    appVersion: () => '1.22.3',
    now: () => 1700000000000,
  });
  return { order, keychain, meta, store, calls, oauth, host };
}

describe('MCP OAuth: host wiring end to end', () => {
  test('confirm → DCR → PKCE exchange → device register, and device_cred is a different slot', async () => {
    const it = integration();
    const out = await it.host.pair();
    eq(out.code, 'ok');
    eq(it.order.join(' > '), 'confirm > oauth-register > authorize-sheet > oauth-token > device-register');

    const reg = it.calls.find((c) => c.url.endsWith('/api/mcp/device-sessions/register'));
    ok(!!reg, 'no device register');
    eq(reg.init.headers.Authorization, 'Bearer mcp-it-access');
    ok(!JSON.stringify(it.calls).includes('gotrue-it-token'), 'the GoTrue token reached the mock cloud');
    eq(it.store.getItem('device_cred'), 'dc-it');
    eq(await it.keychain.get('mcp_refresh'), 'mcp-it-refresh');
    eq(it.meta.getItem('mcp_oauth_account'), 'u1');
    eq(it.meta.getItem('mcp_oauth_client_id'), 'client-it');
    // Different slots: the device store knows nothing about the refresh token, and
    // the Keychain knows nothing about device_cred.
    eq(it.store.getItem('mcp_refresh'), null);
    eq(it.keychain.dump().device_cred, undefined);
  });

  test('cancel confirm: zero HTTP — no DCR, no token, no device register', async () => {
    const it = integration();
    const out = await it.host.pair({ ui: { confirm: async () => ({ allow: false }), show: async () => {} } });
    eq(out.code, 'cancelled');
    eq(it.calls.length, 0, 'a cancelled confirm sent HTTP: ' + it.calls.map((c) => c.url).join(' '));
    eq(it.store.getItem('device_cred'), null);
  });

  test('a second pair reuses the same-account access token (no DCR, no consent)', async () => {
    const it = integration();
    eq((await it.host.pair()).code, 'ok');
    const before = it.calls.length;
    const out = await it.host.pair();
    eq(out.code, 'ok');
    eq(it.calls.length, before + 1, 'the second pair did more than the device register');
    eq(it.calls[it.calls.length - 1].url, 'https://mcp.belliedmonkey.cc/api/mcp/device-sessions/register');
  });

  test('the MCP client never claims persistence it does not have', async () => {
    const client = M.createClient({
      flavor: () => 'global',
      fetch: async () => json(201, { client_id: 'c' }),
      keychain: { persistent: false, available: () => false, get: async () => null, set: async () => false, clear: async () => false },
      meta: memoryMeta(),
      openAuth: null,
      crypto: globalThis.crypto,
    });
    eq(client.state().keychain, false);
  });
});

describe('MCP OAuth: the native half mirrors the JS protocol', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'app/native/mcp-oauth-bridge.swift'), 'utf8');
  const webauth = fs.readFileSync(path.join(ROOT, 'app/native/apple-signin-bridge.swift'), 'utf8');

  test('channel, service, accounts and ops are all in the Swift bridge', () => {
    ok(sw.includes('name: "mtMcpOAuth"'), 'channel name drifted');
    ok(sw.includes('"mt.mcp.oauth"'), 'Keychain service drifted');
    for (const account of ['mcp_refresh', 'mcp_access']) {
      ok(sw.includes('"' + account + '"'), 'account missing in Swift: ' + account);
    }
    for (const op of ['get', 'set', 'clear']) {
      ok(sw.includes('case "' + op + '":'), 'op missing in Swift: ' + op);
    }
    ok(/window\.__mtMcpOAuth/.test(sw), 'the reply window function is missing');
  });

  test('the bridge is in the sync block list and gets an install on both platforms', () => {
    const sync = fs.readFileSync(path.join(ROOT, 'scripts/sync-app-assets.js'), 'utf8');
    ok(/name: 'mt-mcp-oauth', src: 'mcp-oauth-bridge\.swift'/.test(sync), 'BLOCKS entry missing');
    ok(/MTMcpOAuth\.install/.test(sync), 'install patch missing');
    // The install line must not be wrapped in #if os(iOS) — the Mac is the P0 host.
    const around = sync.slice(sync.indexOf('MTMcpOAuth.install') - 400, sync.indexOf('MTMcpOAuth.install') + 100);
    ok(!/#if os\(iOS\)\n\s*MTMcpOAuth/.test(around), 'the MCP Keychain install is iOS-only');
  });

  test('the system auth sheet now returns the OAuth `state` (st stays for the site login)', () => {
    ok(/get\("state"\) \?\? get\("st"\)/.test(webauth), 'MTWebAuth drops the OAuth state');
  });
});
