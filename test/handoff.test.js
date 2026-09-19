// test/handoff.test.js — 「交来的文字」进复习库的唯一写入者（docs/learning-design.md §9.9）。
//
// 这条路上会**静默**出错的几件事：采集开关关着却还在收（用户看不见的积压）；同一句被收两遍；
// 一篇两千多字的文章变成一张卡；译文等于原文的「翻译」进了复习；收件箱文件在写库之前就被删了。
const fs = require('fs');
const path = require('path');
const { describe, test, eq, ok, deepEq } = require('./harness');
const ROOT = path.join(__dirname, '..');
const H = require(path.join(ROOT, 'app', 'handoff.js'));

const NOW = Date.UTC(2026, 8, 19, 4, 0, 0);
const rec = (o) => Object.assign({ v: 1, text: 'The committee postponed the vote.', tr: '委员会推迟了表决。', lang: 'en', trLang: 'zh-CN', ts: NOW - 60000, via: 'system' }, o || {});
function env(cfg, over) {
  const merged = [];
  const deps = Object.assign({
    langAllowed: () => true, shouldCapture: () => true,
    makeItem: (d, now) => ({ id: d.lang + ':' + d.text, text: d.text, tr: d.tr, sourceId: d.sourceId, anchor: d.anchor, createdAt: now }),
    mergeBatch: async (items, sources) => { merged.push({ items, sources }); },
    t: (k, fb) => fb, once: (n) => { merged.once = n; },
  }, over || {});
  return { env: { cfg: Object.assign({ learnEnabled: true, handoffCapture: true, quickCapture: true, langs: ['en'], registry: [] }, cfg || {}), deps, now: NOW }, merged };
}

describe('AppHandoff — 形状与来源', () => {
  test('锚点是显式新 kind，只有 via 与时间，不带任何来源 App 的信息', () => {
    const d = H.draftFor(rec({ via: 'shot' }));
    deepEq(d.anchor, { k: 'handoff', via: 'shot', at: NOW - 60000 });
    eq(d.playedThrough, true); eq(d.kind, 'sentence'); eq(d.targetLang, 'zh-CN');
  });
  test('来源按入口 + 月份一组；右键「服务」与划词并成一组', () => {
    const a = H.sourceFor(rec({ via: 'select' })), b = H.sourceFor(rec({ via: 'service' }));
    eq(a.id, b.id); eq(a.url, 'handoff://select/' + H.monthOf(NOW)); ok(/划词翻译 · \d{4}-\d{2}$/.test(a.title), a.title);
    eq(H.sourceFor(rec()).id, 'handoff:system:' + H.monthOf(NOW));
    eq(H.draftFor(rec({ via: 'service' })).sourceId, a.id, '卡的 sourceId 必须与来源 id 对得上');
  });
  test('采集开关按入口分两把：系统翻译一把、快速翻译一把', () => {
    eq(H.captureKeyOf('system'), 'handoffCapture');
    for (const v of ['select', 'service', 'input', 'shot']) eq(H.captureKeyOf(v), 'quickCapture');
  });
});

describe('AppHandoff.whyNot — 每一道门', () => {
  const cfg = { learnEnabled: true, handoffCapture: true, quickCapture: true };
  const why = (r, c, d) => H.whyNot(r, Object.assign({}, cfg, c), d || {}, NOW);
  test('合格的记录 ⇒ 写', () => eq(why(rec()), ''));
  test('形状不对、via 不在闭集里 ⇒ 不写', () => { eq(why({ text: 1 }), 'shape'); eq(why(rec({ via: 'spy' })), 'shape'); eq(why(rec({ ts: 0 })), 'shape'); });
  test('空、或译文等于原文 ⇒ 不写', () => { eq(why(rec({ tr: '  ' })), 'empty'); eq(why(rec({ tr: 'The committee postponed the vote.' })), 'same'); });
  test('超过 2000 字 ⇒ 不写（照翻不采集）', () => { eq(why(rec({ text: 'a'.repeat(2001) })), 'long'); eq(why(rec({ text: 'a '.repeat(999) })), ''); });
  test('放了 30 天以上 ⇒ 不写', () => eq(why(rec({ ts: NOW - 31 * 24 * 3600 * 1000 })), 'stale'));
  test('总闸或这一把采集开关关着 ⇒ 不写；另一把关着不影响', () => {
    eq(why(rec(), { learnEnabled: false }), 'learn-off');
    eq(why(rec(), { handoffCapture: false }), 'capture-off');
    eq(why(rec(), { quickCapture: false }), '');
    eq(why(rec({ via: 'shot' }), { quickCapture: false }), 'capture-off');
  });
  test('学习语言与采集门照常过', () => {
    eq(why(rec(), {}, { langAllowed: () => false }), 'lang');
    eq(why(rec(), {}, { shouldCapture: () => false }), 'gate');
  });
});

describe('AppHandoff.ingest — 先写库后删文件；关着就丢弃并清空', () => {
  test('一批里合格的写进去、一次 mergeBatch；来源去重；首次采集记一次', async () => {
    const { env: e, merged } = env();
    const r = await H.ingest([{ name: 'a.json', record: rec() }, { name: 'b.json', record: rec({ text: 'Second sentence here.', tr: '第二句。' }) }], e);
    eq(r.written, 2); eq(merged.length, 1); eq(merged[0].items.length, 2); eq(merged[0].sources.length, 1);
    deepEq(r.names.sort(), ['a.json', 'b.json']); eq(merged.once, 'capture_first');
  });
  test('写库失败 ⇒ 一个文件名都不交出去（调用方就不会去删）', async () => {
    const { env: e } = env({}, { mergeBatch: async () => { throw new Error('idb'); } });
    let threw = false; try { await H.ingest([{ name: 'a.json', record: rec() }], e); } catch (_) { threw = true; }
    ok(threw, '写库失败必须抛出来，不能返回一个带 names 的结果');
  });
  test('采集关着 ⇒ 整批丢弃：不写库，但文件名照交（清空，不留用户看不见的积压）', async () => {
    const { env: e, merged } = env({ handoffCapture: false });
    const r = await H.ingest([{ name: 'a.json', record: rec() }, { name: 'b.json', record: rec({ text: 'x y z w' }) }], e);
    eq(r.written, 0); eq(merged.length, 0); deepEq(r.names.sort(), ['a.json', 'b.json']); eq(r.skipped['capture-off'], 2);
  });
  test('中继来的裸记录（没有文件名）同样能收', async () => {
    const { env: e, merged } = env();
    const r = await H.ingest([rec({ via: 'select' })], e);
    eq(r.written, 1); eq(r.names.length, 0); eq(merged[0].items[0].anchor.via, 'select');
  });
  test('重复摄入是幂等的：同一句两次得到同一个 item id（merge 由库负责去重）', async () => {
    const { env: e, merged } = env();
    await H.ingest([rec()], e); await H.ingest([rec()], e);
    eq(merged[0].items[0].id, merged[1].items[0].id);
  });
});

// 读者分支门（learning-design §9.9 / §12）：新 kind 必须在每个读者里有显式分支 ——
// 「未知 kind 静默落进默认分支才是坑」。去掉注释再找，免得一句注释冒充分支。
describe('锚点 k:handoff —— 三个读者各有显式分支', () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const f of ['extension/learn/review.js', 'extension/learn/sources-view.js', 'app/driving.js']) {
    test(f, () => ok(/handoff/.test(strip(fs.readFileSync(path.join(ROOT, f), 'utf8'))), f + ' 里没有对 handoff 的显式处理'));
  }
  test('来源管理：handoff 来源不进「按站点」分组', () => {
    const src = strip(fs.readFileSync(path.join(ROOT, 'extension/learn/sources-view.js'), 'utf8'));
    ok(/!isConv\(s\) && !isDoc\(s\) && !isHandoff\(s\)/.test(src), 'groupByHost 没有排除 handoff 来源 —— hostOf 会把入口名当成域名');
  });
  test('App 包里有这个模块', () => {
    const { MODULES } = require(path.join(ROOT, 'build', 'app-bundle.js'));
    ok(MODULES.includes('app/handoff.js'));
  });
});

describe('SourcesView.groupHandoff —— 按入口 + 月份一行，新月份在前，不串进站点分组', () => {
  const hadWindow = 'window' in global;
  if (!hadWindow) global.window = { MT_PALETTE: require('../build/palette.config.js').runtime };
  const SV = require('../extension/learn/sources-view.js');
  if (!hadWindow) delete global.window;
  const sources = [
    { id: 'handoff:system:2026-08', url: 'handoff://system/2026-08', title: '系统翻译 · 2026-08' },
    { id: 'handoff:system:2026-09', url: 'handoff://system/2026-09', title: '系统翻译 · 2026-09' },
    { id: 'handoff:shot:2026-09', url: 'handoff://shot/2026-09', title: '截图翻译 · 2026-09' },
    { id: 'handoff:input:2026-09', url: 'handoff://input/2026-09', title: '输入翻译 · 2026-09' },   // 没有卡 ⇒ 不出现
    { id: 'w1', url: 'https://example.org/a', title: 'Example' },
  ];
  const items = [
    { id: 'a', sourceId: 'handoff:system:2026-08', anchor: { k: 'handoff', via: 'system' } },
    { id: 'b', sourceId: 'handoff:system:2026-09', anchor: { k: 'handoff', via: 'system' } },
    { id: 'c', sourceId: 'handoff:system:2026-09', anchor: { k: 'handoff', via: 'system' } },
    { id: 'd', sourceId: 'handoff:shot:2026-09', anchor: { k: 'handoff', via: 'shot' } },
    { id: 'e', sourceId: 'w1', anchor: { k: 'dom' } },
  ];
  test('分组、计数、顺序', () => {
    deepEq(SV.groupHandoff(items, sources).map((g) => [g.sourceId, g.count]),
      [['handoff:shot:2026-09', 1], ['handoff:system:2026-09', 2], ['handoff:system:2026-08', 1]]);
  });
  test('按站点分组里只有真的网页来源 —— 入口名不会被当成域名', () => {
    deepEq(SV.groupByHost(items, sources, {}).map((r) => [r.host, r.count]), [['example.org', 1]]);
  });
  test('isHandoff 只认 handoff://', () => { ok(SV.isHandoff(sources[0])); ok(!SV.isHandoff(sources[4])); ok(!SV.isHandoff({ url: 'conv://x' })); });
});
