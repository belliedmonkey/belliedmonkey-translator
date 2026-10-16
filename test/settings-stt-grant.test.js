// test/settings-stt-grant.test.js — App 设置页转写下拉与 grantOnly（#592）。
//
// 回归：populate 不传 selected 时 grant_stt 被滤掉 → 下拉空 → saveSttCfg 清 sttEngine。

const fs = require('fs');
const path = require('path');
const { loadSrc, describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const EF = loadSrc('src/shared/engine-fields.js', 'EngineFields').EngineFields;
const SETTINGS = fs.readFileSync(path.join(ROOT, 'src/app/settings-view.jsx'), 'utf8');

const STT_LIST = [
  { id: 'local', label: 'Local' },
  { id: 'grant_stt', label: 'Grant STT', grantOnly: true },
];

function fakeSelect() {
  const kids = [];
  return {
    innerHTML: '', value: '',
    ownerDocument: { createElement: () => ({ value: '', textContent: '' }) },
    appendChild: (o) => kids.push(o),
    options: kids,
  };
}

function sttPopulateBlock(src) {
  const i = src.indexOf("$('stt-engine')");
  ok(i >= 0, '找不到 stt-engine 的 populate');
  return src.slice(i, i + 420);
}

describe('EngineFields.populate — grantOnly 转写（#592）', () => {
  const t = (k, d) => d;
  const sentinel = { value: '', text: '未配置' };

  test('未保存 grant_stt 时 grantOnly 不进下拉', () => {
    const s = fakeSelect();
    EF.populate(s, STT_LIST, { t, sentinel, selected: '' });
    eq(s.value, '', '');
    ok(!s.options.some((o) => o.value === 'grant_stt'), 'grantOnly 应隐藏');
  });

  test('已保存 sttEngine=grant_stt 时下拉读回该值', () => {
    const s = fakeSelect();
    eq(EF.populate(s, STT_LIST, { t, sentinel, selected: 'grant_stt' }), 'grant_stt', '');
    ok(s.options.some((o) => o.value === 'grant_stt'), '正选中时 grantOnly 须在列表里');
  });

  test('simulate saveSttCfg：populate 后读 value 不会把 grant_stt 写成空', () => {
    const s = fakeSelect();
    EF.populate(s, STT_LIST, { t, sentinel, selected: 'grant_stt' });
    const payload = { sttEngine: s.value };
    eq(payload.sttEngine, 'grant_stt',
      '测试连接 / change 前的 saveSttCfg 会写 stt-engine 的 value —— 空下拉会清额度转写');
  });
});

describe('settings-view.jsx — 转写下拉 populate 传 selected（#592）', () => {
  test('stt-engine 的 populate 带 selected（参照 engine-fields-view）', () => {
    const block = sttPopulateBlock(SETTINGS);
    ok(/selected:\s*populateSelectedRef\.current\.stt/.test(block),
      'stt-engine populate 未传 populateSelectedRef.current.stt');
  });

  test('paintNow 在 populateStatic 前写入 populateSelectedRef', () => {
    ok(/populateSelectedRef\.current\s*=\s*\{[\s\S]*stt:\s*cur\.sttEngine/.test(SETTINGS),
      'paintNow 未把 cur.sttEngine 写入 populateSelectedRef');
    const paint = SETTINGS.slice(SETTINGS.indexOf('async function paintNow'));
    const head = paint.slice(0, 900);
    const refAt = head.indexOf('populateSelectedRef.current');
    const popAt = head.indexOf('populateStatic()');
    ok(refAt >= 0 && popAt > refAt,
      'paintNow 须在 populateStatic 之前更新 populateSelectedRef');
  });

  test('朗读 / 解析下拉同样传 selected（grant_speech / grant 同形）', () => {
    ok(/populate\(\$\('tts-engine'\)[\s\S]{0,280}selected:\s*populateSelectedRef\.current\.tts/.test(SETTINGS),
      'tts-engine populate 未传 selected');
    ok(/populate\(\$\('notes-provider'\)[\s\S]{0,280}selected:\s*populateSelectedRef\.current\.notes/.test(SETTINGS),
      'notes-provider populate 未传 selected');
  });
});
