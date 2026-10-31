// test/recommend.test.js — 推荐单的门禁。
//
// 推荐是三张表里**过期最快**的一张：证据永不过期（带日期），结论随厂商改协议而变，
// 而建议随新模型出现而变。所以它最需要机械约束 —— 一条没有证据的推荐，和一句
// 「据说这个好」没有区别，而它会被写进官网教程，被新用户照着抄。
const { describe, test, ok, eq } = require('./harness');
const { AXES, PICKS } = require('../build/recommend.config.js');
const LEDGER = require('../build/perf-ledger.config.js');
const PROVIDERS = require('../build/providers.config.js');
const STT = require('../build/stt.config.js');
const TTS = require('../build/tts.config.js');

const BASES = ['latency', 'cost', 'default', 'judgment'];
const CAPS = ['chat', 'transcribe', 'speech'];

const hostOf = (u) => {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(u || ''));
  return m ? m[1].split('@').pop().split(':')[0].toLowerCase() : '';
};
function defaultModelsFor(host) {
  const out = new Set();
  for (const reg of [PROVIDERS, STT, TTS]) {
    for (const e of reg) {
      const d = e.defaultEndpoint;
      const eps = typeof d === 'string' ? [d] : (d && typeof d === 'object' ? Object.values(d) : []);
      if (!eps.some((u) => hostOf(u) === host)) continue;
      const dm = e.defaultModel;
      if (typeof dm === 'string' && dm) out.add(dm);
      else if (dm && typeof dm === 'object') for (const v of Object.values(dm)) if (v) out.add(v);
    }
  }
  return out;
}

describe('推荐单 — 形状', () => {
  test('每条都写全，且轴与能力都在已知集合里', () => {
    for (const p of PICKS) {
      const id = `${p.platform}/${p.capability}/${p.axis}`;
      for (const f of ['platform', 'host', 'capability', 'axis', 'model', 'basis', 'why']) {
        ok(p[f], `${id} 缺 ${f}`);
      }
      ok(AXES[p.axis], `${id} 的轴 ${p.axis} 不在 AXES 里`);
      ok(CAPS.includes(p.capability), `${id} 的能力 ${p.capability} 不认识`);
      ok(BASES.includes(p.basis), `${id} 的 basis ${p.basis} 不在白名单里`);
      ok(String(p.why).length > 30, `${id} 的 why 太短 —— 推荐必须说清为什么`);
    }
  });

  test('同一个 (平台, 能力, 轴) 只能有一条', () => {
    const seen = new Set();
    for (const p of PICKS) {
      const k = `${p.platform}/${p.capability}/${p.axis}`;
      ok(!seen.has(k), `${k} 有两条推荐 —— 那等于没有推荐`);
      seen.add(k);
    }
  });

  test('每个 (平台, 能力) 都必须有 default 那一轴', () => {
    // 别的轴可以缺（没测过就不该编），但「不选的话用哪个」必须有答案。
    const groups = new Map();
    for (const p of PICKS) {
      const k = `${p.platform}/${p.capability}`;
      groups.set(k, (groups.get(k) || []).concat(p.axis));
    }
    for (const [k, axes] of groups) {
      ok(axes.includes('default'), `${k} 没有 default 轴 —— 用户不选时不知道该用哪个`);
    }
  });
});

describe('推荐单 — 必须有据', () => {
  test('推荐的每个 (host, model) 都在台账里，且不是 unreachable', () => {
    // 我们不推荐一个自己都没打通过的东西。unreachable 是一张带日期的欠条，
    // 欠条不能当推荐用。
    for (const p of PICKS) {
      const rows = LEDGER.filter((r) => r.host === p.host && r.model === p.model);
      ok(rows.length > 0,
        `${p.platform}/${p.capability}/${p.axis} 推荐了 ${p.model}，但 ${p.host} 上它在台账里没有任何记录 —— 跑 /perf-tune 或 scripts/capability-probe.js`);
      ok(rows.some((r) => r.verdict !== 'unreachable'),
        `${p.platform}/${p.capability}/${p.axis} 推荐的 ${p.model} 在台账里只有 unreachable —— 那是欠条，不是证据`);
    }
  });

  test('basis 为 default 的，必须真的是注册表的 defaultModel', () => {
    // 防的是「说是默认，其实早就换了」—— 那会让教程与软件各说各的。
    for (const p of PICKS.filter((x) => x.basis === 'default')) {
      const dms = defaultModelsFor(p.host);
      ok(dms.has(p.model),
        `${p.platform}/${p.capability}/${p.axis} 说 ${p.model} 是默认，但 ${p.host} 的注册表默认是 [${[...dms].join(', ')}]`);
    }
  });

  test('basis 为 judgment 的，why 里必须自己承认那不是测量', () => {
    // 这一条是整份文件最要紧的：把厂商定位包装成「实测最佳」，会毁掉另外三轴
    // 之所以有价值的那个理由 —— 它们是量出来的。
    for (const p of PICKS.filter((x) => x.basis === 'judgment')) {
      ok(/判断不是测量|未做质量评测|不是我们的测量/.test(p.why),
        `${p.platform}/${p.capability}/${p.axis} 的 basis 是 judgment，why 里必须写明「这是判断不是测量」`);
    }
  });

  test('quality 轴一律只能是 judgment —— 我们没有质量评测', () => {
    // 有了评测集与判分方式之后再放开这条，并把这条判据一起改掉。
    for (const p of PICKS.filter((x) => x.axis === 'quality')) {
      eq(p.basis, 'judgment',
        `${p.platform}/${p.capability} 的 quality 轴写了 basis=${p.basis} —— 我们没有做过翻译质量评测，`
        + '任何非 judgment 的 basis 都是在把厂商定位包装成测量');
    }
  });

  test('latency / cost 轴的 why 里要带上那个数', () => {
    // 「更快」不是理由，「268ms」才是。数字写在 why 里，读的人不必翻台账就能判断
    // 它值不值得换。
    for (const p of PICKS.filter((x) => x.basis === 'latency' || x.basis === 'cost')) {
      ok(/\d/.test(p.why),
        `${p.platform}/${p.capability}/${p.axis} 的 basis 是 ${p.basis}，但 why 里一个数字都没有`);
    }
  });
});

describe('推荐单 — 文档与两张表同步', () => {
  test('docs/model-recommendations.md 是生成的，且与 recommend/perf-ledger 一致', () => {
    // 一份手改过的推荐文档，比没有更糟：它看起来权威，而实际与软件行为脱节。
    // 逐字节比对，改内容只能改那两份源。
    const fs = require('fs');
    const { build, OUT } = require('../scripts/gen-model-recommendations.js');
    ok(fs.existsSync(OUT), 'docs/model-recommendations.md 不存在 —— 跑 node scripts/gen-model-recommendations.js');
    eq(fs.readFileSync(OUT, 'utf8'), build(),
      'docs/model-recommendations.md 与 build/recommend.config.js + build/perf-ledger.config.js 不一致'
      + ' —— 跑 node scripts/gen-model-recommendations.js 重新生成（不要手改那份文档）');
  });
});
