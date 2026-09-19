// test/telemetry-registry.test.js — 遥测白名单的门禁（docs/telemetry-design.md §3）。
//
// 四件事（第四件 2026-09-19，§3.4：每个事件在每个宿主上真的有发送点 —— 见文件末尾）。
// 前三件：① 服务端读的 events.gen.json 与注册表一致（否则客户端发的东西服务端整条拒，
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

// ── 发送点（telemetry-design §3.4）──────────────────────────────────────────────
//
// 上面四条守的是「发了不该发的」。这一组守另一半：**该发的有人发**。
//
// 核法是静态的：去掉注释之后，file 里有 track/once('<事件>'（telemetry.js 内部直发的
// telemetry_off 是 name: '<事件>' 这个形状）。**先去注释再比**，因为这个仓库的注释里到处是
// 事件名 —— 一句「grant_claimed 由 claim() 自己记」不能算一个发送点（同「负向断言被自己的
// 注释绊倒」那个坑的正向版）。静态核对证明「有调用」，证明不了「走得到」；走得到由
// test:listen 与 verify-onboard 里读 tm:queue 的行为断言守。
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const HOSTS = ['ext', 'app'];
function checkSeams(events, seams, read, modules) {
  const bad = [];
  for (const ev of Object.keys(events)) {
    const list = seams[ev];
    if (!Array.isArray(list) || !list.length) { bad.push(`${ev}: 没有登记 seams`); continue; }
    for (const h of HOSTS) {
      if (!list.some((x) => x.host === h && (x.file || (x.none && !x.surface)))) bad.push(`${ev}: 宿主 ${h} 既没有发送点也没有 none 理由`);
    }
    for (const x of list) {
      if (!HOSTS.includes(x.host)) { bad.push(`${ev}: host 只能是 ext / app，得到 ${x.host}`); continue; }
      if (x.none != null) { if (typeof x.none !== 'string' || x.none.trim().length < 6) bad.push(`${ev}/${x.host}: none 要写一句理由`); continue; }
      const src = read(x.file);
      if (src == null) { bad.push(`${ev}/${x.host}: ${x.file} 不存在`); continue; }
      const code = stripComments(src);
      const called = new RegExp(`(?:track|once)\\(\\s*['"]${ev}['"]`).test(code) || new RegExp(`name:\\s*['"]${ev}['"]`).test(code);
      if (!called) bad.push(`${ev}/${x.host}: ${x.file} 里没有 track/once('${ev}'`);
      if (x.match && !code.includes(x.match)) bad.push(`${ev}/${x.host}: ${x.file} 里没有 ${x.match}`);
      if (x.host === 'app' && x.file.startsWith('extension/') && !modules.includes(x.file)) bad.push(`${ev}/app: ${x.file} 不在 App 包的 MODULES 里`);
    }
  }
  for (const ev of Object.keys(seams)) if (!events[ev]) bad.push(`${ev}: seams 里有、EVENTS 里没有`);
  return bad;
}

describe('telemetry seams — 每个事件在每个宿主上真的有发送点（§3.4）', () => {
  const { MODULES } = require(path.join(ROOT, 'build/app-bundle.js'));
  const read = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { return null; } };

  test('注册表的 SEAMS 与代码逐项对得上', () => {
    const bad = checkSeams(cfg.EVENTS, cfg.SEAMS, read, MODULES);
    eq(bad.length, 0, '\n  ' + bad.join('\n  '));
  });
  test('SEAMS 不出注册表：不进 events.gen.json', () => {
    const gen = fs.readFileSync(path.join(ROOT, 'supabase/functions/bt-ingest/events.gen.json'), 'utf8');
    ok(!/seams|"file"|"none"/i.test(gen), 'events.gen.json 里出现了发送点元数据');
  });

  // 门禁自己要能红。下面四种都是真发生过的形状（§3.3 / §3.4），不是想象出来的。
  const one = (ev, list, files, modules) => checkSeams({ [ev]: {} }, { [ev]: list }, (f) => (f in files ? files[f] : null), modules || []);
  test('红：发送点挂在调用方、共用模块里没有（09-19 的 grant_claimed）', () => {
    const bad = one('grant_claimed', [{ host: 'ext', file: 'g.js' }, { host: 'app', file: 'app/s.js' }],
      { 'g.js': "MTTelemetry.track('grant_claimed', {});", 'app/s.js': "say(t('grant_claimed_toast'));" });
    eq(bad.length, 1); ok(/app\/s\.js 里没有/.test(bad[0]), bad[0]);
  });
  test('红：只在注释里提到事件名不算发送点', () => {
    const bad = one('grant_claimed', [{ host: 'ext', file: 'g.js' }, { host: 'app', none: '这个宿主没有领取入口' }],
      { 'g.js': "// 此前这里是 MTTelemetry.track('grant_claimed', {})\n/* track('grant_claimed') */\nfoo();" });
    eq(bad.length, 1);
  });
  test('红：同名事件接了别的表面，裁定的那个表面没接（09-19 的 App translate_ok{subtitle}）', () => {
    const bad = one('translate_ok', [{ host: 'ext', file: 'a.js' }, { host: 'app', file: 'app/l.js', match: "kind: 'subtitle'" }],
      { 'a.js': "track('translate_ok', { kind: 'page' })", 'app/l.js': "track('translate_ok', { kind: 'doc' })" });
    eq(bad.length, 1); ok(/kind: 'subtitle'/.test(bad[0]), bad[0]);
  });
  test('红：某个宿主整个没登记（09-16 的 App 侧全黑）；共用模块没进 App 包；none 不写理由', () => {
    ok(one('engine_set', [{ host: 'ext', file: 'a.js' }], { 'a.js': "track('engine_set', {})" }).some((b) => /宿主 app/.test(b)));
    ok(one('sync_on', [{ host: 'ext', file: 'extension/x.js' }, { host: 'app', file: 'extension/x.js' }],
      { 'extension/x.js': "once('sync_on')" }, []).some((b) => /MODULES/.test(b)));
    ok(one('rate_prompt', [{ host: 'ext', file: 'a.js' }, { host: 'app', none: '' }], { 'a.js': "track('rate_prompt', {})" }).some((b) => /理由/.test(b)));
  });
  test('红：零发送点的事件（09-08 起的 grant_exhausted）', () => {
    eq(checkSeams({ grant_exhausted: {} }, {}, () => null, []).length, 1);
  });
});
