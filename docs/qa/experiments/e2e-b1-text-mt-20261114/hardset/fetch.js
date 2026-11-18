'use strict';
// Build the hard text set from Wikipedia (CC BY-SA 4.0), pinned by revision id.
// One paragraph per article, chosen for length/number density, not for ease.

const fs = require('fs');
const path = require('path');

const OUT = '/Users/belliedmonkey/qa/e2e-b1-text-mt-20261114/hardset';
const UA = 'BelliedMonkeyBaseline/1.0 (https://github.com/belliedmonkey/belliedmonkey-translator)';

const EN = [
  'Constitutional economics', 'Photosystem II', 'Habeas corpus',
  'Debt-to-GDP ratio', 'Magnetic resonance imaging', 'Basel III',
  'Messier object', 'Roe deer', 'Tidal locking',
  'Semiconductor device fabrication', 'Bayesian inference', 'Tacit collusion',
  'Electoral College (United States)', 'Radiocarbon dating', 'Phonological rule',
];
const ZH = [
  '量子纠缠', '公司法', '通货膨胀', '抗生素', '光合作用',
  '行政复议', '相对论', '货币政策', '疫苗接种', '关税',
  '生态系统', '著作权', '胚胎干细胞', '会计准则', '地缘政治学',
];

function pick(text) {
  const paras = String(text || '').split(/\n+/).map((s) => s.trim())
    .filter((s) => s.length > 120 && !s.startsWith('==') && !s.startsWith('（') && !s.startsWith('('));
  if (!paras.length) return null;
  // Prefer a paragraph with digits and a decent length, cap at one sentence-ish chunk.
  const scored = paras.map((p) => {
    const digits = (p.match(/\d/g) || []).length;
    const commas = (p.match(/[，,]/g) || []).length;
    const len = p.length;
    const lenScore = len > 200 && len < 520 ? 3 : (len <= 200 ? 1 : 0);
    return { p, score: lenScore * 2 + Math.min(digits, 6) + Math.min(commas, 4) };
  }).sort((a, b) => b.score - a.score);
  let body = scored[0].p;
  if (body.length > 520) {
    const cut = body.slice(0, 520);
    const last = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('. '));
    body = last > 180 ? cut.slice(0, last + 1) : cut;
  }
  return body.replace(/\s+/g, ' ').trim();
}

async function fetchOne(lang, title) {
  const url = 'https://' + lang + '.wikipedia.org/w/api.php?action=query&format=json&formatversion=2'
    + '&prop=extracts|revisions&rvprop=ids|timestamp&explaintext=1&redirects=1&titles='
    + encodeURIComponent(title);
  let res = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    res = await fetch(url, { headers: { 'user-agent': UA, 'accept': 'application/json' } });
    if (res.status !== 429) break;
    const wait = 5000 * (attempt + 1);
    console.log('  429, wait ' + wait + 'ms (' + title + ')');
    await new Promise((s) => setTimeout(s, wait));
  }
  if (!res.ok) throw new Error('http ' + res.status + ' ' + title);
  const j = await res.json();
  const page = j.query && j.query.pages && j.query.pages[0];
  if (!page || !page.extract) throw new Error('no extract ' + title);
  const rev = (page.revisions && page.revisions[0]) || {};
  const body = pick(page.extract);
  if (!body) throw new Error('no paragraph ' + title);
  return {
    title: page.title, lang, revid: rev.revid || null, timestamp: rev.timestamp || null,
    source: body, chars: body.length,
    digits: (body.match(/\d/g) || []).length,
    license: 'CC BY-SA 4.0',
    url: 'https://' + lang + '.wikipedia.org/w/index.php?oldid=' + (rev.revid || ''),
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const prevPath = path.join(OUT, 'sources.json');
  const rows = fs.existsSync(prevPath) ? (JSON.parse(fs.readFileSync(prevPath, 'utf8')).items || []) : [];
  const have = new Set(rows.map((r) => r.lang + '|' + r.title));
  for (const [lang, titles] of [['en', EN], ['zh', ZH]]) {
    for (const t of titles) {
      const key = lang + '|' + t;
      if (have.has(key)) { console.log('skip ' + key + ' (already fetched)'); continue; }
      try {
        const r = await fetchOne(lang, t);
        rows.push(r);
        console.log('ok  ' + lang + ' ' + r.title + '  ' + r.chars + ' chars, ' + r.digits + ' digits, rev ' + r.revid);
      } catch (e) {
        console.log('ERR ' + lang + ' ' + t + ': ' + e.message);
      }
      await new Promise((s) => setTimeout(s, 1500));
    }
  }
  fs.writeFileSync(path.join(OUT, 'sources.json'), JSON.stringify({
    schema: 'belliedmonkey.e2e-b1.hardset.v1',
    note: 'Wikipedia extracts under CC BY-SA 4.0, pinned by revision id. One paragraph per article. Not translation gold; used as translation source text only.',
    fetchedAt: new Date().toISOString(),
    items: rows,
  }, null, 2) + '\n');
  const en = rows.filter((r) => r.lang === 'en').length;
  const zh = rows.filter((r) => r.lang === 'zh').length;
  const avg = rows.reduce((a, r) => a + r.chars, 0) / (rows.length || 1);
  console.log(`\n共 ${rows.length} 条 (en ${en} / zh ${zh})，平均 ${avg.toFixed(0)} 字符`);
})();
