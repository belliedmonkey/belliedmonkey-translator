// test/bel293-pack-attrib.test.js — BEL-293 定稿：pack_download_fail 的归因字段。
//
// 五件事：
//   ① detail 是 20 值闭枚举（逐字定稿），config / events.gen / 客户端三处逐值一致；
//      客户端先把 sha_mismatch alias 成 sha，未知 reason → other；
//   ② detail 在 packFailReason() 六值归一**之前**取到（sha/offline/http/load 不被吃掉）；
//   ③ tier 只有五个真实层级，判不出时**整个键省略**（不是 'none'）；
//       size / progress 只在 fail 出现，start / ok 不许多键；
//   ④ TTS 保持 code=tts_failed，detail 带调用方写进 e.reason 的 why；
//   ⑤ 每个下载单元调用点都带 stage —— 新增调用点漏 stage 就红。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq, loadSrc, loadModule } = require('./harness');
const cfg = require('../build/telemetry.config.js');
const gen = require('../supabase/functions/bt-ingest/events.gen.json');

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

function nativeSpeech() {
  const posted = [];
  const window = { webkit: { messageHandlers: { mtSpeech: { postMessage: (m) => posted.push(m) } } } };
  return loadModule('../app/native-speech.js', { window }).NativeSpeech;
}

const unit = { pack_kind: 'vad', pack_id: 'vad', surface: 'listen', source: 'other' };

async function failWith(reason, info, code) {
  const { TS, events } = load();
  const tok = await TS.packStart(Object.assign({}, unit, info || {}));
  await TS.packFail(tok, reason, code || 'download_vad');
  return events[events.length - 1].props;
}

describe('BEL-293 定稿 pack_download_fail 归因字段', () => {
  test('detail 20 值闭枚举：客户端 = config = events.gen（逐值）；alias / 未知 reason', async () => {
    const { TS } = load();
    const want = ['sha', 'offline', 'http', 'load', 'download', 'assets', 'locale',
      'locales', 'os', 'analyzer', 'no-engine', 'lang', 'timeout', 'cancelled', 'no-bridge',
      'probe', 'blocked', 'superseded', 'unsupported', 'other'];
    // 三处逐值比对：不只键集合，顺序也必须一致；客户端的私有数组经 _PACK_DETAILS 出口。
    deepEq(cfg.PACK_DETAILS, want, 'config 的 detail 枚举漂了');
    deepEq(TS._PACK_DETAILS, cfg.PACK_DETAILS, '客户端 detail 列表必须逐值等于 config 的 PACK_DETAILS');
    eq(want.length, 20, 'detail 闭枚举定稿 20 值');
    deepEq(gen.events.pack_download_fail.detail, cfg.PACK_DETAILS, 'events.gen 与 config 的 detail 枚举不一致');
    deepEq(gen.events.pack_download_fail.tier, ['cache', 'server', 'server-alt', 'builtin', 'builtin-alt'],
      'events.gen 的 tier 枚举不该再有 none');

    // 20 个值逐个走真实发送路径：detail 原样落库。
    for (const d of want) {
      const p = await failWith({ reason: d });
      eq(p.detail, d, 'detail=' + d);
      eq(p.reason, cfg.EVENTS.pack_download_fail.reason.indexOf(p.reason) >= 0 ? p.reason : 'bad',
        'reason 必须仍是六值：' + JSON.stringify(p));
    }

    // 表驱动 alias：sha_mismatch 是客户端的 sha 别名，不另立值。
    for (const [raw, detail] of [['sha_mismatch', 'sha'], ['SHA_MISMATCH', 'sha']]) {
      eq((await failWith({ reason: raw })).detail, detail, 'alias/大小写：' + raw);
    }
    // enospc 已从 detail 删除：磁盘满靠六值 reason='disk' 表达，detail 落 other。
    // 这条断言钉住「reason 与 detail 各管各的」，不靠 detail 猜磁盘。
    for (const raw of ['enospc', 'ENOSPC']) {
      const p = await failWith({ reason: raw });
      eq(p.reason, 'disk', '磁盘满必须靠 reason=disk 表达：' + raw);
      eq(p.detail, 'other', 'enospc 不在 detail 闭枚举里，必须落 other：' + raw);
    }

    // 闭枚举 = 不做前缀/包含/白名单外匹配。这些都不是表内值，一律 other。
    // failed / format / enospc 都已删：兜底只有 other。
    for (const bad of ['failed', 'format', 'enospc', 'https://example.test/a.zip',
      'load failed', 'not-a-reason', '']) {
      eq((await failWith({ reason: bad })).detail, 'other', '非法 reason 必须 other：' + JSON.stringify(bad));
    }
    // locale 与 locales 是两个原生码，都留、不合并。
    eq((await failWith({ reason: 'locale' })).detail, 'locale');
    eq((await failWith({ reason: 'locales' })).detail, 'locales');
    // 大小写归一仍按原生码处理。
    eq((await failWith({ reason: 'SHA' })).detail, 'sha');
  });

  test('未知 reason 仍发事件：detail=other，且断言事件条数（含 failed / enospc）', async () => {
    const { TS, events } = load();
    const registered = Object.keys(cfg.EVENTS.pack_download_fail);
    for (const reason of ['failed', 'enospc', 'ENOSPC', 'format', 'load failed',
      'https://example.test/a.zip', '', 'not-a-reason']) {
      const tok = await TS.packStart(unit);
      const before = events.length;
      await TS.packFail(tok, { reason }, 'download_vad');
      eq(events.length, before + 1, '未知 reason 也必须发一条 fail：' + JSON.stringify(reason));
      const e = events[events.length - 1];
      eq(e.name, 'pack_download_fail', '事件名必须是 fail：' + JSON.stringify(reason));
      for (const k of Object.keys(e.props)) {
        ok(registered.indexOf(k) >= 0, '事件形状不合法：未登记键 ' + k + '（' + JSON.stringify(reason) + '）');
      }
      eq(e.props.detail, 'other', '未知 reason 的 detail 必须 other：' + JSON.stringify(reason));
      ok(cfg.PACK_DETAILS.indexOf(e.props.detail) >= 0, 'detail 必须落在闭枚举内');
    }
  });

  test('native-speech 的 msg.reason || "failed" 兜底：仍走 packFail 发事件，detail=other', async () => {
    const NS = nativeSpeech();

    // stt-state failed 不带 reason ⇒ native-speech 兜底 'failed'，不在闭枚举里。
    const sttSeen = [];
    NS.sttOpen({ locales: ['en-US'], onEvent: (k, p) => sttSeen.push([k, p]) });
    NS._fromNative({ type: 'stt-state', state: 'failed' });
    const sttErr = sttSeen.find(([k]) => k === 'error');
    ok(sttErr, 'stt-state failed 必须触发 error');
    eq(sttErr[1].reason, 'failed', 'stt failed 无原生 reason 时兜底 failed');

    // tts-failed 不带 reason ⇒ 同一个 'failed' 兜底（第 185/186 行）。
    const job = NS.speak({ id: 'bel293-tts', text: 'x', lang: 'en' });
    NS._fromNative({ type: 'tts-failed', id: 'bel293-tts' });
    let ttsErr = null;
    await job.done.then(() => {}, (e) => { ttsErr = e; });
    const ttsReason = ttsErr && typeof ttsErr === 'object' ? ttsErr.reason : String(ttsErr || '');
    eq(ttsReason, 'failed', 'tts failed 无原生 reason 时兜底 failed');

    // 两个兜底值走真实 telemetry 出口：事件照发、detail 落 other（不是丢事件）。
    const { TS, events } = load();
    for (const raw of [sttErr[1].reason, ttsReason]) {
      const tok = await TS.packStart(unit);
      const before = events.length;
      await TS.packFail(tok, { reason: raw }, 'download_vad');
      eq(events.length, before + 1, '兜底 failed 必须发一条 fail：' + raw);
      eq(events[events.length - 1].name, 'pack_download_fail');
      eq(events[events.length - 1].props.detail, 'other', '兜底 failed 的 detail 必须 other');
    }
  });

  test('detail 在六值归一前取到；只读 e.reason，不读 code / why / detail / message', async () => {
    // 这些原生码会被 packFailReason 压成六值 —— detail 必须保留原码。
    const cases = [
      ['sha', 'hash'],
      ['offline', 'network'],
      ['http', 'network'],
      ['load', 'other'],
      ['timeout', 'timeout'],
      ['cancelled', 'other'],
    ];
    for (const [detail, reason] of cases) {
      const p = await failWith({ reason: detail });
      eq(p.detail, detail, '六值归一吃掉了 detail：' + detail);
      eq(p.reason, reason, detail + ' 的六值 reason');
    }

    // 只从 e.reason 取：code / why / detail / message 都不是来源。
    eq((await failWith({ code: 'sha' })).detail, 'other', 'code 不得成为 detail 来源');
    eq((await failWith({ why: 'load' })).detail, 'other', 'why 不得成为 detail 来源');
    eq((await failWith({ detail: 'assets' })).detail, 'other', 'e.detail 不得成为 detail 来源');
    eq((await failWith({ message: 'offline sha mismatch' })).detail, 'other', 'message 不得成为 detail 来源');
    // 原生 e.reason 是字符串时（旧调用形状）仍按同一个闭枚举处理。
    eq((await failWith('sha')).detail, 'sha');
  });

  test('tier 五值；判不出整键省略（不是 none）；size/progress 只在 fail', async () => {
    const { TS, events } = load();

    // start / ok 不带归因键，即使调用方把上下文塞进了 token。
    const st = await TS.packStart(Object.assign({}, unit, { tier: 'cache', size: 12, progress: 3 }));
    await TS.packOk(st);
    eq(events[0].name, 'pack_download_start');
    eq(events[1].name, 'pack_download_ok');
    for (const e of events) {
      for (const k of ['tier', 'detail', 'size', 'progress']) {
        ok(!(k in e.props), e.name + ' 不应出现 ' + k);
      }
    }
    // packInfo() 只在有值时带 tier：判不出时 token 上也没有这个键。
    eq(st.tier, 'cache');
    const noTierTok = await TS.packStart(unit);
    ok(!('tier' in noTierTok), 'packInfo() 判不出 tier 时必须整键省略');

    // 五个真实层级逐个接受。
    for (const tier of ['cache', 'server', 'server-alt', 'builtin', 'builtin-alt']) {
      const p = await failWith({ reason: 'load' }, { tier }, 'download_vad');
      eq(p.tier, tier, 'tier=' + tier);
    }
    // 判不出（none / 非法 / 空）⇒ 键整个不出现，不是 tier:'none'。
    for (const tier of ['none', 'not-a-tier', '', null]) {
      const p = await failWith({ reason: 'load' }, { tier }, 'download_vad');
      ok(!('tier' in p), 'tier 判不出时必须省略整个键：' + JSON.stringify(tier));
    }

    // 失败对象覆盖 info；info 作为兜底；未知 size / progress 一律 0 且仍然发。
    let p = await failWith({ reason: 'load', tier: 'builtin-alt', size: 99, progress: 87 },
      { tier: 'server', size: 100, progress: 12 }, 'download_vad');
    eq(p.tier, 'builtin-alt', '失败对象 tier 优先');
    eq(p.size, 99, '失败对象 size 优先');
    eq(p.progress, 87, '失败对象 progress 优先');

    p = await failWith({ reason: 'load' }, { size: -5, progress: 42 }, 'download_vad');
    eq(p.size, 0, '负 size -> 0');
    eq(p.progress, 42, '没有失败对象时沿用已有进度');
    ok(!('tier' in p), '没有 tier 上下文时省略');

    p = await failWith({ reason: 'load', progress: 150 }, { size: 0 }, 'download_vad');
    eq(p.progress, 100, 'progress 上限 100');
    eq(p.size, 0, '未知 size 仍写 0（fail 上键必须存在）');

    // packUnsupported：原生判据是 locale；调用方透传后 detail 记 locale，tier 省略。
    await TS.packUnsupported(Object.assign({}, unit, { pack_kind: 'asr', pack_id: 'asr_xx', reason: 'locale' }));
    let up = events[events.length - 1].props;
    eq(up.detail, 'locale', 'ASR 不支持的原生码是 locale');
    ok(!('tier' in up), 'ASR 直调原生 ⇒ tier 省略');
    eq(up.size, 0);
    eq(up.progress, 0);
    // 没有原生 reason 时不能猜一个值：闭枚举的兜底是 other。
    await TS.packUnsupported(Object.assign({}, unit, { pack_kind: 'asr', pack_id: 'asr_yy' }));
    up = events[events.length - 1].props;
    eq(up.detail, 'other', '没有原生 reason 时 detail=other');

    // 纯函数：没有 attempts / 不认识的 source ⇒ 空串；最后一个合法层级胜出。
    const PU = packUnit();
    eq(PU.packTierFromAttempts([]), '');
    eq(PU.packTierFromAttempts([{ source: 'wat' }]), '');
    eq(PU.packTierFromAttempts([{ source: 'cache' }, { source: 'server-alt' }]), 'server-alt');

    // 中英朗读共用一个 zip：两条清单各指同一 path，不能把大小算两遍。
    eq(PU.packSizeFromSpec([
      { files: [{ path: 'kokoro-zh-en.zip', size: 146767700 }] },
      { files: [{ path: 'kokoro-zh-en.zip', size: 146767700 }] },
    ]), 146767700, '共享包按 path 去重');
    eq(PU.packSizeFromSpec([{ files: [{ path: 'x.zip', size: -1 }] }]), 0, '非法 size 记未知 0');
  });

  test('TTS 保持 code=tts_failed，detail 带 why（why 由调用方写进 e.reason）', async () => {
    const { TS, events } = load();
    const PU = packUnit();
    const cases = [
      ['sha', 'sha'],
      ['load', 'load'],
      ['no-engine', 'no-engine'],
    ];
    for (const [why, detail] of cases) {
      const err = { mtTtsFailed: true, why, reason: why };
      eq(PU.packFailCode(err, 'tts'), 'tts_failed', 'TTS code 口径不许变');
      const tok = await TS.packStart({ pack_kind: 'tts', pack_id: 'tts_zh_en', surface: 'first_run_packs', source: 'modelscope' });
      await TS.packFail(tok, err, PU.packFailCode(err, 'tts'));
      const p = events[events.length - 1].props;
      eq(p.code, 'tts_failed', 'TTS 仍用 tts_failed');
      eq(p.detail, detail, 'TTS detail 带 why：' + why);
    }
    // 真实调用点必须把 why 写进 e.reason（packFail 只从 e.reason 取 detail）。
    const src = fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8');
    ok(/mtTtsFailed:\s*true,\s*\n\s*why,\s*\n\s*reason:\s*why/.test(src),
      'shell-model 的 TTS 失败对象没有把 why 同时写进 reason');
  });

  test('config 键集合 = 实际发送键集合；调用点 stage 齐全', async () => {
    const { TS, events } = load();
    const units = [
      { pack_kind: 'vad', pack_id: 'vad', surface: 'listen', source: 'other', size: 655360 },
      { pack_kind: 'asr', pack_id: 'asr_zh', locale: 'zh', surface: 'first_run_packs', source: 'system', size: 0 },
      { pack_kind: 'lid', pack_id: 'lid', surface: 'first_run_packs', source: 'other', tier: 'server', size: 39614532 },
      { pack_kind: 'tts', pack_id: 'tts_zh_en', locale: 'zh-en', surface: 'first_run_packs', source: 'modelscope', tier: 'cache', size: 146767700 },
    ];
    for (const u of units) {
      const st = await TS.packStart(u);
      await TS.packOk(st);
      const failTok = await TS.packStart(u);
      await TS.packFail(failTok, { reason: 'sha', tier: u.tier, size: u.size, progress: 41 }, 'download_' + u.pack_kind);
    }
    const keys = (name) => {
      const set = new Set();
      for (const e of events) if (e.name === name) for (const k of Object.keys(e.props)) set.add(k);
      return [...set].sort();
    };
    for (const name of ['pack_download_start', 'pack_download_ok', 'pack_download_fail']) {
      const actual = keys(name);
      const registered = Object.keys(cfg.EVENTS[name]).sort();
      for (const k of actual) ok(registered.indexOf(k) >= 0, name + ' 发了未登记键 ' + k);
      for (const k of registered) ok(actual.indexOf(k) >= 0, name + ' 没有发已登记键 ' + k);
    }

    // 调用点扫描：每个 runPackUnit / reportPackUnit 都必须带 stage。
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
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
          if (/function\s+$/.test(before)) continue;
          const open = src.indexOf('(', m.index);
          let depth = 0;
          let end = -1;
          for (let i = open; i < src.length; i++) {
            if (src[i] === '(') depth++;
            else if (src[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
          }
          ok(end > open, f + ' 里 ' + name + ' 调用括号不配对');
          const args = src.slice(open + 1, end);
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
    const up = strip(fs.readFileSync(path.join(ROOT, 'src/app/pack-unit.js'), 'utf8'));
    eq((up.match(/\bpackFail\s*\(/g) || []).length, 1, 'packFail 应只有一个调用点');
    ok(up.indexOf('packFail(token, e, failCode(e))') >= 0,
      'packFail 调用点没把 failCode/stage 交进去');
  });
});
