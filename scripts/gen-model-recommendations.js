#!/usr/bin/env node
// scripts/gen-model-recommendations.js — 把推荐单与实测台账渲染成一份能读的文档。
//
//   node scripts/gen-model-recommendations.js            # 生成
//   node scripts/gen-model-recommendations.js --check    # 只比对（干运行即校验器）
//
// 产出 docs/model-recommendations.md。**不要手改那份文件** —— 它由
// build/recommend.config.js + build/perf-ledger.config.js 生成，门禁逐字节比对。
//
// 为什么要有这一份：台账是给机器和门禁读的（一行一个 JS 对象，六十多行），
// 推荐单是给生成器读的。人要回答「我该用哪个模型、凭什么」时，两份都不合适 ——
// 而这个问题会被反复问到（用户问、我自己下次也会问）。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'model-recommendations.md');
const { AXES, PICKS } = require(path.join(ROOT, 'build/recommend.config.js'));
const LEDGER = require(path.join(ROOT, 'build/perf-ledger.config.js'));

const PLATFORM_LABEL = {
  openrouter: 'OpenRouter（国际版，一个 key）',
  qianwen: '千问AI平台 / DashScope（中国版，一个 key）',
};
const CAP_LABEL = { chat: '翻译 / 句子解析', transcribe: '转写（「说」题）', speech: '朗读' };
const VERDICT_LABEL = {
  adopted: '✅ 采纳', rejected: '⬜ 测过不写', reachable: '🔵 可达（参数未扫）',
  inferred: '🟣 继承', unreachable: '⚠️ 打不到',
};

const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

// 台账里那一行的关键数字，压成一句话。
function numbers(r) {
  const bits = [];
  if (r.baseline && r.baseline.ms != null) bits.push(`基线 ${r.baseline.ms}ms`);
  if (r.baseline && r.baseline.thinkTokens != null) bits.push(`思考 ${r.baseline.thinkTokens}tok`);
  const best = (r.tried || []).filter((t) => t.outChars > 0).sort((a, b) => a.ms - b.ms)[0];
  if (best) bits.push(`降档后 ${best.ms}ms`);
  return bits.join(' · ') || '—';
}

function build() {
  const today = new Date().toISOString().slice(0, 10);
  const L = [];
  L.push('# 模型推荐与实测台账');
  L.push('');
  L.push('> **这份文件是生成的，不要手改。**');
  L.push('> 来源：`build/recommend.config.js`（建议）+ `build/perf-ledger.config.js`（证据）。');
  L.push('> 改内容请改那两份，然后跑 `node scripts/gen-model-recommendations.js`。');
  L.push('');
  L.push('三张表的分工：**台账**记打过什么（永不过期，带日期）·**参数表**记该发哪些字段');
  L.push('（随厂商改协议而变）·**推荐单**记同一件事该选哪个（随新模型出现变得最快）。');
  L.push('');

  L.push('## 轴');
  L.push('');
  for (const [k, v] of Object.entries(AXES)) L.push(`- **${k}** —— ${v}`);
  L.push('');

  L.push('## 推荐');
  L.push('');
  const platforms = [...new Set(PICKS.map((p) => p.platform))];
  for (const plat of platforms) {
    L.push(`### ${PLATFORM_LABEL[plat] || plat}`);
    L.push('');
    for (const cap of ['chat', 'transcribe', 'speech']) {
      const rows = PICKS.filter((p) => p.platform === plat && p.capability === cap);
      if (!rows.length) continue;
      L.push(`**${CAP_LABEL[cap] || cap}**`);
      L.push('');
      L.push('| 轴 | 模型 | 依据 | 为什么 |');
      L.push('|---|---|---|---|');
      for (const p of rows) {
        L.push(`| ${p.axis} | \`${esc(p.model)}\` | ${p.basis} | ${esc(p.why)} |`);
      }
      L.push('');
    }
  }

  L.push('## 我们**没有**测过的');
  L.push('');
  L.push('- **翻译质量。** 没有评测集、没有人工打分、没有 A/B。所以 `quality` 轴上每一条的');
  L.push('  依据都是 `judgment`（厂商定位 / 模型规模），不是我们的测量。要把它变成可测的，');
  L.push('  需要一个固定的评测集（同一批段落 × 多语言）加一个可复现的判分方式。');
  L.push('- **转写准确率。** 只用一句「The quick brown fox jumps over the lazy dog.」比对过，');
  L.push('  那能抓住「引擎在瞎猜」，抓不住「口音下掉词率」这类差异。');
  L.push('- **朗读音质。** 只验到「浏览器能解码出声音、时长合理」。');
  L.push('');

  L.push('## 实测台账（全部）');
  L.push('');
  L.push(`共 ${LEDGER.length} 行。结局的含义见 \`build/perf-ledger.config.js\` 的文件头。`);
  L.push('');
  const byHost = new Map();
  for (const r of LEDGER) byHost.set(r.host, (byHost.get(r.host) || []).concat(r));
  for (const [host, rows] of byHost) {
    L.push(`### \`${host}\``);
    L.push('');
    L.push('| 模型 | 日期 | 结局 | 数字 | 采纳的参数 | 说明 |');
    L.push('|---|---|---|---|---|---|');
    for (const r of rows) {
      L.push(`| \`${esc(r.model)}\` | ${r.date} | ${VERDICT_LABEL[r.verdict] || r.verdict} | `
        + `${esc(numbers(r))} | ${r.adopted ? '`' + esc(JSON.stringify(r.adopted)) + '`' : '—'} | ${esc(r.why)} |`);
    }
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push(`怎么增补：新平台/新模型跑 \`node scripts/capability-probe.js <平台>\`（横扫可达性），`);
  L.push('要调参数跑 `/perf-tune` → `node scripts/perf-probe.js`（纵扫参数）。两者都产出可直接');
  L.push('粘进台账的草稿。台账变了之后重跑本生成器。');
  L.push('');
  return L.join('\n');
}

function main(argv) {
  const want = build();
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (cur === want) { console.log('  ✓ docs/model-recommendations.md 与两张表一致'); return; }
  if (argv.includes('--check')) {
    console.error('  ✗ docs/model-recommendations.md 与 recommend/perf-ledger 不一致 —— 跑 node scripts/gen-model-recommendations.js');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, want);
  console.log(`  已写入 ${path.relative(ROOT, OUT)}（${want.length} 字节）`);
}

module.exports = { build, OUT };
if (require.main === module) main(process.argv.slice(2));
