// test/growth-386.test.js — #386「复习善终口径 + 未登录复习入口」的地面判据（2026-09-27）。
//
// 这条改动不是「加个按钮」那种一眼能看懂的：它的正确性一半是**负的** —— 没卡不许出现、
// 登录了不许出现、评过卡就不许再记 left。所以这里钉的是判据本身（源码形状 + 12 份 locale
// 的键），行为由两个真浏览器门禁（`npm run test:learn` / `npm run test:app`）在真的重开
// App、真的评分之后读队列来守。
//
// #384（扩展横幅温和复核）从这条线**拆出去**了：它的口径要等「启用链路」查清后再定，
// 代码不在这一支（那是 PR #469 的另一半）。这一份顺带钉住那条**已淘汰**的
// `#ext-banner-check`（30 天只有 1 台点过）不再回来。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8');
const JSSX = fs.readFileSync(path.join(ROOT, 'src/app/AppShell.jsx'), 'utf8');
const REVIEW = fs.readFileSync(path.join(ROOT, 'src/shared/review.js'), 'utf8');
const LOCALES = path.join(ROOT, 'extension', '_locales');

// 源码判据先去掉注释：注释里会提到被退役的东西（说明它为什么退役），把说明当违规是误伤。
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function section(text, from, to) {
  const a = text.indexOf(from);
  ok(a >= 0, '找不到锚点：' + from);
  const b = to ? text.indexOf(to, a) : text.length;
  ok(b > a, '找不到终点锚点：' + to);
  return text.slice(a, b);
}

describe('#386 · 一轮的善终门槛是「学过」，不是「清空」（2026-09-27 用户裁定）', () => {
  test('leave() 按 sess.graded 分流 —— 评过一张就走记 done', () => {
    ok(REVIEW.includes("function leave() { if (!practicing) sessEnd(sess.graded > 0 ? 'done' : 'left'); }"),
      'leave() 不再是「评过卡就记 done，一张没评才记 left」—— 用户裁定：「完成 1 卡也要记」');
  });
  test('「今天就到这儿」记 done，不再记 left', () => {
    const seg = section(REVIEW, "$('group-stop').addEventListener('click'", 'window.LearnReview =');
    ok(/sessEnd\('done'\);/.test(seg), '做满一组后收尾没有记 done');
    ok(!/sessEnd\('left'\);/.test(seg), '做满一组后收尾仍在记 left —— 那是半途离开的口径');
  });
});

// ── 2026-10-01 更新（#532）：本节方向**反转** ────────────────────────────────
// #386 当初立的规矩是「未登录也能复习」（卡片是本机数据，登录只影响同步）。
// 2026-10-01 的裁定把 App 改成「**登录是前提**」（AGENTS.md 规则 2/3 的注），
// 所以那条入口**整条退役**：未登录的首页只有登录，复习只能从登录后的首页进。
// 同一件事在 test/app-firstrun.test.js 的 R1 里以结构门再钉一次。
describe('#386 退役 —— 未登录不再有复习入口（2026-10-01，#532）', () => {
  test('入口、判定函数、三个文案键全部退役', () => {
    ok(!JSSX.includes('signed-out-review'), 'AppShell 里还有 #signed-out-review —— 未登录首页只许有登录');
    ok(!stripComments(SHELL).includes('paintSignedOutReview'), 'shell-model 里 paintSignedOutReview 还在 —— 入口退役了，函数与调用点也该删');
    const locs = fs.readdirSync(LOCALES).filter((l) => fs.existsSync(path.join(LOCALES, l, 'messages.json')));
    const dead = [];
    for (const loc of locs) {
      const d = JSON.parse(fs.readFileSync(path.join(LOCALES, loc, 'messages.json'), 'utf8'));
      for (const k of ['app_so_review_title', 'app_so_review_due', 'app_so_review_total']) if (d[k]) dead.push(`${loc}/${k}`);
    }
    eq(dead, [], '退役入口的三个文案键还在（死文案）—— 12 份一起删');
  });
});

describe('已淘汰的 #ext-banner-check 不再回来（2026-09-27）', () => {
  test('AppShell 里没有那条检测页链接', () => {
    ok(!JSSX.includes('ext-banner-check'), '#ext-banner-check 又出现在 AppShell 里');
  });
  test('shell-model 不再引它、不再发 check 动作', () => {
    ok(!SHELL.includes('ext-banner-check'), 'shell-model 还在引 #ext-banner-check');
    ok(!SHELL.includes("extBannerTrack('check')"), "shell-model 还在发 ext_banner{check}");
    ok(!SHELL.includes('app_ext_check_hint'), 'shell-model 还在用 app_ext_check_hint');
  });
  test('12 份 locale 都删掉了 app_ext_check_hint 与 #384 的 app_ext_recheck_*', () => {
    const locs = fs.readdirSync(LOCALES).filter((l) => fs.existsSync(path.join(LOCALES, l, 'messages.json')));
    for (const loc of locs) {
      const d = JSON.parse(fs.readFileSync(path.join(LOCALES, loc, 'messages.json'), 'utf8'));
      for (const k of ['app_ext_check_hint', 'app_ext_recheck_title', 'app_ext_recheck_body']) {
        ok(!(k in d), `${loc} 还留着已淘汰的键 ${k}`);
      }
    }
  });
});
