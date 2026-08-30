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
const TTS = require('../build/tts.config.js');
const STT = require('../build/stt.config.js');

const VERDICTS = ['adopted', 'rejected', 'unreachable', 'inferred'];
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
    // 注：inferred 不在此列 —— 它按定义就没有自己的基线，那正是它叫「推测」的原因。
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

// ─── 继承：同厂不同域可以，网关与第一方之间不行 ──────────────────────────────
//
// 成本是真的：一个厂常有国内外两个域，逐一实测把测试量翻倍，而它们是同一套 API。
// 但**跨网关**继承有实测反例：同一个 deepseek-v4-flash 在 api.deepseek.com 上默认思考
// 278 tok（disabled 关掉），在 openrouter.ai 上默认 0 tok 而 reasoning:{effort:'low'}
// 反而把它开到 78–233。同一个模型、两个端点、默认行为相反。
//
// 判据用「共享同一个 model-params 行」，而不是另立一张网关名单 —— 那张名单需要人记得
// 去更新，而能力表本来就把同厂的两个域写在一行、把 openrouter 独立成一行。
describe('性能台账：推测值只许在同厂不同域之间流动', () => {
  const INFERRED = LEDGER.filter((r) => r.verdict === 'inferred');
  const byKey = (h, m) => LEDGER.filter((r) => r.host === h && r.model === m);

  test('inferred 必须写清继承自哪个 host，以及为什么可以继承', () => {
    for (const r of INFERRED) {
      const id = `${r.host}·${r.model}`;
      ok(r.from && typeof r.from === 'string', `${id} 是 inferred 却没写 from`);
      ok(r.from !== r.host, `${id} 的 from 指向自己`);
      ok(String(r.why || '').trim().length > 8, `${id} 缺 why`);
    }
  });

  test('只能继承自**实测**结论，不能继承自另一条推测 —— 否则推测值会链式传播', () => {
    for (const r of INFERRED) {
      const src = LEDGER.filter((x) => x.host === r.from);
      ok(src.length > 0, `${r.host} 继承自 ${r.from}，但台账里没有这个 host`);
      const measured = src.filter((x) => x.verdict === 'adopted' || x.verdict === 'rejected');
      ok(measured.length > 0,
        `${r.host} 继承自 ${r.from}，但那个 host 没有任何实测结论`
        + `（只有 ${src.map((x) => x.verdict).join('/')}）—— 推测不能建立在推测上`);
    }
  });

  test('继承双方必须共享同一个 model-params 行 —— 这道墙挡住网关', () => {
    for (const r of INFERRED) {
      const shared = PARAMS.some((p) => p.hosts.includes(r.host) && p.hosts.includes(r.from));
      ok(shared,
        `${r.host} 想继承 ${r.from}，但两者不在同一个 model-params 行里。`
        + ' 同厂不同域才可继承；网关（openrouter 等）与第一方端点之间**不可以**。'
        + ' 实测反例：同一个 deepseek-v4-flash 在第一方默认思考 278tok、在网关默认 0tok，'
        + " 而网关上的 reasoning:{effort:'low'} 是「开启」不是「降档」。");
    }
  });

  test('实测永远优先：有实测行的 (host, model) 不许再有 inferred 行', () => {
    // 用户策略里「有官方值以官方为准」的落点。推测值是占位，实测一到就该被替掉，
    // 而不是两条并存 —— 并存时没有任何机制决定用哪条。
    for (const r of INFERRED) {
      const rivals = byKey(r.host, r.model).filter((x) => x !== r
        && (x.verdict === 'adopted' || x.verdict === 'rejected'));
      eq(rivals.length, 0,
        `${r.host}·${r.model} 既有实测行又有 inferred 行 —— 实测到了就该把推测删掉`);
    }
  });

  test('继承来的参数值必须与源行逐字相等', () => {
    for (const r of INFERRED) {
      if (!r.adopted) continue;
      const src = LEDGER.find((x) => x.host === r.from && x.verdict === 'adopted');
      ok(src, `${r.host} 带了 adopted 值，但源 host ${r.from} 没有 adopted 结论`);
      eq(JSON.stringify(r.adopted), JSON.stringify(src.adopted),
        `${r.host} 的继承值与源行不一致`);
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

  // 按 host 找是不够的 —— 这一条 2026-08-30 被抓到是**空过**的：
  // openrouter.ai 上新测的 google/gemini-3.7-flash 采纳了 reasoning:{effort:low}，
  // 而同 host 的 openrouter-reasoning 行恰好带着同一个值，于是断言满足了 ——
  // 尽管那一行的前缀只有 openai/gpt-5|o1|o3|o4，**根本覆盖不到 gemini**。
  // 也就是说：把新建的 openrouter-gemini 行整个删掉，这道门依然全绿。
  //
  // 判据必须用运行时那把尺子 —— content/request-shape.js 的最长前缀匹配，
  // host 通行行特异度为 0。问的不再是「这个值在表里出现过吗」，
  // 而是「**这个模型**真的会收到它吗」。
  function resolveRow(host, model) {
    const m = String(model || '').trim().toLowerCase();
    let best = null;
    let bestLen = -1;
    for (const row of PARAMS) {
      if (!row.hosts || !row.hosts.includes(host)) continue;
      const prefixes = row.models || [];
      if (!prefixes.length) { if (bestLen < 0) { best = row; bestLen = 0; } continue; }
      if (!m) continue;
      for (const pre of prefixes) {
        if (m.indexOf(pre) === 0 && pre.length > bestLen) { best = row; bestLen = pre.length; }
      }
    }
    return best;
  }

  test('台账里 adopted 的参数，必须真的会发给**那个模型** —— 否则那次测量白做了', () => {
    for (const r of LEDGER.filter((x) => x.verdict === 'adopted')) {
      const row = resolveRow(r.host, r.model);
      ok(row, `台账 ${r.host}·${r.model} 采纳了参数，但 model-params 里没有能命中它的行`);
      eq(JSON.stringify(row.reasoning), JSON.stringify(r.adopted),
        `台账 ${r.host}·${r.model} 采纳了 ${JSON.stringify(r.adopted)}，`
        + `但按运行时的最长前缀匹配，它命中的是 model-params/${row.id}，`
        + `发出去的是 ${JSON.stringify(row.reasoning)} —— 那次测量没有落到这个模型上`);
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
    // **三个注册表都要走**，不只 providers。verification-spec §1.0 的原文就是
    // `build/{providers,tts,stt}.config.js`，而这道门原先只遍历翻译引擎 ——
    // 于是 2026-08-30 新加的 qwen_asr / qwen_tts / openrouter_audio 一条自动门禁都
    // 没过。今天它们碰巧不红，因为语音 host 与翻译 host 重合（dashscope、openrouter、
    // api.openai.com 都已在台账里）；但那是**巧合**，不是保证 —— 一个只做语音的
    // 新 host（比如某个专门的 TTS 厂商）会从这个缺口整个漏过去。
    const covered = new Set(LEDGER.map((r) => r.host));
    const missing = [];
    for (const [reg, entries] of [['providers', PROVIDERS], ['tts', TTS], ['stt', STT]]) {
      for (const e of entries) {
        // 用户自填地址的条目（custom_chat / custom_msg / local）没有可测的对象 ——
        // 我们量不了一个还不存在的地址。google 用查询参数在调用时拼地址，
        // browser 那条根本不说 HTTP，同理。
        if (e.requiresEndpoint || !e.defaultEndpoint) continue;
        for (const h of hostsOfEntry(e)) if (!covered.has(h)) missing.push(`${reg}/${e.id} → ${h}`);
      }
    }
    eq(missing.length, 0,
      '这些引擎还没有性能台账记录：\n  ' + missing.join('\n  ')
      + '\n\n新增供应商要先跑 `/perf-tune`（.claude/skills/perf-tune/SKILL.md）：'
      + '把它下面能做翻译的模型逐个打一遍，把结果记进 build/perf-ledger.config.js。'
      + '\n打不到就记一条 verdict:"unreachable" —— 那是带日期的欠条，不是免责声明。');
  });

  test('台账里的 host 必须是某个引擎或某张表真的会用到的 —— 不许留下已删条目的尸体', () => {
    // live 集合也要含 tts/stt —— 否则给一个**只做语音**的 host 写了台账行，会因为
    // 「不属于任何引擎」而红，而它明明属于一个引擎。两条判据必须看同一批注册表。
    const live = new Set();
    for (const entries of [PROVIDERS, TTS, STT]) {
      for (const e of entries) for (const h of hostsOfEntry(e)) live.add(h);
    }
    for (const p of PARAMS) for (const h of p.hosts) live.add(h);
    for (const r of LEDGER) {
      ok(live.has(r.host),
        `台账里的 ${r.host} 已经不属于任何引擎或能力表条目 —— 条目删了，台账该跟着删`);
    }
  });

  test('这道门本身要能红，否则它证明不了任何事', () => {
    // 守卫的守卫：如果所有条目都被豁免，上面那条会真空通过并在有人删掉豁免判断后
    // 继续通过。至少要有一个条目真的被覆盖检查管着。
    const guarded = [].concat(PROVIDERS, TTS, STT)
      .filter((e) => !e.requiresEndpoint && e.defaultEndpoint);
    ok(guarded.length > 0, '没有任何条目受覆盖检查约束 —— 那条测试是真空的');
  });
});
