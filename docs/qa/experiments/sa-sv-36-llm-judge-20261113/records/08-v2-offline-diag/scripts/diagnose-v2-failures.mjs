#!/usr/bin/env node
'use strict';

/**
 * Offline diagnostic for official v2 LLM-judge run 20261114-0015.
 * Reads evidence / pack / frozen pins only. Writes only under this diag dir.
 * No network, no secrets, no paid calls, no official backfill, no quote/note/JSON repair.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIAG = resolve(HERE, '..');
const EVIDENCE = resolve(
  process.env.V2_EVIDENCE ||
    join(DIAG, '../v2-real-run-20261114-0015/evidence/llm-judge-v2-real-20261114-0015'),
);
const TARBALL = resolve(
  process.env.V2_TARBALL ||
    join(DIAG, '../v2-real-run-20261114-0015/llm-judge-v2-real-20261114-0015-evidence.tar.gz'),
);
const PACK = resolve(process.env.V2_PACK || join(DIAG, 'pack-unpacked'));
const OUT = join(DIAG, 'out');
const FIX = join(DIAG, 'fixtures');

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
  promptTemplateSha256: 'a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923',
};

const CUMULATIVE_CONSUMED = '0.10094232';
const CUMULATIVE_PLAN = '0.28';

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
function utf16Len(s) {
  return typeof s === 'string' ? s.length : null;
}

function pinCheck() {
  const rows = [];
  function add(label, path, expected) {
    if (!existsSync(path)) {
      rows.push({ label, path, expected, actual: null, ok: false, error: 'missing' });
      return;
    }
    const actual = sha256File(path);
    rows.push({ label, path, expected, actual, ok: actual === expected });
  }
  add('tarball', TARBALL, BAKED.tarball);
  add('RESULT', join(EVIDENCE, 'ledger/RESULT.json'), BAKED.result);
  add('summary', join(EVIDENCE, 'judge-run/summary.json'), BAKED.summary);
  add('usage', join(EVIDENCE, 'judge-run/usage.json'), BAKED.usage);
  add('human-review', join(EVIDENCE, 'judge-run/human-review.json'), BAKED.humanReview);
  add('assignment', join(EVIDENCE, 'judge-run/assignment.json'), BAKED.assignment);
  add('formal-config', join(EVIDENCE, 'config/config.formal-run-budget-remaining.json'), BAKED.config);
  add('pack-gz', join(EVIDENCE, 'package/01M7ASY5H5YT8XV1NH4Y291ZFP.gz'), BAKED.packGz);
  add('input', join(EVIDENCE, 'input/input-asr-36.json'), BAKED.input);
  const frozenInput = resolve(DIAG, '../input-asr-36.json');
  add('frozen-input-judge-prep', frozenInput, BAKED.input);
  const bad = rows.filter((r) => !r.ok);
  if (bad.length) {
    console.error('PIN MISMATCH', JSON.stringify(bad, null, 2));
    throw new Error('official original hash changed or missing; abort');
  }
  return rows;
}

function classifyJsonIssue(text) {
  const info = {
    charLen: text.length,
    utf8Bytes: Buffer.byteLength(text, 'utf8'),
    hasFence: text.includes('```'),
    leadingWs: /^\s/.test(text),
    trailingWs: /\s$/.test(text),
    startsWithObject: text.startsWith('{'),
    endsWithObject: text.trimEnd().endsWith('}'),
    jsonOk: false,
  };
  try {
    JSON.parse(text);
    info.jsonOk = true;
    return info;
  } catch (err) {
    info.error = err.message;
    const m = /position\s+(\d+)/i.exec(err.message);
    info.position = typeof err.position === 'number' ? err.position : (m ? Number(m[1]) : null);
  }
  // Scan strings / depths / illegal escapes (JSON standard escapes).
  const validEsc = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);
  let inStr = false;
  let esc = false;
  let brace = 0;
  let bracket = 0;
  const invalidEscapes = [];
  const extraClosers = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) {
        if (!validEsc.has(ch)) {
          invalidEscapes.push({ at: i - 1, char: ch });
        }
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') brace += 1;
    else if (ch === '}') {
      brace -= 1;
      if (brace < 0) extraClosers.push({ at: i, char: '}' });
    } else if (ch === '[') bracket += 1;
    else if (ch === ']') {
      bracket -= 1;
      if (bracket < 0) extraClosers.push({ at: i, char: ']' });
    }
  }
  info.invalidEscapes = invalidEscapes;
  info.extraClosers = extraClosers;
  info.endDepths = { brace, bracket, inStr, esc };
  if (info.position != null) {
    const i = info.position;
    const a = Math.max(0, i - 70);
    const b = Math.min(text.length, i + 70);
    info.window = text.slice(a, b);
    info.windowStart = a;
  }
  const stripped = text.trim();
  const attempts = {
    strip: stripped,
  };
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  if (fence) attempts.fence = fence[1];
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) attempts.firstToLastObject = text.slice(a, b + 1);
  info.losslessAttempts = {};
  for (const [k, cand] of Object.entries(attempts)) {
    try {
      JSON.parse(cand);
      info.losslessAttempts[k] = true;
    } catch {
      info.losslessAttempts[k] = false;
    }
  }
  const extraAfterSlot = /"\s*\}\s*\]\s*\}\s*\}\s*,\s*\{\s*"slot"/.exec(text);
  const unquotedReason = /"hypQuote"\s*:\s*""\s*,reason"\s*:/.exec(text);
  const dupSlotKey = /"slot"\s*:\s*"slot"\s*:/.exec(text);
  info.pattern = {
    extraCloserAfterSlot1: Boolean(extraAfterSlot),
    extraCloserIndex: extraAfterSlot ? extraAfterSlot.index : null,
    unquotedReasonKey: Boolean(unquotedReason),
    unquotedReasonIndex: unquotedReason ? unquotedReason.index : null,
    duplicateSlotKey: Boolean(dupSlotKey),
    duplicateSlotKeyIndex: dupSlotKey ? dupSlotKey.index : null,
  };
  return info;
}

function exactSlice(hay, quote) {
  return typeof quote === 'string' && (quote === '' || (typeof hay === 'string' && hay.includes(quote)));
}

function diagnoseQuoteNote(content, request, officialCode) {
  const user = JSON.parse(request.messages[1].content);
  const reference = user.reference;
  const cands = Object.fromEntries(user.candidates.map((c) => [c.slot, c.text]));
  const doc = JSON.parse(content);
  const KINDS = [
    'format-only', 'entity', 'number', 'negation', 'semantic', 'omission', 'addition',
  ];
  const slots = [];
  for (const sl of doc.slots || []) {
    const hyp = cands[sl.slot];
    const notePresent = Object.prototype.hasOwnProperty.call(sl, 'note');
    const rec = {
      slot: sl.slot,
      keys: Object.keys(sl),
      abstain: sl.abstain,
      notePresent,
      noteType: sl.note === null ? 'null' : typeof sl.note,
      noteCharLen: typeof sl.note === 'string' ? sl.note.length : null,
      noteUtf8Bytes: typeof sl.note === 'string' ? Buffer.byteLength(sl.note, 'utf8') : null,
      noteExceeds400: typeof sl.note === 'string' ? sl.note.length > 400 : null,
      findings: [],
    };
    const findings = Array.isArray(sl.findings) ? sl.findings : [];
    findings.forEach((f, idx) => {
      const inRef = exactSlice(reference, f.refQuote);
      const inHyp = exactSlice(hyp, f.hypQuote);
      const inOther = {};
      for (const [sid, txt] of Object.entries(cands)) {
        inOther[sid] = exactSlice(txt, f.hypQuote);
      }
      const kindOk = KINDS.includes(f.kind);
      const failQuote = !inRef || !inHyp
        || (f.kind === 'omission' && !f.refQuote)
        || (f.kind === 'addition' && !f.hypQuote)
        || (f.kind !== 'omission' && f.kind !== 'addition' && (!f.refQuote || !f.hypQuote));
      rec.findings.push({
        idx,
        kind: f.kind,
        kindOk,
        failQuote,
        inReference: inRef,
        inSameSlotHypothesis: inHyp,
        hypQuoteInSlots: inOther,
        refQuote: f.refQuote,
        hypQuote: f.hypQuote,
        refQuoteCharLen: typeof f.refQuote === 'string' ? f.refQuote.length : null,
        hypQuoteCharLen: typeof f.hypQuote === 'string' ? f.hypQuote.length : null,
        refIndex: inRef && f.refQuote ? reference.indexOf(f.refQuote) : -1,
        hypIndex: inHyp && f.hypQuote ? hyp.indexOf(f.hypQuote) : -1,
      });
    });
    slots.push(rec);
  }
  return {
    officialCode,
    referenceCharLen: reference.length,
    referenceUtf8Bytes: Buffer.byteLength(reference, 'utf8'),
    candidateCharLens: Object.fromEntries(
      Object.entries(cands).map(([k, v]) => [k, v.length]),
    ),
    slots,
    missingNoteSlots: slots.filter((s) => !s.notePresent || s.noteType !== 'string').map((s) => s.slot),
    oversizeNoteSlots: slots.filter((s) => s.noteExceeds400).map((s) => s.slot),
    failingQuotes: slots.flatMap((s) => s.findings.filter((f) => f.failQuote).map((f) => ({ slot: s.slot, ...f }))),
  };
}

function classifyFailure(row) {
  const { officialCode, jsonInfo, quoteNote, sidecar, response } = row;
  const fr = sidecar.finishReason;
  const outTok = sidecar.outputTokens;
  const maxTok = sidecar.maxTokensSent;
  const baseMeta = {
    finishReason: fr,
    outputTokens: outTok,
    maxTokensSent: maxTok,
    provider: sidecar.provider,
    httpStatus: sidecar.httpStatus,
    providerUsd: sidecar.providerUsd,
    usageComplete: response.usage && response.usage.complete,
  };
  if (officialCode === 'bad-json') {
    if (fr === 'error' || (jsonInfo.endDepths && jsonInfo.endDepths.inStr && fr !== 'stop')) {
      return {
        classId: 'provider-or-gateway-incomplete',
        blame: 'undetermined-incomplete-response',
        vsContract: 'cannot-assert-model-violated-json-constraint-because-response-is-incomplete',
        ...baseMeta,
        detail: 'finish_reason=error or unterminated stored content; do not call this a completed model JSON error.',
      };
    }
    if (jsonInfo.hasFence) {
      return {
        classId: 'wrapped-or-fenced-json',
        blame: 'undetermined-wrapper',
        vsContract: 'model-or-wrapper-added-fence',
        ...baseMeta,
      };
    }
    if (fr === 'length' || (outTok != null && maxTok != null && outTok >= maxTok)) {
      return {
        classId: 'possible-output-truncation',
        blame: 'undetermined-truncation',
        vsContract: 'cannot-assert-model-json-error-if-cut-by-max_tokens',
        ...baseMeta,
      };
    }
    if (jsonInfo.pattern.unquotedReasonKey) {
      return {
        classId: 'model-invalid-json-unquoted-key',
        blame: 'model-violated-explicit-json-object-constraint',
        vsContract: 'contract-requires-one-JSON-object; missing opening quote on key reason after empty hypQuote (`"",reason":` not `,"reason":`)',
        ...baseMeta,
      };
    }
    if (jsonInfo.pattern.duplicateSlotKey) {
      return {
        classId: 'model-invalid-json-duplicate-slot-key',
        blame: 'model-violated-explicit-json-object-constraint',
        vsContract: 'invalid JSON: "slot": "slot": "slot-2"',
        ...baseMeta,
      };
    }
    if (jsonInfo.pattern.extraCloserAfterSlot1) {
      return {
        classId: 'model-invalid-json-extra-closer-after-slot-1',
        blame: 'model-violated-explicit-json-object-constraint',
        vsContract: 'invalid JSON: extra } between slot-1 object and slot-2 element',
        ...baseMeta,
      };
    }
    return {
      classId: 'model-invalid-json-other',
      blame: 'model-violated-explicit-json-object-constraint',
      vsContract: 'stored content is complete (finish=stop) but not valid JSON',
      ...baseMeta,
    };
  }
  if (officialCode === 'note') {
    if (quoteNote.missingNoteSlots.length) {
      return {
        classId: 'model-missing-required-note-field',
        blame: 'model-violated-explicit-slot-key-constraint',
        vsContract: 'each slot keys are exactly slot, abstain, confidence, note, findings; note must be a string; official code "note" here is missing field, not length>400',
        missingNoteSlots: quoteNote.missingNoteSlots,
        oversizeNoteSlots: quoteNote.oversizeNoteSlots,
        ...baseMeta,
      };
    }
    if (quoteNote.oversizeNoteSlots.length) {
      return {
        classId: 'model-note-exceeds-400-chars',
        blame: 'model-violated-explicit-note-length-constraint',
        vsContract: 'note.length <= 400 (JS UTF-16 code units, same as parse.js)',
        oversizeNoteSlots: quoteNote.oversizeNoteSlots,
        ...baseMeta,
      };
    }
    return {
      classId: 'note-other',
      blame: 'undetermined',
      vsContract: 'official code is note but neither missing nor >400 observed',
      ...baseMeta,
    };
  }
  if (officialCode === 'quote') {
    return {
      classId: 'model-quote-not-exact-slice',
      blame: 'model-violated-explicit-exact-slice-constraint',
      vsContract: 'refQuote must be exact slice of reference; hypQuote of the same-slot candidate',
      failingQuotes: quoteNote.failingQuotes,
      ...baseMeta,
    };
  }
  return { classId: 'unexpected-official-code', blame: 'undetermined', officialCode, ...baseMeta };
}

function officialJudgeOk(entry) {
  return Boolean(entry && typeof entry === 'object' && entry.schema === 'belliedmonkey.llm-judge.verdict.v2');
}

function humanReviewAndArmCheck(human, arm, summary, result) {
  const items = summary.results;
  const both = [];
  const oneFail = [];
  for (const r of items) {
    const aOk = officialJudgeOk(r.judges['judge-a']);
    const bOk = officialJudgeOk(r.judges['judge-b']);
    if (aOk && bOk) both.push(r.id);
    else oneFail.push(r.id);
  }
  const bothSet = new Set(both);
  const disagreed = human.disagreement || [];
  const sample = human.sample || [];
  const notAssessed = human.notAssessed || [];
  const agreed = both.filter((id) => !disagreed.includes(id));
  const bothParsedArm = arm.overall.bothJudgesParsed;
  const ncBoth = (arm.items || []).filter((it) => bothSet.has(it.id) && it.preference === 'not-comparable');
  const arithmetic = {
    items: items.length,
    bothOfficialValid: both.length,
    officialResultBothOk: result.parseCounts && result.parseCounts.bothOk,
    disagreement: disagreed.length,
    agreed: agreed.length,
    sample: sample.length,
    notAssessed: notAssessed.length,
    sampleEqualsAllAgreed: sample.length === agreed.length && agreed.every((id) => sample.includes(id)),
    notAssessedEqualsNonBoth: notAssessed.length === oneFail.length && oneFail.every((id) => notAssessed.includes(id)),
    disagreementSubsetOfBoth: disagreed.every((id) => bothSet.has(id)),
    armBothParsed: bothParsedArm,
    armBothParsedEquals22: bothParsedArm === both.length,
    armSa: arm.overall.saPreferredBoth,
    armSv: arm.overall.svPreferredBoth,
    armTie: arm.overall.bothTie,
    armSplit: arm.overall.splitPreference,
    armNotComparable: arm.overall.notComparable,
    armComparableSum: arm.overall.saPreferredBoth + arm.overall.svPreferredBoth + arm.overall.bothTie + arm.overall.splitPreference,
    armTotal: arm.overall.saPreferredBoth + arm.overall.svPreferredBoth + arm.overall.bothTie + arm.overall.splitPreference + arm.overall.notComparable,
    bothParsedButArmNotComparable: ncBoth.map((it) => ({
      id: it.id,
      reason: 'at-least-one-judge-abstain-or-missing-contentFindings',
      judgeA: it.judges['judge-a'],
      judgeB: it.judges['judge-b'],
    })),
  };
  arithmetic.notComparableComposition = {
    unparsedItems: oneFail.length,
    bothParsedButNotComparable: ncBoth.length,
    sum: oneFail.length + ncBoth.length,
    equalsOfficialNotComparable: oneFail.length + ncBoth.length === arm.overall.notComparable,
  };
  const misreadNotes = [];
  if (arithmetic.disagreement === 17 && arithmetic.sample === 5 && arithmetic.notAssessed === 14) {
    misreadNotes.push('17+5+14 与官方 human-review 文件一致，不是误读：17 为双有效 22 条中的 kind 列表不一致；5 为全部一致项（约定 sampleCount=6，但一致项只有 5，故抽样=全部一致项）；14 为至少一名评委官方无效的条目（36-22），其中 en_us/1673 双评委均失败，故失败判决 15 条对应 14 个 item。');
  } else {
    misreadNotes.push('17+5+14 与重算不一致，见 arithmetic。');
  }
  if (arithmetic.notComparableComposition.equalsOfficialNotComparable) {
    misreadNotes.push('aux notComparable=17 若被读成「17 条未解析」则是误读。正确组成是 14 条至少一名未官方解析，加上 3 条双解析但至少一名弃权/不可比（en_us/1676、cmn_hans_cn/1679、ascend/00004，均为 judge-b abstain）。4+3+7+5=19 为双解析且可比较的倾向合计，19+3=22。本核验不改原件，也不把倾向当胜者或人审。');
  }
  return { arithmetic, misreadNotes, agreedIds: agreed, notAssessedIds: notAssessed };
}

function mdEscape(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function buildReport(ctx) {
  const { pins, replay, failures, reviewCheck, sentContract, lossless } = ctx;
  const classCounts = {};
  for (const f of failures) {
    const id = f.classification.classId;
    classCounts[id] = (classCounts[id] || 0) + 1;
  }
  const lines = [];
  lines.push('# 正式 v2 剩余失败离线诊断（不回填、不付费）');
  lines.push('');
  lines.push('目录：`judge-prep/v2-offline-diag-20261114/`。授权：t55u / [pt55u]「同意」先离线分析剩余失败，不再直接付费重跑。');
  lines.push('');
  lines.push('约束：只读现有正式 v2 证据与已归档 pack；不付费、不网络、不 Mac、不 secret、不改仓库/冻结包/原 run/分数；官方 partial 永久保留；不做语义人审或伪造人审；不把本次 agent 审视当人审；不启动新 paid 补洞。预算台账仍为累计消耗 `0.10094232` / 计划 `0.28`，本诊断不改台账。');
  lines.push('');
  lines.push('## 简短结论');
  lines.push('');
  lines.push(`原 parser 重放与正式结果一致：judge-a（GPT）34/36 有效、judge-b（Qwen）23/36 有效、双有效 22。正式原件 hash 与归档钉扎一致。15 条失败判决（14 个 item，\`en_us/1673\` 双失败）均已对照发送的 v2 contract 与完整存储响应检查。**未发现会把合法完整 JSON 误判为失败的 pack 解析器缺陷，也未发现可无损提取/去围栏即可正式通过的响应。** 不得回填、不得修 quote/截 note/修 JSON 编造判决。`);
  lines.push('');
  lines.push('失败精确分类（15 条）：');
  lines.push('');
  lines.push('- **模型违反「返回一个 JSON 对象」且响应完整（finish_reason=stop，输出远小于 2048）共 8 条：** 6 条在 slot-1 结束后多了一个 `}`（`"}]}},{"slot":"slot-2"`）；1 条（GPT `cmn_hans_cn/1671`）在空 `hypQuote` 后键 `reason` 缺少起始引号（精确切片为 `"hypQuote":"",reason":`，JSON.parse 于 pos 474 / 字符 `r`；合法写法应为 `,"reason":`）；1 条（Qwen `cmn_hans_cn/1681`）出现 `"slot": "slot": "slot-2"`。无 markdown fence、无非法 JSON escape、非 max_tokens 截断。不能因为「看起来像判决」就改字节修复。');
  lines.push('- **不可把「模型 JSON 写错」当作完整结论 1 条：** Qwen `cmn_hans_cn/1673`，`finish_reason=error`，`providerUsd=0`，`outputTokens=137`，存储 content 在 `"hyp` 处未终止字符串。这是网关/供应商未完成响应（至少存储如此）；官方记为 `bad-json` 对「已存文本」成立，但不能武断说模型在完整生成后写出了非法 JSON。');
  lines.push('- **模型违反明确槽位键约束 3 条（官方 code=`note`）：** `cmn_hans_cn/1674`、`cmn_hans_cn/1676`、`en_us/1670` 的 slot-2 **缺少 `note` 字段**（不是 note 长度超过 400）。JS `note.length` 对此三项不适用。slot-1 的 note 均为空字符串 `""`（长度 0≤400）。');
  lines.push('- **模型违反明确 exact-slice 约束 3 条（官方 code=`quote`）：** `ascend/00055` slot-2 `format-only` 的 `refQuote`/`hypQuote` 为 `运动。`，参考文本无 `。`；`cmn_hans_cn/1675` slot-1 `format-only` 的 `refQuote` 为 `即便`，参考为 `即使`（候选才有 `即便`）；`cmn_hans_cn/1680` slot-2 `format-only` 的 `hypQuote` 为 `5倍`，不在 slot-2 假设中（在 slot-1）。均为精确切片失败，禁止改 quote 放行。');
  lines.push('');
  lines.push('是否确有代码缺陷：');
  lines.push('');
  lines.push('- **pack `parse.js` / `verdict-contract.js` / 已发送 system prompt：未发现与这 15 条失败相关的实现不一致。** 发送 system 的 sha256 与 plan `promptTemplateSha256`=`a2e82f86…220923` 一致；schema 要求 slots 为长度 2 的数组、键含 `note`、quote 必须是参考/同槽候选的精确切片、note≤400。官方拒绝符合合同。');
  lines.push('- **请求包装：72 条请求均为 `model/temperature/seed/max_tokens/messages`，system 为 v2 contract，未见把对象 slots 或 v1 提示混入本轮。**');
  lines.push('- **响应提取：完整 finish=stop 的 14 条失败，存储 content 以 `{` 起、无 fence，内部语法或字段/切片问题，不像抽错网关字段。** 1 条 `finish_reason=error` 只有部分文本被存入 `content`——这是 QA/传输层的**可观察性缺口**（仍把不完整文本交给 parser，官方 code 只表现为 `bad-json`；`usage.complete=true` 因已有 token 计数，易被误读为完整成功）。**这不是把合法完整判决判失败，也不是可回填的解析 bug。** 证据：sidecar `finishReason=error`、`providerUsd=0`、content 以 `"hyp` 截断、http 200。');
  lines.push('');
  lines.push('后续最小建议（**本轮不执行**）：');
  lines.push('');
  lines.push('1. 保持官方 v2 partial 与分数不动；不把任何 diagnostic derived 回填。本诊断无无损可回放通过项。');
  lines.push('2. 若日后要补洞，只对失败的评委×条目付费重跑（14 个 item、15 次请求），不要重跑已官方有效的 57 条；须另授权预算，且不得与本诊断 derived 混用。当前剩余计划额度仅作记账备忘，本文件不启动请求。');
  lines.push('3. 可选的未来 QA（非本轮开发）：sidecar/`parsed` 保留 `finishReason`；当 `finish_reason=error` 或 content 未闭合时使用单独 code（如 `provider-error`），避免只显示 `bad-json`。禁止自动修 JSON/quote/note。');
  lines.push('4. 对外说明：官方 `note` 失败包含「缺字段」；aux `notComparable=17` 含 14 未解析 + 3 双解析弃权，不是 17 条未解析。`semanticHumanReviewed` 仍为 false。');
  lines.push('');
  lines.push('## 原件 hash 与 parser 重放');
  lines.push('');
  lines.push('| 钉扎 | sha256 | 一致 |');
  lines.push('| --- | --- | --- |');
  for (const r of pins) {
    lines.push(`| ${mdEscape(r.label)} | \`${r.actual}\` | ${r.ok ? '是' : '否'} |`);
  }
  lines.push('');
  lines.push(`重放：judge-a parsed=${replay.judgeA.parsed} fail=${replay.judgeA.failed}（官方 34/2）；judge-b parsed=${replay.judgeB.parsed} fail=${replay.judgeB.failed}（官方 23/13）；双有效=${replay.bothOk}（官方 22）。与官方 parsed 文件逐条 code 一致：${replay.codesMatchOfficial ? '是' : '否'}。`);
  lines.push('');
  lines.push(`发送 system prompt sha256=\`${sentContract.systemSha256}\`，与 plan.promptTemplateSha256 一致：${sentContract.matchesPlan ? '是' : '否'}；72 条 system 完全相同：${sentContract.allSystemIdentical ? '是' : '否'}。`);
  lines.push('');
  lines.push('## 逐条失败');
  lines.push('');
  lines.push('| 评委 | item | 官方 code | finish_reason | out/max tok | provider | 分类 | 关键证据（切片/长度） |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const f of failures) {
    const ev = f.evidenceNote.replace(/\n/g, ' ');
    lines.push(`| ${f.judgeId} | ${f.itemId} | ${f.officialCode} | ${f.sidecar.finishReason} | ${f.sidecar.outputTokens}/${f.sidecar.maxTokensSent} | ${f.sidecar.provider} | ${f.classification.classId} | ${mdEscape(ev)} |`);
  }
  lines.push('');
  lines.push('分类计数：' + Object.entries(classCounts).map(([k, n]) => `${k}=${n}`).join('；') + '。');
  lines.push('');
  lines.push(`无损提取/格式恢复：${lossless.recoverableCount} 条。${lossless.note}`);
  lines.push('');
  lines.push('## human-review 17+5+14 与 aux 倾向');
  lines.push('');
  for (const n of reviewCheck.misreadNotes) lines.push('- ' + n);
  lines.push('');
  lines.push('本诊断不做语义复核，不改 human-review 原件，不将 agent 审视记为 `semanticHumanReviewed`。');
  lines.push('');
  lines.push('## 预算台账（不变）');
  lines.push('');
  lines.push(`累计计划 ${CUMULATIVE_PLAN}，累计消耗 ${CUMULATIVE_CONSUMED}，本诊断未产生新费用。`);
  lines.push('');
  lines.push('## 可复现命令');
  lines.push('');
  lines.push('```');
  lines.push('node /workspace/baseline-sa-sv-36-20261113/judge-prep/v2-offline-diag-20261114/scripts/diagnose-v2-failures.mjs');
  lines.push('```');
  lines.push('');
  lines.push('输出：`out/`、`fixtures/`、本 `REPORT.md`、`SHA256SUMS`、`MANIFEST.json`。证据树只读。');
  lines.push('');
  return lines.join('\n') + '\n';
}

function main() {
  if (!existsSync(join(PACK, 'parse.js'))) {
    throw new Error('pack-unpacked/parse.js missing');
  }
  const pins = pinCheck();
  const requirePack = createRequire(pathToFileURL(join(PACK, 'parse.js')));
  const { parseVerdict } = requirePack(join(PACK, 'parse.js'));
  const { rubricText, NOTE_MAX } = requirePack(join(PACK, 'verdict-contract.js'));
  if (NOTE_MAX !== 400) throw new Error('NOTE_MAX unexpected: ' + NOTE_MAX);

  mkdirSync(OUT, { recursive: true });
  mkdirSync(FIX, { recursive: true });
  for (const name of readdirSync(FIX)) {
    if (name.startsWith('.')) continue;
    rmSync(join(FIX, name));
  }

  const result = readJson(join(EVIDENCE, 'ledger/RESULT.json'));
  const summary = readJson(join(EVIDENCE, 'judge-run/summary.json'));
  const plan = readJson(join(EVIDENCE, 'judge-run/plan.json'));
  const human = readJson(join(EVIDENCE, 'judge-run/human-review.json'));
  const arm = readJson(join(EVIDENCE, 'ledger/derived-arm-stats.json'));
  const inputDoc = readJson(join(EVIDENCE, 'input/input-asr-36.json'));
  const assignmentDoc = readJson(join(EVIDENCE, 'judge-run/assignment.json'));
  const itemsById = new Map(inputDoc.items.map((it) => [it.id, it]));
  const assignById = new Map(assignmentDoc.items.map((it) => [it.id, it]));

  if (String(result.cumulativeConsumedUsd) !== CUMULATIVE_CONSUMED) {
    throw new Error('ledger cumulativeConsumedUsd changed: ' + result.cumulativeConsumedUsd);
  }
  if (String(result.cumulativePlanUsd) !== CUMULATIVE_PLAN) {
    throw new Error('ledger cumulativePlanUsd changed: ' + result.cumulativePlanUsd);
  }

  const contractText = rubricText();
  const contractSha = sha256Text(contractText);
  const judges = ['judge-a', 'judge-b'];
  const replayRows = [];
  const counts = {
    'judge-a': { parsed: 0, failed: 0, codes: {} },
    'judge-b': { parsed: 0, failed: 0, codes: {} },
  };
  let codesMatchOfficial = true;
  const systemSet = new Set();

  for (const judgeId of judges) {
    const reqDir = join(EVIDENCE, 'judge-run/requests', judgeId);
    const names = readdirSync(reqDir).filter((n) => n.endsWith('.json') && !n.startsWith('._'));
    names.sort();
    for (const name of names) {
      const request = readJson(join(reqDir, name));
      const response = readJson(join(EVIDENCE, 'judge-run/responses', judgeId, name));
      const official = readJson(join(EVIDENCE, 'judge-run/parsed', judgeId, name));
      const sidecar = readJson(join(EVIDENCE, 'judge-run/sidecars', `${judgeId}_${name}`));
      const system = request.messages[0].content;
      systemSet.add(system);
      const user = JSON.parse(request.messages[1].content);
      const itemId = user.itemId;
      const item = itemsById.get(itemId);
      const assignment = assignById.get(itemId);
      if (!item || !assignment) throw new Error('missing item/assignment for ' + itemId);
      const content = response.content;
      const replayed = parseVerdict(content, item, assignment);
      const officialCode = official.ok ? 'parsed' : official.code;
      const replayCode = replayed.ok ? 'parsed' : replayed.code;
      if (officialCode !== replayCode || Boolean(official.ok) !== Boolean(replayed.ok)) {
        codesMatchOfficial = false;
      }
      if (replayed.ok) counts[judgeId].parsed += 1;
      else counts[judgeId].failed += 1;
      counts[judgeId].codes[replayCode] = (counts[judgeId].codes[replayCode] || 0) + 1;
      replayRows.push({
        judgeId, itemId, file: name, officialOk: official.ok, officialCode,
        replayOk: replayed.ok, replayCode,
      });
    }
  }

  const bothIds = new Set();
  const okA = new Set(replayRows.filter((r) => r.judgeId === 'judge-a' && r.replayOk).map((r) => r.itemId));
  const okB = new Set(replayRows.filter((r) => r.judgeId === 'judge-b' && r.replayOk).map((r) => r.itemId));
  for (const id of okA) if (okB.has(id)) bothIds.add(id);
  const replay = {
    judgeA: counts['judge-a'],
    judgeB: counts['judge-b'],
    bothOk: bothIds.size,
    codesMatchOfficial,
    official: result.parseCounts,
  };
  if (replay.judgeA.parsed !== 34 || replay.judgeB.parsed !== 23 || replay.bothOk !== 22) {
    throw new Error('replay counts != 34/23/22: ' + JSON.stringify(replay));
  }
  if (!codesMatchOfficial) throw new Error('replay codes diverge from official parsed files');

  const allSystemIdentical = systemSet.size === 1;
  const onlySystem = [...systemSet][0];
  const systemSha256 = sha256Text(onlySystem);
  const sentContract = {
    systemSha256,
    planPromptSha: plan.promptTemplateSha256,
    matchesPlan: systemSha256 === plan.promptTemplateSha256 && systemSha256 === BAKED.promptTemplateSha256,
    allSystemIdentical,
    matchesRubricText: onlySystem === contractText && systemSha256 === contractSha,
    systemUtf8Bytes: Buffer.byteLength(onlySystem, 'utf8'),
    systemCharLen: onlySystem.length,
    containsArrayExample: onlySystem.includes('"slots"') && onlySystem.includes('slot-1') && onlySystem.includes('slot-2'),
    containsNoteMax: onlySystem.includes('400'),
    containsExactSlice: /exact slice|精确/.test(onlySystem) || onlySystem.toLowerCase().includes('exact'),
  };
  if (!sentContract.matchesPlan || !sentContract.matchesRubricText || !allSystemIdentical) {
    throw new Error('sent system prompt mismatch: ' + JSON.stringify(sentContract));
  }

  const failures = [];
  for (const row of replayRows.filter((r) => !r.replayOk)) {
    const request = readJson(join(EVIDENCE, 'judge-run/requests', row.judgeId, row.file));
    const response = readJson(join(EVIDENCE, 'judge-run/responses', row.judgeId, row.file));
    const sidecar = readJson(join(EVIDENCE, 'judge-run/sidecars', `${row.judgeId}_${row.file}`));
    const official = readJson(join(EVIDENCE, 'judge-run/parsed', row.judgeId, row.file));
    const content = response.content;
    const jsonInfo = typeof content === 'string' ? classifyJsonIssue(content) : { jsonOk: false, error: 'content-not-string' };
    let quoteNote = null;
    if (jsonInfo.jsonOk) {
      quoteNote = diagnoseQuoteNote(content, request, official.code);
    }
    const record = {
      judgeId: row.judgeId,
      itemId: row.itemId,
      officialCode: official.code,
      officialOk: official.ok,
      sidecar: {
        finishReason: sidecar.finishReason,
        outputTokens: sidecar.outputTokens,
        maxTokensSent: sidecar.maxTokensSent,
        inputTokens: sidecar.inputTokens,
        provider: sidecar.provider,
        httpStatus: sidecar.httpStatus,
        providerUsd: sidecar.providerUsd,
        ok: sidecar.ok,
      },
      response: {
        stage: response.stage,
        aborted: response.aborted,
        usage: response.usage,
        providerUsd: response.providerUsd,
        contentCharLen: typeof content === 'string' ? content.length : null,
        contentUtf8Bytes: typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : null,
        contentSha256: typeof content === 'string' ? sha256Text(content) : null,
      },
      jsonInfo,
      quoteNote,
    };
    record.classification = classifyFailure(record);
    if (official.code === 'bad-json') {
      const p = record.classification;
      const bits = [];
      if (jsonInfo.pattern && jsonInfo.pattern.unquotedReasonKey) {
        bits.push(`missing opening quote on key reason at ${jsonInfo.pattern.unquotedReasonIndex}: "hypQuote":"",reason":`);
      }
      if (jsonInfo.pattern && jsonInfo.pattern.extraCloserAfterSlot1) {
        bits.push(`extra } after slot-1 at index ${jsonInfo.pattern.extraCloserIndex}`);
      }
      if (jsonInfo.pattern && jsonInfo.pattern.duplicateSlotKey) {
        bits.push(`duplicate slot key at ${jsonInfo.pattern.duplicateSlotKeyIndex}: "slot": "slot": "slot-2"`);
      }
      if (jsonInfo.position != null) bits.push(`JSON.parse position ${jsonInfo.position}: ${jsonInfo.error}`);
      bits.push(`content ${jsonInfo.charLen} chars / ${jsonInfo.utf8Bytes} utf8 bytes; fence=${jsonInfo.hasFence}; illegalEscapes=${(jsonInfo.invalidEscapes || []).length}`);
      bits.push(`finish=${sidecar.finishReason} out=${sidecar.outputTokens}/${sidecar.maxTokensSent}`);
      record.evidenceNote = bits.join('; ');
    } else if (official.code === 'note' && quoteNote) {
      const miss = quoteNote.slots.filter((s) => !s.notePresent || s.noteType !== 'string')
        .map((s) => `${s.slot} keys=[${s.keys.join(',')}] note absent`);
      const lens = quoteNote.slots.filter((s) => s.noteType === 'string')
        .map((s) => `${s.slot} note.length=${s.noteCharLen} utf8=${s.noteUtf8Bytes} (>400=${s.noteExceeds400})`);
      record.evidenceNote = [...miss, ...lens].join('; ');
    } else if (official.code === 'quote' && quoteNote) {
      record.evidenceNote = quoteNote.failingQuotes.map((f) => {
        return `${f.slot}#${f.idx} kind=${f.kind} refQuote=${JSON.stringify(f.refQuote)} (len=${f.refQuoteCharLen}, inRef=${f.inReference}, refIndex=${f.refIndex}) hypQuote=${JSON.stringify(f.hypQuote)} (len=${f.hypQuoteCharLen}, inSameSlot=${f.inSameSlotHypothesis}, hypIndex=${f.hypIndex}, inSlots=${JSON.stringify(f.hypQuoteInSlots)})`;
      }).join('; ');
    } else {
      record.evidenceNote = official.code;
    }
    failures.push(record);

    // Minimal redacted fixture: typo/quote windows only, not a repaired verdict.
    const fixture = {
      diagnosticOnly: true,
      notForBackfill: true,
      mustNotChangeOfficialPartial: true,
      judgeId: row.judgeId,
      itemId: row.itemId,
      officialCode: official.code,
      classification: record.classification.classId,
      sidecar: record.sidecar,
      contentCharLen: record.response.contentCharLen,
      contentUtf8Bytes: record.response.contentUtf8Bytes,
      contentSha256: record.response.contentSha256,
    };
    if (!jsonInfo.jsonOk) {
      fixture.jsonError = {
        message: jsonInfo.error,
        position: jsonInfo.position,
        window: jsonInfo.window,
        windowStart: jsonInfo.windowStart,
        pattern: jsonInfo.pattern,
        endDepths: jsonInfo.endDepths,
        hasFence: jsonInfo.hasFence,
        invalidEscapeCount: (jsonInfo.invalidEscapes || []).length,
        losslessAttempts: jsonInfo.losslessAttempts,
      };
    } else {
      fixture.quoteNote = {
        missingNoteSlots: quoteNote.missingNoteSlots,
        oversizeNoteSlots: quoteNote.oversizeNoteSlots,
        failingQuotes: quoteNote.failingQuotes,
        slotNotes: quoteNote.slots.map((s) => ({
          slot: s.slot,
          keys: s.keys,
          notePresent: s.notePresent,
          noteCharLen: s.noteCharLen,
          noteUtf8Bytes: s.noteUtf8Bytes,
          noteExceeds400: s.noteExceeds400,
        })),
        referenceCharLen: quoteNote.referenceCharLen,
        candidateCharLens: quoteNote.candidateCharLens,
      };
    }
    writeJson(join(FIX, `${row.judgeId}__${safeName(row.itemId)}`), fixture);
  }

  const losslessRecoverable = failures.filter((f) => {
    const la = f.jsonInfo && f.jsonInfo.losslessAttempts;
    return la && Object.values(la).some(Boolean);
  });
  const lossless = {
    recoverableCount: losslessRecoverable.length,
    ids: losslessRecoverable.map((f) => `${f.judgeId}:${f.itemId}`),
    note: losslessRecoverable.length
      ? '若有 fence/空白可剥且内部字节不变即可 JSON.parse 的，仅能作为 diagnostic derived，不可回填。本轮见 ids。'
      : 'strip/fence/首尾对象切片均不能在不改 JSON 字节的前提下恢复合法对象。不生成 derived 判决，不修 quote/note/JSON。',
  };

  const reviewCheck = humanReviewAndArmCheck(human, arm, summary, result);

  writeJson(join(OUT, 'pin-check.json'), { ok: true, pins });
  writeJson(join(OUT, 'replay-counts.json'), replay);
  writeJson(join(OUT, 'sent-contract.json'), sentContract);
  writeJson(join(OUT, 'failure-table.json'), failures.map((f) => ({
    judgeId: f.judgeId,
    itemId: f.itemId,
    officialCode: f.officialCode,
    classification: f.classification,
    evidenceNote: f.evidenceNote,
    sidecar: f.sidecar,
    contentCharLen: f.response.contentCharLen,
    contentUtf8Bytes: f.response.contentUtf8Bytes,
    contentSha256: f.response.contentSha256,
    jsonError: f.jsonInfo && !f.jsonInfo.jsonOk ? {
      message: f.jsonInfo.error,
      position: f.jsonInfo.position,
      window: f.jsonInfo.window,
      pattern: f.jsonInfo.pattern,
      endDepths: f.jsonInfo.endDepths,
      hasFence: f.jsonInfo.hasFence,
      invalidEscapeCount: (f.jsonInfo.invalidEscapes || []).length,
      losslessAttempts: f.jsonInfo.losslessAttempts,
    } : null,
    quoteNote: f.quoteNote && {
      missingNoteSlots: f.quoteNote.missingNoteSlots,
      oversizeNoteSlots: f.quoteNote.oversizeNoteSlots,
      failingQuotes: f.quoteNote.failingQuotes,
      slotNotes: f.quoteNote.slots.map((s) => ({
        slot: s.slot,
        keys: s.keys,
        noteCharLen: s.noteCharLen,
        noteUtf8Bytes: s.noteUtf8Bytes,
        noteExceeds400: s.noteExceeds400,
      })),
    },
  })));
  writeJson(join(OUT, 'human-review-and-arm-check.json'), reviewCheck);
  writeJson(join(OUT, 'lossless-derived.json'), {
    diagnosticOnly: true,
    notForBackfill: true,
    ...lossless,
  });

  const tableMd = [
    '| judge | item | official | finish | tokens | provider | class | evidence |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...failures.map((f) => `| ${f.judgeId} | ${f.itemId} | ${f.officialCode} | ${f.sidecar.finishReason} | ${f.sidecar.outputTokens}/${f.sidecar.maxTokensSent} | ${f.sidecar.provider} | ${f.classification.classId} | ${mdEscape(f.evidenceNote)} |`),
    '',
  ].join('\n');
  writeFileSync(join(OUT, 'failure-table.md'), tableMd + '\n');

  const report = buildReport({
    pins, replay, failures, reviewCheck, sentContract, lossless,
  });
  writeFileSync(join(DIAG, 'REPORT.md'), report);

  const manifest = {
    schema: 'belliedmonkey.qa.v2-offline-diag.v1',
    authorizedBy: 'pt55u',
    diagnosticOnly: true,
    notForBackfill: true,
    officialPartialPermanent: true,
    paidCalls: 0,
    budgetLedgerUnchanged: {
      cumulativeConsumedUsd: CUMULATIVE_CONSUMED,
      cumulativePlanUsd: CUMULATIVE_PLAN,
    },
    replay,
    failureCount: failures.length,
    uniqueItems: [...new Set(failures.map((f) => f.itemId))].length,
    classes: failures.reduce((acc, f) => {
      acc[f.classification.classId] = (acc[f.classification.classId] || 0) + 1;
      return acc;
    }, {}),
    losslessRecoverableCount: lossless.recoverableCount,
    codesMatchOfficial,
    sentContractMatchesPlan: sentContract.matchesPlan,
    createdAtAsiaShanghai: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date()).replace(',', ''),
  };
  writeJson(join(DIAG, 'MANIFEST.json'), manifest);

  // SHA256SUMS for diagnostic outputs only (not rewriting official evidence sums).
  const sumLines = [];
  const outFiles = [
    'REPORT.md',
    'MANIFEST.json',
    'scripts/diagnose-v2-failures.mjs',
    'out/pin-check.json',
    'out/replay-counts.json',
    'out/sent-contract.json',
    'out/failure-table.json',
    'out/failure-table.md',
    'out/human-review-and-arm-check.json',
    'out/lossless-derived.json',
    ...readdirSync(FIX).filter((n) => n.endsWith('.json')).sort().map((n) => 'fixtures/' + n),
  ];
  for (const rel of outFiles) {
    const fp = join(DIAG, rel);
    if (!existsSync(fp)) continue;
    sumLines.push(`${sha256File(fp)}  ${rel}`);
  }
  writeFileSync(join(DIAG, 'SHA256SUMS'), sumLines.join('\n') + '\n');

  // Re-read official pins after write to prove evidence untouched.
  const pinsAfter = pinCheck();

  console.log(JSON.stringify({
    ok: true,
    replay,
    failureCount: failures.length,
    uniqueItems: [...new Set(failures.map((f) => f.itemId))].length,
    classes: manifest.classes,
    losslessRecoverableCount: lossless.recoverableCount,
    reportSha256: sha256File(join(DIAG, 'REPORT.md')),
    manifestSha256: sha256File(join(DIAG, 'MANIFEST.json')),
    sumsSha256: sha256File(join(DIAG, 'SHA256SUMS')),
    pinsOkAfterWrite: pinsAfter.every((p) => p.ok),
    budgetUnchanged: { cumulativeConsumedUsd: CUMULATIVE_CONSUMED, cumulativePlanUsd: CUMULATIVE_PLAN },
  }, null, 2));
}

main();
