// test/telemetry-registry.test.js — 遥测白名单的门禁（docs/telemetry-design.md §3）。
//
// 三件事：① 服务端读的 events.gen.json 与注册表一致（否则客户端发的东西服务端整条拒，
// 而两边都不报错）；② 表里**永远没有**内容/身份类字段 —— 这是规则 4 的机器判据，
// 不是文档里的一句话；③ 值类型只有那几种，别人加不出「自由文本」这一类。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { describe, test, ok, eq } = require('./harness');
const ROOT = path.join(__dirname, '..');
const cfg = require(path.join(ROOT, 'build/telemetry.config.js'));

describe('telemetry registry — 白名单是唯一登记处', () => {
  test('events.gen.json 与 build/telemetry.config.js 一致', () => {
    let out = '';
    try { out = execFileSync('node', [path.join(ROOT, 'scripts/gen-telemetry.js'), '--check'], { encoding: 'utf8' }); }
    catch (e) { ok(false, (e.stdout || '') + (e.stderr || '')); }
    ok(/一致/.test(out), out);
  });
  test('公共字段与每个事件的属性键里，都没有内容/身份类的词', () => {
    const bad = [];
    // 按 snake_case 的词元比对，不按子串：subtitle_on 里的 title 不是 title。
    const check = (k, where) => { const toks = k.toLowerCase().split('_'); for (const w of cfg.FORBIDDEN_KEY_WORDS) if (toks.includes(w)) bad.push(`${where}.${k} 含「${w}」`); };
    for (const k of Object.keys(cfg.COMMON)) check(k, 'common');
    for (const [ev, props] of Object.entries(cfg.EVENTS)) { check(ev, 'event'); for (const k of Object.keys(props)) check(k, ev); }
    eq(bad.length, 0, bad.join('; '));
  });
  test('值类型只有 int / id / 枚举 / 公共四种 —— 没有「任意字符串」这一类', () => {
    const allowed = new Set(['int', 'id', 'uuid', 'iso', 'semver', 'lang']);
    const rules = [...Object.values(cfg.COMMON), ...Object.values(cfg.EVENTS).flatMap((p) => Object.values(p))];
    for (const r of rules) ok(Array.isArray(r) ? r.every((v) => typeof v === 'string' && v.length <= 32) : allowed.has(r), 'bad rule: ' + JSON.stringify(r));
  });
  test('flavor 只允许 global —— 中国版一个字节都不发', () => {
    eq(JSON.stringify(cfg.COMMON.flavor), JSON.stringify(['global']));
  });
  test('设计文档 §3 列的 11 个事件与注册表逐一对应', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs/telemetry-design.md'), 'utf8');
    const inDoc = new Set([...doc.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]));
    const inCfg = new Set(Object.keys(cfg.EVENTS));
    eq([...inCfg].filter((e) => !inDoc.has(e)).join(','), '', '注册表里有、文档里没有');
    eq([...inDoc].filter((e) => !inCfg.has(e)).join(','), '', '文档里有、注册表里没有');
  });
});
