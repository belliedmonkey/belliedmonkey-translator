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

describe('#386 · 未登录也能复习（本机卡就是本机的）', () => {
  test('入口容器初始 hidden —— 没有卡时一行都不该出现', () => {
    ok(JSSX.includes('<div id="signed-out-review" hidden>'), '#signed-out-review 不是 hidden 初始态');
  });
  test('按钮是次级 —— 这一屏的主行动仍是「把扩展 / 登录打通」', () => {
    ok(JSSX.includes('<button id="signed-out-review-btn" type="button" className="secondary">'),
      '未登录复习按钮不是 secondary：它会和横幅的填色按钮抢「每屏至多一个」那条家规');
  });
  test('长在 #signed-out 段里，且在登录卡之前', () => {
    const so = JSSX.indexOf('<section id="signed-out"');
    const entry = JSSX.indexOf('id="signed-out-review"');
    const signin = JSSX.indexOf('id="signin-prompt"');
    ok(so > 0 && entry > so && signin > entry, '未登录复习入口不在 #signed-out 里，或位置不在登录卡之前');
  });
  test('判据两个方向都要对：已登录不显示、本机 0 张卡不显示', () => {
    const fn = section(SHELL, 'function paintSignedOutReview(', '\n  }\n');
    ok(/box\.hidden = !!currentSession \|\| !\(total > 0\);/.test(fn),
      'paintSignedOutReview 的可见性判据变了 —— 要么会显示给已登录的人，要么会给一个必然空着的入口：' + fn.slice(0, 200));
  });
  test('入口走的是同一个 #review 按钮，没有第二份视图切换', () => {
    ok(/\$\('signed-out-review-btn'\)[\s\S]{0,160}?\$\('review'\)[\s\S]{0,40}?\.click\(\)/.test(SHELL),
      '未登录入口没有复用 #review 的点击路径 —— 视图切换抄了第二份');
  });
  test('「← 返回」按来路分流：未登录进来的人回未登录首页', () => {
    const seg = section(SHELL, "$('review-back').addEventListener('click'", '// ─── Settings ─');
    ok(/if \(currentSession\) \{ \$\('signed-in'\)\.hidden = false; \} else \{ \$\('signed-out'\)\.hidden = false; \}/.test(seg),
      'review-back 仍无条件回 #signed-in —— 未登录的人点返回会落到他没见过的界面');
  });
});

describe('#386 · 新增的 UI 文案在 12 份 locale 里都有', () => {
  const KEYS = ['app_so_review_title', 'app_so_review_due', 'app_so_review_total'];
  const locs = fs.readdirSync(LOCALES).filter((l) => fs.existsSync(path.join(LOCALES, l, 'messages.json')));
  test('12 份一个不少', () => { eq(locs.length, 12); });
  for (const loc of locs) {
    test(loc, () => {
      const d = JSON.parse(fs.readFileSync(path.join(LOCALES, loc, 'messages.json'), 'utf8'));
      for (const k of KEYS) {
        ok(d[k] && typeof d[k].message === 'string' && d[k].message.length > 0, `${loc} 缺 ${k}（或缺成空串——运行时与缺键一字不差）`);
      }
    });
  }
  test('带 {n} 的两条在各自译文里都留着占位符', () => {
    for (const loc of locs) {
      const d = JSON.parse(fs.readFileSync(path.join(LOCALES, loc, 'messages.json'), 'utf8'));
      for (const k of ['app_so_review_due', 'app_so_review_total']) {
        ok(d[k].message.includes('{n}'), `${loc} 的 ${k} 丢了 {n} 占位符 —— 计数会显示不出来`);
      }
    }
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
