// test/growth-384-386.test.js — #384 / #386 两根漏斗的地面判据（2026-09-27）。
//
// 这两条改动都不是「加个按钮」那种一眼能看懂的：它们的正确性一半是**负的** ——
// 没卡不许出现、登录了不许出现、静音没满 3 天不许打扰、评过卡就不许再记 left。
// 所以这里钉的是判据本身（源码形状 + 12 份 locale 的键），行为由两个真浏览器门禁
// （`npm run test:learn` / `npm run test:app`）在**真的重开 App、真的评分之后读队列**来守。
//
// 写这份的理由：agy 会话（Antigravity CLI）的实施方案里有一半条目其实早已在 main 上
// 落地（`GROUP=5` 的组终点、习惯条、「本轮进度」计数器、`opened`/`nothing_due`）。
// 「方案里写着的」与「代码里真的有的」在交接时长得一模一样 —— 这份文件把这一课留在原地。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8');
const JSSX = fs.readFileSync(path.join(ROOT, 'src/app/AppShell.jsx'), 'utf8');
const REVIEW = fs.readFileSync(path.join(ROOT, 'extension/learn/review.js'), 'utf8');
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

describe('#384 · 扩展横幅的「温和复核」', () => {
  test('3 天窗口 + 本机无卡 + 没点过复核态才复核（四个条件缺一不可）', () => {
    const seg = section(SHELL, 'const needsRecheck = extBannerDone', ';\n    extBannerRechecking');
    ok(/extBannerDone && !extBannerRechecked && !browserSideOk/.test(seg), '复核条件少了「没点过复核态」或「本机没通」那一半');
    ok(/extBannerDoneAt > 0 && \(Date.now\(\) - extBannerDoneAt >= RECHECK_MS\)/.test(seg), '复核没有真的按 3 天窗口算');
  });
  test('首次点击仍然立刻落 extBannerDoneAt（老断言不变）', () => {
    const seg = section(SHELL, "$('ext-banner-done').addEventListener('click'", 'paintExtBanner(extState);');
    ok(/chrome\.storage\.local\.set\(\{ \[EXT_DONE\]: now \}/.test(seg), '首次点击不再写 extBannerDoneAt —— app-bundle 门禁的既有断言会红');
    ok(/chrome\.storage\.local\.set\(\{ \[EXT_RECHECKED\]: now \}/.test(seg), '复核态点击没有写 extBannerRecheckedAt —— 那就是永久静音不了');
  });
  test('设置页的复原键一次清掉两个键', () => {
    const seg = section(SHELL, "$('extb-restore').addEventListener('click'", '});\n');
    ok(/remove\(\[EXT_DONE, EXT_RECHECKED, 'tm:extBannerDay'\]/.test(seg),
      '复原键没有连 extBannerRecheckedAt 一起清 —— 触发过复核的人再也回不来');
  });
  test('预读把复核键与时间戳一起读进来（paintExtBanner 是同步的）', () => {
    ok(/get\(\[EXT_DONE, EXT_RECHECKED, 'tm:extBannerDay'\]/.test(SHELL), 'init 预读没有包含复核键');
    ok(/extBannerDoneAt = Number\(\(o && o\[EXT_DONE\]\) \|\| 0\) \|\| 0;/.test(SHELL), 'init 没有把 extBannerDoneAt 的时间戳读进内存');
  });
});

describe('#384 / #386 · 新增的 UI 文案在 12 份 locale 里都有', () => {
  const KEYS = ['app_ext_recheck_title', 'app_ext_recheck_body',
    'app_so_review_title', 'app_so_review_due', 'app_so_review_total'];
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
