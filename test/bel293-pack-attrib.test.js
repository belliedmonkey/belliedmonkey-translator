// test/bel293-pack-attrib.test.js — BEL-293：pack_download_fail 的归因字段。
//
// 四件事：
//   ① 注册表键集合与实际发送键集合**双向**相等（少一个 = 白名单丢键；多一个 = 整条拒收）；
//   ② 原生 reason 串 → 六值 reason + detail 的全表（含 TTS mtTtsFailed 拆码）；
//   ③ 失败归因的 tier / size / progress 归一化（未知/越界不把事件打成非法）；
//   ④ 每个下载单元调用点都带 stage —— 新增调用点漏 stage 就红。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq, loadSrc } = require('./harness');
const cfg = require('../build/telemetry.config.js');

const ROOT = path.join(__dirname, '..');
const MOD = 'src/app/telemetry-session.js';
const INSTALL = '11111111-1111-4111-8111-111111111111';
const TEL_SPEC = {
  url: 'https://ingest.test/functions/v1/bt-ingest',
  spec: { common: cfg.COMMON, events: cfg.EVENTS, limits: cfg.LIMITS },
};

function load() {
  const store = Object.create(null);
  const events = [];
  const local = {
    get(keys, cb) {
      const out = {};
      const list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
      for (const k of list) if (k in store) out[k] = store[k];
      cb && cb(out);
    },
    set(obj, cb) { Object.assign(store, obj); cb && cb(); },
  };
  const sandbox = {
    console: { debug() {}, log() {}, error() {} },
    window: { MT_TELEMETRY: TEL_SPEC },
    chrome: { storage: { local } },
    fetch: async () => ({ ok: true, status: 200 }),
    MTTelemetry: {
      enabled: async () => true,
      track(name, props) { events.push({ name, props }); },
      flush() { return Promise.resolve(true); },
      installId: async () => ({ id: INSTALL }),
    },
    LearnAuth: { currentStable: async () => null, lastLoadError: () => '' },
  };
  const ctx = loadSrc(MOD, 'TelemetrySession', sandbox);
  return { TS: ctx.TelemetrySession, events };
}

function packUnit() {
  return loadSrc('src/app/pack-unit.js', 'PackUnit', {}).PackUnit;
}

const units = [
  { pack_kind: 'vad', pack_id: 'vad', surface: 'listen', source: 'other', tier: 'none', size: 655360 },
  { pack_kind: 'asr', pack_id: 'asr_zh', locale: 'zh', surface: 'first_run_packs', source: 'system', tier: 'none', size: 0 },
  { pack_kind: 'lid', pack_id: 'lid', surface: 'first_run_packs', source: 'other', tier: 'server', size: 39614532 },
  { pack_kind: 'tts', pack_id: 'tts_zh_en', locale: 'zh-en', surface: 'first_run_packs', source: 'modelscope', tier: 'cache', size: 146767700 },
];

describe('BEL-293 pack_download_fail 归因字段', () => {
  test('config 键集合 = pack_download_start / ok / fail 的实际发送键集合（双向）', async () => {
    const { TS, events } = load();
    for (const u of units) {
      const st = await TS.packStart(u);
      await TS.packOk(st);
      const failTok = await TS.packStart(u);
      await TS.packFail(failTok, { reason: 'sha_mismatch', tier: 'server-alt', size: u.size, progress: 41 }, 'download_' + u.pack_kind);
    }
    const keys = (name) => {
      const set = new Set();
      for (const e of events) if (e.name === name) for (const k of Object.keys(e.props)) set.add(k);
      return [...set].sort();
    };
    for (const name of ['pack_download_start', 'pack_download_ok', 'pack_download_fail']) {
      const actual = keys(name);
      const registered = Object.keys(cfg.EVENTS[name]).sort();
      deepEq(actual, registered, name + '：实际发送键 != 注册表键');
    }
    // start / ok 不许多发归因键（白名单没有 ⇒ 服务端整条拒）。
    for (const e of events) {
      if (e.name === 'pack_download_start' || e.name === 'pack_download_ok') {
        for (const k of ['tier', 'detail', 'size', 'progress']) {
          ok(!(k in e.props), e.name + ' 不应出现 ' + k + '（packStart/packOk 不新增字段）');
        }
      }
    }
  });

  test('原生 reason 串 → 六值 + detail 全表（assets / sha_mismatch / load / enospc / mtTtsFailed …）', async () => {
    const { TS, events } = load();
    const PU = packUnit();
    const cases = [
      // [原生错误, stage, 期望 reason, 期望 detail, 期望 code]
      [{ reason: 'assets' }, 'asr', 'other', 'assets', 'download_asr'],
      [{ reason: 'sha_mismatch' }, 'asr', 'hash', 'sha_mismatch', 'download_asr'],
      [{ reason: 'load' }, 'vad', 'other', 'load', 'download_vad'],
      [{ reason: 'enospc' }, 'tts', 'disk', 'enospc', 'download_tts'],
      [{ reason: 'ENOSPC' }, 'asr', 'disk', 'enospc', 'download_asr'],
      // detail 只收 id 型：URL / 长文 / 带空格一律 other，原串不得落库。
      [{ reason: 'https://example.test/a b.zip' }, 'asr', 'network', 'other', 'download_asr'],
      // TTS 拆码：code 仍是 tts_failed（看板前缀不变），why 进 detail。
      [{ mtTtsFailed: true, why: 'sha_mismatch' }, 'tts', 'hash', 'sha_mismatch', 'tts_failed'],
      [{ mtTtsFailed: true, why: 'load' }, 'tts', 'other', 'load', 'tts_failed'],
      [{ mtTtsFailed: true, why: 'enospc' }, 'tts', 'disk', 'enospc', 'tts_failed'],
      // 既有旧 code 优先级 / 取消语义不许被这次拆码改写。
      [{ mtSttTimeout: true, reason: 'timeout' }, 'asr', 'timeout', 'timeout', 'timeout'],
      [{ mtBaseFailed: true, reason: 'disk' }, 'base', 'disk', 'disk', 'base_failed'],
      [{ reason: 'cancelled', message: 'network connect timeout cancelled' }, 'vad', 'other', 'cancelled', 'download_vad'],
      [new Error('download failed with URL https://secret.test/x'), 'asr', 'network', 'other', 'download_asr'],
    ];
    for (const [err, stage, reason, detail, code] of cases) {
      const tok = await TS.packStart({ pack_kind: 'vad', pack_id: 'vad', surface: 'listen', source: 'other', tier: 'none', size: 1 });
      const gotCode = PU.packFailCode(err, stage);
      eq(gotCode, code, JSON.stringify(err) + ' 的 code');
      await TS.packFail(tok, err, gotCode);
      const p = events[events.length - 1].props;
      eq(p.reason, reason, JSON.stringify(err) + ' 的 reason');
      eq(p.detail, detail, JSON.stringify(err) + ' 的 detail');
      eq(p.code, code, JSON.stringify(err) + ' 的落库 code');
      ok(/^[a-z0-9_-]{1,32}$/.test(p.detail), 'detail 必须是 id 型：' + p.detail);
      ok(!/https?:\/\/|secret|example\.test|\.zip|message/i.test(JSON.stringify(p)), 'URL/原文/自由文本进了事件');
    }
  });

  test('tier / size / progress：调用方上下文与失败对象覆盖、非法值归一化', async () => {
    const { TS, events } = load();
    const base = { pack_kind: 'tts', pack_id: 'tts_th', surface: 'first_run_packs', source: 'modelscope' };

    // packStart 的 info 带着上下文（只进 token，不进 start 事件）；失败对象可覆盖。
    const t1 = await TS.packStart(Object.assign({}, base, { tier: 'server', size: 105167496, progress: 12 }));
    eq(events[0].name, 'pack_download_start');
    ok(!('size' in events[0].props) && !('tier' in events[0].props) && !('progress' in events[0].props),
      'packStart 不新增字段');
    await TS.packFail(t1, { reason: 'enospc', tier: 'builtin-alt', size: 99, progress: 87 }, 'tts_failed');
    let p = events[events.length - 1].props;
    eq(p.tier, 'builtin-alt', '失败对象的 tier 优先');
    eq(p.size, 99, '失败对象的 size 优先');
    eq(p.progress, 87, '失败对象的 progress 优先');
    eq(p.detail, 'enospc');

    // 未知 tier / 负 size / 越界 progress 一律回安全值，不让整条事件被拒。
    const t2 = await TS.packStart(Object.assign({}, base, { tier: 'not-a-tier', size: -5, progress: 42 }));
    await TS.packFail(t2, { reason: 'load' }, 'tts_failed');
    p = events[events.length - 1].props;
    eq(p.tier, 'none');
    eq(p.size, 0);
    eq(p.progress, 42, '没有失败对象时用已有进度');
    const t3 = await TS.packStart(Object.assign({}, base, { progress: 150 }));
    await TS.packFail(t3, { reason: 'load', progress: 150 }, 'tts_failed');
    eq(events[events.length - 1].props.progress, 100, 'progress 上限 100');

    // 中英朗读共用一个 zip：两条清单各指同一 path，不能把大小算两遍。
    const PU = packUnit();
    eq(PU.packSizeFromSpec([
      { files: [{ path: 'kokoro-zh-en.zip', size: 146767700 }] },
      { files: [{ path: 'kokoro-zh-en.zip', size: 146767700 }] },
    ]), 146767700, '共享包按 path 去重');
    eq(PU.packSizeFromSpec([{ files: [{ path: 'x.zip', size: -1 }] }]), 0, '非法 size 记未知 0');
  });

  test('packFail / 下载单元调用点都带 stage；新增调用点漏 stage 就红', () => {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    // 扫整个 src/app（含 .jsx），不只今天这三个文件 —— 新调用点落在别处也会被点名。
    const files = fs.readdirSync(path.join(ROOT, 'src/app'))
      .filter((f) => /\.(js|jsx)$/.test(f))
      .map((f) => 'src/app/' + f);
    const calls = [];
    for (const f of files) {
      const src = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
      for (const name of ['runPackUnit', 'reportPackUnit']) {
        const re = new RegExp('\\b' + name + '\\s*\\(', 'g');
        let m;
        while ((m = re.exec(src))) {
          const before = src.slice(Math.max(0, m.index - 24), m.index);
          if (/function\s+$/.test(before)) continue;   // 定义，不是调用点
          const open = src.indexOf('(', m.index);
          let depth = 0;
          let end = -1;
          for (let i = open; i < src.length; i++) {
            if (src[i] === '(') depth++;
            else if (src[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
          }
          ok(end > open, f + ' 里 ' + name + ' 调用括号不配对');
          const args = src.slice(open + 1, end);
          // runPackUnit 的定义体内那一处 reportPackUnit 是唯一出口，stage 是闭包变量；
          // 它不是下载单元调用点，跳过。
          if (/^TelemetrySession,\s*info,\s*fn,/.test(args) && name === 'reportPackUnit') continue;
          calls.push({ file: f, name, args });
        }
      }
    }
    ok(calls.length >= 6, '下载单元调用点少于 6 个 —— 扫描器失效或有人删了单元：' + calls.length);
    for (const c of calls) {
      ok(/'(base|asr|tts|vad)'/.test(c.args),
        c.file + ' 的 ' + c.name + ' 调用点没带 stage：' + c.args.slice(0, 160));
    }

    // packFail 的唯一调用点在 pack-unit.js；stage 已经由 failCode 闭包带进来。
    const unit = strip(fs.readFileSync(path.join(ROOT, 'src/app/pack-unit.js'), 'utf8'));
    let pf = 0;
    const re = /\bpackFail\s*\(/g;
    let m;
    while ((m = re.exec(unit))) {
      const before = unit.slice(Math.max(0, m.index - 24), m.index);
      if (/function\s+$/.test(before)) continue;
      pf++;
    }
    eq(pf, 1, 'packFail 应只有一个调用点（reportPackUnit 的失败出口）');
    ok(unit.indexOf('packFail(token, e, failCode(e))') >= 0,
      'packFail 调用点没把 failCode/stage 交进去');
  });
});
