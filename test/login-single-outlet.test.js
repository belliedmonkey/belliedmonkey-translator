// test/login-single-outlet.test.js — #335：首页与设置页的登录态必须同一个出口。
//
// 2026-09-19 观察（macOS 宿主 App）：退出重开后首页画「未登录」，同一次运行里设置页
// 账号块却是「退出登录」。两处其实都调 LearnAuth.current()，但 current() 在「真没登录」
// 与「存储读失败」两种情况下**都返回 null**（load() 对失败不闩锁、只记 loadError，§8.4.1），
// 只有 lastLoadError() 能区分 —— 首页把宿主 App WKWebView 启动早期的一次 localStorage
// 瞬断画成了未登录；设置页晚一点重读成功，又是已登录。
//
// 这道门钉两件事：
//   行为：currentStable() 读失败先退避重试（瞬断恢复 ⇒ 拿回会话；真没登录 ⇒ 零重试立返；
//         重试耗尽 ⇒ null + lastLoadError()，调用方写「读不到 ≠ 已退出」）；
//   接线：两个页面的初次读都走 currentStable()（不是 current().catch(()=>null)），且
//         reconcileSession 在读失败时不把还登着的人画回登录卡。

const fs = require('fs');
const path = require('path');
const { loadModule, describe, test, ok, eq } = require('./harness');

const ROOT = path.resolve(__dirname, '..');

function loadAuth(read) {
  const ctx = loadModule('learn/auth.js', {
    window: {},
    MT_BACKEND: { url: 'https://x.example', anonKey: 'anon', table: 'bt_chunks' },
    PageSettings: {
      read,
      write: async () => ({ ok: true }),
      removeKeys: async () => ({ ok: true }),
    },
    LearnStore: { getMeta: async () => null, setMeta: async () => {} },
    fetch: async () => { throw new Error('no fetch in this test'); },
  });
  return ctx.LearnAuth;
}

describe('LearnAuth.currentStable（#335 的唯一出口）', () => {
  test('★ 瞬断两次后恢复 ⇒ 重试拿回会话，不冒充未登录', async () => {
    let n = 0;
    const SESSION = { accessToken: 'at', refreshToken: 'rt', email: 'a@b.c', userId: 'u1', expiresAt: Date.now() + 3600e3 };
    const A = loadAuth(async () => (++n <= 2
      ? { ok: false, data: {}, error: 'boom' }
      : { ok: true, data: { learnAuth: SESSION }, error: null }));
    const sleeps = [];
    const s = await A.currentStable({ delayMs: 1, sleep: async (ms) => { sleeps.push(ms); } });
    eq(s && s.email, 'a@b.c', '第三次读到会话');
    eq(sleeps.length, 2, '第 1、2 次失败后各睡一次');
    eq(A.lastLoadError(), null, '成功后 loadError 清空');
  });

  test('真没登录（读成功、无键）⇒ 零重试立返 null —— 正常启动零开销', async () => {
    let reads = 0;
    const A = loadAuth(async () => { reads++; return { ok: true, data: {}, error: null }; });
    const sleeps = [];
    const s = await A.currentStable({ delayMs: 1, sleep: async () => { sleeps.push(1); } });
    eq(s, null);
    eq(reads, 1, '只读一次');
    eq(sleeps.length, 0, '确认过没有会话就不许重试');
    eq(A.lastLoadError(), null);
  });

  test('读一直失败 ⇒ 重试耗尽返回 null，loadError 还在（调用方据此写「读不到 ≠ 已退出」）', async () => {
    const A = loadAuth(async () => ({ ok: false, data: {}, error: 'storage returned nothing' }));
    const sleeps = [];
    const s = await A.currentStable({ tries: 3, delayMs: 1, sleep: async () => { sleeps.push(1); } });
    eq(s, null);
    eq(sleeps.length, 3, 'tries 次重试');
    ok(A.lastLoadError(), '失败可辨');
  });
});

describe('首页与设置页的接线（源码门）', () => {
  const SHELL = fs.readFileSync(path.join(ROOT, 'src', 'app', 'shell-model.js'), 'utf8');
  const OPT = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'options.jsx'), 'utf8');

  test('★ 两个页面的初次读都走 currentStable()，不再 current().catch(()=>null)', () => {
    ok(SHELL.includes('await LearnAuth.currentStable()'), 'shell-model（boot / obFinish）走 currentStable');
    ok(!SHELL.includes('LearnAuth.current().catch('), 'shell-model 不再把失败吞成 null 的读法');
    ok(OPT.includes('await LearnAuth.currentStable()'), '设置页（refreshSyncUI / 额度卡）走 currentStable');
    ok(!OPT.includes('LearnAuth.current().catch('), '设置页不再把失败吞成 null 的读法');
  });

  test('★ reconcileSession：读失败（lastLoadError）不许把还登着的人画回登录卡', () => {
    ok(/if \(!s && LearnAuth\.lastLoadError\(\)\) return false;/.test(SHELL), 'loadError 守卫在 —— load() 读失败不抛、只记 loadError，原 catch 挡不住');
  });
});
