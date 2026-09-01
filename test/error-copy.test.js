// test/error-copy.test.js — 同步层挂出来的每个 code，两个界面都得有一句人话。
//
// 这一族失败没有中间状态：要么有文案，要么把**英文标识符原样摆到用户眼前**。
// 两个界面的兜底都是 `return e.message` / `return msg`，所以漏掉一个 code 不会红、
// 不会抛，只会让某个用户在状态行里读到 `owner_mismatch`。
//
// 2026-09-01 实测：`ownerGate()` 从 2026-08-31 起就会抛 owner_unknown / owner_mismatch，
// 而这两个词在全仓的 11 份译文里**一个字都没有**。触发条件（换账号登录）不常见，
// 所以它一直没被人看见 —— 这正是需要门禁而不是靠人记的形状。
//
// 判据是**从源码里数出 code**，不是维护一份手写清单：手写清单和实现分家的那天，
// 这道门禁就变成了摆设。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');
const { stripComments } = require('./lib/strip-comments');

const ROOT = path.join(__dirname, '..');
const read = (rel) => stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// 同步/认证层能挂到错误上的 code。三种写法都要认：
//   e.code = 'x'      （ownerErr / httpErr 之类）
//   { code: 'x' }     （emit 的载荷）
//   ? 'x' : 'y'       （httpCode 里按状态码分支出来的字符串）
function codesFrom(src) {
  const out = new Set();
  for (const m of src.matchAll(/\.code\s*=\s*'([a-z_]+)'/g)) out.add(m[1]);
  for (const m of src.matchAll(/code:\s*'([a-z_]+)'/g)) out.add(m[1]);
  for (const m of src.matchAll(/ownerErr\('([a-z_]+)'\)/g)) out.add(m[1]);
  for (const m of src.matchAll(/\?\s*'([a-z_]+)'\s*:/g)) out.add(m[1]);
  return out;
}

// 故意不给专属文案的 code，逐个写明理由。放行清单必须短，且每条都说得出为什么。
const GENERIC_OK = new Map([
  // 传输层细节。用户对 http_500 与 http_502 的处置完全相同（等一会儿再试），
  // 而它们的数量是开放的 —— 逐个写文案只会得到 N 句同样的话。
  ['bad_response', '上游返回了读不懂的东西，对用户是「稍后重试」，与通用兜底同义'],
  ['unauthorized', '会话失效走的是 signed_out 那条；这个 code 只在 auth 内部分流'],
]);

describe('同步层的每个错误 code 都有人话', () => {
  const codes = new Set([...codesFrom(read('extension/learn/sync.js')),
    ...codesFrom(read('extension/learn/auth.js'))]);
  const app = read('app/app.js');
  const opt = read('extension/options/options.js');

  test('扫到了 code —— 扫不到东西的断言不是门禁', () => {
    ok(codes.size >= 5, `只扫到 ${codes.size} 个 code：${[...codes].join(' ')} —— 扫法走歪了？`);
    for (const must of ['owner_mismatch', 'owner_unknown', 'quota', 'signed_out', 'offline']) {
      ok(codes.has(must), `没扫到 ${must} —— 它明明在 sync.js 里`);
    }
  });

  test('★ App 的 humanError 认得每一个', () => {
    const miss = [...codes].filter((c) => !GENERIC_OK.has(c) && !app.includes(`'${c}'`));
    eq(miss.length, 0, 'app/app.js 的 humanError 没有这些 code 的分支，它们会以英文原文'
      + '出现在状态行：' + miss.join(', '));
  });

  test('★ 扩展设置页的 syncError 认得每一个', () => {
    const miss = [...codes].filter((c) => !GENERIC_OK.has(c) && !opt.includes(`'${c}'`));
    eq(miss.length, 0, 'options.js 的 syncError 没有这些 code 的分支：' + miss.join(', '));
  });

  test('放行清单里的每一条都还真的存在 —— 过期的豁免比没有豁免更危险', () => {
    const stale = [...GENERIC_OK.keys()].filter((c) => !codes.has(c));
    eq(stale.length, 0, '这些 code 已经不存在了，从放行清单里删掉：' + stale.join(', '));
  });
});
