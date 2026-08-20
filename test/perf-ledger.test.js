// test/perf-ledger.test.js — 「新增一个供应商，必须先把它的模型打一遍」这条规约的门。
//
// ── 为什么是门而不是一句提醒 ────────────────────────────────────────────────
//
// 仓库自己的话：**a list a human must remember to extend is not a gate, it is a wish**。
// 2026-08-20 的教训是这句话的最贵一次注脚：gpt-5-mini 在 1.6.0 里长段落 100% 失败，
// 而全部门禁都是绿的 —— 因为没有任何一道门问过「这个引擎在真端点上跑起来什么样」。
//
// 这道门守的是一条**人真的会走的路**：往 `build/providers.config.js` 加一个条目。
// 加了却没打过，`npm test` 当场红，并告诉你去跑 /perf-tune。
//
// ── 它能证明什么、不能证明什么 ──────────────────────────────────────────────
//
// CI 没有网络也没有 key，所以这道门**不重跑测量**，它检查的是「测量被记下来了，
// 而且结论与出货配置一致」。真正的测量由 `/perf-tune` + `scripts/perf-probe.js` 完成。
// 换句话说：它拦不住「测得草率」，但拦得住「没测」和「测完没落地」——而今天出事的
// 恰恰是后两类。
//
// ── 为什么 unreachable 也算通过 ────────────────────────────────────────────
//
// 一条永远红的测试等于没有测试，人会学会无视它。打不到的端点（没 key、余额不足、
// 模型 id 拿不到）记成一条**带日期、带原因**的欠条，门放行但账目留痕。
// `npm run perf:status` 把欠条列出来 —— 那是给人看的，不是给 CI 看的。

const { describe, test, ok, eq, deepEq } = require('./harness');

const LEDGER = require('../build/perf-ledger.config.js');
const PARAMS = require('../build/model-params.config.js');
const PROVIDERS = require('../build/providers.config.js');

const VERDICTS = ['adopted', 'rejected', 'unreachable'];
const hostOf = (u) => {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(u || ''));
  return m ? m[1].split('@').pop().split(':')[0].toLowerCase() : '';
};

// 一个条目在某个 flavor 下实际会打的 host。`defaultEndpoint` 可能是 {china, global} 映射。
function hostsOfEntry(e) {
  const out = new Set();
  for (const f of (e.flavors || [])) {
    const v = (e.defaultEndpoint && typeof e.defaultEndpoint === 'object' && !Array.isArray(e.defaultEndpoint))
      ? e.defaultEndpoint[f] : e.defaultEndpoint;
    const h = hostOf(v);
    if (h) out.add(h);
  }
  return [...out];
}

describe('性能台账：形状', () => {
  test('每一行都有 host / model / date / verdict，且日期是真日期', () => {
    for (const r of LEDGER) {
      const id = `${r.host}·${r.model}`;
      ok(r.host && typeof r.host === 'string', `${id} 缺 host`);
      ok(r.model && typeof r.model === 'string', `${id} 缺 model`);
      ok(/^\d{4}-\d{2}-\d{2}$/.test(String(r.date)), `${id} 的 date 不是 YYYY-MM-DD：${r.date}`);
      ok(!isNaN(Date.parse(r.date)), `${id} 的 date 不是一个真日期`);
      ok(VERDICTS.indexOf(r.verdict) >= 0, `${id} 的 verdict 不认识：${r.verdict}`);
    }
  });

  test('host 是精确主机名 —— 与 model-params 同一套写法', () => {
    for (const r of LEDGER) {
      eq(r.host, r.host.toLowerCase(), `${r.host} 不是小写`);
      ok(!r.host.includes('/') && !r.host.includes(':') && !r.host.includes('*'),
        `${r.host} 带了协议/端口/通配`);
    }
  });

  test('adopted 必须有基线、有候选、有采纳值 —— 空口不算测过', () => {
    for (const r of LEDGER.filter((x) => x.verdict === 'adopted')) {
      const id = `${r.host}·${r.model}`;
      ok(r.baseline && typeof r.baseline === 'object', `${id} adopted 却没有 baseline`);
      ok(Array.isArray(r.tried) && r.tried.length > 0, `${id} adopted 却没有试过任何候选`);
      ok(r.adopted && typeof r.adopted === 'object' && Object.keys(r.adopted).length > 0,
        `${id} adopted 却没写采纳了什么`);
      ok(String(r.why || '').trim().length > 8, `${id} 缺 why`);
      // 采纳值必须真的出现在候选里，否则「采纳」与「测过」之间没有联系
      const seen = r.tried.some((t) => JSON.stringify(t.params) === JSON.stringify(r.adopted));
      ok(seen, `${id} 采纳的值不在 tried 里 —— 那它是从哪来的？`);
    }
  });

  test('rejected 必须有基线和理由 —— 「测过之后不写」和「没测」是两回事', () => {
    // 这一条是防腐的关键：没有它，下一个人会照厂商文档把 grok / gemini 补回来，
    // 而我们今天实测的结论恰恰是「不写」。
    for (const r of LEDGER.filter((x) => x.verdict === 'rejected')) {
      const id = `${r.host}·${r.model}`;
      ok(r.baseline && typeof r.baseline === 'object', `${id} rejected 却没有 baseline`);
      ok(String(r.why || '').trim().length > 8, `${id} 缺 why`);
    }
  });

  test('unreachable 是一张带日期的欠条，必须写清打不到的原因', () => {
    for (const r of LEDGER.filter((x) => x.verdict === 'unreachable')) {
      ok(String(r.why || '').trim().length > 8, `${r.host}·${r.model} 缺 why`);
    }
  });
});

describe('性能台账：与出货配置锁在一起', () => {
  test('model-params 里每一个 reasoning 片段，都必须有 adopted 台账为证', () => {
    // 表是结论，台账是证据。没有证据的结论，就是我们说好不写的那种「文档摘抄」。
    for (const p of PARAMS) {
      if (!p.reasoning) continue;
      const rows = LEDGER.filter((r) => p.hosts.includes(r.host) && r.verdict === 'adopted');
      ok(rows.length > 0,
        `model-params/${p.id} 写了 reasoning，但 ${p.hosts.join(' / ')} 在台账里没有 adopted 记录`);
      const match = rows.some((r) => JSON.stringify(r.adopted) === JSON.stringify(p.reasoning));
      ok(match,
        `model-params/${p.id} 的 reasoning 与台账不一致：\n`
        + `  表里：${JSON.stringify(p.reasoning)}\n`
        + `  台账：${rows.map((r) => JSON.stringify(r.adopted)).join(' / ')}`);
    }
  });

  test('台账里 adopted 的参数，必须真的写进了 model-params —— 否则那次测量白做了', () => {
    for (const r of LEDGER.filter((x) => x.verdict === 'adopted')) {
      const rows = PARAMS.filter((p) => p.hosts.includes(r.host));
      ok(rows.length > 0, `台账 ${r.host} 采纳了参数，但 model-params 里没有这个 host`);
      const used = rows.some((p) => JSON.stringify(p.reasoning) === JSON.stringify(r.adopted));
      ok(used,
        `台账 ${r.host}·${r.model} 采纳了 ${JSON.stringify(r.adopted)}，但没有任何一行在发它`);
    }
  });

  test('rejected 的 host 不许在表里凭空长出 reasoning —— 除非另有 adopted 为证', () => {
    for (const r of LEDGER.filter((x) => x.verdict === 'rejected')) {
      const adoptedElsewhere = LEDGER.some((x) => x.host === r.host && x.verdict === 'adopted');
      if (adoptedElsewhere) continue;         // 同 host 别的模型采纳了，不冲突
      for (const p of PARAMS.filter((x) => x.hosts.includes(r.host))) {
        ok(!p.reasoning,
          `${r.host} 实测结论是不写，model-params/${p.id} 却写了 ${JSON.stringify(p.reasoning)}`);
      }
    }
  });
});

describe('性能台账：新增供应商必须先打一遍', () => {
  // 这是整份文件的目的。前面几组守的是「记下来的东西自洽」，这一组守的是「有没有记」。
  test('每个自带默认端点的引擎，其 host 都必须在台账里出现过', () => {
    const covered = new Set(LEDGER.map((r) => r.host));
    const missing = [];
    for (const e of PROVIDERS) {
      // 用户自填地址的条目（custom_chat / custom_msg）没有可测的对象 —— 我们量不了
      // 一个还不存在的地址。google 用查询参数在调用时拼地址，同理。
      if (e.requiresEndpoint || !e.defaultEndpoint) continue;
      for (const h of hostsOfEntry(e)) if (!covered.has(h)) missing.push(`${e.id} → ${h}`);
    }
    eq(missing.length, 0,
      '这些引擎还没有性能台账记录：\n  ' + missing.join('\n  ')
      + '\n\n新增供应商要先跑 `/perf-tune`（.claude/skills/perf-tune/SKILL.md）：'
      + '把它下面能做翻译的模型逐个打一遍，把结果记进 build/perf-ledger.config.js。'
      + '\n打不到就记一条 verdict:"unreachable" —— 那是带日期的欠条，不是免责声明。');
  });

  test('台账里的 host 必须是某个引擎或某张表真的会用到的 —— 不许留下已删条目的尸体', () => {
    const live = new Set();
    for (const e of PROVIDERS) for (const h of hostsOfEntry(e)) live.add(h);
    for (const p of PARAMS) for (const h of p.hosts) live.add(h);
    for (const r of LEDGER) {
      ok(live.has(r.host),
        `台账里的 ${r.host} 已经不属于任何引擎或能力表条目 —— 条目删了，台账该跟着删`);
    }
  });

  test('这道门本身要能红，否则它证明不了任何事', () => {
    // 守卫的守卫：如果所有条目都被豁免，上面那条会真空通过并在有人删掉豁免判断后
    // 继续通过。至少要有一个条目真的被覆盖检查管着。
    const guarded = PROVIDERS.filter((e) => !e.requiresEndpoint && e.defaultEndpoint);
    ok(guarded.length > 0, '没有任何条目受覆盖检查约束 —— 那条测试是真空的');
  });
});
