// test/cli-corpus.test.js — 命令行宿主的语料 / 计划 / 复习（learning-design §9.10）。
//
// 语料是 mt-learn/1 文件，语义必须与扩展 / App 一致：这里钉四件事 ——
//   1. 采集按句对齐（§4.2）且不同语言不误配；
//   2. 保存 → 重载逐字段一致（内容寻址 id 稳定）；
//   3. review 走 applyReview → stateFor，推进 sched 并写复习行；
//   4. 导入 / 导出 / 删除台账（§7.4）往返正确。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { test, describe, ok, eq } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const { Corpus } = require('../cli/corpus.js');
const { buildPlan } = require('../cli/plan.js');
const { runReview } = require('../cli/review.js');
const LearnScheduler = require(path.join(ROOT, 'extension/content/learn-scheduler.js'));

const tmpFile = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bt-corpus-')), name || 'corpus.mtlearn');
const NOW = Date.UTC(2026, 8, 30, 0, 0, 0);

describe('cli-corpus: 采集 / 保存 / 计划 / 复习（§9.10）', () => {
  test('★ 采集按句对齐：一段三句 → 三张卡（§4.2）', () => {
    const c = new Corpus(tmpFile());
    const text = 'Coffee is a drink. It comes from beans. People drink it daily.';
    const tr = '咖啡是一种饮料。它来自咖啡豆。人们每天喝它。';
    const r = c.capture(text, tr, { targetLang: 'zh-CN' }, NOW);
    eq(r.added, 3, '三句英文对三句中文 ⇒ 三张卡');
    eq(c.allItems().length, 3);
  });

  test('★ 内容寻址：同一句再遇到合并成一张，不重复（§4）', () => {
    const c = new Corpus(tmpFile());
    c.capture('Coffee is a drink.', '咖啡是一种饮料。', { targetLang: 'zh-CN' }, NOW);
    c.capture('Coffee is a drink.', '咖啡是一种饮料。', { targetLang: 'zh-CN' }, NOW + 1000);
    eq(c.allItems().length, 1, 'id 内容寻址 ⇒ 合并');
    const it = c.allItems()[0];
    ok(it.seenCount >= 2, '重遇要累加 seenCount，实际 ' + it.seenCount);
  });

  test('保存 → 重载逐字段一致（id 稳定）', async () => {
    const file = tmpFile();
    const a = new Corpus(file);
    a.capture('A sentence to remember.', '一句要记住的话。', { targetLang: 'zh-CN' }, NOW);
    const before = a.allItems()[0];
    await a.save(NOW);
    const b = new Corpus(file);
    const res = await b.load();
    eq(res.empty, undefined);
    eq(b.allItems().length, 1);
    const after = b.allItems()[0];
    eq(after.id, before.id);
    eq(after.text, before.text);
    eq(after.tr, before.tr);
  });

  test('★ review：applyReview 推进 sched 并写复习行（§5）', async () => {
    const c = new Corpus(tmpFile());
    c.capture('A sentence to review.', '一句要复习的话。', { targetLang: 'zh-CN' }, NOW);
    const id = c.allItems()[0].id;
    eq(c.itemById(id).sched, null, '新卡没有 sched');
    c.recordReview(id, 2, NOW + 1000, { mode: 'read', skill: 'read' });
    const it = c.itemById(id);
    ok(it.sched && it.sched.s > 0, '评「好」后要有稳定性');
    eq(it.state, 'learning');
    eq(c.allReviews().length, 1);
    eq(c.allReviews()[0].mode, 'read');
    ok(it.skills && it.skills.read === NOW + 1000, 'read 技能要盖章');
  });

  test('★ plan 只读：不改语料（同一 now 两次结果一致）', () => {
    const c = new Corpus(tmpFile());
    c.capture('One card.', '一张卡。', { targetLang: 'zh-CN' }, NOW);
    const snapshot = JSON.stringify(c.allItems());
    const p1 = buildPlan(c, NOW, 0);
    const p2 = buildPlan(c, NOW, 0);
    eq(p1.deck.length, 1, '候选卡进今日牌库（新卡）');
    eq(JSON.stringify(c.allItems()), snapshot, 'plan 不许改语料');
    eq(JSON.stringify(p1.deck.map((x) => x.id)), JSON.stringify(p2.deck.map((x) => x.id)));
  });

  test('★ plan --days：buildDeckAhead 覆盖今日 + 未来', () => {
    const c = new Corpus(tmpFile());
    for (let i = 0; i < 30; i++) c.capture(`Sentence number ${i} of the corpus.`, `语料第 ${i} 句。`, { targetLang: 'zh-CN' }, NOW);
    const p0 = buildPlan(c, NOW, 0);
    const p3 = buildPlan(c, NOW, 3);
    // 新卡受 dailyNew 与 MIX.fresh 双重限制（§5）：牌库非空但不会把 30 张全端出来。
    ok(p0.deck.length > 0 && p0.deck.length <= LearnScheduler.DEFAULTS.deckSize, '牌库在 (0, deckSize] 内');
    ok(p0.deck.length < 30, '不能把全部候选一次性端出（每日新卡是硬上限）');
    ok(p3.ahead && p3.ahead.length >= p0.deck.length, '未来 N 天是今日牌库的超集');
  });

  test('★ runReview：脚本化打分推进并落盘', async () => {
    const file = tmpFile();
    const c = new Corpus(file);
    c.capture('Review me.', '复习我。', { targetLang: 'zh-CN' }, NOW);
    const answers = ['2'];
    const res = await runReview(c, NOW, () => Promise.resolve(answers.shift()));
    eq(res.graded, 1);
    const d = new Corpus(file);
    await d.load();
    eq(d.allReviews().length, 1, '复习行要落盘');
  });

  test('★ 技能轮换：够久的卡走 write（填空）并盖章（§5.4）', async () => {
    const c = new Corpus(tmpFile());
    c.capture('The quick brown fox jumps over the lazy dog.', '敏捷的棕色狐狸跳过懒狗。', { targetLang: 'zh-CN' }, NOW);
    const id = c.allItems()[0].id;
    const it = c.itemById(id);
    // 把它推到 write 档的门槛（s ≥ TIER_WRITE_S = 30 天），且到期（R ≤ targetR）。
    it.sched = { s: 40, d: 5, lastReviewAt: NOW - 40 * LearnScheduler.DAY, dueAt: NOW - LearnScheduler.DAY, reps: 5, lapses: 0 };
    let sawWrite = false;
    const io = {
      read: () => Promise.resolve('2'),
      write: (item, cloze) => {
        sawWrite = true;
        return Promise.resolve(cloze.parts.filter((p) => p.t === 'blank').map((p) => p.answer).join('|'));
      },
      note: () => {},
    };
    const res = await runReview(c, NOW, io);
    eq(res.graded, 1);
    ok(sawWrite, 's ≥ 30 的卡应触发 write 档');
    eq(c.allReviews()[0].mode, 'write');
    ok(c.itemById(id).skills && c.itemById(id).skills.write, 'write 技能要盖章');
  });

  test('★ 删除台账（§7.4）：删掉的卡再导入不会复活', async () => {
    const a = new Corpus(tmpFile('a.mtlearn'));
    a.capture('Delete me.', '删了我。', { targetLang: 'zh-CN' }, NOW);
    const id = a.allItems()[0].id;
    // 导出一份「删除前」的快照。
    const snap = tmpFile('snap.mtlearn');
    await a.exportTo(snap, NOW);
    // 删除并保存。
    a.deleteItems([id], NOW + 1000);
    eq(a.allItems().length, 0);
    await a.save(NOW + 1000);
    // 把旧快照导入回来 —— 删除必须赢（touchedAt ≤ at）。
    const stats = await a.importFrom(snap);
    eq(a.allItems().length, 0, '删除台账要抑制旧拷贝');
    eq(stats.deleted, 0, '导入的是旧快照，删除已在本机发生过');
    ok(a.allDels().some((d) => d.id === id), '台账要留着这条删除');
  });
});

// ── 启动器：plan / export / import 端到端（不联网）────────────────────────
function runCli(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(ROOT, 'cli', 'bin', 'belliedmonkey.js')].concat(args),
      { env: Object.assign({}, process.env, env || {}), encoding: 'utf8' },
      (err, stdout, stderr) => resolve({ code: err ? (err.code || 1) : 0, stdout, stderr }));
  });
}

describe('cli-bin: 语料命令端到端（§3.1.13）', () => {
  test('plan --json 读语料；export → import 往返', async () => {
    const file = tmpFile('seed.mtlearn');
    const seed = new Corpus(file);
    seed.capture('Seed sentence one.', '种子句一。', { targetLang: 'zh-CN' }, NOW);
    seed.capture('Seed sentence two.', '种子句二。', { targetLang: 'zh-CN' }, NOW);
    await seed.save(NOW);

    const plan = await runCli(['plan', '--corpus', file, '--json'], {});
    eq(plan.code, 0, plan.stderr);
    const pj = JSON.parse(plan.stdout);
    eq(pj.total, 2);

    const out = path.join(path.dirname(file), 'export.mtlearn');
    const exp = await runCli(['export', '--corpus', file, '-o', out], {});
    eq(exp.code, 0, exp.stderr);
    ok(fs.existsSync(out), 'export 要写出文件');

    const file2 = tmpFile('dest.mtlearn');
    const imp = await runCli(['import', out, '--corpus', file2], {});
    eq(imp.code, 0, imp.stderr);
    const plan2 = await runCli(['plan', '--corpus', file2, '--json'], {});
    eq(JSON.parse(plan2.stdout).total, 2, '导入后应有两张卡');
  });

  test('坏文件 ⇒ 退出码 4', async () => {
    const bad = tmpFile('bad.mtlearn');
    fs.writeFileSync(bad, 'not a corpus at all');
    const r = await runCli(['import', bad, '--corpus', tmpFile('x.mtlearn')], {});
    eq(r.code, 4, '坏格式应退出 4，实际 ' + r.code + ' / ' + r.stderr);
  });
});
