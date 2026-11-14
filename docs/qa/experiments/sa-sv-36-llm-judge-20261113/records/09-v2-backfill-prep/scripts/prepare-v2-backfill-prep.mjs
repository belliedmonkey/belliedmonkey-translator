#!/usr/bin/env node
'use strict';

/**
 * Offline prep for a future official v2 15-request backfill and later human semantic review.
 * Read-only on official evidence / frozen input / pack-unpacked.
 * Writes only under v2-backfill-prep-20261114/.
 * No network, no secrets, no paid calls, no official evidence overwrite, no repo edits.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PREP = resolve(HERE, '..');
const JUDGE_PREP = resolve(PREP, '..');
const EVIDENCE = resolve(
  process.env.V2_EVIDENCE ||
    join(JUDGE_PREP, 'v2-real-run-20261114-0015/evidence/llm-judge-v2-real-20261114-0015'),
);
const V1_ASSIGNMENT = resolve(
  process.env.V1_ASSIGNMENT ||
    join(JUDGE_PREP, 'real-run-20261113-2253/judge-run/assignment.json'),
);
const FROZEN_INPUT = resolve(process.env.FROZEN_INPUT || join(JUDGE_PREP, 'input-asr-36.json'));
const PACK = resolve(
  process.env.V2_PACK || join(JUDGE_PREP, 'v2-offline-diag-20261114/pack-unpacked'),
);
const OUT = join(PREP, 'out');
const HUMAN = join(PREP, 'human-review');

const BAKED = {
  tarball: 'e9e088f1c479f24e69eaf017591638c6f0d121974c077b257874dae001a3f002',
  result: '580da9aaa0107c3ec54939f2e4782334de3da6ca96b0600441235a57896169bc',
  summary: '4744aef13ff5ce3a30680be4fb42604db044073a3e317202c09339d24934365f',
  usage: '2c72567b6f04191536f84fdb42dda3971082fcb6bb561c3b53ae184478126da1',
  humanReview: 'b034c87c8fc841a32e99d20967a011bf7621165bba08cfbc0f2f2fe77889c453',
  assignment: '3c54b9c2571ce63b6203d004f3ab2e109da7e7ba39feeda438c88fc8a4e79470',
  config: 'e101ef5e9055f14c397505046d5033c2d62242f7cf5d1a6068632e0c24683180',
  packGz: 'a81afb949cc3e7ebc807e7ac90e88b6cd520220bd519641ec3051876d3ee3f92',
  input: '1a44cca3bf05662c8701d943702a35e7fd1a303f9bcd931764775d9057c795a1',
  promptV2: 'a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923',
  promptV1: 'a955cddc61e16ef988ee7c4290437218df4653f88ec9a8a45d6cb38adca5bdd6',
};

const CUMULATIVE_CONSUMED = '0.10094232';
const CUMULATIVE_PLAN = '0.28';
const CUMULATIVE_REMAINING = '0.17905768';
const UNIT_GPT = '0.00411136';
const UNIT_QWEN = '0.0018688';
const GPT_N = 2;
const QWEN_N = 13;
const SEED = 20261113;
const SAMPLE_COUNT = 6;

const GPT_MODEL = 'openai/gpt-4.1-mini';
const QWEN_MODEL = 'qwen/qwen3-235b-a22b-2507';
const RATE_GPT_IN = '0.00000044';
const RATE_GPT_OUT = '0.00000176';
const RATE_QWEN_IN = '0.0000002';
const RATE_QWEN_OUT = '0.0000008';
const MAX_IN = 1152;
const MAX_OUT = 2048;

function sha256Buf(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
function sha256File(p) {
  return sha256Buf(readFileSync(p));
}
function sha256Text(s) {
  return sha256Buf(Buffer.from(s, 'utf8'));
}
function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}
function writeJson(p, obj) {
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}
function safeName(id) {
  return id.replace(/[^A-Za-z0-9._-]+/g, '_') + '.json';
}
function nowAsiaShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date()).replace(',', '') + ' Asia/Shanghai (CST)';
}
function pin(label, path, expected, rows) {
  if (!existsSync(path)) {
    rows.push({ label, path, expected, actual: null, ok: false, error: 'missing' });
    return;
  }
  const actual = sha256File(path);
  rows.push({ label, path, expected, actual, ok: actual === expected });
}
function mul(a, b) {
  // Decimal-like multiply of two short decimal strings via integer scale.
  function parts(s) {
    const [i, f = ''] = String(s).split('.');
    return { n: BigInt(i + f), e: f.length };
  }
  const x = parts(a);
  const y = parts(b);
  const n = x.n * y.n;
  const e = x.e + y.e;
  return formatScaled(n, e);
}
function add(a, b) {
  function parts(s) {
    const neg = String(s).startsWith('-');
    const t = neg ? String(s).slice(1) : String(s);
    const [i, f = ''] = t.split('.');
    return { n: BigInt(i + f) * (neg ? -1n : 1n), e: f.length };
  }
  const x = parts(a);
  const y = parts(b);
  const e = Math.max(x.e, y.e);
  const xs = x.n * 10n ** BigInt(e - x.e);
  const ys = y.n * 10n ** BigInt(e - y.e);
  return formatScaled(xs + ys, e);
}
function formatScaled(n, e) {
  const neg = n < 0n;
  let s = (neg ? -n : n).toString();
  if (e === 0) return (neg ? '-' : '') + s;
  if (s.length <= e) s = '0'.repeat(e - s.length + 1) + s;
  const cut = s.length - e;
  let frac = s.slice(cut).replace(/0+$/, '');
  const whole = s.slice(0, cut);
  return (neg ? '-' : '') + (frac ? whole + '.' + frac : whole);
}

function emptyHumanAnnotation() {
  return {
    reviewerId: '',
    reviewedAtAsiaShanghai: '',
    slots: {
      'slot-1': {
        agreeJudgeAFindingKinds: null,
        agreeJudgeBFindingKinds: null,
        comment: '',
        ownKindsIfDifferent: [],
      },
      'slot-2': {
        agreeJudgeAFindingKinds: null,
        agreeJudgeBFindingKinds: null,
        comment: '',
        ownKindsIfDifferent: [],
      },
    },
    overallComment: '',
    marksCompleteOnlyAfterUserReview: true,
  };
}

function slotView(verdict, slotName) {
  if (!verdict || !Array.isArray(verdict.slots)) return null;
  const row = verdict.slots.find((s) => s.slot === slotName);
  if (!row) return null;
  return {
    slot: row.slot,
    abstain: row.abstain,
    confidence: row.confidence,
    note: row.note,
    findings: (row.findings || []).map((f) => ({
      kind: f.kind,
      refQuote: f.refQuote,
      hypQuote: f.hypQuote,
      reason: f.reason,
    })),
  };
}

function kindsOf(verdict, slotName) {
  if (!verdict) return null;
  const row = verdict.slots.find((s) => s.slot === slotName);
  if (!row) return null;
  if (row.abstain) return ['abstain'];
  return (row.findings || []).map((f) => f.kind).sort();
}

function instructionsZh() {
  return `# 正式 v2 人工语义复核说明（冻结判定标准）

本文只用于真人对照参考与匿名 slot 文本，复核两位评委的 findings。本准备目录不是已完成人审，不得把本说明或空表当作 \`semanticHumanReviewed=true\`。

## 何时评、何时不评

- 当前官方 v2 跑次的人审清单是**初始状态**：分歧 17 + 一致样本 5 + 未评估 14。这 14 条是至少一名评委官方无效、正待最多 15 次补评的条目。
- **现在不要评这 14 条待补项。** 补评成功后必须用同一套 \`reviewList\`（按槽位排序后的 finding kind 列表是否一致；弃权记为 \`['abstain']\`；再按 seed=${SEED}、sampleCount=${SAMPLE_COUNT} 从新的一致项抽样）刷新清单。一致集合变化后，样本集合也可能变化。
- 17+5 的空表已按当前双有效判决预备，便于查看格式与材料；**建议等补评刷新后再一次性送审**，以免评完又要按新清单补看。若有人在补评前先看了 17+5，补评后只补看新进入 divergence/sample 的条目，且不得把待补 14 条提前当完成。
- 以前的音字听审（听音频核字）**不是**本栏语义人审，不能迁移计数。\`earReviewUsedAsSemanticReview\` 必须保持 false，除非用户另行明确否定这一协议（本准备不改变该协议）。
- 只有用户本人（或用户明确指定的真人）在空表上完成标注并确认后，才能把对应条目计为语义已审。任何 agent / 自动脚本不得代填结论，不得把模型或本诊断的判断写入人审字段。
- 本复核不改官方 ASR 分数、不改拉丁/语气词规则、不评选胜者、不把 aux 倾向当结论。

## 你看到的材料

每份空表包含：

- 匿名 \`itemId\`、参考文本 \`reference\`、\`slot-1\` / \`slot-2\` 的候选文本（只有槽位名，没有系统名或产品名）。
- 两位评委的官方有效判决：每槽的 \`abstain\`、\`confidence\`、\`note\`，以及每条 finding 的 \`kind\`、\`refQuote\`、\`hypQuote\`、\`reason\`。
- 空的 \`humanAnnotation\` 字段，供你填写。\`semanticHumanReviewed\` 在空表里保持 \`false\`，完成确认前不要改官方计数。

不要尝试根据写法和风格猜测哪条是哪个系统。不要把槽位还原成产品名。

## 冻结 v2 判定标准（评委合同，也是你复核的尺度）

依据已发送的 v2 system / \`verdict-contract.js\`（prompt sha256 \`a2e82f86…220923\`），不是 v1。

- 评委没有听音频，只比较参考与两条匿名候选。人审本栏同样以文本为准；听过音频的印象不能直接当作本表结论，更不能改参考去迁就候选。
- 不要改参考。括号里的拉丁字母、语气词（如 um）要保留，不能为了让候选看起来更近而丢掉。
- 不要用外部知识修补候选。若专名或数字可能只是写法不同、而仅凭这两个字符串无法判断，应倾向认为评委弃权是合理的。
- \`format-only\`：同一值的表面形式不同（如数字与汉字数字）。**值不同**则应是 \`number\`、\`entity\`、\`negation\` 或 \`semantic\`，不能把值变了还标成格式。
- \`omission\`：参考里有、候选里缺。\`addition\`：候选里有、参考里无。
- 每条非弃权 finding 的引用必须是**精确切片**：\`refQuote\` 必须是参考的连续子串，\`hypQuote\` 必须是**同一槽**候选的连续子串，不得借用另一槽，不得增删标点或近义改写。不能引用就应弃权，不得编造 quote。
- 合法 kind 仅七个：\`format-only\`、\`entity\`、\`number\`、\`negation\`、\`semantic\`、\`omission\`、\`addition\`。
- 官方双评委「一致 / 分歧」只比较每槽排序后的 kind 列表（弃权为 \`abstain\`），不比较 note 措辞。人审可以指出 kind 用错、quote 不精确、或该弃权却未弃权，即使官方已判「一致」。
- 不要要求评委或你自己给出 WER/CER/MER 或胜者。

## 如何填空表

对每个槽分别填写：

- \`agreeJudgeAFindingKinds\` / \`agreeJudgeBFindingKinds\`：\`true\` / \`false\` / \`null\`（未评请保持 null）。
- \`comment\`：简短说明不同意的理由（例如 quote 不是精确切片、把「即使/即便」这类不同用字标成纯格式、该弃权等）。
- \`ownKindsIfDifferent\`：仅当你认为官方 kind 列表不合适时，给出你的 kind 列表；不要编造新 quote 去「修好」官方判决。
- \`overallComment\`：整条的补充。
- \`reviewerId\` 与 \`reviewedAtAsiaShanghai\`（Asia/Shanghai 时区）在你实际评完该条后再填。

未评条目保持空字符串 / \`null\` / \`false\`（未审标记）。不要为了凑数而填写。

## 刷新

补评完成后，用新的官方 \`human-review.json\` 与有效判决重跑本目录脚本或后续刷新入口，再生成新空表。初始 17+5+14 不得冒充补评后的最终送审清单。
`;
}

function buildReport(ctx) {
  const { pins, allowlist, budget, invariance, inventory, createdAt } = ctx;
  const lines = [];
  lines.push('# 正式 v2 补评与人审离线准备（不执行、不付费）');
  lines.push('');
  lines.push('目录：`judge-prep/v2-backfill-prep-20261114/`。授权：t57u / [pt57u]「同意 开工吧。都做掉」。');
  lines.push('');
  lines.push('本轮只做离线准备：精确 15 条 allowlist、全 36 匿名输入与原 assignment 不变验证、同池预留核对、以及按冻结 v2 标准准备的中文语义复核说明与待评空表。**不 Mac、不网络、不 key、不付费、不改仓库、不覆盖原证据。** 等云端新包（可观察性 + selection 入口）完成后，由父侧安排独立复验再执行；本准备不自行启动 paid，也不代填人审。');
  lines.push('');
  lines.push('生成时间：' + createdAt + '。');
  lines.push('');
  lines.push('## Selection（精确 15 对）');
  lines.push('');
  lines.push('只补官方 v2 失败的评委×条目，共 15 次请求（14 个 item；`en_us/1673` 两位评委都失败）。不重跑已官方有效的 57 条，不用 v1 提示或 v1 判决，不重新随机槽位。');
  lines.push('');
  lines.push('| itemId | judgeId | model | official code | finish_reason | request sha256 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const row of allowlist.pairs) {
    lines.push(`| ${row.itemId} | ${row.judgeId} | ${row.model} | ${row.officialCode} | ${row.finishReason} | \`${row.requestSha256}\` |`);
  }
  lines.push('');
  lines.push('共同 provenance：');
  lines.push('');
  lines.push(`- 输入（36 条匿名）sha256=\`${allowlist.inputSha256}\``);
  lines.push(`- assignment sha256=\`${allowlist.assignmentSha256}\`（与正式 v1 匿名 assignment 相同）`);
  lines.push(`- 已发送 v2 prompt sha256=\`${allowlist.promptTemplateSha256}\`（15 条请求的 system 均为此值；无一为 v1 \`${BAKED.promptV1}\`）`);
  lines.push('- 完整逐条字段见 `out/allowlist-15.json`。');
  lines.push('');
  lines.push('## Assignment 与输入不变');
  lines.push('');
  lines.push(`用冻结输入 + seed ${SEED} 重放 \`assignItems\`，与正式 assignment 逐条槽位一致：${invariance.replayMatchesOfficial ? '是' : '否'}。与 v1 assignment 文件 hash 一致：${invariance.matchesOfficialV1 ? '是' : '否'}。15 条原请求中的 slot 文本与「输入候选 × 冻结 assignment」一致：${invariance.requestsMatchFrozenSlots ? '是' : '否'}。选取这 15 个 item 只是切片，不重新抽随机数，故槽位映射不变。`);
  lines.push('');
  lines.push('## 预算（同池，不新开 0.28）');
  lines.push('');
  lines.push(`单次全 cap 预留（\`maxInputTokens=${MAX_IN}\` × 输入单价 + \`maxOutputTokens=${MAX_OUT}\` × 输出单价）：GPT \`${UNIT_GPT}\`，Qwen \`${UNIT_QWEN}\`。`);
  lines.push('');
  lines.push(`公式：\`2 × ${UNIT_GPT} + 13 × ${UNIT_QWEN} = ${budget.formulaTotal}\`。`);
  lines.push(`独立核对（由单价整数演算）= \`${budget.independentTotal}\`；与 pack 浮点 \`reserveUsd\` 在账本所用小数位一致：${budget.agreesWithPackFloat ? '是' : '否'}（pack float 合计 \`${budget.packFloatTotal}\`）。`);
  lines.push('');
  lines.push(`累计历史消耗 \`${CUMULATIVE_CONSUMED}\` / 计划 \`${CUMULATIVE_PLAN}\`，剩余 \`${CUMULATIVE_REMAINING}\`。15 条全 cap 预留 \`${budget.formulaTotal}\`，预留后账本余量 \`${budget.remainingAfterReserve}\`。**够预留，不自动多轮补洞，不把结算差额拿去加请求。** 未来补评必须走同一累计池，不得另开 0.28。本准备不改台账、不发起请求。建议日后配置：\`budgetUsd=${CUMULATIVE_REMAINING}\`（本轮可用余额，不是新池），\`maxRequests=15\`，\`maxTotalTokens=${budget.maxTotalTokens}\`，\`maxRetries=0\`。在新包 selection 入口经独立复验前，不要用当前包对 36×2 盲目 \`--run\`。`);
  lines.push('');
  lines.push('## 人审材料');
  lines.push('');
  lines.push(`路径：\`human-review/INSTRUCTIONS.zh.md\`，空表 \`human-review/forms/disagreement/\`（${inventory.disagreement.length}）与 \`human-review/forms/sample/\`（${inventory.sample.length}），待补且**现在不要评**的清单 \`human-review/pending-backfill-not-for-review-now.json\`（${inventory.notAssessed.length}）。索引：\`human-review/forms-index.json\`。`);
  lines.push('');
  lines.push('空表保留匿名 reference / slot 文本、官方 findings 与 quote，以及空白标注字段。所有表内 \`semanticHumanReviewed=false\`，未代填任何语义结论。音字听审不计入。初始 17+5+14 须在补评后刷新。');
  lines.push('');
  lines.push('## 原件钉扎（只读核对，未改写）');
  lines.push('');
  lines.push('| 钉扎 | sha256 | 一致 |');
  lines.push('| --- | --- | --- |');
  for (const r of pins) {
    lines.push(`| ${r.label} | \`${r.actual || ''}\` | ${r.ok ? '是' : '否'} |`);
  }
  lines.push('');
  lines.push('## 可复现命令');
  lines.push('');
  lines.push('```');
  lines.push('node /workspace/baseline-sa-sv-36-20261113/judge-prep/v2-backfill-prep-20261114/scripts/prepare-v2-backfill-prep.mjs');
  lines.push('```');
  lines.push('');
  lines.push('做完即停，等待新包；不自行启动 paid，不改 repo。');
  lines.push('');
  return lines.join('\n') + '\n';
}

function main() {
  const createdAt = nowAsiaShanghai();
  const pins = [];
  pin('tarball', join(JUDGE_PREP, 'v2-real-run-20261114-0015/llm-judge-v2-real-20261114-0015-evidence.tar.gz'), BAKED.tarball, pins);
  pin('RESULT', join(EVIDENCE, 'ledger/RESULT.json'), BAKED.result, pins);
  pin('summary', join(EVIDENCE, 'judge-run/summary.json'), BAKED.summary, pins);
  pin('usage', join(EVIDENCE, 'judge-run/usage.json'), BAKED.usage, pins);
  pin('human-review', join(EVIDENCE, 'judge-run/human-review.json'), BAKED.humanReview, pins);
  pin('assignment-v2', join(EVIDENCE, 'judge-run/assignment.json'), BAKED.assignment, pins);
  pin('assignment-v1', V1_ASSIGNMENT, BAKED.assignment, pins);
  pin('formal-config', join(EVIDENCE, 'config/config.formal-run-budget-remaining.json'), BAKED.config, pins);
  pin('pack-gz', join(EVIDENCE, 'package/01M7ASY5H5YT8XV1NH4Y291ZFP.gz'), BAKED.packGz, pins);
  pin('input-evidence', join(EVIDENCE, 'input/input-asr-36.json'), BAKED.input, pins);
  pin('input-frozen', FROZEN_INPUT, BAKED.input, pins);
  const pinBad = pins.filter((r) => !r.ok);
  if (pinBad.length) {
    throw new Error('official pin mismatch: ' + JSON.stringify(pinBad, null, 2));
  }

  const requirePack = createRequire(pathToFileURL(join(PACK, 'assign.js')));
  const { assignItems } = requirePack(join(PACK, 'assign.js'));
  const { validateInput, validateConfig, reserveFor } = requirePack(join(PACK, 'schema.js'));
  const { rubricText } = requirePack(join(PACK, 'verdict-contract.js'));
  if (sha256Text(rubricText()) !== BAKED.promptV2) {
    throw new Error('pack rubricText sha != frozen v2 prompt');
  }

  const result = readJson(join(EVIDENCE, 'ledger/RESULT.json'));
  if (String(result.cumulativeConsumedUsd) !== CUMULATIVE_CONSUMED) {
    throw new Error('ledger cumulativeConsumedUsd changed');
  }
  if (String(result.cumulativePlanUsd) !== CUMULATIVE_PLAN) {
    throw new Error('ledger cumulativePlanUsd changed');
  }
  if (String(result.cumulativeRemainingUsd) !== CUMULATIVE_REMAINING) {
    throw new Error('ledger cumulativeRemainingUsd changed');
  }

  const inputDoc = readJson(join(EVIDENCE, 'input/input-asr-36.json'));
  const frozenInput = readJson(FROZEN_INPUT);
  if (sha256Text(JSON.stringify(inputDoc)) !== sha256Text(JSON.stringify(frozenInput))) {
    // byte hash already pinned equal; structural compare as well
  }
  const inputCheck = validateInput(inputDoc);
  if (!inputCheck.ok || inputCheck.items.length !== 36) {
    throw new Error('input failed validateInput: ' + JSON.stringify(inputCheck));
  }
  for (const item of inputCheck.items) {
    const keys = item.candidates.map((c) => c.key);
    if (keys.some((k) => /sa|sv|speech|sense|analyzer/i.test(k))) {
      throw new Error('candidate key looks like a backend name: ' + keys.join(','));
    }
  }

  const assignmentDoc = readJson(join(EVIDENCE, 'judge-run/assignment.json'));
  const replayed = assignItems(inputCheck.items, SEED);
  const officialMap = new Map(assignmentDoc.items.map((r) => [r.id, r]));
  let replayMatchesOfficial = true;
  const mismatches = [];
  if (replayed.length !== assignmentDoc.items.length) replayMatchesOfficial = false;
  for (const row of replayed) {
    const official = officialMap.get(row.id);
    if (!official || official.slots['slot-1'] !== row.slots['slot-1'] || official.slots['slot-2'] !== row.slots['slot-2']) {
      replayMatchesOfficial = false;
      mismatches.push({ id: row.id, replay: row.slots, official: official && official.slots });
    }
  }
  if (!replayMatchesOfficial) throw new Error('assignment replay mismatch: ' + JSON.stringify(mismatches));

  const itemsById = new Map(inputCheck.items.map((it) => [it.id, it]));
  const judges = ['judge-a', 'judge-b'];
  const pairs = [];
  let requestsMatchFrozenSlots = true;
  const slotMismatches = [];
  let allSystemV2 = true;
  let anySystemV1 = false;

  for (const judgeId of judges) {
    const parsedDir = join(EVIDENCE, 'judge-run/parsed', judgeId);
    const names = readdirSync(parsedDir).filter((n) => n.endsWith('.json') && !n.startsWith('._')).sort();
    for (const name of names) {
      const official = readJson(join(parsedDir, name));
      const requestPath = join(EVIDENCE, 'judge-run/requests', judgeId, name);
      const request = readJson(requestPath);
      const system = request.messages[0].content;
      const systemSha = sha256Text(system);
      if (systemSha !== BAKED.promptV2) allSystemV2 = false;
      if (systemSha === BAKED.promptV1) anySystemV1 = true;
      const user = JSON.parse(request.messages[1].content);
      const itemId = user.itemId;
      const assignment = officialMap.get(itemId);
      const item = itemsById.get(itemId);
      const candByKey = new Map(item.candidates.map((c) => [c.key, c.text]));
      const expected = {
        'slot-1': candByKey.get(assignment.slots['slot-1']),
        'slot-2': candByKey.get(assignment.slots['slot-2']),
      };
      const got = {};
      for (const c of user.candidates) got[c.slot] = c.text;
      if (got['slot-1'] !== expected['slot-1'] || got['slot-2'] !== expected['slot-2']) {
        requestsMatchFrozenSlots = false;
        slotMismatches.push({ judgeId, itemId });
      }
      if (official.ok) continue;
      const sidecar = readJson(join(EVIDENCE, 'judge-run/sidecars', `${judgeId}_${name}`));
      const model = judgeId === 'judge-a' ? GPT_MODEL : QWEN_MODEL;
      if (sidecar.modelSent && sidecar.modelSent !== model) {
        throw new Error('model mismatch ' + judgeId + ' ' + itemId);
      }
      pairs.push({
        itemId,
        judgeId,
        model,
        officialCode: official.code,
        finishReason: sidecar.finishReason,
        requestSha256: sha256File(requestPath),
        promptTemplateSha256: systemSha,
        assignmentSha256: BAKED.assignment,
        assignmentSlots: {
          'slot-1': assignment.slots['slot-1'],
          'slot-2': assignment.slots['slot-2'],
        },
        officialParsedFile: `judge-run/parsed/${judgeId}/${name}`,
        officialRequestFile: `judge-run/requests/${judgeId}/${name}`,
        officialSidecarFile: `judge-run/sidecars/${judgeId}_${name}`,
        provider: sidecar.provider || null,
        outputTokens: sidecar.outputTokens,
        maxTokensSent: sidecar.maxTokensSent,
        httpStatus: sidecar.httpStatus,
      });
    }
  }

  if (!allSystemV2 || anySystemV1) throw new Error('found non-v2 or v1 prompt in official requests');
  if (!requestsMatchFrozenSlots) throw new Error('request slots != frozen assignment: ' + JSON.stringify(slotMismatches));
  if (pairs.length !== 15) throw new Error('expected 15 failures, got ' + pairs.length);
  const gptN = pairs.filter((p) => p.judgeId === 'judge-a').length;
  const qwenN = pairs.filter((p) => p.judgeId === 'judge-b').length;
  if (gptN !== GPT_N || qwenN !== QWEN_N) throw new Error('expected 2 GPT + 13 Qwen, got ' + gptN + '+' + qwenN);

  // Selecting 15 items does not re-roll slots: compare slice of frozen assignment.
  const selectedIds = [...new Set(pairs.map((p) => p.itemId))].sort();
  const sliced = selectedIds.map((id) => officialMap.get(id));
  const sliceOk = sliced.every((row) => {
    const full = officialMap.get(row.id);
    return full.slots['slot-1'] === row.slots['slot-1'] && full.slots['slot-2'] === row.slots['slot-2'];
  });

  const formal = readJson(join(EVIDENCE, 'config/config.formal-run-budget-remaining.json'));
  const priced = validateConfig(formal);
  if (!priced.ok) throw new Error('official config failed validateConfig');
  const packGpt = reserveFor(priced.prices, GPT_MODEL);
  const packQwen = reserveFor(priced.prices, QWEN_MODEL);
  const independentGpt = add(mul(String(MAX_IN), RATE_GPT_IN), mul(String(MAX_OUT), RATE_GPT_OUT));
  const independentQwen = add(mul(String(MAX_IN), RATE_QWEN_IN), mul(String(MAX_OUT), RATE_QWEN_OUT));
  const formulaTotal = add(mul(String(GPT_N), UNIT_GPT), mul(String(QWEN_N), UNIT_QWEN));
  const independentTotal = add(mul(String(GPT_N), independentGpt), mul(String(QWEN_N), independentQwen));
  const packFloatTotalNum = GPT_N * packGpt + QWEN_N * packQwen;
  const packFloatTotal = packFloatTotalNum.toFixed(8);
  const agreesUnits = independentGpt === UNIT_GPT && independentQwen === UNIT_QWEN;
  const agreesWithPackFloat = packFloatTotal === formulaTotal && independentTotal === formulaTotal;
  const remainingAfterReserve = add(CUMULATIVE_REMAINING, '-' + formulaTotal);
  const enough = !remainingAfterReserve.startsWith('-') && remainingAfterReserve !== formulaTotal || Number(remainingAfterReserve) >= 0;
  // remaining 0.17905768 - 0.03251712 must be non-negative
  const enoughReserve = !remainingAfterReserve.startsWith('-');
  if (!agreesUnits || !agreesWithPackFloat || !enoughReserve) {
    throw new Error('budget check failed ' + JSON.stringify({
      independentGpt, independentQwen, formulaTotal, independentTotal, packFloatTotal, packGpt, packQwen, remainingAfterReserve,
    }));
  }

  const budget = {
    schema: 'belliedmonkey.qa.v2-backfill-budget.v1',
    sameCumulativePool: true,
    doNotOpenNewPlan: true,
    noAutomaticMultiRoundBackfill: true,
    notExecuted: true,
    cumulativePlanUsd: CUMULATIVE_PLAN,
    cumulativeConsumedUsd: CUMULATIVE_CONSUMED,
    cumulativeRemainingUsd: CUMULATIVE_REMAINING,
    rates: {
      maxInputTokens: MAX_IN,
      maxOutputTokens: MAX_OUT,
      [GPT_MODEL]: { inputUsdPerToken: RATE_GPT_IN, outputUsdPerToken: RATE_GPT_OUT, unitReserveUsd: UNIT_GPT, packFloatReserveUsd: packGpt },
      [QWEN_MODEL]: { inputUsdPerToken: RATE_QWEN_IN, outputUsdPerToken: RATE_QWEN_OUT, unitReserveUsd: UNIT_QWEN, packFloatReserveUsd: packQwen },
    },
    formula: `${GPT_N}*${UNIT_GPT}+${QWEN_N}*${UNIT_QWEN}`,
    gptRequests: GPT_N,
    qwenRequests: QWEN_N,
    formulaTotal,
    independentTotal,
    packFloatTotal,
    agreesWithPackFloat,
    remainingAfterReserve,
    enoughReserve: enoughReserve,
    suggestedFutureRun: {
      budgetUsd: CUMULATIVE_REMAINING,
      maxRequests: 15,
      maxTotalTokens: 15 * (MAX_IN + MAX_OUT),
      maxRetries: 0,
      reuseOfficialAssignment: true,
      doNotReassignSlots: true,
      onlyAllowlistPairs: true,
      waitForNewPackSelectionAndIndependentVerify: true,
    },
    maxTotalTokens: 15 * (MAX_IN + MAX_OUT),
    ledgerUnchangedByThisPrep: true,
  };

  const allowlist = {
    schema: 'belliedmonkey.qa.v2-backfill-allowlist.v1',
    diagnosticOnlyUntilNewPackVerified: true,
    notForPaidRunNow: true,
    noAutomaticMultiRoundBackfill: true,
    protocol: 'belliedmonkey.llm-judge.verdict.v2',
    asrRubric: 'belliedmonkey.llm-judge.asr.v2',
    officialRun: 'v2-real-run-20261114-0015',
    officialResultSha256: BAKED.result,
    inputSha256: BAKED.input,
    assignmentSha256: BAKED.assignment,
    promptTemplateSha256: BAKED.promptV2,
    frozenV1PromptSha256Rejected: BAKED.promptV1,
    seedUsedForOriginalAssignment: SEED,
    doNotReassignSlots: true,
    reuseFull36AnonymousInput: true,
    pairCount: pairs.length,
    uniqueItemCount: selectedIds.length,
    gptCount: gptN,
    qwenCount: qwenN,
    pairs,
  };

  const invariance = {
    replayMatchesOfficial,
    matchesOfficialV1: sha256File(V1_ASSIGNMENT) === BAKED.assignment,
    requestsMatchFrozenSlots,
    allOfficialSystemsAreV2: allSystemV2,
    anyOfficialSystemIsV1: anySystemV1,
    selecting15DoesNotRerollSlots: sliceOk,
    seed: SEED,
    inputItemCount: inputCheck.items.length,
    assignmentItemCount: assignmentDoc.items.length,
    candidateKeysAnonymous: true,
    mismatches,
    slotMismatches,
  };

  // Human review materials from official current lists; empty annotations.
  const human = readJson(join(EVIDENCE, 'judge-run/human-review.json'));
  if (human.semanticHumanReviewCount !== 0 || human.earReviewUsedAsSemanticReview !== false) {
    throw new Error('official human-review flags unexpected');
  }
  const summary = readJson(join(EVIDENCE, 'judge-run/summary.json'));
  const verdictOf = new Map();
  for (const row of summary.results) {
    verdictOf.set(row.id, row.judges);
  }

  // reset form dirs
  for (const sub of ['disagreement', 'sample']) {
    const dir = join(HUMAN, 'forms', sub);
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      rmSync(join(dir, name));
    }
  }

  function writeForm(listName, itemId) {
    const item = itemsById.get(itemId);
    const assignment = officialMap.get(itemId);
    const candByKey = new Map(item.candidates.map((c) => [c.key, c.text]));
    const judgesVerdicts = verdictOf.get(itemId) || {};
    const form = {
      schema: 'belliedmonkey.qa.v2-semantic-human-review-form.v1',
      list: listName,
      itemId,
      initialInventoryOnly: true,
      mustRefreshAfterBackfill: true,
      semanticHumanReviewed: false,
      earReviewUsedAsSemanticReview: false,
      doNotPreFillJudgment: true,
      officialAgentReviewIsNotHumanReview: true,
      reference: item.reference,
      slots: {
        'slot-1': { text: candByKey.get(assignment.slots['slot-1']) },
        'slot-2': { text: candByKey.get(assignment.slots['slot-2']) },
      },
      officialKindLists: {
        'judge-a': {
          'slot-1': kindsOf(judgesVerdicts['judge-a'], 'slot-1'),
          'slot-2': kindsOf(judgesVerdicts['judge-a'], 'slot-2'),
        },
        'judge-b': {
          'slot-1': kindsOf(judgesVerdicts['judge-b'], 'slot-1'),
          'slot-2': kindsOf(judgesVerdicts['judge-b'], 'slot-2'),
        },
      },
      officialVerdicts: {
        'judge-a': {
          model: GPT_MODEL,
          'slot-1': slotView(judgesVerdicts['judge-a'], 'slot-1'),
          'slot-2': slotView(judgesVerdicts['judge-a'], 'slot-2'),
        },
        'judge-b': {
          model: QWEN_MODEL,
          'slot-1': slotView(judgesVerdicts['judge-b'], 'slot-1'),
          'slot-2': slotView(judgesVerdicts['judge-b'], 'slot-2'),
        },
      },
      humanAnnotation: emptyHumanAnnotation(),
    };
    const dest = join(HUMAN, 'forms', listName, safeName(itemId));
    writeJson(dest, form);
    return dest;
  }

  const formIndex = { disagreement: [], sample: [] };
  for (const id of human.disagreement) formIndex.disagreement.push({ itemId: id, path: writeForm('disagreement', id) });
  for (const id of human.sample) formIndex.sample.push({ itemId: id, path: writeForm('sample', id) });

  const pending = {
    schema: 'belliedmonkey.qa.v2-pending-backfill-not-for-review-now.v1',
    doNotReviewNow: true,
    reason: 'At least one official v2 verdict is missing; wait for allowlist backfill and refresh reviewList before sending these items to a human.',
    notAssessed: human.notAssessed,
    items: human.notAssessed.map((id) => ({
      itemId: id,
      missingJudges: pairs.filter((p) => p.itemId === id).map((p) => ({
        judgeId: p.judgeId,
        officialCode: p.officialCode,
        finishReason: p.finishReason,
      })),
    })),
  };

  const inventory = {
    schema: 'belliedmonkey.qa.v2-initial-human-review-inventory.v1',
    semanticHumanReviewCount: 0,
    earReviewUsedAsSemanticReview: false,
    officialHumanReviewSha256: BAKED.humanReview,
    disagreement: human.disagreement,
    sample: human.sample,
    notAssessed: human.notAssessed,
    counts: {
      disagreement: human.disagreement.length,
      sample: human.sample.length,
      notAssessed: human.notAssessed.length,
    },
    mustRefreshAfterBackfill: true,
    doNotCountThisPrepAsHumanReview: true,
  };

  mkdirSync(OUT, { recursive: true });
  mkdirSync(HUMAN, { recursive: true });
  writeJson(join(OUT, 'allowlist-15.json'), allowlist);
  writeJson(join(OUT, 'budget.json'), budget);
  writeJson(join(OUT, 'assignment-invariance.json'), invariance);
  writeJson(join(OUT, 'pin-check.json'), { ok: true, pins });
  writeJson(join(OUT, 'initial-human-review-inventory.json'), inventory);
  writeJson(join(HUMAN, 'pending-backfill-not-for-review-now.json'), pending);
  writeJson(join(HUMAN, 'forms-index.json'), {
    schema: 'belliedmonkey.qa.v2-human-form-index.v1',
    semanticHumanReviewed: false,
    mustRefreshAfterBackfill: true,
    disagreementCount: formIndex.disagreement.length,
    sampleCount: formIndex.sample.length,
    forms: formIndex,
    pendingList: 'pending-backfill-not-for-review-now.json',
    instructions: 'INSTRUCTIONS.zh.md',
  });
  writeFileSync(join(HUMAN, 'INSTRUCTIONS.zh.md'), instructionsZh());
  writeFileSync(join(PREP, 'DO-NOT-RUN.txt'), [
    'This directory is offline preparation only.',
    'Do not --run, do not send paid requests, do not copy secrets, do not overwrite official evidence, do not edit the translator repo.',
    'Wait for the new pack (observability + selection entry), parent-directed independent re-verify, and a fresh authorization to execute.',
    'Reuse frozen 36-item input and official assignment; send only the 15 allowlist pairs; same $0.28 cumulative pool; maxRetries=0; no automatic extra backfill rounds.',
    'Do not mark semanticHumanReviewed true in this prep.',
    '',
  ].join('\n'));

  const report = buildReport({ pins, allowlist, budget, invariance, inventory, createdAt });
  writeFileSync(join(PREP, 'REPORT.md'), report);

  const manifest = {
    schema: 'belliedmonkey.qa.v2-backfill-prep.v1',
    authorizedBy: 'pt57u',
    createdAtAsiaShanghai: createdAt,
    offlineOnly: true,
    notForPaidRunNow: true,
    officialEvidenceUnchanged: true,
    allowlistPairs: pairs.length,
    uniqueItems: selectedIds.length,
    budget: {
      formulaTotal,
      cumulativeRemainingUsd: CUMULATIVE_REMAINING,
      remainingAfterReserve,
      enoughReserve,
    },
    humanForms: {
      disagreement: formIndex.disagreement.length,
      sample: formIndex.sample.length,
      pendingNotForReviewNow: pending.notAssessed.length,
      semanticHumanReviewCountStill: 0,
    },
    assignmentUnchanged: invariance.replayMatchesOfficial && invariance.matchesOfficialV1,
    promptAllV2: allSystemV2 && !anySystemV1,
  };
  writeJson(join(PREP, 'MANIFEST.json'), manifest);

  const sumFiles = [
    'REPORT.md',
    'MANIFEST.json',
    'DO-NOT-RUN.txt',
    'scripts/prepare-v2-backfill-prep.mjs',
    'out/allowlist-15.json',
    'out/budget.json',
    'out/assignment-invariance.json',
    'out/pin-check.json',
    'out/initial-human-review-inventory.json',
    'human-review/INSTRUCTIONS.zh.md',
    'human-review/forms-index.json',
    'human-review/pending-backfill-not-for-review-now.json',
    ...formIndex.disagreement.map((f) => 'human-review/forms/disagreement/' + safeName(f.itemId)),
    ...formIndex.sample.map((f) => 'human-review/forms/sample/' + safeName(f.itemId)),
  ];
  const sumLines = [];
  for (const rel of sumFiles) {
    const fp = join(PREP, rel);
    if (!existsSync(fp)) throw new Error('missing output ' + rel);
    sumLines.push(`${sha256File(fp)}  ${rel}`);
  }
  writeFileSync(join(PREP, 'SHA256SUMS'), sumLines.join('\n') + '\n');

  // prove official pins still hold after writes
  const pinsAfter = [];
  pin('RESULT', join(EVIDENCE, 'ledger/RESULT.json'), BAKED.result, pinsAfter);
  pin('human-review', join(EVIDENCE, 'judge-run/human-review.json'), BAKED.humanReview, pinsAfter);
  pin('assignment-v2', join(EVIDENCE, 'judge-run/assignment.json'), BAKED.assignment, pinsAfter);
  pin('input-evidence', join(EVIDENCE, 'input/input-asr-36.json'), BAKED.input, pinsAfter);
  if (pinsAfter.some((r) => !r.ok)) throw new Error('official evidence changed during prep');

  console.log(JSON.stringify({
    ok: true,
    createdAt,
    allowlistPairs: pairs.length,
    uniqueItems: selectedIds.length,
    gpt: gptN,
    qwen: qwenN,
    formulaTotal,
    remainingAfterReserve,
    enoughReserve,
    assignmentUnchanged: invariance.replayMatchesOfficial && invariance.matchesOfficialV1,
    requestsMatchFrozenSlots,
    allSystemV2,
    humanForms: manifest.humanForms,
    reportSha256: sha256File(join(PREP, 'REPORT.md')),
    manifestSha256: sha256File(join(PREP, 'MANIFEST.json')),
    allowlistSha256: sha256File(join(OUT, 'allowlist-15.json')),
    budgetSha256: sha256File(join(OUT, 'budget.json')),
    instructionsSha256: sha256File(join(HUMAN, 'INSTRUCTIONS.zh.md')),
    sumsSha256: sha256File(join(PREP, 'SHA256SUMS')),
    officialPinsOkAfterWrite: true,
  }, null, 2));
}

main();
