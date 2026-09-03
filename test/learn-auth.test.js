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

// ─── §8.4.1.2 手机号 + 第三方登录（2026-09-03）──────────────────────────────
//
// 这一组守的是「三条路收敛到同一个 sessionFrom」。收敛不成立的话，learnUserId /
// bindCorpus / ownerGate 就会因为「用户是怎么进来的」而表现不同 —— 而那三样恰恰
// 是最不该知道这件事的（§8.4.1 可替换性契约）。

function loadWith(fetchImpl, seed) {
  const stored = Object.assign({}, seed || {});
  const removed = [];
  const PageSettings = {
    read: async (keys) => ({ ok: true,
      data: Object.fromEntries((keys || []).filter((k) => k in stored).map((k) => [k, stored[k]])) }),
    write: async (items) => { Object.assign(stored, items); return { ok: true }; },
    removeKeys: async (keys) => { removed.push(...keys); for (const k of keys) delete stored[k]; return { ok: true }; },
  };
  const LearnStore = { getMeta: async () => null, setMeta: async () => {} };
  const calls = [];
  const ctx = loadModule('learn/auth.js', {
    window: {},
    MT_BACKEND: { url: 'https://x.example', anonKey: 'anon', table: 'bt_chunks' },
    PageSettings, LearnStore,
    crypto: require('crypto').webcrypto,
    TextEncoder,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    fetch: async (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); },
  });
  return { A: ctx.LearnAuth, calls, stored, removed };
}

const SESSION = {
  access_token: 'a', refresh_token: 'r', expires_in: 3600,
  user: { id: 'u-1', email: 'x@y.com' },
};

describe('手机号走同一条路（§8.4.1.2）', () => {
  test('signIn 认得手机号，打的是 {phone} 而不是 {email}', async () => {
    const { A, calls } = loadWith(async () => okResponse({}));
    const r = await A.signIn('13800138000');
    eq(r.via, 'phone');
    const body = JSON.parse(calls[0].init.body);
    eq(body.phone, '+8613800138000', '11 位国内号要补成 E.164 —— Supabase 只认这个形状');
    eq(body.email, undefined, '手机号那条路不许再带 email 字段');
  });

  test('verify 用 type:sms', async () => {
    const { A, calls } = loadWith(async () => okResponse(SESSION));
    await A.verify('+8613800138000', '123456');
    const body = JSON.parse(calls[0].init.body);
    eq(body.type, 'sms');
    eq(body.phone, '+8613800138000');
  });

  test('邮箱那条路一个字都没变', async () => {
    const { A, calls } = loadWith(async () => okResponse({}));
    const r = await A.signIn('  x@y.com ');
    eq(r.via, 'email');
    const body = JSON.parse(calls[0].init.body);
    eq(body.email, 'x@y.com');
    eq(body.phone, undefined);
  });

  test('session 带 phone，且 displayName 是唯一口径', async () => {
    const { A } = loadWith(async () => okResponse({
      access_token: 'a', refresh_token: 'r', expires_in: 3600,
      user: { id: 'u-2', email: null, phone: '+8613800138000' },
    }));
    const s = await A.verify('13800138000', '123456');
    eq(s.phone, '+8613800138000');
    eq(A.displayName(s), '+8613800138000',
      '手机号用户没有 email —— 界面读 email 会显示空白');
    eq(A.displayName({ email: 'x@y.com', phone: null }), 'x@y.com');
  });
});

describe('第三方登录：PKCE（§8.4.1.1 第二条跨界裁定）', () => {
  test('startProviderSignIn 存 verifier 并**返回** URL，自己不开窗', async () => {
    const { A, stored } = loadWith(async () => okResponse({}));
    const url = await A.startProviderSignIn('google', 'https://belliedmonkey.cc/auth/done.html');
    ok(url.startsWith('https://x.example/auth/v1/authorize?'), 'URL 形状不对: ' + url);
    ok(url.includes('code_challenge_method=s256'), '没带 PKCE method');
    const p = stored.learnAuthPkce;
    ok(p && p.verifier && p.state, 'verifier/state 没落盘');
    // challenge 必须是 verifier 的 s256 —— 不然服务端换不出来，而那要到用户走完
    // 一整圈才会发现。
    const h = require('crypto').createHash('sha256').update(p.verifier).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    ok(url.includes('code_challenge=' + encodeURIComponent(h).replace(/%2D/g, '-'),
    ) || url.includes('code_challenge=' + h), 'challenge 不是 verifier 的 s256');
  });

  test('completeProviderSignIn 换到 session，并把 verifier 与票都清掉', async () => {
    const { A, calls, stored } = loadWith(async () => okResponse(SESSION), {
      learnAuthPkce: { verifier: 'v', state: 's', provider: 'google', at: Date.now() },
      learnAuthCode: { code: 'c', state: 's' },
    });
    const s = await A.completeProviderSignIn();
    eq(s.userId, 'u-1');
    ok(calls[0].url.includes('grant_type=pkce'), '打错端点: ' + calls[0].url);
    const body = JSON.parse(calls[0].init.body);
    eq(body.auth_code, 'c');
    eq(body.code_verifier, 'v');
    eq(stored.learnAuthPkce, undefined, 'verifier 必须一次性');
    eq(stored.learnAuthCode, undefined, '票必须一次性 —— 留着会在下次开页时重放');
  });

  test('★ state 不符：停住，且一个请求都不发', async () => {
    const { A, calls, stored } = loadWith(async () => okResponse(SESSION), {
      learnAuthPkce: { verifier: 'v', state: 's', provider: 'google', at: Date.now() },
      learnAuthCode: { code: 'c', state: 'NOT-s' },
    });
    let code = '';
    try { await A.completeProviderSignIn(); } catch (e) { code = e.code; }
    eq(code, 'pkce_state');
    eq(calls.length, 0, 'state 不符还去换 —— 那等于把别人塞的票当成自己的');
    eq(stored.learnAuthPkce, undefined);
  });

  test('没有票时返回 null，不报错 —— 每次开设置页都会调它一次', async () => {
    const { A, calls } = loadWith(async () => okResponse(SESSION));
    eq(await A.completeProviderSignIn(), null);
    eq(calls.length, 0);
  });

  test('有票但没有 verifier → pkce_missing（换过浏览器/清过数据）', async () => {
    const { A } = loadWith(async () => okResponse(SESSION), { learnAuthCode: { code: 'c', state: 's' } });
    let code = '';
    try { await A.completeProviderSignIn(); } catch (e) { code = e.code; }
    eq(code, 'pkce_missing');
  });
});

describe('原生登录：id_token grant（App 侧）', () => {
  test('signInWithIdToken 打对端点，落成同一个 session 形状', async () => {
    const { A, calls, stored } = loadWith(async () => okResponse(SESSION));
    const s = await A.signInWithIdToken('apple', 'ID-TOKEN', 'NONCE');
    ok(calls[0].url.includes('grant_type=id_token'), '打错端点: ' + calls[0].url);
    const body = JSON.parse(calls[0].init.body);
    eq(body.provider, 'apple');
    eq(body.id_token, 'ID-TOKEN');
    eq(body.nonce, 'NONCE');
    eq(s.userId, 'u-1');
    // 三条路收敛的实证：落盘的键与邮箱那条路逐字相同。
    ok(stored.learnAuth && stored.learnAuth.accessToken === 'a', 'learnAuth 没落盘');
    eq(stored.learnUserId, 'u-1', 'learnUserId 必须照旧写 —— 跨面交接靠它');
  });
});

describe('这台设备上是不是还有别人的库（§8.4.1.2 身份合并）', () => {
  // 换一个身份登录时，bindCorpus 给新账号一个独立的空库，ownerGate 读的是库内部的
  // 戳（新库是空的 → 直接认领）—— 整条路**一个错都不报**。用户看到的是一个空的
  // 复习页，而他的卡还在这台设备上挂在另一个身份下。这个判据是那一支文案的开关。
  test('主库属于别人 → true', async () => {
    const { A } = loadWith(async () => okResponse({}), {
      learnDbOwner: 'u-first',
      learnAuth: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3e6, userId: 'u-second' },
    });
    eq(await A.otherAccountOnDevice(), true);
  });

  test('主库就是我 → false', async () => {
    const { A } = loadWith(async () => okResponse({}), {
      learnDbOwner: 'u-me',
      learnAuth: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3e6, userId: 'u-me' },
    });
    eq(await A.otherAccountOnDevice(), false);
  });

  test('主库没主人（升级上来的设备）→ false，不许吓人', async () => {
    const { A } = loadWith(async () => okResponse({}), {
      learnAuth: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3e6, userId: 'u-me' },
    });
    eq(await A.otherAccountOnDevice(), false);
  });

  test('没登录 → false（那是「未登录」，不是「另一个账号」）', async () => {
    const { A } = loadWith(async () => okResponse({}), { learnDbOwner: 'u-first' });
    eq(await A.otherAccountOnDevice(), false);
  });

  test('★ 不开数据库 —— §8.4.3 为死锁付过代价', async () => {
    let opened = 0;
    const stored = { learnDbOwner: 'u-first',
      learnAuth: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3e6, userId: 'u-2' } };
    const ctx = loadModule('learn/auth.js', {
      window: {},
      MT_BACKEND: { url: 'https://x.example', anonKey: 'anon', table: 'bt_chunks' },
      PageSettings: {
        read: async (keys) => ({ ok: true,
          data: Object.fromEntries((keys || []).filter((k) => k in stored).map((k) => [k, stored[k]])) }),
        write: async () => ({ ok: true }), removeKeys: async () => ({ ok: true }),
      },
      LearnStore: {
        getMeta: async () => { opened += 1; return null; },
        setMeta: async () => { opened += 1; },
        useDb: async () => { opened += 1; },
      },
      fetch: async () => okResponse({}),
    });
    await ctx.LearnAuth.otherAccountOnDevice();
    eq(opened, 0, '它开了数据库 —— 这个判据只该读两个 storage 键');
  });
});
