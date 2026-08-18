// test/learn-auth.test.js — §8.4.1 password grant (2026-08-17).
//
// The load-bearing properties: signInPassword speaks the provider's password
// grant and nothing else new (same sessionFrom shape, same storage path as
// verify), a definitive rejection carries the provider's named code so the UI
// can say 「邮箱或密码不对」 instead of a stack trace, and offline never reads
// as an auth failure.

const { loadModule, describe, test, ok, eq } = require('./harness');

function load(fetchImpl) {
  const stored = {};
  const PageSettings = {
    read: async (keys) => ({ ok: true, data: {} }),
    write: async (items) => { Object.assign(stored, items); return { ok: true }; },
    removeKeys: async () => ({ ok: true }),
  };
  const LearnStore = { getMeta: async () => null, setMeta: async () => {} };
  const calls = [];
  const ctx = loadModule('learn/auth.js', {
    window: {},
    MT_BACKEND: { url: 'https://x.example', anonKey: 'anon', table: 'bt_chunks' },
    PageSettings, LearnStore,
    fetch: async (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); },
  });
  return { A: ctx.LearnAuth, calls, stored };
}

const okResponse = (body) => ({
  ok: true, status: 200,
  text: async () => JSON.stringify(body),
});
const errResponse = (status, body) => ({
  ok: false, status,
  text: async () => JSON.stringify(body),
});

describe('LearnAuth.signInPassword (§8.4.1 second grant)', () => {
  test('posts the password grant and stores the same session shape as verify', async () => {
    const { A, calls, stored } = load(async () => okResponse({
      access_token: 'at', refresh_token: 'rt', expires_in: 3600,
      user: { email: 'demo@example.com', id: 'u1' },
    }));
    const s = await A.signInPassword(' demo@example.com ', 'pw123');
    eq(calls.length, 1);
    ok(calls[0].url.endsWith('/auth/v1/token?grant_type=password'), calls[0].url);
    const body = JSON.parse(calls[0].init.body);
    eq(body.email, 'demo@example.com', '邮箱应裁剪空白');
    eq(body.password, 'pw123');
    eq(s.accessToken, 'at');
    eq(s.email, 'demo@example.com');
    ok(stored.learnAuth && stored.learnAuth.accessToken === 'at', '会话应落 chrome.storage');
  });

  test('a definitive rejection carries the provider code — the UI names the fix', async () => {
    const { A } = load(async () => errResponse(400, {
      code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials',
    }));
    let got = null;
    try { await A.signInPassword('a@b.c', 'wrong'); } catch (e) { got = e; }
    ok(got, '应抛错');
    eq(got.code, 'invalid_credentials');
    ok(got.hasBody, '带 GoTrue 错误体 = 权威回答');
  });

  test('offline is not an auth failure and must not read like one', async () => {
    const { A } = load(async () => { throw new Error('Load failed'); });
    let got = null;
    try { await A.signInPassword('a@b.c', 'pw'); } catch (e) { got = e; }
    eq(got.code, 'offline');
  });
});
