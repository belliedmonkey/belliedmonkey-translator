// test/test-account.test.js — 测试账号脚本那道**邮箱守卫**的判据。
//
// 这个脚本会 DELETE 一整个账号的语料。它与「误删主账号」之间只隔着两样东西：
// 服务端的 RLS，和这里这道守卫。RLS 我测不到（要真 token），守卫我测得到 ——
// 而守卫要防的恰恰是最可能发生的那种事故：**有人把主账号的 token 贴进了测试槽位**。
const { describe, test, ok, eq } = require('./harness');
const TA = require('../scripts/test-account.js');

// 造一个只有 payload 有意义的 JWT —— 守卫本来就不验签（验签是服务端的事），
// 它要回答的是「这个 token 自称是谁」。
function fakeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

describe('测试账号脚本 — 邮箱守卫', () => {
  test('测试账号固定写死，不从参数或环境读', () => {
    // 可配置的目标账号意味着「跑错一次就删错一个账号」。写死是刻意的。
    eq(TA.TEST_EMAIL, 'belliedmonkey.en@gmail.com');
  });

  test('认得出测试账号自己的 token', () => {
    eq(TA.jwtEmail(fakeJwt({ email: 'belliedmonkey.en@gmail.com' })), 'belliedmonkey.en@gmail.com');
  });

  test('主账号的 token 会被认出来（守卫据此拒绝）', () => {
    // 这是这份文件存在的理由：主账号有 2999 张真卡。
    const got = TA.jwtEmail(fakeJwt({ email: 'belliedmonkey@gmail.com' }));
    ok(got !== TA.TEST_EMAIL, '主账号的 token 必须与测试账号区分开');
    eq(got, 'belliedmonkey@gmail.com');
  });

  test('大小写不影响判断 —— 邮箱不区分大小写，守卫也不该区分', () => {
    eq(TA.jwtEmail(fakeJwt({ email: 'BelliedMonkey.EN@Gmail.com' })), 'belliedmonkey.en@gmail.com');
  });

  test('读不出邮箱时回空串，绝不回测试账号', () => {
    // 「解析失败」必须落到拒绝那一侧。回一个像是测试账号的值，就等于把守卫关掉。
    for (const bad of ['', 'not-a-jwt', 'a.b', 'a.!!!.c', fakeJwt({})]) {
      const got = TA.jwtEmail(bad);
      ok(got !== TA.TEST_EMAIL, `坏输入 ${JSON.stringify(String(bad).slice(0, 20))} 不该被当成测试账号`);
    }
  });

  test('凭证槽位名不含账号或密钥字样，且脚本不打印 token', () => {
    const fs = require('fs');
    eq(TA.SLOT, 'supabase_test_refresh_token');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'scripts/test-account.js'), 'utf8');
    ok(!/console\.log\([^)]*refresh_token\b(?!\.length)/.test(src),
      '脚本里有把 refresh token 直接打印出来的地方');
  });
});
