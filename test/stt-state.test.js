// test/stt-state.test.js — content/stt-state.js：转写四键「配好了没有」的唯一判据（learning-design §9.4，2026-09-17）。
//
// 三层：① 判据本身；② 三个消费者真的转调它（而不是各自再算一遍）—— 这是这个文件存在的理由，
// grep 锁住；③ 装载顺序：内容脚本清单、四个扩展页、App 包都在消费者之前装它，否则是加载期
// ReferenceError（engine-state.js 当年在 App 包里漏装过一次，test/app-bundle-deps.test.js 记着）。
const fs = require('fs');
const path = require('path');
const { loadModule, describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const S = loadModule('content/stt-state.js', { window: {} }).SttState;
const REG = [
  { id: 'local', needsKey: false, supportsKey: true, requiresEndpoint: true, defaultEndpoint: null, defaultModel: '' },
  { id: 'cloud', needsKey: true, requiresEndpoint: false, defaultEndpoint: 'https://x/v1/audio/transcriptions', defaultModel: 'm1' },
  { id: 'grant', needsKey: true, requiresEndpoint: false, defaultEndpoint: 'https://relay/audio/transcriptions', grantOnly: true },
];

describe('SttState.fileReady — 三种原因、一份判据', () => {
  test('没选引擎 / 认不出的 id ⇒ no_engine', () => {
    eq(S.fileReady({}, REG).reason, 'no_engine');
    eq(S.fileReady({ sttEngine: 'nope', sttApiKey: 'k' }, REG).reason, 'no_engine');
    eq(S.fileReady({ sttEngine: 'nope' }, REG).eng, null);
  });
  test('要填端点的条目没填 ⇒ no_base；填了就过（不要 key）', () => {
    eq(S.fileReady({ sttEngine: 'local' }, REG).reason, 'no_base');
    const r = S.fileReady({ sttEngine: 'local', sttBaseUrl: 'http://127.0.0.1:1/v1/audio/transcriptions' }, REG);
    ok(r.ok && r.baseUrl === 'http://127.0.0.1:1/v1/audio/transcriptions' && r.model === '', JSON.stringify(r));
  });
  test('云端条目：没 key ⇒ no_key；有 key ⇒ ok，模型回落注册表默认，端点留空（原样走注册表）', () => {
    eq(S.fileReady({ sttEngine: 'cloud' }, REG).reason, 'no_key');
    const r = S.fileReady({ sttEngine: 'cloud', sttApiKey: 'k' }, REG);
    ok(r.ok && r.eng.id === 'cloud' && r.apiKey === 'k' && r.baseUrl === '' && r.model === 'm1', JSON.stringify(r));
    eq(S.fileReady({ sttEngine: 'cloud', sttApiKey: 'k', sttModel: 'mine' }, REG).model, 'mine', '用户填的模型优先');
  });
  test('既没端点也没注册表默认端点的条目 ⇒ no_base（两种写法在这里合成一句）', () => {
    eq(S.fileReady({ sttEngine: 'odd' }, [{ id: 'odd', needsKey: false, requiresEndpoint: false, defaultEndpoint: null }]).reason, 'no_base');
  });
  test('不注入注册表时读 window.MT_STT_ENGINES；注册表没加载 ⇒ no_engine 而不是崩', () => {
    const S2 = loadModule('content/stt-state.js', { window: { MT_STT_ENGINES: REG } }).SttState;
    ok(S2.fileReady({ sttEngine: 'cloud', sttApiKey: 'k' }).ok);
    eq(S.fileReady({ sttEngine: 'cloud', sttApiKey: 'k' }).reason, 'no_engine');
  });
  test('KEYS 恰好是那四个键', () => {
    eq(JSON.stringify(S.KEYS), JSON.stringify(['sttEngine', 'sttApiKey', 'sttBaseUrl', 'sttModel']));
  });
});

describe('三个消费者都转调它，不再各算一遍', () => {
  const CONSUMERS = ['extension/content/asr-source.js', 'extension/learn/speech-input.js', 'extension/popup/asr-entry.js'];
  for (const f of CONSUMERS) {
    test(f + ' 调 SttState.fileReady', () => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      ok(/SttState\.fileReady\(/.test(src), f + ' 没转调 SttState.fileReady');
    });
  }
  test('除 stt-state.js 外，扩展与 App 里没有第二份「needsKey && !sttApiKey」判断', () => {
    const walk = (d, out) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); const st = fs.statSync(p); if (st.isDirectory()) { if (!/node_modules|_locales/.test(n)) walk(p, out); } else if (/\.js$/.test(n) && !/\.gen\.js$|i18n-messages\.js/.test(n)) out.push(p); } return out; };
    const files = walk(path.join(ROOT, 'extension'), []).concat(walk(path.join(ROOT, 'app'), []));
    const bad = files.filter((p) => !p.endsWith('content/stt-state.js') && /needsKey\s*&&\s*!\s*(s|cfg|settings)\.sttApiKey|requiresEndpoint\s*&&\s*!\s*(s|cfg|settings)\.sttBaseUrl/.test(fs.readFileSync(p, 'utf8')));
    eq(bad.length, 0, '又有人自己判转写配好了没有：\n  ' + bad.map((p) => path.relative(ROOT, p)).join('\n  '));
  });
});

describe('装载顺序：消费者之前先有它', () => {
  test('内容脚本清单：每个装了 asr-source.js 的块都在它之前装 stt-state.js', () => {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'));
    let seen = 0;
    for (const b of m.content_scripts || []) {
      const js = b.js || [];
      if (!js.includes('content/asr-source.js')) continue;
      seen++;
      ok(js.includes('content/stt-state.js'), '内容脚本清单里缺 stt-state.js');
      ok(js.indexOf('content/stt-state.js') < js.indexOf('content/asr-source.js'), 'stt-state.js 必须排在 asr-source.js 之前');
    }
    ok(seen >= 1, '没有任何内容脚本块装 asr-source.js —— 这条测试没测到东西');
  });
  test('四个扩展页都加载它，且在消费者之前', () => {
    for (const [page, consumer] of [['popup/popup.html', 'asr-entry.js'], ['options/options.html', 'speech-input.js'], ['onboard/onboard.html', null], ['learn/review.html', 'speech-input.js']]) {
      const html = fs.readFileSync(path.join(ROOT, 'extension', page), 'utf8');
      ok(html.includes('content/stt-state.js'), page + ' 没加载 stt-state.js');
      if (consumer && html.includes(consumer)) ok(html.indexOf('stt-state.js') < html.indexOf(consumer), page + '：stt-state.js 要排在 ' + consumer + ' 之前');
    }
  });
  test('App 包的 MODULES 里有它，且在 speech-input.js / asr-entry.js 之前', () => {
    const src = fs.readFileSync(path.join(ROOT, 'build', 'app-bundle.js'), 'utf8');
    const at = (f) => src.indexOf(`'${f}'`);
    ok(at('extension/content/stt-state.js') >= 0, 'MODULES 里没有 stt-state.js');
    for (const c of ['extension/learn/speech-input.js', 'extension/popup/asr-entry.js']) {
      if (at(c) >= 0) ok(at('extension/content/stt-state.js') < at(c), 'stt-state.js 要排在 ' + c + ' 之前');
    }
  });
});
