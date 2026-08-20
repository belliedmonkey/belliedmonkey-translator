#!/usr/bin/env node
// scripts/perf-probe.js — 「这个端点的这个模型，发什么参数最划算」的测量工具。
//
// 用法：
//   node scripts/perf-probe.js <keySlot> <endpointURL> <model> [--candidates <file.json>]
//   node scripts/perf-probe.js --list                 # 列出 .local/keys.md 里可用的槽位
//
// 例：
//   node scripts/perf-probe.js key_chat_openai https://api.openai.com/v1/chat/completions gpt-5-mini
//
// 它做四件事，每一件都对应 2026-08-20 栽过的一个坑：
//
//   1. **用真实的题面**。默认输入是一段 870 字的维基正文 + 我们真实的 2000 输出预算。
//      短句测不出「预算被思考吃光」—— gpt-5-mini 短句 9 秒能过、长段 27.8 秒吐 0 字。
//   2. **按 token 判，不按墙钟判**。端点会抖、会 503（gemini 那轮多次 503，
//      openrouter 会换上游供应商）。thinkTokens / outChars 才是稳定信号。
//   3. **200 不等于生效**。GLM 收下 reasoning_effort 返回 200 然后完全无视它；
//      openrouter 两种拼法都 200 但效果差一截。所以每个候选都打印 token 数对比。
//   4. **每个候选都要在一个不思考的模型上再打一次**（--safe <model>）。
//      o3-mini 收到 'minimal' 直接 400，而它不发这个参数时本来是好的 —— 一个
//      「优化」把能用的路打断，是这里最贵的错误。
//
// 输出是给人读的表格 + 一段可直接粘进 build/perf-ledger.config.js 的草稿。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KEYS_FILE = path.join(ROOT, '.local', 'keys.md');

// 默认题面：用户 2026-08-20 真机上翻译失败的那一段（en.wikipedia.org/wiki/SMS_Schwaben）。
// 870 字符，页面上最长单元的量级 —— 短于它的输入测不出饿死。
const LONG = 'Rendered obsolete by the appearance of HMS Dreadnought in 1906, Schwaben spent most'
  + ' of her career as a gunnery training ship from 1904 to 1914, though she frequently'
  + ' participated in the large scale fleet exercises during this period. After the start of'
  + ' World War I in August 1914, the ship was mobilized with her sisters as part of IV Battle'
  + ' Squadron. She saw limited duty in the North Sea as a guard ship and in the Baltic Sea'
  + ' against Russian forces. The threat from British submarines forced the ship to withdraw'
  + ' from the Baltic in 1916. For the remainder of the war, Schwaben served as an engineering'
  + ' training ship for navy cadets. She was retained by the Reichsmarine after the war and'
  + ' reactivated from 1919 until June 1920, serving as a depot ship for F-type minesweepers in'
  + ' the Baltic. The ship was stricken from the navy list in March 1921 and sold for scrapping'
  + ' in that year.';

const SYS = "You are a professional translator. Translate the user's text into Simplified Chinese."
  + '\nRules:\n1. Output ONLY the translation — no explanations, notes, or extra content.';

// 候选池：四家四种拼法，全部来自实测。新厂商先从这里试，都不中再查文档补。
const CANDIDATES = [
  { label: "reasoning_effort:'minimal'", params: { reasoning_effort: 'minimal' } },
  { label: "reasoning_effort:'low'", params: { reasoning_effort: 'low' } },
  { label: "thinking:{type:'disabled'}", params: { thinking: { type: 'disabled' } } },
  { label: "reasoning:{effort:'low'}", params: { reasoning: { effort: 'low' } } },
  { label: 'reasoning:{enabled:false}', params: { reasoning: { enabled: false } } },
  { label: 'enable_thinking:false', params: { enable_thinking: false } },
  // messages-compat 的写法。Anthropic 的 extended thinking 本就是 opt-in，
  // 所以这里试的是「显式关掉会不会被拒」，不是「能不能省」。
  { label: "thinking:{type:'disabled'}（messages 形状同名）", params: { thinking: { type: 'disabled' } },
    onlyShape: 'messages' },
];

const hostOf = (u) => {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(u || ''));
  return m ? m[1].split('@').pop().split(':')[0].toLowerCase() : '';
};

function slot(name) {
  if (!fs.existsSync(KEYS_FILE)) return null;
  const m = new RegExp(name + '\\s*=\\s*(\\S+)').exec(fs.readFileSync(KEYS_FILE, 'utf8'));
  return m ? m[1] : null;
}

function listSlots() {
  if (!fs.existsSync(KEYS_FILE)) { console.log('没有 .local/keys.md'); return; }
  for (const line of fs.readFileSync(KEYS_FILE, 'utf8').split('\n')) {
    const m = /^(key_\w+)\s*=\s*(\S*)/.exec(line);
    if (m) console.log('  ' + m[1].padEnd(28) + (m[2] ? `✓ 已填 ${m[2].length} 字符` : '✗ 空'));
  }
}

// 「思考了多少」——各家藏在不同地方，所以这里不是一个字段而是一次搜寻。
function thinkOf(d) {
  const u = d.usage || {};
  const rt = (u.completion_tokens_details || {}).reasoning_tokens
    ?? (u.output_tokens_details || {}).reasoning_tokens;
  if (rt != null) return rt;
  const m = d.choices && d.choices[0] && d.choices[0].message;
  if (m && m.reasoning_content) return String(m.reasoning_content).length;   // 字符数，不是 token
  // messages-compat：思考是一类 content 块，不是一个 usage 字段。
  if (Array.isArray(d.content)) {
    const t = d.content.filter((b) => b.type === 'thinking' || b.type === 'redacted_thinking');
    if (t.length) return t.reduce((a, b) => a + String(b.thinking || '').length, 0);
  }
  return null;
}

// 正文：chat 在 choices[0].message.content，messages 在 content 里的 text 块。
function textOf(d) {
  const m = d.choices && d.choices[0] && d.choices[0].message;
  if (m) return String(m.content || '').trim();
  if (Array.isArray(d.content)) {
    return d.content.filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim();
  }
  return '';
}

// 形状由地址后缀判定，与 wire-format.js 同一条规则。
// 本来只写了 chat-compat —— 而我们自己的注册表就有 messages 形状的条目（claude /
// custom_msg）。一个测不了自家形状的测量工具，会让 /perf-tune 变成一句空话。
function shapeOf(url) {
  const n = String(url).split('?')[0].replace(/\/+$/, '').toLowerCase();
  return n.endsWith('/messages') ? 'messages' : 'chat';
}

async function once(url, key, model, extra, budgetKey, text) {
  const shape = shapeOf(url);
  // messages-compat：系统提示走**顶层 system**（不是一条 message），max_tokens 是
  // API 必填，鉴权用 x-api-key + anthropic-version 而不是 Bearer。
  const body = shape === 'messages'
    ? { model, max_tokens: 2000, system: SYS, messages: [{ role: 'user', content: text }] }
    : { model, messages: [{ role: 'system', content: SYS }, { role: 'user', content: text }] };
  if (shape !== 'messages') body[budgetKey] = 2000;
  Object.assign(body, extra || {});
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: shape === 'messages'
        ? { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
        : { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    const raw = await r.text();
    let d = {};
    try { d = JSON.parse(raw); } catch (_) { /* 非 JSON 正文也要留住 —— 网关会返回 HTML */ }
    const c = d.choices && d.choices[0];
    // ⚠️ MiniMax 会把错误包在 HTTP 200 里（base_resp.status_code）。只看 r.ok 会把
    // 「无效 key」读成一次成功的空翻译 —— 2026-08-20 实测。
    const soft = d.base_resp && d.base_resp.status_code ? d.base_resp : null;
    return {
      ms: Date.now() - t0,
      status: r.status,
      ok: r.ok && !soft && !d.error,
      finish: (c && c.finish_reason) || d.stop_reason || d.status || null,
      think: thinkOf(d),
      outChars: textOf(d).length,
      outTokens: (d.usage || {}).completion_tokens ?? (d.usage || {}).output_tokens ?? null,
      err: soft ? `${soft.status_code} ${soft.status_msg}`
        : (d.error && (d.error.message || JSON.stringify(d.error)))
        || (!r.ok ? raw.replace(/\s+/g, ' ').slice(0, 160) : null),
    };
  } catch (e) { return { ms: Date.now() - t0, status: 0, ok: false, err: String(e.message || e) }; }
}

const fmt = (r) => `${String(r.ms).padStart(6)}ms HTTP ${String(r.status).padEnd(3)} `
  + `finish=${String(r.finish || '-').padEnd(7)} 思考=${String(r.think ?? '?').padStart(5)} `
  + `出参tok=${String(r.outTokens ?? '?').padStart(4)} 正文${String(r.outChars ?? 0).padStart(4)}字`
  + (r.err ? `  ✗ ${String(r.err).slice(0, 90)}` : '');

(async () => {
  const argv = process.argv.slice(2);

  // --status：把台账里的欠条与覆盖缺口列出来。这是给**人**看的，不是给 CI 看的 ——
  // 门禁必须是二值的（一条永远红的测试等于没有测试），所以「还欠着什么」放在这里。
  if (argv[0] === '--status') {
    const LEDGER = require(path.join(ROOT, 'build', 'perf-ledger.config.js'));
    const PROVIDERS = require(path.join(ROOT, 'build', 'providers.config.js'));
    const covered = new Set(LEDGER.map((r) => r.host));
    const owed = LEDGER.filter((r) => r.verdict === 'unreachable');
    const guessed = LEDGER.filter((r) => r.verdict === 'inferred');
    const byVerdict = (v) => LEDGER.filter((r) => r.verdict === v).length;

    console.log(`\n台账 ${LEDGER.length} 行： adopted ${byVerdict('adopted')} ·`
      + ` rejected ${byVerdict('rejected')} · inferred ${byVerdict('inferred')}`
      + ` · unreachable ${byVerdict('unreachable')}`);

    if (owed.length) {
      console.log('\n欠条（打不到，带日期）:');
      for (const r of owed) {
        console.log(`  ${r.date}  ${r.host}`.padEnd(48) + String(r.why).slice(0, 88));
      }
    }
    // 推测值与欠条的紧急度不同：欠条是「完全不知道」，推测值是「按同厂另一个域的结论在跑」。
    // 前者要补测才有知识，后者已经在起作用 —— 一旦拿到该域的 key，应该回头把它换成实测。
    if (guessed.length) {
      console.log('\n推测值（按同厂另一域的实测结论在跑，拿到 key 后应回头实测）:');
      for (const r of guessed) {
        console.log(`  ${r.date}  ${r.host}`.padEnd(48) + `← ${r.from}`);
      }
    }
    const gaps = [];
    for (const e of PROVIDERS) {
      if (e.requiresEndpoint || !e.defaultEndpoint) continue;
      const v = e.defaultEndpoint;
      const list = (v && typeof v === 'object' && !Array.isArray(v)) ? Object.values(v) : [v];
      for (const u of list) { const h = hostOf(u); if (h && !covered.has(h)) gaps.push(`${e.id} → ${h}`); }
    }
    console.log(gaps.length ? '\n⚠️  没有任何记录的引擎（npm test 会红）:\n  ' + gaps.join('\n  ')
      : '\n✓ 每个自带端点的引擎都有台账记录');
    console.log('\n补一条: /perf-tune（.claude/skills/perf-tune/SKILL.md）\n');
    process.exit(0);
  }

  if (argv[0] === '--list' || argv.length < 3) {
    console.log('用法: node scripts/perf-probe.js <keySlot> <endpointURL> <model> [--safe <不思考的模型>] [--repeat N]');
    console.log('\n.local/keys.md 里的槽位:');
    listSlots();
    process.exit(argv[0] === '--list' ? 0 : 1);
  }
  const [slotName, url, model] = argv;
  const safeModel = argv.includes('--safe') ? argv[argv.indexOf('--safe') + 1] : null;
  const repeat = argv.includes('--repeat') ? Number(argv[argv.indexOf('--repeat') + 1]) : 2;
  const key = slot(slotName);
  if (!key) { console.error(`✗ ${slotName} 没填。先看 node scripts/perf-probe.js --list`); process.exit(1); }

  // 预算字段名由地址决定，跟 request-shape.js 同一套判断（/responses 用另一个名字）。
  const budgetKey = /\/responses\/?$/.test(url.split('?')[0]) ? 'max_output_tokens'
    : /openai\.com/.test(url) && /^(gpt-5|o1|o3|o4)/.test(model) ? 'max_completion_tokens' : 'max_tokens';

  console.log(`\n端点  ${url}`);
  console.log(`模型  ${model}   预算字段 ${budgetKey}=2000   题面 ${LONG.length} 字符   每项 ${repeat} 遍\n`);

  // ── 1. 基线：不发任何推理字段 ─────────────────────────────────────────
  const base = [];
  for (let i = 0; i < repeat; i++) base.push(await once(url, key, model, null, budgetKey, LONG));
  for (const r of base) console.log('  基线'.padEnd(34) + fmt(r));
  const baseThink = base.map((r) => r.think).filter((v) => v != null);
  const thinks = baseThink.length > 0 && baseThink.some((v) => v > 0);
  const starved = base.some((r) => r.ok && r.outChars === 0);
  console.log('');
  if (starved) console.log('  ⚠️  基线出现「200 但正文 0 字」—— 预算被思考吃光，这是必须修的 bug，不只是慢');

  if (!thinks && !starved) {
    console.log('  ⓘ  基线看不到思考。若该端点不单独报推理 token（如 gemini 兼容端点），'
      + '改看出参 tok 与耗时；若确实不思考，结论就是 rejected —— 记下来，别留白。');
  }

  // ── 2. 候选 ───────────────────────────────────────────────────────────
  const results = [];
  for (const c of CANDIDATES) {
    if (c.onlyShape && c.onlyShape !== shapeOf(url)) continue;
    const runs = [];
    for (let i = 0; i < repeat; i++) runs.push(await once(url, key, model, c.params, budgetKey, LONG));
    for (const r of runs) console.log(('  ' + c.label).padEnd(34) + fmt(r));
    results.push({ c, runs });
  }

  // ── 3. 安全性：要写的那个值会不会打断一个不思考的模型 ──────────────────
  if (safeModel) {
    console.log(`\n  安全性检查（${safeModel}，本来就不思考的模型）:`);
    for (const c of CANDIDATES) {
      if (c.onlyShape && c.onlyShape !== shapeOf(url)) continue;
      const r = await once(url, key, safeModel, c.params, budgetKey, LONG);
      console.log(('    ' + c.label).padEnd(34) + fmt(r));
    }
  }

  // ── 4. 结论草稿 ───────────────────────────────────────────────────────
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const bt = avg(baseThink);
  const winners = results
    .filter(({ runs }) => runs.every((r) => r.ok && r.outChars > 0))
    .map(({ c, runs }) => ({ c, think: avg(runs.map((r) => r.think).filter((v) => v != null)), ms: avg(runs.map((r) => r.ms)) }))
    .filter((w) => bt == null || w.think == null || w.think < bt)
    .sort((a, b) => (a.think ?? 1e9) - (b.think ?? 1e9));

  // 反方向的坑，2026-08-21 全家扫时才看见：某些网关上「降档」参数其实是**开关**。
  // openrouter 的 reasoning:{effort:'low'} 对本来不思考的模型是「以低档**开启**推理」——
  // deepseek-v4-flash 基线 0 tok、加了之后 78–233 tok；baidu、mistral 同样从 0 变成几百。
  // 所以候选一律也要看**思考有没有变多**，不是只看有没有变少。
  // （这段原本写在基线段里，引用了还没声明的 results，直接把工具跑崩 —— 2026-08-21
  //   打 minimax 时炸的。放在这里是因为它本来就依赖候选结果。）
  const grew = results.filter(({ runs }) => {
    const t = runs.map((r) => r.think).filter((v) => v != null);
    return t.length && bt != null && Math.min(...t) > bt;
  });
  if (grew.length) {
    console.log('\n  ⚠️  这些候选让思考**变多**了 —— 在这个端点上它们是「开启」而不是「降档」:');
    for (const g of grew) console.log(`        ${g.c.label}`);
  }

  console.log('\n── 结论草稿（粘进 build/perf-ledger.config.js 前请自己复核）──');

  // 候选之间分不出高下时，**不许给自信的结论**。
  // 2026-08-21 这个工具自己踩过：minimax/minimax-m2 经 openrouter，五个被接受的候选
  // 思考量落在 233–264，本质上一模一样，而它按「单次采样里最小的那个」推荐了
  // enable_thinking:false —— 一个大概率根本没生效的参数。写进表就是一行假知识。
  // 判据：最好与最差的候选相差不到 15%，就是分不出来。
  const spread = winners.length > 1 && winners.every((w) => w.think != null)
    ? (winners[winners.length - 1].think - winners[0].think) / Math.max(1, winners[0].think)
    : null;
  if (winners.length > 1 && spread != null && spread < 0.15) {
    console.log(`  ⚠️  ${winners.length} 个候选彼此分不出高下（思考 `
      + `${winners[0].think}–${winners[winners.length - 1].think}，相差 ${Math.round(spread * 100)}%）。`);
    console.log('  这通常意味着**它们都没生效**，而不是「都很好」。别按最小的那个下结论 ——');
    console.log('  先 --repeat 4 看基线自己的抖动区间；基线若能跨进这个区间，那就是噪声，'
      + "verdict: 'rejected'。");
    console.log('');
  }

  if (!winners.length) {
    console.log("  verdict: 'rejected' —— 没有候选同时满足「全部成功」且「思考更少」。");
    console.log('  记得写 why：是本来就不思考，还是候选都无效/被拒。留白等于下一个人重做一遍。');
  } else {
    const w = winners[0];
    console.log(`  verdict: 'adopted'，采纳 ${w.c.label}`);
    console.log(`  基线思考 ${bt ?? '?'} → ${w.think ?? '?'}，耗时 ${avg(base.map((r) => r.ms))}ms → ${w.ms}ms`);
    console.log('  ⚠️  写进 model-params 之前，先确认上面的安全性检查里它没有 400。');
  }
  console.log('\n  别忘了：rejected 与 unreachable 也要记。「测过之后不写」和「没测」是两回事，');
  console.log('  而 test/perf-ledger.test.js 只认记下来的那一种。\n');
})().catch((e) => { console.error('perf-probe failed:', (e && e.stack) || e); process.exit(1); });
