// test/bel197-default-browser.test.js — BEL-197 Mac default browser.
//
// The load-bearing properties:
//   · macOS MTWebAuth opens the system default browser with NSWorkspace.shared.open
//     and has NO ASWebAuthenticationSession fallback (one carrier: MTDeepLink);
//     iOS keeps the ASWebAuthenticationSession sheet and its ephemeral flag.
//   · `scheme://auth?code=…` is intercepted after the MCP callback and before
//     parseDeepLink, then redeemed by the one existing completeProviderSignIn path.
//     It must never reach applyDeepLink's account branches.
//   · Google has an in-App cancel and a 5-minute backstop (a closed tab is not a
//     canceled login), and the busy lock is released by either.
//   · The MCP callback predicate still says false for `://auth` (MCP must not steal
//     Google), and `://oauth/mcp/callback` still routes first.

const fs = require('fs');
const path = require('path');
const { describe, test, loadSrc, ok, eq } = require('./harness');
const { stripComments } = require('./lib/strip-comments');

const ROOT = path.join(__dirname, '..');
const Shell = loadSrc('src/app/shell-model.js', 'Shell', { URL }).Shell;
const Bridge = require('../agent/device-bridge');
const DeviceBridgeHost = loadSrc('src/app/device-bridge-host.js', 'DeviceBridgeHost',
  { URL, URLSearchParams }).DeviceBridgeHost;

function swift() {
  return fs.readFileSync(path.join(ROOT, 'app/native/apple-signin-bridge.swift'), 'utf8');
}

describe('BEL-197 Swift: macOS default browser, iOS sheet unchanged', () => {
  test('macOS branch is NSWorkspace.shared.open(u), with AppKit and no Chrome/profile', () => {
    const src = swift();
    const begin = src.indexOf('private func begin(url: String, scheme: String)');
    const start = src.indexOf('#if os(macOS)', begin);
    const alt = src.indexOf('#else', start);
    const end = src.indexOf('#endif', alt);
    ok(begin > 0 && start > begin && alt > start && end > alt, 'MTWebAuth.begin branches not found');
    const mac = stripComments(src.slice(start, alt));
    ok(mac.includes('NSWorkspace.shared.open(u)'), 'macOS does not open the system default browser');
    ok(!mac.includes('ASWebAuthenticationSession'), 'macOS kept an ASWebAuthenticationSession fallback');
    ok(!mac.includes('session ='), 'macOS still stores a web-auth session');
    ok(!/--profile-directory|NSWorkspace\.OpenConfiguration|Google Chrome/i.test(mac),
      'macOS chooses a browser or a Chrome profile');
    ok(/#if os\(macOS\)\s*\nimport AppKit\s*\n#endif/.test(src), 'AppKit is not imported for macOS');
  });

  test('iOS branch still has ASWebAuthenticationSession + prefersEphemeralWebBrowserSession', () => {
    const src = swift();
    const begin = src.indexOf('private func begin(url: String, scheme: String)');
    const alt = src.indexOf('#else', begin);
    const end = src.indexOf('#endif', alt);
    const ios = src.slice(alt, end);
    ok(ios.includes('ASWebAuthenticationSession(url: u, callbackURLScheme: scheme)'), 'iOS sheet was removed');
    ok(ios.includes('s.prefersEphemeralWebBrowserSession = true'), 'iOS lost the ephemeral session');
    ok(ios.includes('canceledLogin'), 'iOS lost its own cancel path');
  });

  test('empty {} still selects native Apple; url/scheme still selects MTWebAuth', () => {
    const src = swift();
    const relay = src.slice(src.indexOf('final class MTAppleSignInRelay'));
    ok(relay.includes('let url = d["url"] as? String, let scheme = d["scheme"] as? String'),
      'the relay no longer requires url/scheme for the web path');
    ok(relay.includes('MTWebAuth.start(url: url, scheme: scheme)'), 'web path lost');
    ok(relay.includes('MTAppleSignIn.start()'), 'empty {} Apple path changed');
  });
});

describe('BEL-197 provider auth deeplink', () => {
  test('intl/CN schemes, host=auth and path=/auth are ours; code/state are read', () => {
    eq(JSON.stringify(Shell.providerAuthFromUrl('belliedmonkey://auth?code=c1&state=s1')),
      JSON.stringify({ code: 'c1', state: 's1', error: '' }));
    eq(JSON.stringify(Shell.providerAuthFromUrl('belliedmonkeycn://auth?code=c2&st=s2')),
      JSON.stringify({ code: 'c2', state: 's2', error: '' }));
    eq(Shell.providerAuthFromUrl('belliedmonkey:///auth?code=c3').code, 'c3');
    eq(Shell.providerAuthFromUrl('belliedmonkey://auth?error=access_denied').error, 'access_denied');
  });

  test('MCP, agent, other schemes and non-auth hosts are not provider auth', () => {
    eq(Shell.providerAuthFromUrl('belliedmonkey://oauth/mcp/callback?code=x&state=s'), null);
    eq(Shell.providerAuthFromUrl('belliedmonkey://agent/v1/open_setup?step=login'), null);
    eq(Shell.providerAuthFromUrl('https://belliedmonkey://auth?code=x'), null);
    eq(Shell.providerAuthFromUrl('belliedmonkey://authx?code=x'), null);
  });

  test('the real host still says isOAuthCallback(://auth) === false', () => {
    const host = DeviceBridgeHost.createHost({ store: Bridge.memoryStore() });
    eq(host.isOAuthCallback('belliedmonkey://auth?code=x'), false);
    eq(host.isOAuthCallback('belliedmonkey://oauth/mcp/callback?code=x&state=s'), true);
  });
});

describe('BEL-197 route order: MCP → Google auth → generic deep link', () => {
  test('MCP callback wins first and never reaches the auth or parse routes', () => {
    const calls = [];
    const out = Shell.routeDeepLink('belliedmonkey://oauth/mcp/callback?code=x&state=s', {
      isOAuthCallback: () => true,
      handleOAuthCallback: async () => { calls.push('oauth'); },
      finishProviderAuth: () => { calls.push('auth'); },
      parseDeepLink: () => { calls.push('parse'); return { action: 'auth' }; },
      applyDeepLink: () => { calls.push('apply'); },
    });
    eq(out, 'oauth');
    eq(calls.join(','), 'oauth');
  });

  test('://auth is handed to the Google flow and NEVER to applyDeepLink', () => {
    const calls = [];
    const out = Shell.routeDeepLink('belliedmonkey://auth?code=abc&state=s', {
      isOAuthCallback: () => false,
      handleOAuthCallback: () => { calls.push('oauth'); },
      finishProviderAuth: (r) => { calls.push('auth:' + r.code); },
      parseDeepLink: () => { calls.push('parse'); return { action: 'auth' }; },
      applyDeepLink: () => { calls.push('apply'); },
    });
    eq(out, 'provider-auth');
    eq(calls.join(','), 'auth:abc');
  });

  test('everything else is left to the boot listener parse/apply (existing agent copy owns it)', () => {
    const calls = [];
    const out = Shell.routeDeepLink('belliedmonkey://agent/v1/nope', {
      isOAuthCallback: () => false,
      finishProviderAuth: () => { calls.push('auth'); },
      parseDeepLink: () => { calls.push('parse'); return { action: 'agent' }; },
      applyDeepLink: () => { calls.push('apply'); },
    });
    eq(out, 'deeplink');
    eq(calls.join(','), '', 'the route helper must not consume a generic deep link');
  });

  test('the boot listener puts isOAuthCallback before auth before parseDeepLink', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8');
    const oauth = src.indexOf('deviceBridgeHost.isOAuthCallback(raw)');
    const auth = src.indexOf('finishProviderAuth: (r) => googleFlow.finish(r)');
    const parse = src.indexOf('const d = parseDeepLink(raw)', auth);
    ok(oauth > 0, 'no OAuth predicate in the boot listener');
    ok(auth > oauth, 'Google auth is not after the MCP callback');
    ok(parse > auth, 'parseDeepLink is not after the Google auth intercept');
    ok(/providerAuthFromUrl\(raw\)/.test(src), 'the boot listener does not use providerAuthFromUrl');
  });
});

function googleHarness(overrides) {
  const state = {
    busy: null, pending: null, said: [], shown: 0, synced: 0,
    waitMs: 0, timer: null, cleared: 0,
  };
  const calls = { complete: [], notes: [], prepare: 0 };
  const flow = Shell.createGoogleAuthFlow(Object.assign({
    learnAuth: {
      completeProviderSignIn: async (ticket) => { calls.complete.push(ticket); return { userId: 'u1' }; },
    },
    setBusy: (b) => { state.busy = b; },
    onPending: (p) => { state.pending = p; },
    say: (m, isErr) => { state.said.push({ m: m || '', isErr: !!isErr }); },
    show: async () => { state.shown += 1; },
    doSync: async () => { state.synced += 1; },
    prepare: async () => { calls.prepare += 1; },
    noteNative: (err) => { calls.notes.push(['native', err]); },
    notePostLogin: (err) => { calls.notes.push(['post_login', err]); },
    humanError: (e) => 'ERR:' + ((e && e.code) || 'unknown'),
    verifyingText: () => 'verifying',
    failedText: () => 'failed',
    timeoutText: () => 'timeout',
    setTimeout: (fn, ms) => { state.waitMs = ms; state.timer = fn; return 9; },
    clearTimeout: () => { state.cleared += 1; },
  }, overrides || {}));
  return { flow, state, calls };
}

describe('BEL-197 Google flow: deeplink-only completion, cancel, timeout', () => {
  test('deeplink-only (no webauth-result) completes PKCE and releases busy', async () => {
    const { flow, state, calls } = googleHarness();
    flow.begin();
    eq(state.busy, true);
    eq(state.pending, true);
    const session = await flow.finish(Shell.providerAuthFromUrl('belliedmonkey://auth?code=abc&state=s'));
    eq(session.userId, 'u1');
    eq(calls.complete.length, 1);
    eq(calls.complete[0].code, 'abc');
    eq(calls.complete[0].state, 's');
    eq(state.busy, false, 'deeplink completion left loginBusy locked');
    eq(state.pending, false);
    eq(state.shown, 1);
    eq(state.synced, 1);
  });

  test('CN deeplink goes through the same single exchange', async () => {
    const { flow, state, calls } = googleHarness();
    flow.begin();
    await flow.finish(Shell.providerAuthFromUrl('belliedmonkeycn://auth?code=cn1'));
    eq(calls.complete.length, 1);
    eq(calls.complete[0].code, 'cn1');
    eq(state.busy, false);
  });

  test('a second carrier for the same code cannot redeem twice', async () => {
    const { flow, calls } = googleHarness();
    flow.begin();
    await flow.finish({ code: 'abc', state: 's' });
    await flow.finish({ code: 'abc', state: 's' });
    eq(calls.complete.length, 1, 'the late webauth-result re-ran completeProviderSignIn');
  });

  test('in-App cancel unlocks busy, clears the wait and rotates the verifier', () => {
    const { flow, state, calls } = googleHarness();
    flow.begin();
    eq(flow.cancel(), true);
    eq(state.busy, false);
    eq(state.pending, false);
    eq(state.said[state.said.length - 1].m, '');
    eq(calls.complete.length, 0);
    eq(calls.prepare, 1, 'cancel did not rotate the one-time verifier');
    eq(flow.cancel(), false, 'cancel is not idempotent');
  });

  test('5-minute backstop unlocks busy without pretending a closed tab canceled', () => {
    const { flow, state, calls } = googleHarness();
    flow.begin();
    eq(state.waitMs, Shell.GOOGLE_AUTH_WAIT_MS);
    eq(Shell.GOOGLE_AUTH_WAIT_MS, 5 * 60 * 1000);
    state.timer();
    eq(state.busy, false);
    eq(state.pending, false);
    eq(state.said[state.said.length - 1].m, 'timeout');
    eq(state.said[state.said.length - 1].isErr, true);
    eq(calls.complete.length, 0);
    eq(calls.prepare, 1);
  });

  test('iOS canceled result unlocks but is not painted as an error', async () => {
    const { flow, state } = googleHarness();
    flow.begin();
    await flow.finish({ error: 'canceled' });
    eq(state.busy, false);
    eq(state.said[state.said.length - 1].m, '');
    eq(state.said[state.said.length - 1].isErr, false);
  });

  test('a postMessage failure unlocks and reports the failure', async () => {
    const { flow, state, calls } = googleHarness();
    flow.begin();
    await flow.finish({ error: 'post_failed' });
    eq(state.busy, false);
    eq(calls.notes.length, 1);
    eq(calls.notes[0][0], 'native');
  });

  test('the App has a dedicated cancel button wired to googleFlow.cancel()', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8');
    ok(src.includes("b.id = 'btn-google-cancel'"), 'no in-App cancel button');
    ok(/googleFlow\.cancel\(\)/.test(src), 'the cancel button does not call the flow');
    ok(!/const LOGIN_ENTRY_IDS = \[[^\]]*'btn-google-cancel'/.test(src),
      'the cancel button is in the locked entry list and would be disabled');
  });
});
