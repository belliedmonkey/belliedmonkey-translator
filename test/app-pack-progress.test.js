// test/app-pack-progress.test.js — 听译页切语言时的识别包进度（2026-10-11 真机）。
// 切到还没装的语言必须用完整 locale 去下，进度不能留着上一门，超时不能一直等。
const { describe, test, ok, eq, loadSrc } = require('./harness');

const ctx = loadSrc('src/app/pack-progress.js', 'PackProgress');
const P = ctx.PackProgress;

const LOCALES = { ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN' };
const NAMES = { ja: '日本語', ko: '한국어', zh: '中文' };

describe('识别包进度', () => {
  test('切语言：用完整 locale 开始下载，名字和百分比不沿用上一门', async () => {
    const calls = [];
    const states = [];
    const out = await P.downloadAsrLangs(['ko'], {
      generation: 1,
      current: () => 1,
      toLocale: (c) => LOCALES[c] || c,
      nameOf: (c) => NAMES[c],
      ensureAssets: (kind, spec, onProgress) => {
        calls.push({ kind, spec: spec.slice() });
        onProgress({ locale: 'ja-JP', fraction: 1, name: 'ja-JP' });
        onProgress({ locale: 'ko-KR', fraction: 0.4 });
        return Promise.resolve({ ok: true });
      },
      onState: (s) => states.push(Object.assign({}, s)),
    });
    eq(calls.length, 1);
    eq(calls[0].kind, 'stt');
    eq(calls[0].spec[0], 'ko-KR');
    eq(states[0].name, '한국어');
    eq(states[0].pct, 0);
    eq(states[0].code, 'ko');
    ok(states.every((s) => s.name !== 'ja-JP' && s.name !== '日本語'),
      '进度里出现了上一门或 locale 代码：' + JSON.stringify(states));
    eq(states.find((s) => s.pct === 40).name, '한국어');
    eq(out[0].ok, true);
    eq(out[0].locale, 'ko-KR');
  });

  test('回调的 locale 对不上就丢掉，名字保持这一门的本名', () => {
    const begun = P.beginLangProgress('ko', '한국어');
    const stale = P.applyLangProgress(begun, { locale: 'ja-JP', fraction: 1 });
    eq(stale, begun);
    eq(stale.name, '한국어');
    eq(stale.pct, 0);
    const next = P.applyLangProgress(begun, { locale: 'ko-KR', fraction: 0.5 });
    eq(next.name, '한국어');
    eq(next.pct, 50);
    eq(next === begun, false);
  });

  test('超时标成 stalled，不把没装上的记成成功', async () => {
    const states = [];
    const out = await P.downloadAsrLangs(['ja'], {
      generation: 3,
      current: () => 3,
      timeoutMs: 20,
      toLocale: (c) => LOCALES[c],
      nameOf: (c) => NAMES[c],
      ensureAssets: () => new Promise(() => {}),
      onState: (s) => states.push(Object.assign({}, s)),
    });
    eq(out.length, 1);
    eq(out[0].ok, false);
    eq(out[0].stalled, true);
    eq(states[0].name, '日本語');
    eq(states[0].pct, 0);
    eq(states[states.length - 1].stalled, true);
    eq(states[states.length - 1].name, '日本語');
  });

  test('切走之后这一轮不当失败', async () => {
    let gen = 1;
    const out = await P.downloadAsrLangs(['ja', 'ko'], {
      generation: 1,
      current: () => gen,
      timeoutMs: 500,
      toLocale: (c) => LOCALES[c],
      nameOf: (c) => NAMES[c],
      ensureAssets: () => {
        gen = 2;
        return Promise.resolve({ ok: true });
      },
      onState: () => {},
    });
    eq(out.length, 0);
  });
});

// F12（1.19.4 第 4 轮）：首启「下载中 · 还剩 N 项」= 界面上还没就绪的**那一屏行**，
// 不是「packRows 里已经有 phase 的条目」。基础组件 downloading + 中英朗读 queued 必须数 2。
describe('首启还剩几项', () => {
  test('界面显示 queued 但 packRows 还没写入的行也要算进去', () => {
    // 真机 F12 现场：只有 base 被 setRow 写过；tts:zh-en 的「排队中」是 rowPhase 现推的。
    // 识别包 zh/en 早已就绪。实际剩 2 项，必须数 2（当时错写成 1）。
    const phases = { base: 'downloading', 'asr:zh': 'ready', 'asr:en': 'ready' };
    const ids = ['base', 'tts:zh-en', 'asr:zh', 'asr:en'];
    const phaseOf = (id) => ({ phase: phases[id] || 'queued' });
    eq(P.pendingRowCount(ids, phaseOf), 2, 'base downloading + 中英朗读 queued');
  });
  test('已就绪 / 未选 都不算', () => {
    const phaseOf = (id) => ({ base: { phase: 'ready' }, 'tts:zh-en': { phase: 'ready' }, 'asr:zh': { phase: 'unselected' }, 'tts:th': { phase: 'queued' } }[id] || {});
    eq(P.pendingRowCount(['base', 'tts:zh-en', 'asr:zh', 'tts:th'], phaseOf), 1, '只剩 tts:th');
    eq(P.pendingRowCount([], phaseOf), 0);
    eq(P.pendingRowCount(null, phaseOf), 0);
  });
});

// N24v2 D-02：下载中总进度聚合（细条 + xx% · 约 MB）
describe('首启总进度聚合', () => {
  test('均权：ready / downloading / queued', () => {
    const phaseOf = (id) => ({
      base: { phase: 'ready', pct: 100 },
      'tts:zh-en': { phase: 'downloading', pct: 40 },
      'asr:zh': { phase: 'queued', pct: 0 },
    }[id]);
    const r = P.aggregatePackProgress(['base', 'tts:zh-en', 'asr:zh'], phaseOf, { totalBytes: 200e6 });
    eq(r.pct, 47); // (100+40+0)/3 → 46.66 → 47
    eq(r.indeterminate, false);
    eq(r.count, 3);
    eq(r.totalBytes, 200e6);
  });
  test('waiting / 空列表 → indeterminate', () => {
    const r0 = P.aggregatePackProgress([], () => ({}), {});
    eq(r0.indeterminate, true);
    const r1 = P.aggregatePackProgress(['base'], () => ({ phase: 'queued', pct: 0 }), {
      forceIndeterminate: true, totalBytes: 0,
    });
    eq(r1.indeterminate, true);
  });
  test('未选行不计入', () => {
    const phaseOf = (id) => ({
      base: { phase: 'downloading', pct: 50 },
      'asr:en': { phase: 'unselected' },
    }[id] || { phase: 'unselected' });
    const r = P.aggregatePackProgress(['base', 'asr:en'], phaseOf, { totalBytes: 50e6 });
    eq(r.count, 1);
    eq(r.pct, 50);
    eq(r.indeterminate, false);
  });
});
