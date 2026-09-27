// test/growth-digest.test.js — 渠道 × 转化一页看板的纯逻辑与 sources 解析。
//
// 这个脚本只读快照、不改任何东西，所以要守的是「它会不会把读数汇错」：
//   · 跨口径的快照不能相减（#476 修复前把更新算进下载，直接相减会显示一个假暴跌）；
//   · 分档（10/50/100/200）必须与 aso-rank.js 共用一份，否则同一个词两个档位；
//   · `asc.js sources` 是给人看的表格，解析器认错列就会把「浏览」当成「搜索」。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const G = require(path.join(ROOT, 'scripts/growth-digest.js'));
const RANK = require(path.join(ROOT, 'scripts/lib/rank-tiers.js'));
const SRC_ASO = fs.readFileSync(path.join(ROOT, 'scripts/aso-rank.js'), 'utf8');
const SRC_DIGEST = fs.readFileSync(path.join(ROOT, 'scripts/growth-digest.js'), 'utf8');

describe('growth-digest —— 渠道 × 转化一页看板', () => {
  test('deltaText：没得比不画箭头，比过没变是 ±0', () => {
    eq(G.deltaText(5, undefined), '');
    eq(G.deltaText(5, 5), '±0');
    eq(G.deltaText(7, 5), '↑2');
    eq(G.deltaText(3, 5), '↓2');
  });

  test('channelRows：Apple 跨口径不画环比（旧快照没有 updates 字段）', () => {
    const snap = { apple: { ok: true, total: 571, updates: 1245 }, amo: { ok: true, dau: 6, weekly: 2 }, github: { ok: true, total: 126 }, supabase: { ok: true, accounts: 260 } };
    const old = { apple: { ok: true, total: 1690 }, amo: { ok: true, dau: 6 }, github: { ok: true, total: 126 }, supabase: { ok: true, accounts: 232 } };
    const by = Object.fromEntries(G.channelRows(snap, { data: old }).map((r) => [r.name, r]));
    eq(by['Apple App Store'].delta, '', '旧口径不画环比');
    eq(by['Firefox AMO'].delta, '±0');
    eq(by['Supabase 账号'].delta, '↑28');
    const by2 = Object.fromEntries(G.channelRows(snap, { data: { apple: { ok: true, total: 500, updates: 1000 } } }).map((r) => [r.name, r]));
    eq(by2['Apple App Store'].delta, '↑71', '同口径才画环比');
  });

  test('channelRows：按量排序，Apple 第一', () => {
    const rows = G.channelRows({ apple: { ok: true, total: 571, updates: 1 }, github: { ok: true, total: 126 } }, null);
    eq(rows[0].name, 'Apple App Store');
  });

  test('rank-tiers 是唯一分档实现：aso-rank 与 digest 都 require 它', () => {
    ok(/require\('\.\/lib\/rank-tiers'\)/.test(SRC_ASO), 'aso-rank.js 没有用共享分档');
    ok(!/const TIERS\s*=/.test(SRC_ASO), 'aso-rank.js 又自己定义了 TIERS');
    ok(/require\('\.\/lib\/rank-tiers'\)/.test(SRC_DIGEST), 'growth-digest.js 没有用共享分档');
    eq(RANK.tierOf(null), '200+');
    eq(RANK.tierOf(7), '前10');
    eq(RANK.tierOf(60), '前100');
  });

  test('keywordRows：取最新一天、近 N 次中位、只在跨档时标记', () => {
    const docs = [
      { date: 'd1', doc: { ranks: { 'ios|us|alpha': 180, 'ios|us|beta': 5 } } },
      { date: 'd2', doc: { ranks: { 'ios|us|alpha': 40, 'ios|us|beta': 5 } } },
      { date: 'd3', doc: { ranks: { 'ios|us|alpha': 30, 'ios|us|beta': 5 } } },
    ];
    const rows = G.keywordRows(docs);
    const alpha = rows.find((r) => r.term === 'alpha');
    eq(alpha.latest, 30);
    eq(alpha.tier, '前50');
    ok(alpha.crossed, '180→30 应标跨档');
    ok(!rows.find((r) => r.term === 'beta').crossed, '一直 #5 不该标跨档');
  });

  test('parseSources：从 asc.js sources 的文本里取曝光构成与搜索地区', () => {
    const text = [
      '■ 国际版  请求 abc',
      '  accessType=ONGOING  stoppedDueToInactivity=false',
      '  Impression  合计 1000',
      '      App Store search             935   93.5%',
      '      App Store browse              65    6.5%',
      '  Tap  合计 12',
      '      App Store search              10   83.3%',
      '  来自搜索的曝光 · 按地区（前 12）',
      '      US        800',
      '      TW        135',
    ].join('\n');
    const L = G.parseSources(text);
    eq(L.length, 1);
    eq(L[0].name, '国际版');
    eq(L[0].events.Impression.total, 1000);
    eq(L[0].events.Impression.bySource[0].source, 'App Store search');
    eq(L[0].events.Impression.bySource[0].count, 935);
    eq(L[0].events.Tap.total, 12);
    eq(L[0].searchByTerr[0][0], 'US');
    eq(L[0].searchByTerr[0][1], 800);
  });

  test('readSnapshots / readRankDocs：只认对应文件名，忽略别的', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-digest-'));
    fs.writeFileSync(path.join(dir, '2026-09-27.json'), JSON.stringify({ at: 'x' }));
    fs.writeFileSync(path.join(dir, 'manual.json'), '{}');
    fs.writeFileSync(path.join(dir, 'aso-rank-2026-09-27.json'), JSON.stringify({ ranks: {} }));
    fs.writeFileSync(path.join(dir, 'sources-2026-09-27.txt'), 'x');
    eq(G.readSnapshots(dir).length, 1);
    eq(G.readRankDocs(dir).length, 1);
    eq(G.readSnapshots(dir)[0].date, '2026-09-27');
    eq(G.readRankDocs(dir)[0].date, '2026-09-27');
  });
});
