// test/layout-caption-desk.test.js — BEL-29 CaptionChrome / deskNarrow|deskWide（SPEC §3.2–3.3）
const { describe, test, ok, eq } = require('./harness');
const { loadSrc } = require('./harness');
const fs = require('fs');
const path = require('path');

const LC = loadSrc('src/app/layout-caption.js', 'LayoutCaption').LayoutCaption;

describe('BEL-29 layout-caption — chrome 派生', () => {
  test('Mac / 非 subtitle 恒 compactPipPath', () => {
    eq(LC.captionChromeForSubtitle({ subtitle: false, macLike: false, ctx: { captionChrome: 'captionDesk' } }), 'compactPipPath');
    eq(LC.captionChromeForSubtitle({ subtitle: true, macLike: true, ctx: { captionChrome: 'captionDesk' } }), 'compactPipPath');
  });
  test('iOS subtitle 只读原生 captionChrome', () => {
    eq(LC.captionChromeForSubtitle({ subtitle: true, macLike: false, ctx: { captionChrome: 'captionDesk' } }), 'captionDesk');
    eq(LC.captionChromeForSubtitle({ subtitle: true, macLike: false, ctx: { captionChrome: 'compactPipPath' } }), 'compactPipPath');
  });
  test('520pt 阈值：deskNarrow / deskWide', () => {
    eq(LC.captionDeskBand({ sceneGeometry: { width: 519 } }, 'captionDesk'), 'deskNarrow');
    eq(LC.captionDeskBand({ sceneGeometry: { width: 520 } }, 'captionDesk'), 'deskWide');
    eq(LC.captionDeskBand({ sceneGeometry: { width: 800 } }, 'compactPipPath'), '');
  });
  test('COPY-LOCK CTA 常量与质量锁一致', () => {
    const lock = fs.readFileSync(path.join(__dirname, '..', 'quality', 'COPY-LOCK-duo-09-caption-desk-b-2026-10-25.md'), 'utf8');
    ok(lock.includes(LC.COPY_DESK_WIDE_CTA), 'deskWide CTA 与 COPY-LOCK 不一致');
  });
});

describe('BEL-29 native layout-context.swift — 注入字段', () => {
  const swift = fs.readFileSync(path.join(__dirname, '..', 'app', 'native', 'layout-context.swift'), 'utf8');
  test('captionChrome 枚举与 JSON 字段', () => {
    ok(/enum MTCaptionChrome/.test(swift), '缺 MTCaptionChrome');
    ok(/"captionChrome": chrome\.rawValue/.test(swift), 'publish 未写 captionChrome');
    ok(/data-mt-caption-chrome/.test(swift), '未写 data-mt-caption-chrome');
  });
  test('singleCompact → compactPipPath；dualRegular → captionDesk', () => {
    ok(/mode == \.singleCompact\) \? \.compactPipPath : \.captionDesk/.test(swift), 'chrome 映射不对');
  });
});

describe('BEL-29 listen 接线 — PiP 仅 compactPipPath', () => {
  const model = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listen-model.js'), 'utf8');
  test('pipHost 门禁 captionChrome', () => {
    ok(/subtitleChromeLayout\(\)\.captionChrome === 'compactPipPath'/.test(model), 'pipHost 未跟 chrome 分流');
    ok(/pipGeom: pipOn/.test(model), 'pipGeom 应跟 compact PiP 路径');
  });
  test('LayoutContextChanged 重排且 desk 时停 PiP 占位', () => {
    ok(/LayoutContextChanged[\s\S]{0,400}pipRectOff\(\)/.test(model), 'desk 几何变化应停 pip rect');
  });
});
