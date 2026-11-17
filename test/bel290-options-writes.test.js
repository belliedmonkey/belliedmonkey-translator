// test/bel290-options-writes.test.js — BEL-290：options 三处写盘必须把 {ok:false} 变成 throw。
//
// 为什么是这三处：setup_apply_fail{stage:'write'} 的唯一来源是 onApply 抛错。
// SettingsStore.setMany 把失败放在返回值里、不抛 —— 不检查就永远不会有 write 失败，
// 界面还会说「配好了」。
//
// 行为：setManyOrThrow 直接对着假 store 跑（真代码路径）。
// 接线：saveNow / 一键卡 writes / 一键卡 owner flow 三处都必须走它，且不能留裸 setMany。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq, rejects, loadSrc } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const M = loadSrc('src/pages/options-model.js', 'OptionsModel').OptionsModel;

describe('BEL-290 · setManyOrThrow', () => {
  test('{ok:false} → throw new Error("storage")（不是把失败当成功）', async () => {
    const calls = [];
    const store = { setMany: async (p) => { calls.push(p); return { ok: false, error: 'disk full' }; } };
    const e = await rejects(() => M.setManyOrThrow(store, { provider: 'acme' }), /storage/);
    eq(e.message, 'storage', '错误只能是固定的 storage，不能把底层 message 带出来');
    deepEq(calls, [{ provider: 'acme' }], 'patch 必须原样落到 store');
  });

  test('{ok:true} → 原样返回，不抛', async () => {
    const store = { setMany: async () => ({ ok: true, error: null }) };
    const r = await M.setManyOrThrow(store, { targetLang: 'ja' });
    eq(r.ok, true);
  });

  test('store.setMany 自己抛 → 原样抛出（调用方仍能看到写失败）', async () => {
    const store = { setMany: async () => { throw new Error('boom'); } };
    const e = await rejects(() => M.setManyOrThrow(store, { targetLang: 'ja' }), /boom/);
    eq(e.message, 'boom');
  });
});

describe('BEL-290 · options.jsx 三处写盘都走同一个检查', () => {
  const src = stripComments(read('src/pages/options.jsx'));

  test('恰好三处 setManyOrThrow(SettingsStore, …) —— saveNow / writes / owner flow', () => {
    eq((src.match(/setManyOrThrow\(SettingsStore,/g) || []).length, 3,
      '三处保存汇合点没有全部接上检查');
  });

  test('saveNow 的 setMany 走 setManyOrThrow，且不再裸调 SettingsStore.setMany', () => {
    const i = src.indexOf('const saveNow = async () => {');
    ok(i > 0, '找不到 saveNow');
    const body = src.slice(i, src.indexOf('\n  };', i));
    ok(/setManyOrThrow\(SettingsStore,/.test(body), 'saveNow 没走 setManyOrThrow');
    ok(!/SettingsStore\.setMany\(/.test(body), 'saveNow 还有裸 setMany —— 写失败会静默');
  });

  test('一键卡的 writes 与 owner flow 也各自走检查', () => {
    const i = src.indexOf('const applyQuickSetup = async (plan) => {');
    ok(i > 0, '找不到 applyQuickSetup');
    const body = src.slice(i, src.indexOf('\n  };', i));
    eq((body.match(/setManyOrThrow\(SettingsStore,/g) || []).length, 2,
      'applyQuickSetup 的 writes / flow 两笔都要检查');
    ok(!/SettingsStore\.setMany\(/.test(body), 'applyQuickSetup 还有裸 setMany');
    ok(/if \(Object\.keys\(patch\)\.length\)/.test(body) && /if \(Object\.keys\(flow\)\.length\)/.test(body),
      '空 patch / 空 flow 仍应跳过写盘（不制造假失败）');
  });
});
