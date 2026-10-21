// test/listen-1194-s1.test.js — 1.19.4 S1：标点开头定稿补句首合并同一行（推翻 #592 删补句首）
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');
const C = require('../app/listen-core.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const MODEL = strip(read('src/app/listen-model.js'));

const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

function intakeLeadMerge(ev, partialBy, diags) {
  const base = C.baseCode(ev.locale);
  const pNow = partialBy[base];
  let text = ev.text;
  if (pNow && !pNow.leadUsed) {
    const cut = C.rescueLeadCut(ev.text, pNow.text);
    if (cut && cut.lead) {
      text = C.mergeRescueLead(cut.lead, cut.text);
      partialBy[base] = Object.assign({}, pNow, { leadUsed: true });
      diags.push({ kind: 'rescue:lead' });
    } else if (cut && cut.text && cut.text !== ev.text) text = cut.text;
  }
  return text;
}

describe('S1 · rescueLeadCut / mergeRescueLead', () => {
  test('EN1：定稿 ", and send…" + partial 整句 ⇒ 合并一条', () => {
    const cut = C.rescueLeadCut(', and send them to my office',
      'Please make three copies of this contract and send them to my office');
    ok(cut && cut.lead.indexOf('Please make three copies') >= 0, JSON.stringify(cut));
    const merged = C.mergeRescueLead(cut.lead, cut.text);
    ok(/please make three copies/i.test(merged) && /send them to my office/i.test(merged), merged);
  });
  test('中文：定稿「，明天之前发给我」+ partial 整句 ⇒ 不加空格合并', () => {
    const cut = C.rescueLeadCut('，明天之前发给我', '请把这份报告翻译成英文，明天之前发给我');
    ok(cut && cut.lead.indexOf('请把这份报告') >= 0, JSON.stringify(cut));
    const merged = C.mergeRescueLead(cut.lead, cut.text);
    ok(merged.indexOf('请把这份报告翻译成英文') >= 0 && merged.indexOf('明天之前发给我') >= 0, merged);
    ok(!/\u82f1\u6587\s，/.test(merged), '中文与标点开尾不应插空格：' + merged);
  });
  test('#590 L：`, you, and you risk…` 切垃圾前缀、不借 partial 句首', () => {
    const cut = C.rescueLeadCut(', you, and you risk starvation.', 'and you risk starvation when dry');
    ok(cut && /and you risk starvation/i.test(cut.text) && !/^,\s*you/i.test(cut.text), JSON.stringify(cut));
    ok(!cut.lead, '对不上的 partial 不应硬补句首');
  });
  test('约束 3：对不上 partial ⇒ 不补', () => {
    eq(C.rescueLeadCut(', totally different final words here', 'Please make three copies only'), null);
  });
  test('约束 2：不以标点开头 ⇒ 不补', () => {
    eq(C.rescueLeadCut('Please make copies', 'Please make three copies of this contract'), null);
  });
});

describe('S1 · EN1 回放（单 feed、一行、rescue:lead）', () => {
  test('★ partial + 标点开尾定稿 ⇒ 一行且 diag rescue:lead=1', async () => {
    const partialBy = {};
    const diags = [];
    const rows = [];
    let feeds = 0;
    const seg = C.makeSegmentRouter({
      call: (p) => {
        const m = String(p).match(/BUF:\n([\s\S]*?)\nFORCE:/);
        const buf = m ? m[1].trim() : '';
        return Promise.resolve(JSON.stringify({ segments: [{ source: buf, translation: 'T' }], remainder: '' }));
      },
      emit: (list) => { for (const r of list) rows.push(r.source); },
      fallback: (t) => rows.push(t),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
      idleMs: 1500, endWaitMs: 3000,
    });
    const origFeed = seg.feed.bind(seg);
    seg.feed = (...args) => { feeds++; return origFeed(...args); };
    const gate = C.makeFinalGate({ dominantScript: () => 'Latin', now: () => Date.now(), idleMs: 1500 });
    partialBy.en = { text: 'Please make three copies of this contract and send them to my office', at: Date.now() };
    const merged = intakeLeadMerge({ locale: 'en-US', text: ', and send them to my office', conf: 0.9, t0: 1, t1: 2 }, partialBy, diags);
    const texts = gate.push({ locale: 'en-US', text: merged, conf: 0.9, t0: 1, t1: 2 });
    for (const tt of texts) seg.feed('en-US', tt);
    await seg.settle('end');
    eq(diags.filter((d) => d.kind === 'rescue:lead').length, 1, JSON.stringify(diags));
    eq(feeds, texts.length, '只 feed 一次（合并后）：' + feeds);
    eq(rows.length, 1, JSON.stringify(rows));
    ok(/please make three copies/i.test(rows[0]), rows[0]);
    seg.dispose();
  });
});

describe('S1 · 约束 2 反例', () => {
  test('跨 base 不借 partial', () => {
    const partialBy = { zh: { text: '请把这份报告翻译成英文，明天之前发给我', at: 0 } };
    const diags = [];
    const out = intakeLeadMerge({ locale: 'en-US', text: ', and send them to my office', conf: 0.9 }, partialBy, diags);
    eq(out, ', and send them to my office');
    eq(diags.length, 0);
  });
  test('同段 partial 句首只救一次', () => {
    const partialBy = { en: { text: 'Please make three copies of this contract and send them to my office', at: 0 } };
    const diags = [];
    intakeLeadMerge({ locale: 'en-US', text: ', and send them to my office', conf: 0.9 }, partialBy, diags);
    eq(diags.length, 1);
    const out2 = intakeLeadMerge({ locale: 'en-US', text: ', again tail words', conf: 0.9 }, partialBy, diags);
    eq(out2, ', again tail words');
    eq(diags.length, 1, '第二次不应再 rescue:lead');
  });
});

describe('S1 · hardCut / authStop 合并句首不重复不丢', () => {
  test('hardCut 交旧路：合并后的整句原文照出、句首不重复', async () => {
    const merged = C.mergeRescueLead(
      'Please make three copies of this contract',
      C.rescueLeadCut(', and send them to my office', 'Please make three copies of this contract and send them to my office').text,
    );
    const ev = [];
    const r = C.makeSegmentRouter({
      call: () => Promise.reject(new Error('net')),
      emit: (rows, meta) => ev.push({ t: 'emit', rows, orig: meta.orig }),
      fallback: (s) => ev.push({ t: 'fallback', text: s }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    });
    r.feed('en-US', merged);
    r.settle('stop'); await tick();
    r.settle('stop'); await tick();
    ok(ev.some((e) => e.t === 'fallback'), '应 hardCut 交旧路');
    const shown = ev.filter((e) => e.t === 'fallback').map((e) => e.text).join(' ');
    const hits = (shown.match(/please make three copies/gi) || []).length;
    ok(hits <= 1, '句首重复出现：' + shown);
    ok(/send them to my office/i.test(shown), '尾巴丢失：' + shown);
    r.dispose();
  });
  test('authStop：合并后的整句原文照出一次、不重复句首', async () => {
    const merged = C.mergeRescueLead(
      'Please make three copies of this contract',
      ', and send them to my office',
    );
    const err = Object.assign(new Error('402'), { status: 402, grant: true, code: 'credit_exhausted' });
    const ev = [];
    const r = C.makeSegmentRouter({
      call: () => Promise.reject(err),
      emit: (rows, meta) => ev.push({ t: 'emit', orig: meta.orig, rows }),
      fallback: (s) => ev.push({ t: 'fallback', text: s }),
      onQuota: (e) => ev.push({ t: 'quota', grant: !!(e && e.grant) }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    });
    r.feed('en-US', merged);
    r.settle('switch');
    await tick();
    eq(ev.filter((e) => e.t === 'fallback').length, 0, 'authStop 不应走旧路');
    const shown = ev.filter((e) => e.t === 'emit').map((e) => e.orig).join('');
    ok(shown.indexOf('Please make three copies') >= 0 && /send them to my office/i.test(shown), shown);
    ok((shown.match(/please make three copies/gi) || []).length <= 1, '句首重复：' + shown);
    eq(ev.filter((e) => e.t === 'quota').length, 1);
    r.dispose();
  });
});

describe('S1 · 生产入口形状', () => {
  test('listen-model：merge 在 gate 前、无单独 feed lead', () => {
    ok(/rescueLeadCut/.test(MODEL));
    ok(/mergeRescueLead/.test(MODEL));
    ok(/diagBump\('rescue',\s*'lead'/.test(MODEL));
    ok(!/seg\.feed\(ev\.locale,\s*lead/.test(MODEL));
    ok(/leadUsed/.test(MODEL), 'partial 句首消费标记');
    ok(/function flushPartial\(/.test(MODEL), '1194 A：flushPartial 唯一出口');
  });
  test('1194 A：delete partialBy 只在 flushPartial 内', () => {
    const body = MODEL.slice(MODEL.indexOf('function flushPartial'));
    const deletes = (body.match(/delete partialBy/g) || []).length;
    ok(deletes >= 1, 'flushPartial 内应有 delete');
    ok(!/delete partialBy/.test(MODEL.slice(0, MODEL.indexOf('function flushPartial'))), 'flushPartial 之前不得 delete partialBy');
    ok(!/partialBy\s*=\s*\{\}/.test(MODEL.replace(/let partialBy = \{\}/, '')), '不得整体重置 partialBy');
  });
});

describe('1194 · flushPartial / 九条', () => {
  test('④ timeout：partial 当定稿出行 final:from-partial', () => {
    const partialBy = { en: { text: 'Please make three copies', at: Date.now() - 3000 } };
    const diags = [];
    const feed = (loc, text) => diags.push({ loc, text, kind: 'feed' });
    function flushPartial(base, reason) {
      const p = partialBy[base];
      if (!p || p.flushed) { delete partialBy[base]; return; }
      if (reason === 'timeout' && p.text) { diags.push({ kind: 'final:from-partial', text: p.text }); feed('en-US', p.text); }
      delete partialBy[base];
    }
    flushPartial('en', 'timeout');
    eq(diags.filter((d) => d.kind === 'final:from-partial').length, 1);
    eq(Object.keys(partialBy).length, 0);
  });
  test('② lead_split：入口与纯函数存在', () => {
    ok(typeof C.rescueLeadSplit === 'function');
    ok(/lead_split/.test(MODEL));
    ok(/rescueLeadSplit/.test(MODEL));
  });
  test('B · flushPartial 幂等：同 base 调两次只 feed 一次', () => {
    const partialBy = { en: { text: 'orphan partial line', at: 0 } };
    let feeds = 0;
    const flush = (base, reason) => {
      const p = partialBy[base];
      if (!p) return;
      if (p.flushed) { delete partialBy[base]; return; }
      if (reason === 'pause' && p.text) feeds++;
      delete partialBy[base];
    };
    flush('en', 'pause');
    flush('en', 'pause');
    eq(feeds, 1);
  });
  test('pause / source：关麦与切源走 flushAllPartials', () => {
    ok(/clearPartials\('pause'\)/.test(MODEL));
    ok(/flushAllPartials\('source'\)/.test(MODEL));
  });
  test('⑨ 连说两句：第二句 partial 不借第一句 base', () => {
    const partialBy = { en: { text: 'First sentence complete.', at: 0, leadUsed: true } };
    const diags = [];
    const out = intakeLeadMerge({ locale: 'en-US', text: ', second sentence tail', conf: 0.9 }, partialBy, diags);
    eq(out, ', second sentence tail');
    eq(diags.length, 0);
  });
});
