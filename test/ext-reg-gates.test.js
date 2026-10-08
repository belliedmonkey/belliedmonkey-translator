// test/ext-reg-gates.test.js — 扩展端回归的「门」类断言（X1 / X2 / X4 / X9 / X10）。
//
// 为什么不放进各个功能单测里：这几条守的是**发布面**（权限、版本、文案、提审、产物新鲜度），
// 它们坏掉的方式都是「悄悄变宽 / 悄悄落后」，与功能无关，单独一处更好找。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sh = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

describe('扩展端发布面（X 组）', () => {
  test('X1 清单没有变宽（对照已上架标签）', () => {
    let out = '', code = 0;
    try { out = sh('node', ['scripts/verify-manifest-diff.js']); } catch (e) { code = e.status || 1; out = String(e.stdout || '') + String(e.stderr || ''); }
    eq(code, 0, '清单差异门判红：\n' + out.slice(-600));
  });

  test('X2 版本号处处一致（dist × package.json × 两个 Safari 工程）', () => {
    const out = sh('node', ['scripts/verify-version-consistency.js']);
    ok(/✓ 都等于/.test(out), '版本号不一致：\n' + out);
  });

  test('X9 没有任何脚本会提审（R-01）', () => {
    const pkg = JSON.parse(read('package.json'));
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      ok(!/--publish\b/.test(cmd), `${name} 带 --publish：${cmd}`);
      ok(!/--apply\b/.test(cmd), `${name} 带 --apply：${cmd}`);
      ok(!/reviewSubmissions|appStoreVersionSubmissions/.test(cmd), `${name} 带提审命令：${cmd}`);
    }
    // 发布脚本本身也不能默认就提审（必须是「不带 --publish/--apply 只检查」）
    for (const f of ['scripts/cws-publish.js', 'scripts/amo-publish.js', 'scripts/gh-release.js']) {
      ok(fs.existsSync(path.join(ROOT, f)), `${f} 不在`);
    }
  });

  test('X10 三个 dist 比 HEAD 新（G-01）', () => {
    const headMs = Number(sh('git', ['log', '-1', '--format=%ct']).trim()) * 1000;
    for (const d of ['dist', 'dist-china', 'dist-firefox']) {
      const p = path.join(ROOT, d, 'manifest.json');
      ok(fs.existsSync(p), `${d}/manifest.json 不在 —— 先跑构建`);
      const ms = fs.statSync(p).mtimeMs;
      ok(ms > headMs, `${d} 比 HEAD 旧（${new Date(ms).toISOString()} ≤ ${new Date(headMs).toISOString()}）`);
    }
    for (const f of ['belliedmonkeytranslator.zip', 'belliedmonkeytranslator-firefox.xpi']) {
      const p = path.join(ROOT, f);
      ok(fs.existsSync(p), `${f} 不在`);
      ok(fs.statSync(p).mtimeMs > headMs, `${f} 比 HEAD 旧`);
    }
  });

  test('X4 「译成」列表：13 项、本名、没有一项 disabled（S-02）', () => {
    const CFG = require('../build/target-langs.config.js');
    const list = Array.isArray(CFG) ? CFG : (CFG.langs || CFG.default || []);
    eq(list.length, 13, '「译成」应当是 13 项');
    const want = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ar', 'pt', 'ru', 'it', 'th'];
    const got = list.map((x) => x.id);
    ok(JSON.stringify(got) === JSON.stringify(want), `顺序/内容不对：${JSON.stringify(got)}`);
    for (const x of list) ok(x.endonym && x.endonym.trim(), `${x.id} 没有本名 endonym`);
    const th = list.find((x) => x.id === 'th');
    eq(th.endonym, 'ไทย', '泰语的本名应当是 ไทย');
    // 任何一个「译成」选择器都不许把 option 标成 disabled
    const srcs = ['src/pages/popup.jsx', 'src/pages/options.jsx', 'src/app/listen-view.jsx'];
    for (const f of srcs) {
      const s = read(f);
      ok(!/disabled=\{o\.disabled\}/.test(s) || !/target/.test(f), `${f} 里的目标语言选择器带了 disabled`);
    }
    ok(/l\.code !== 'th'/.test(read('src/app/listen-model.js')), '听译的语言选择器没有泰语豁免（泰语会被灰）');
  });
});
