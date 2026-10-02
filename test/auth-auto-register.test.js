// test/auth-auto-register.test.js — 登录即注册（用户 2026-10-02 要求）。
//
// 扩展端 Apple 登录报「还未注册」。不管那句来自哪里，「Apple / 邮箱登录后必须自动建号」是
// 产品要求（§8.4.1.2 的登录方式、§8.10.1「登录即额度」都建在它上面），而它**只活在两三处
// 请求体里** —— 改一处就能悄悄退回「必须先注册」，症状是「新用户登不进去」。所以钉在这里：
//   · 邮箱 / 手机号：`signIn` 必须带 `create_user: true`（登录即注册，auth.js:214-215）；
//   · 第三方（Apple / Google）：走 Supabase 的 `/authorize`（首次登录建号），而不是自己拼端点；
//   · App 原生 id_token：`/token?grant_type=id_token`，不带「不建号」的字段。
const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// 先剥注释：这些文件里到处是被解释过的形状，负向断言会被自己的说明绊倒（同仓库别处）。
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

describe('登录即注册（2026-10-02）', () => {
  const auth = strip(read('extension/learn/auth.js'));

  test('邮箱 / 手机号：signIn 必须带 create_user:true（两条都要）', () => {
    const i = auth.indexOf('function signIn(who)');
    ok(i >= 0, 'auth.js 里找不到 signIn');
    const body = auth.slice(i, i + 700);
    const n = (body.match(/create_user:\s*true/g) || []).length;
    ok(n >= 2,
      `signIn 里只有 ${n} 处 create_user:true —— 手机号与邮箱两条都要；少一条，那一类新用户就会被拒成「还未注册」`);
  });

  test('第三方（Apple / Google）：走 Supabase 的 /authorize（首次登录建号）', () => {
    const i = auth.indexOf('function providerSignInUrl(');
    ok(i >= 0, '找不到 providerSignInUrl');
    const body = auth.slice(i, i + 900);
    ok(/\/authorize\?/.test(body),
      'providerSignInUrl 不再打 /authorize —— Apple / Google 的新用户建不了号（那正是「还未注册」的形状）');
    ok(/provider/.test(body) && /code_challenge/.test(body),
      'providerSignInUrl 少了 provider / PKCE 参数 —— 形状变了，这条门禁要跟着看一眼');
  });

  test('App 原生 id_token：不带「不建号」的字段（GoTrue 默认按 id_token 建号）', () => {
    const i = auth.indexOf('async function signInWithIdToken(');
    ok(i >= 0, '找不到 signInWithIdToken');
    const body = auth.slice(i, i + 300);
    ok(/grant_type=id_token/.test(body), 'signInWithIdToken 没打 /token?grant_type=id_token');
    ok(/provider/.test(body) && /id_token/.test(body), 'signInWithIdToken 少了 provider / id_token 字段');
    ok(!/create_user\s*:\s*false|shouldCreateUser\s*:\s*false/.test(body),
      'signInWithIdToken 带了「不建号」的字段 —— Apple 新用户会被拒');
  });
});
