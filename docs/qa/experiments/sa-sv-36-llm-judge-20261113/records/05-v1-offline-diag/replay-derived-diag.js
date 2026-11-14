'use strict';

// Offline QA diagnostic only. Does not call any network, read any key,
// write into the frozen official evidence tree, or backfill the original run.
// Replay-derived counts are post-hoc format adaptation, not a frozen-protocol pass.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseVerdict } = require('./pack-unpacked/parse.js');
const { ASR_RUBRIC, promptTemplateSha256, ASR_VERSION } = require('./pack-unpacked/rubric.js');
const { sampleIds } = require('./pack-unpacked/assign.js');

const ROOT = __dirname;
const EVIDENCE = path.resolve(ROOT, '..', 'real-run-20261113-2253');
const OUT = path.join(ROOT, 'out');
const FROZEN = {
  'package/01M7AJ65AKYJT2H26187ZDN7TW.gz':
    '74258e362de80cf39986717b32b65ef6ec9d3719bd60d21b91af54c1d441a9fe',
  'input/input-asr-36.json':
    '1a44cca3bf05662c8701d943702a35e7fd1a303f9bcd931764775d9057c795a1',
  'input/pair-manifest.json':
    '2e5d95d1b61e16f9e0b3506f3e949b94c9717d577e1cc8c41fe72e3b6e221bb7',
  'config/config.draft-openrouter-20261113.json':
    '912305f81258ce801c16285816af06949d9dec81590a8adb2b296daa176a1600',
  'judge-run/summary.json':
    '44d9be2d34f633815622754e4e6ee3535bf67bb6f059e5f67d9d237236eb1e7b',
  'judge-run/human-review.json':
    '6dc6b18b2a95f158bff1e29e12df8514eaf5de497f4be3adf3d581b62cbc855a',
  'judge-run/assignment.json':
    '3c54b9c2571ce63b6203d004f3ab2e109da7e7ba39feeda438c88fc8a4e79470',
  'judge-run/plan.json':
    '9a0d9f86ebbef41a3657f0e773c3cb9bb231c39fbc1b647f2f6d7cd69261ab81',
  'judge-run/usage.json':
    'c4dcc906a14e460f32cee30e110a8f1bbebfdfffe295c73138349789a3652216',
  'ledger/RESULT.json':
    'e1496fd413d4057b09ee75346c96d7da7cd85402c2f1a270d2fc40bf6ba5e0b6',
};

const SPEC = {
  name: 'belliedmonkey.llm-judge.slots-object-to-array.candidate.v1-diag',
  protocolStatus: 'post-hoc-format-adaptation-candidate; not frozen original protocol; not a formal pass',
  doesNotBackfillOriginalRun: true,
  doesNotChangeScoringContent: true,
  applicability: [
    'Input text is valid JSON and the root is a plain object.',
    'Root keys are a subset of {schema, itemId, slots}; extra root keys are not stripped (official parse may then fail score-field).',
    'slots is a plain object (not an array, not null).',
    'slots has exactly the keys slot-1 and slot-2 (both present, no other keys).',
    'Each value is a plain object (not an array, not null).',
    'Slot identity is unique and complete: if an inner object has a slot field, it must equal the object key; if it lacks a slot field, the adapter may insert slot equal to the object key only (identity, not scoring content). This official run already has matching inner slot fields on every adaptable object, so no insertion is required.',
    'The transform is slotsArray = [slots["slot-1"], slots["slot-2"]]. No other field is added, deleted, truncated, remapped, or rewritten (notes, findings, quotes, kinds, reasons, confidence, abstain stay byte-for-byte as parsed JSON values).',
    'The mapping is one-to-one reversible: objectFrom(array) keyed by inner slot equals the (identity-completed) original slots object.',
    'After the shape change, the official parseVerdict is applied unchanged. Quote, note, kind, reason, leak, item-id, and remaining checks are not relaxed. A later parse failure stays null.',
  ],
  rejection: [
    'Invalid JSON (including mixed object/array punctuation). Do not delete or insert brackets, do not unescape, do not guess a repaired document.',
    'slots is already an array, is missing, or is not a plain object.',
    'Object keys are not exactly {slot-1, slot-2} (missing, extra, or renamed keys). Do not drop extra keys; that would delete content.',
    'A value is not a plain object.',
    'Object key conflicts with the inner slot field (e.g. key slot-1 but inner slot is slot-2 or any other string).',
    'Duplicate slot identity after conversion.',
    'Any rewrite of quotes (including whitespace/punctuation near-misses), truncation of note or reason to meet the 400 cap, remapping of finding-kind (including punctuation -> format-only), or adding/removing findings.',
    'Using the adapter to backfill official summary/human-review or to claim doubleBlindComplete under the frozen v1 protocol.',
  ],
};

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function safeName(id) {
  return String(id).replace(/[^A-Za-z0-9._-]+/g, '_') + '.json';
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isSlice(haystack, quote) {
  return typeof quote === 'string' && (quote === '' || (typeof haystack === 'string' && haystack.indexOf(quote) !== -1));
}

function nearHints(hay, q) {
  if (typeof q !== 'string' || typeof hay !== 'string' || !q) return [];
  const hints = [];
  if (q.trim() && hay.indexOf(q.trim()) !== -1 && hay.indexOf(q) === -1) hints.push('trim-quote-in-hay');
  if (q.toLowerCase() !== q && hay.toLowerCase().indexOf(q.toLowerCase()) !== -1 && hay.indexOf(q) === -1) {
    hints.push('casefold-in-hay');
  }
  const coll = (s) => s.replace(/\s+/g, ' ');
  if (coll(hay).indexOf(coll(q)) !== -1 && hay.indexOf(q) === -1) hints.push('collapsed-ws-in-hay');
  if (q.length > hay.length) hints.push('quote-longer-than-field');
  return hints;
}

function kindsFor(verdict, slotName) {
  if (!verdict) return null;
  const slot = verdict.slots.filter((row) => row.slot === slotName)[0];
  if (!slot) return null;
  if (slot.abstain) return ['abstain'];
  return slot.findings.map((finding) => finding.kind).sort();
}

function reviewList(items, byId, judges, seed, sampleCount) {
  const disagreements = [];
  const unparsed = [];
  const agreed = [];
  for (const item of items) {
    const left = byId.get(judges[0].id + ':' + item.id);
    const right = byId.get(judges[1].id + ':' + item.id);
    if (!left || !left.ok || !right || !right.ok) {
      unparsed.push(item.id);
      continue;
    }
    const mismatch = ['slot-1', 'slot-2'].some((slot) => {
      const a = kindsFor(left.verdict, slot);
      const b = kindsFor(right.verdict, slot);
      return JSON.stringify(a) !== JSON.stringify(b);
    });
    if (mismatch) disagreements.push(item.id);
    else agreed.push(item.id);
  }
  const sampled = sampleIds(agreed, seed, sampleCount);
  return {
    schema: 'belliedmonkey.llm-judge.human-review.v1',
    semanticHumanReviewCount: 0,
    semanticHumanReviewed: false,
    earReviewUsedAsSemanticReview: false,
    disagreement: disagreements,
    sample: sampled,
    notAssessed: unparsed,
    label: 'post-hoc-format-adaptation-diagnostic; not official frozen-protocol human-review; review not performed',
  };
}

function verifyFrozen() {
  const report = [];
  for (const [rel, expect] of Object.entries(FROZEN)) {
    const file = path.join(EVIDENCE, rel);
    if (!fs.existsSync(file)) {
      report.push({ rel, ok: false, error: 'missing' });
      continue;
    }
    const got = sha256(fs.readFileSync(file));
    report.push({ rel, ok: got === expect, expected: expect, got });
  }
  return report;
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json') && !name.startsWith('._')).sort();
}

function adaptSlotsObject(text) {
  const result = {
    applicable: false,
    rejected: true,
    rejectCode: null,
    insertedSlotIdentity: false,
    reversible: false,
    adaptedText: null,
    details: null,
  };
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    result.rejectCode = 'bad-json';
    result.details = { message: String(err.message || err) };
    return result;
  }
  if (!isPlainObject(doc)) {
    result.rejectCode = 'root-not-object';
    return result;
  }
  if (!Object.prototype.hasOwnProperty.call(doc, 'slots')) {
    result.rejectCode = 'slots-missing';
    return result;
  }
  if (Array.isArray(doc.slots)) {
    result.rejectCode = 'slots-already-array';
    return result;
  }
  if (!isPlainObject(doc.slots)) {
    result.rejectCode = 'slots-not-object';
    return result;
  }
  const keys = Object.keys(doc.slots);
  const keySet = keys.slice().sort().join(',');
  if (keySet !== 'slot-1,slot-2') {
    result.rejectCode = 'slots-keys-not-exactly-slot-1-slot-2';
    result.details = { keys };
    return result;
  }
  const completed = {};
  let inserted = false;
  for (const key of ['slot-1', 'slot-2']) {
    const inner = doc.slots[key];
    if (!isPlainObject(inner)) {
      result.rejectCode = 'slot-value-not-object';
      result.details = { key, type: inner === null ? 'null' : Array.isArray(inner) ? 'array' : typeof inner };
      return result;
    }
    if (Object.prototype.hasOwnProperty.call(inner, 'slot')) {
      if (inner.slot !== key) {
        result.rejectCode = 'key-inner-slot-conflict';
        result.details = { key, innerSlot: inner.slot };
        return result;
      }
      completed[key] = inner;
    } else {
      inserted = true;
      completed[key] = Object.assign({ slot: key }, inner);
    }
  }
  const arr = [completed['slot-1'], completed['slot-2']];
  const seen = new Set(arr.map((row) => row.slot));
  if (seen.size !== 2 || !seen.has('slot-1') || !seen.has('slot-2')) {
    result.rejectCode = 'slot-identity-not-unique-and-complete';
    return result;
  }
  const back = {};
  for (const row of arr) back[row.slot] = row;
  const reversible = deepEqual(back, completed);
  if (!reversible) {
    result.rejectCode = 'not-reversible';
    return result;
  }
  const adapted = Object.assign({}, doc, { slots: arr });
  result.applicable = true;
  result.rejected = false;
  result.insertedSlotIdentity = inserted;
  result.reversible = true;
  result.adaptedText = JSON.stringify(adapted);
  result.details = { keys, insertedSlotIdentity: inserted };
  return result;
}

function diagnoseBadJson(text) {
  const info = { length: text.length, issues: [] };
  try {
    JSON.parse(text);
    info.parseable = true;
    return info;
  } catch (err) {
    info.parseable = false;
    info.message = String(err.message || err);
  }
  const slotsIdx = text.indexOf('"slots"');
  info.slotsPrefix = slotsIdx >= 0 ? text.slice(slotsIdx, slotsIdx + 24) : null;
  let firstErrorPos = null;
  // Walk for extra closers and invalid escapes, string-aware.
  let inStr = false;
  let esc = false;
  let brace = 0;
  let bracket = 0;
  const validEsc = { '"': 1, '\\': 1, '/': 1, b: 1, f: 1, n: 1, r: 1, t: 1, u: 1 };
  const invalidEscapes = [];
  const extraClosers = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) {
        if (!validEsc[ch]) invalidEscapes.push({ pos: i - 1, next: ch });
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
      if (brace < 0) extraClosers.push({ pos: i, kind: '}', brace, bracket });
    } else if (ch === '[') bracket += 1;
    else if (ch === ']') {
      bracket -= 1;
      if (bracket < 0) extraClosers.push({ pos: i, kind: ']', brace, bracket });
    }
  }
  info.invalidEscapes = invalidEscapes;
  info.extraClosers = extraClosers;
  info.endDepths = { brace, bracket, inStr };
  info.tail = text.slice(-40);
  if (extraClosers.length) {
    const p = extraClosers[0].pos;
    info.firstExtraCloserWindow = text.slice(Math.max(0, p - 20), Math.min(text.length, p + 20));
    firstErrorPos = p;
  }
  info.firstErrorPos = firstErrorPos;
  return info;
}

function inspectSystemAndUsers(requestsRoot) {
  const systems = new Map();
  const userShapes = new Map();
  let n = 0;
  for (const judge of ['judge-a', 'judge-b']) {
    const dir = path.join(requestsRoot, judge);
    for (const name of listJson(dir)) {
      n += 1;
      const req = readJson(path.join(dir, name));
      const sys = req.messages[0].content;
      const key = sha256(Buffer.from(sys, 'utf8'));
      if (!systems.has(key)) systems.set(key, { sha256: key, length: sys.length, text: sys, count: 0 });
      systems.get(key).count += 1;
      const user = JSON.parse(req.messages[1].content);
      const candTypes = Array.isArray(user.candidates) ? 'array' : typeof user.candidates;
      const candKeys = Array.isArray(user.candidates)
        ? Array.from(new Set(user.candidates.map((c) => Object.keys(c).sort().join(',')))).sort()
        : [];
      const shape = JSON.stringify({
        keys: Object.keys(user),
        candidatesType: candTypes,
        candidatesLen: Array.isArray(user.candidates) ? user.candidates.length : null,
        candidateObjectKeys: candKeys,
      });
      userShapes.set(shape, (userShapes.get(shape) || 0) + 1);
    }
  }
  const systemList = Array.from(systems.values());
  const sys = systemList[0] && systemList[0].text || '';
  return {
    requestCount: n,
    uniqueSystemPrompts: systemList.length,
    systemSha256: systemList.map((s) => s.sha256),
    systemMatchesRubric: systemList.length === 1 && sys === ASR_RUBRIC,
    rubricVersion: ASR_VERSION,
    promptTemplateSha256: promptTemplateSha256(),
    computedSystemSha256: systemList[0] ? systemList[0].sha256 : null,
    flags: {
      containsWordExample: sys.indexOf('example') !== -1,
      containsFence: sys.indexOf('```') !== -1,
      containsJsonArray: sys.indexOf('JSON array') !== -1,
      containsIsAnArray: sys.indexOf('is an array') !== -1,
      containsSlotsIs: sys.indexOf('slots is') !== -1,
      containsSlotsHas: sys.indexOf('slots has') !== -1,
      containsEmptyArrayClause: sys.indexOf('empty array') !== -1,
      containsNoteLimit400: /note[^.]{0,80}400/.test(sys) || sys.indexOf('400') !== -1,
      containsReasonLimit400: /reason[^.]{0,80}400/.test(sys),
      containsAllowedKinds: sys.indexOf('format-only, entity, number, negation, semantic, omission, addition') !== -1,
      ambiguousSlotsSentence: 'slots has one object for slot-1 and one for slot-2.',
    },
    userShapes: Array.from(userShapes.entries()).map(([shape, count]) => ({ shape: JSON.parse(shape), count })),
    systemText: sys,
  };
}

function independentFindingChecks(verdict, item, assignment) {
  const bySlot = new Map();
  for (const cand of item.candidates) {
    const slot = assignment.slots['slot-1'] === cand.key ? 'slot-1' : 'slot-2';
    bySlot.set(slot, cand.text);
  }
  const issues = [];
  for (const slot of verdict.slots) {
    const hyp = bySlot.get(slot.slot);
    for (let i = 0; i < slot.findings.length; i++) {
      const f = slot.findings[i];
      const refOk = isSlice(item.reference, f.refQuote);
      const hypOk = isSlice(hyp, f.hypQuote);
      if (!refOk || !hypOk) {
        issues.push({
          slot: slot.slot,
          index: i,
          kind: f.kind,
          code: 'quote',
          refOk,
          hypOk,
          refQuote: f.refQuote,
          hypQuote: f.hypQuote,
          nearRef: nearHints(item.reference, f.refQuote),
          nearHyp: nearHints(hyp, f.hypQuote),
        });
      }
    }
  }
  return issues;
}

function main() {
  if (!fs.existsSync(EVIDENCE) || fs.existsSync(path.join(OUT, '..', '..', 'real-run-SENTINEL-DO-NOT'))) {
    // no-op guard placeholder
  }
  const frozenAtStart = verifyFrozen();
  if (frozenAtStart.some((row) => !row.ok)) {
    throw new Error('Frozen evidence hash mismatch: ' + JSON.stringify(frozenAtStart.filter((r) => !r.ok)));
  }

  const input = readJson(path.join(EVIDENCE, 'input/input-asr-36.json'));
  const assignmentDoc = readJson(path.join(EVIDENCE, 'judge-run/assignment.json'));
  const plan = readJson(path.join(EVIDENCE, 'judge-run/plan.json'));
  const usage = readJson(path.join(EVIDENCE, 'judge-run/usage.json'));
  const officialHuman = readJson(path.join(EVIDENCE, 'judge-run/human-review.json'));
  const officialSummary = readJson(path.join(EVIDENCE, 'judge-run/summary.json'));
  const officialResult = readJson(path.join(EVIDENCE, 'ledger/RESULT.json'));
  const config = readJson(path.join(EVIDENCE, 'config/config.draft-openrouter-20261113.json'));
  const itemsById = new Map(input.items.map((item) => [item.id, item]));
  const assignById = new Map(assignmentDoc.items.map((row) => [row.id, row]));
  const itemIds = plan.itemIds.slice();

  const promptInfo = inspectSystemAndUsers(path.join(EVIDENCE, 'judge-run/requests'));
  if (promptInfo.computedSystemSha256 !== officialSummary.promptTemplateSha256) {
    throw new Error('Sent system prompt sha256 does not match official promptTemplateSha256');
  }

  const officialCodes = { 'judge-a': {}, 'judge-b': {} };
  const rows = [];
  const officialById = new Map();
  const diagnosticById = new Map();

  for (const judgeId of ['judge-a', 'judge-b']) {
    for (const id of itemIds) {
      const name = safeName(id);
      const item = itemsById.get(id);
      const assignment = assignById.get(id);
      const rawWrap = readJson(path.join(EVIDENCE, 'judge-run/responses', judgeId, name));
      const officialParsed = readJson(path.join(EVIDENCE, 'judge-run/parsed', judgeId, name));
      const text = rawWrap.content;
      const officialReplay = parseVerdict(text, item, assignment);
      if (officialReplay.ok !== officialParsed.ok || officialReplay.code !== officialParsed.code) {
        throw new Error('Official parse replay mismatch ' + judgeId + ' ' + id);
      }
      officialCodes[judgeId][id] = officialParsed.code;
      officialById.set(judgeId + ':' + id, officialReplay);

      const adapt = judgeId === 'judge-a' ? adaptSlotsObject(text) : {
        applicable: false,
        rejected: true,
        rejectCode: officialReplay.ok ? 'slots-already-array-or-not-needed' : (officialReplay.code === 'bad-json' ? 'bad-json' : 'not-shape-adapt-candidate'),
        insertedSlotIdentity: false,
        reversible: false,
        adaptedText: null,
        details: null,
      };
      // Judge-b failures are content/schema, not object-shape. Do not adapt them.
      if (judgeId === 'judge-b' && !officialReplay.ok && officialReplay.code !== 'slots') {
        // leave as above
      }

      let diagnostic = officialReplay;
      let diagnosticSource = 'official-unchanged';
      if (!officialReplay.ok && officialReplay.code === 'slots' && adapt.applicable) {
        const after = parseVerdict(adapt.adaptedText, item, assignment);
        diagnostic = after;
        diagnosticSource = after.ok
          ? 'post-hoc-object-to-array-then-official-parse'
          : 'post-hoc-object-to-array-then-official-parse-failed';
      } else if (!officialReplay.ok && adapt.rejectCode === 'bad-json') {
        diagnosticSource = 'bad-json-not-adaptable';
        diagnostic = officialReplay;
      }

      const quoteIssues = diagnostic.ok ? independentFindingChecks(diagnostic.verdict, item, assignment) : [];
      if (diagnostic.ok && quoteIssues.length) {
        diagnostic = { ok: false, code: 'quote', verdict: null };
        diagnosticSource += '+independent-quote-failed';
      }

      diagnosticById.set(judgeId + ':' + id, diagnostic);

      let badJson = null;
      if (officialParsed.code === 'bad-json' || (typeof text === 'string' && (() => { try { JSON.parse(text); return false; } catch (_) { return true; } })())) {
        badJson = diagnoseBadJson(text);
      }

      let failDetail = null;
      const inspectContentFail = (!officialReplay.ok && officialReplay.code !== 'slots' && officialReplay.code !== 'bad-json')
        || (adapt.applicable && diagnostic && !diagnostic.ok);
      if (inspectContentFail) {
        // Independent diagnosis of official content failures, and of post-adapt parse failures.
        let doc = null;
        try { doc = JSON.parse(adapt.applicable && adapt.adaptedText ? adapt.adaptedText : text); } catch (_) { doc = null; }
        if (doc && (Array.isArray(doc.slots) || (doc.slots && typeof doc.slots === 'object'))) {
          if (!Array.isArray(doc.slots) && doc.slots['slot-1'] && doc.slots['slot-2']) {
            doc = Object.assign({}, doc, { slots: [doc.slots['slot-1'], doc.slots['slot-2']] });
          }
          failDetail = { officialCode: officialReplay.code, diagnosticCode: diagnostic && diagnostic.code, slots: [] };
          const bySlot = new Map();
          for (const cand of item.candidates) {
            const slot = assignment.slots['slot-1'] === cand.key ? 'slot-1' : 'slot-2';
            bySlot.set(slot, cand.text);
          }
          for (const slot of doc.slots) {
            const hyp = bySlot.get(slot.slot);
            const slotInfo = {
              slot: slot.slot,
              noteLen: typeof slot.note === 'string' ? slot.note.length : null,
              noteOver400: typeof slot.note === 'string' ? slot.note.length > 400 : null,
              findings: [],
            };
            for (let i = 0; i < (slot.findings || []).length; i++) {
              const f = slot.findings[i];
              const refOk = isSlice(item.reference, f.refQuote);
              const hypOk = isSlice(hyp, f.hypQuote);
              const allowed = ['format-only', 'entity', 'number', 'negation', 'semantic', 'omission', 'addition'];
              const kindOk = allowed.indexOf(f.kind) !== -1;
              if (!refOk || !hypOk || !kindOk || officialReplay.code === 'note') {
                const rec = {
                  index: i,
                  kind: f.kind,
                  kindAllowed: kindOk,
                  refOk,
                  hypOk,
                  refQuote: f.refQuote,
                  hypQuote: f.hypQuote,
                  nearRef: nearHints(item.reference, f.refQuote),
                  nearHyp: nearHints(hyp, f.hypQuote),
                };
                if (officialReplay.code === 'quote' && (!refOk || !hypOk)) {
                  rec.otherSlotHasHypQuote = {};
                  rec.otherSlotHasRefQuoteInRef = refOk;
                  for (const [s, t] of bySlot.entries()) {
                    rec.otherSlotHasHypQuote[s] = typeof f.hypQuote === 'string' && t.indexOf(f.hypQuote) !== -1;
                  }
                  rec.refHasExactRefQuote = typeof f.refQuote === 'string' && item.reference.indexOf(f.refQuote) !== -1;
                }
                if (!kindOk || !refOk || !hypOk) slotInfo.findings.push(rec);
              }
            }
            failDetail.slots.push(slotInfo);
          }
        }
      }

      const rec = {
        id,
        judgeId,
        officialOk: officialReplay.ok,
        officialCode: officialReplay.code,
        adaptApplicable: adapt.applicable,
        adaptRejectCode: adapt.rejectCode,
        adaptInsertedSlotIdentity: adapt.insertedSlotIdentity,
        adaptReversible: adapt.reversible,
        diagnosticOk: diagnostic.ok,
        diagnosticCode: diagnostic.code,
        diagnosticSource,
        independentQuoteIssuesOnDiagnosticOk: quoteIssues,
        badJson,
        failDetail,
      };
      rows.push(rec);

      if (adapt.applicable) {
        writeJson(path.join(OUT, 'replay-derived', 'adapted-text', judgeId, name), {
          label: 'post-hoc-format-adaptation-candidate; not frozen original protocol formal pass',
          itemId: id,
          judgeId,
          officialCode: officialReplay.code,
          diagnosticOk: diagnostic.ok,
          diagnosticCode: diagnostic.code,
          insertedSlotIdentity: adapt.insertedSlotIdentity,
          reversible: adapt.reversible,
          adaptedParsed: diagnostic,
        });
      }
    }
  }

  const officialBothValid = itemIds.filter((id) => officialById.get('judge-a:' + id).ok && officialById.get('judge-b:' + id).ok);
  const officialA = itemIds.filter((id) => officialById.get('judge-a:' + id).ok);
  const officialB = itemIds.filter((id) => officialById.get('judge-b:' + id).ok);
  const losslessA = itemIds.filter((id) => {
    const r = rows.find((x) => x.id === id && x.judgeId === 'judge-a');
    return r.officialCode === 'slots' && r.adaptApplicable && r.diagnosticOk && r.adaptReversible && !r.adaptInsertedSlotIdentity;
  });
  const losslessAButParseFail = itemIds.filter((id) => {
    const r = rows.find((x) => x.id === id && x.judgeId === 'judge-a');
    return r.adaptApplicable && !r.diagnosticOk;
  });
  const notAdaptableA = itemIds.filter((id) => {
    const r = rows.find((x) => x.id === id && x.judgeId === 'judge-a');
    return !r.officialOk && !r.adaptApplicable;
  });
  const qwenMustRejudge = itemIds.filter((id) => !officialById.get('judge-b:' + id).ok);
  const diagnosticBothValid = itemIds.filter((id) => diagnosticById.get('judge-a:' + id).ok && diagnosticById.get('judge-b:' + id).ok);
  const mustNewJudgmentDiagnostic = itemIds.filter((id) => !diagnosticById.get('judge-a:' + id).ok || !diagnosticById.get('judge-b:' + id).ok);

  const judges = plan.judges;
  const officialReview = officialHuman;
  const diagnosticReview = reviewList(itemIds.map((id) => ({ id })), diagnosticById, judges, plan.seed, config.sampleCount);

  const reserveGpt = plan.prices.reserveUsd.find((r) => r.model === 'openai/gpt-4.1-mini').usd;
  const reserveQwen = plan.prices.reserveUsd.find((r) => r.model === 'qwen/qwen3-235b-a22b-2507').usd;
  const remaining = officialResult.planRemainingUsd;
  const formalRequests = { judgeA: 36, judgeB: qwenMustRejudge.length };
  const formalReserve = formalRequests.judgeA * reserveGpt + formalRequests.judgeB * reserveQwen;
  const mustNewA = itemIds.filter((id) => !diagnosticById.get('judge-a:' + id).ok);
  const mustNewB = qwenMustRejudge;
  const mustNewReserve = mustNewA.length * reserveGpt + mustNewB.length * reserveQwen;
  const callsA = usage.calls.filter((c) => c.judgeId === 'judge-a');
  const callsB = usage.calls.filter((c) => c.judgeId === 'judge-b');
  const meanA = callsA.reduce((s, c) => s + c.settledUsd, 0) / callsA.length;
  const meanB = callsB.reduce((s, c) => s + c.settledUsd, 0) / callsB.length;
  const expectedFormal = formalRequests.judgeA * meanA + formalRequests.judgeB * meanB;
  const expectedMustNew = mustNewA.length * meanA + mustNewB.length * meanB;

  const gptShape = summarizeGptShapes(itemIds, rows, path.join(EVIDENCE, 'judge-run/responses/judge-a'));
  const qwenFails = rows.filter((r) => r.judgeId === 'judge-b' && !r.officialOk);

  const manifest = {
    schema: 'belliedmonkey.llm-judge.offline-diag.v1',
    generatedAt: shanghaiNow(),
    timezone: 'Asia/Shanghai (UTC+8)',
    officialRun: {
      evidenceDir: EVIDENCE,
      ok: officialResult.ok,
      code: officialResult.code,
      doubleBlindComplete: officialResult.doubleBlindComplete,
      planRemainingUsd: officialResult.planRemainingUsd,
      planConsumedUsd: officialResult.planConsumedUsd,
      judgeHeldUsd: officialResult.judgeHeldUsd,
      reservedProbesUsd: officialResult.reservedProbesUsd,
    },
    frozenHashesVerified: frozenAtStart,
    protocol: {
      original: 'belliedmonkey.llm-judge.verdict.v1 + asr.v1; slots must be array length 2',
      candidateSpec: SPEC.name,
      candidateStatus: SPEC.protocolStatus,
      backfillOriginalRun: false,
      claim36DoubleBlindComplete: false,
    },
    prompt: {
      uniqueSystemPrompts: promptInfo.uniqueSystemPrompts,
      systemMatchesRubric: promptInfo.systemMatchesRubric,
      promptTemplateSha256: promptInfo.promptTemplateSha256,
      flags: promptInfo.flags,
      userShapes: promptInfo.userShapes,
      hasActionableJsonSchema: false,
      hasArrayExample: false,
    },
    officialCounts: {
      judgeAOk: officialA.length,
      judgeBOk: officialB.length,
      bothOfficialValid: officialBothValid,
      judgeACodes: countCodes(rows.filter((r) => r.judgeId === 'judge-a')),
      judgeBCodes: countCodes(rows.filter((r) => r.judgeId === 'judge-b')),
    },
    diagnosticCounts: {
      label: 'post-hoc format adaptation; not a frozen-original-protocol formal pass; still not 36 double-blind complete',
      judgeALosslessRecoverable: losslessA,
      judgeAAdaptThenParseFail: losslessAButParseFail,
      judgeANotAdaptable: notAdaptableA,
      judgeBOfficialValid: officialB,
      judgeBMustRejudge: mustNewB,
      bothDiagnosticallyValid: diagnosticBothValid,
      mustNewJudgmentAtLeastOneJudge: mustNewJudgmentDiagnostic,
      officialBothValid: officialBothValid,
    },
    officialHumanReview: Object.assign({}, officialReview, {
      semanticHumanReviewed: false,
      note: 'Official file has no semanticHumanReviewed field; count is 0 and all 36 are notAssessed. This diagnostic does not perform human review.',
    }),
    diagnosticHumanReview: diagnosticReview,
    budgetEstimateOnly: {
      noRequestMade: true,
      remainingUsd: remaining,
      reservePerRequestUsd: { 'openai/gpt-4.1-mini': reserveGpt, 'qwen/qwen3-235b-a22b-2507': reserveQwen },
      formalCompleteUnderFrozenProtocol: {
        meaning: 'Do not accept post-hoc adapt as official. Re-judge all 36 judge-a plus the officially failed judge-b items.',
        requests: formalRequests,
        reserveUsd: roundUsd(formalReserve),
        remainingCoversReserve: remaining >= formalReserve,
        reserveMarginUsd: roundUsd(remaining - formalReserve),
        expectedSettledFromFirstRunMeanUsd: roundUsd(expectedFormal),
        expectedSettledNote: 'Mean settled of the first official 36 calls per judge; not a guarantee; estimate only.',
      },
      diagnosticUnrecoverableOnly: {
        meaning: 'If a later authorized run only re-calls judges/items that cannot be losslessly shape-adapted. This still cannot formal-complete the frozen protocol for the adapted items.',
        judgeAIds: mustNewA,
        judgeBIds: mustNewB,
        reserveUsd: roundUsd(mustNewReserve),
        remainingCoversReserve: remaining >= mustNewReserve,
        expectedSettledFromFirstRunMeanUsd: roundUsd(expectedMustNew),
      },
    },
    gptShape,
    qwenOfficialFailures: qwenFails,
    spec: SPEC,
    rows,
  };

  fs.mkdirSync(OUT, { recursive: true });
  writeJson(path.join(OUT, 'MANIFEST.json'), manifest);
  writeJson(path.join(OUT, 'spec-object-to-array.json'), SPEC);
  writeJson(path.join(OUT, 'items.json'), rows);
  writeJson(path.join(OUT, 'replay-derived', 'human-review.diagnostic.json'), diagnosticReview);
  writeJson(path.join(OUT, 'replay-derived', 'LABEL.json'), {
    label: 'post-hoc-format-adaptation / not frozen original protocol formal pass / still cannot claim 36 double-blind complete',
    officialDoubleBlindComplete: false,
    officialCode: 'partial',
    semanticHumanReviewed: false,
  });
  writeJson(path.join(OUT, 'fixtures-min', 'failure-summaries.json'), buildFixtures(rows, promptInfo, gptShape));
  writeText(path.join(OUT, 'FIX-SUGGESTIONS.md'), buildFixSuggestions());
  writeText(path.join(OUT, 'REPORT.md'), buildReport(manifest, promptInfo, officialResult, officialSummary, officialReview));

  const frozenAtEnd = verifyFrozen();
  if (frozenAtEnd.some((row) => !row.ok)) {
    throw new Error('Frozen evidence hash changed during diagnostic');
  }

  const sums = [];
  const outFiles = listFilesRecursive(OUT).sort();
  for (const rel of outFiles) {
    if (rel === 'SHA256SUMS') continue;
    const file = path.join(OUT, rel);
    if (fs.statSync(file).isFile()) {
      sums.push(sha256(fs.readFileSync(file)) + '  ' + rel);
    }
  }
  writeText(path.join(OUT, 'SHA256SUMS'), sums.join('\n') + '\n');

  process.stdout.write(JSON.stringify({
    ok: true,
    out: OUT,
    officialBothValid: officialBothValid.length,
    losslessA: losslessA.length,
    diagnosticBothValid: diagnosticBothValid.length,
    mustNewJudgment: mustNewJudgmentDiagnostic,
    formalReserveUsd: roundUsd(formalReserve),
    remainingUsd: remaining,
    remainingCoversFormalReserve: remaining >= formalReserve,
    frozenUnchanged: true,
  }, null, 2) + '\n');
}

function countCodes(subset) {
  const c = {};
  for (const r of subset) {
    const k = r.officialCode;
    c[k] = (c[k] || 0) + 1;
  }
  return c;
}

function roundUsd(n) {
  return Math.round(n * 1e9) / 1e9;
}

function shanghaiNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')} Asia/Shanghai (UTC+8)`;
}

function summarizeGptShapes(itemIds, rows, dir) {
  let objectCount = 0;
  let innerMatch = 0;
  const keySets = {};
  const innerKeySets = {};
  for (const id of itemIds) {
    const name = safeName(id);
    const text = readJson(path.join(dir, name)).content;
    let doc;
    try { doc = JSON.parse(text); } catch (_) { continue; }
    if (!isPlainObject(doc.slots)) continue;
    objectCount += 1;
    const keys = Object.keys(doc.slots).join(',');
    keySets[keys] = (keySets[keys] || 0) + 1;
    for (const key of Object.keys(doc.slots)) {
      const inner = doc.slots[key];
      if (isPlainObject(inner)) {
        const ik = Object.keys(inner).join(',');
        innerKeySets[ik] = (innerKeySets[ik] || 0) + 1;
        if (inner.slot === key) innerMatch += 1;
      }
    }
  }
  const bad = rows.find((r) => r.judgeId === 'judge-a' && r.officialCode === 'bad-json');
  return {
    validJsonObjectSlots: objectCount,
    innerObjectsWithMatchingSlotField: innerMatch,
    keySets,
    innerKeySets,
    badJsonId: bad ? bad.id : null,
    badJson: bad ? bad.badJson : null,
  };
}

function buildFixtures(rows, promptInfo, gptShape) {
  return {
    note: 'Minimal real-failure summaries for a later cloud patch. Not official verdicts. Do not use as a repaired run.',
    promptAmbiguity: {
      sentence: promptInfo.flags.ambiguousSlotsSentence,
      noArrayExample: true,
      noExplicitSlotsIsArray: true,
    },
    gptObjectSlots: {
      count: 35,
      shape: 'root.slots is a plain object with exactly keys slot-1, slot-2; each value is an object with slot, abstain, confidence, note, findings; inner slot matches the key',
      officialCode: 'slots',
    },
    ascend_00066: gptShape.badJson && {
      id: 'ascend/00066',
      judge: 'judge-a',
      officialCode: 'bad-json',
      slotsPrefix: gptShape.badJson.slotsPrefix,
      extraClosers: gptShape.badJson.extraClosers,
      invalidEscapes: gptShape.badJson.invalidEscapes,
      firstExtraCloserWindow: gptShape.badJson.firstExtraCloserWindow,
      observation: 'slots starts as an object ("slots":{"slot-1":{...}}); at the first extra closer, the raw text is ...}]}],"slot-2" — an extra ] after the slot-1 object, mixing object and array punctuation. End depths return to near-balanced only because of that extra bracket. No JSON escape errors. Do not delete the ] to invent a verdict.',
    },
    qwenFailures: rows.filter((r) => r.judgeId === 'judge-b' && !r.officialOk).map((r) => ({
      id: r.id,
      officialCode: r.officialCode,
      failDetail: r.failDetail,
    })),
  };
}

function buildFixSuggestions() {
  return [
    '# Pack / prompt fix suggestions (do not apply in this offline step)',
    '',
    'Do not edit the frozen pack or the translator repo here. Hand these to the existing cloud stream if a new protocol version is authorized later.',
    '',
    '## 1. Prompt (root cause of 35 GPT object-slots)',
    'The sent rubric says: "Return one JSON object... The object keys are only schema, itemId, and slots." then "slots has one object for slot-1 and one for slot-2." It never says that slots is a JSON array, and it never gives a JSON example. "has one object for slot-1 and one for slot-2" is readable as either an array of two objects or a dict keyed by slot name. All 35 well-formed GPT replies used the dict form, with inner `slot` already equal to the key. This is prompt-induced, not a random parser glitch.',
    'Candidate wording for a **new** prompt version (not a silent v1 change, not for backfill):',
    '  - "slots MUST be a JSON array of length 2, not an object or dictionary."',
    '  - "The two array elements are objects whose slot fields are slot-1 and slot-2 (unique, both required; order may be either)."',
    '  - Include one minimal example: `{"schema":"belliedmonkey.llm-judge.verdict.v1","itemId":"example-id","slots":[{"slot":"slot-1","abstain":true,"confidence":0,"note":"why","findings":[]},{"slot":"slot-2","abstain":true,"confidence":0,"note":"why","findings":[]}]}`',
    '  - State the parser caps in the prompt: note and reason are strings of length <= 400 (currently enforced only in parse.js; the sent rubric never mentions 400).',
    '  - Keep the allowed kind list explicit. Do not add punctuation unless a new version defines it; do not alias it to format-only without a written rule.',
    '',
    '## 2. parse.js',
    'Keep frozen v1 parse rejecting a slots object (correct for the original protocol). A candidate parse version may apply the documented lossless object→array adapter (see spec-object-to-array.json) and then the **unchanged** quote/note/kind checks. That is a new protocol version. It must not backfill the official 20261113-2253 run and must reject key/inner-slot conflicts, extra keys, and invalid JSON.',
    '',
    '## 3. Minimal fixtures for later tests (real failure summaries, not repaired verdicts)',
    '- object-slots: a verdict whose slots is `{"slot-1":{"slot":"slot-1",...},"slot-2":{"slot":"slot-2",...}}` — v1 parse code `slots`; candidate adapter then official checks.',
    '- key conflict: `{"slot-1":{"slot":"slot-2",...},...}` must be rejected.',
    '- extra key: slots object with slot-3 or typo key must be rejected (do not drop).',
    '- bad-json extra bracket: `"slots":{"slot-1":{...}],"slot-2":{...}}` (extra `]` after first object), modeled on judge-a ascend/00066; must stay bad-json; do not auto-repair.',
    '- note 401: official parse code `note`; do not truncate to 400 in a helper to force ok. Real item ascend/00028 slot-1 noteLen=429.',
    '- quote not in reference: refQuote `运动。` (U+3002) against a reference that contains `运动` but no ideographic full stop. Real item ascend/00055 slot-2. Do not rewrite the quote.',
    '- quote from the other slot: hypQuote `5倍` on a slot whose candidate has `五倍` (the other slot has `5倍`). Real item fleurs-public-candidates/cmn_hans_cn/1680 slot-2. Do not swap slots or quotes.',
    '- kind `punctuation`: official parse code `finding-kind`. Real item fleurs-public-candidates/en_us/1675 slot-2. Do not remap to format-only.',
    '- quote invented comma: after a legal object→array adapt, official parse code `quote`. Real item fleurs-public-candidates/cmn_hans_cn/1681 judge-a slot-2: refQuote has a U+FF0C not present in the reference (the comma exists only in the other slot). Do not rewrite the quote; the shape adapt is valid, the verdict stays null.',
    '',
    '## 4. Out of scope but already observed',
    'Official sidecar filenames used `req.itemId || req.model` while the pack request object has no itemId, so per-call provider sidecars overwrote to one file per model. Not fixed here; no paid rerun.',
    '',
  ].join('\n');
}

function buildReport(manifest, promptInfo, officialResult, officialSummary, officialReview) {
  const d = manifest.diagnosticCounts;
  const b = manifest.budgetEstimateOnly;
  const lines = [];
  const L = (s) => lines.push(s);
  L('# 首轮双评委 partial 离线根因报告');
  L('');
  L('生成时间：' + manifest.generatedAt);
  L('范围：只读已有 raw responses / 实际发送的 system+user / 冻结 pack 的 parse 与 rubric。不付费、不网络、不读 key、不碰 Mac、不改仓库、不改冻结证据、不回填原 run。');
  L('官方结果保持永久：`ok=false`，`code=partial`，`doubleBlindComplete=false`。本诊断不得宣称 36 条双盲完成。');
  L('');
  L('## 1. 冻结原件哈希（未改）');
  L('');
  for (const row of manifest.frozenHashesVerified) {
    L('- `' + row.rel + '`: `' + row.got + '` ' + (row.ok ? 'OK' : 'MISMATCH'));
  }
  L('- 官方 `EXPECTED-SHA256.txt` 另列 provenance/tokenizers 路径，本证据树中未包含这些文件；未改 EXPECTED，也未补写那些文件。存在的 pack/input/pair/config 四项与 EXPECTED 一致。');
  L('');
  L('## 2. Root cause：实际发送的提示没有可执行的 JSON 数组 schema / 示例');
  L('');
  L('- 72 条 request 的 system 提示完全相同（1 份，1593 字符），且与 pack `rubric.js` 的 `ASR_RUBRIC` 逐字一致。`promptTemplateSha256=' + promptInfo.promptTemplateSha256 + '`，与官方 summary 一致。');
  L('- 72 条 user 载荷形状相同：JSON 对象，键为 `untrusted, itemId, reference, candidates`；`candidates` 是长度为 2 的**数组**，元素为 `{slot, text}`。');
  L('- system **没有** JSON 示例、没有代码围栏、没有 “JSON array / is an array / slots is an array” 字样。');
  L('- 关键句是歧义的：`slots has one object for slot-1 and one for slot-2.` 既可以读成「数组里各有一个对象」，也可以读成「以 slot-1 / slot-2 为键的对象」。紧接着的 “The object keys are only schema, itemId, and slots” 还强化了「用对象键组织」的读法。');
  L('- “findings to be an empty array” 只约束 abstain 时的 findings，不是 slots 的示例。');
  L('- 解析器要求 `slots` 必须是长度为 2 的数组，但该约束只写在 `parse.js`，没有写进发送给模型的 rubric。');
  L('- `note` / `reason` 的 400 字符上限同样只在 `parse.js`，发送提示中完全没有 “400”。');
  L('- 允许的 kind 列表写在了提示里（format-only, entity, number, negation, semantic, omission, addition），其中**没有** punctuation。');
  L('');
  L('结论：提示对 slots 的形状是歧义且缺少可执行示例的；这足以诱导对象形态。这是协议/提示缺陷，不是后处理改 quote 能补的。');
  L('');
  L('## 3. GPT（judge-a）35 条 slots 对象 + 1 条 bad-json');
  L('');
  L('- 官方：0/36 解析成功。35 条 `code=slots`，1 条 `code=bad-json`（`ascend/00066`）。');
  L('- 35 条可解析 JSON 的顶层键均为 `schema, itemId, slots`，`schema=belliedmonkey.llm-judge.verdict.v1`，`slots` 全部是对象，键恰好为 `slot-1` 与 `slot-2`。');
  L('- 70 个内层对象的键均为 `slot, abstain, confidence, note, findings`，且内层 `slot` 与对象键一致。无键冲突，无缺 identity。');
  L('- 全样本同一形状，与歧义句一一对应，判定为 **prompt 歧义诱导**，不是偶发格式噪声。');
  L('');
  L('### `ascend/00066` bad-json 的真实结构');
  L('');
  const bj = manifest.gptShape.badJson || {};
  L('- 不是合法 JSON，不能做 object→array 适配，也不能靠删括号「修好」后当有效判决。');
  L('- 文本以 `"slots":{"slot-1":{...` 开始，即仍想写成对象形态。');
  L('- JSON.parse 失败：Expecting \',\' delimiter；第一个非法关闭是位置 ' + (bj.firstErrorPos != null ? bj.firstErrorPos : '?') + ' 的多余 `]`。窗口为 `' + (bj.firstExtraCloserWindow || '') + '`，即 slot-1 对象结束后出现 `}]}],"slot-2"`（对象关闭后再多一个数组关闭符）。这是对象/数组标点混用。');
  L('- 全文扫描 **没有** 非法 JSON 转义（先前摘要里 raw 尾部的 `\\\'哦\\\'` 是 Python `repr` 对普通单引号的写法，不是 JSON 里的反斜杠）。');
  L('- 结束深度依赖这个多余括号才回到近乎配对；不得删除该 `]` 来发明判决。此条必须新判断。');
  L('');
  L('### 形状可适配但官方 quote 仍失败：`fleurs-public-candidates/cmn_hans_cn/1681`');
  L('');
  L('- 35 条对象形态中有 34 条在 object→array 之后通过官方 parse + 独立 quote 复核；本条形状适用且可逆，但适配后 official/diagnostic code=`quote`，保持 null。不得改 quote 回收。');
  L('- slot-2 finding 2：kind=`semantic`，`refQuote=\'提出问题及进行观察，也可以指导科学研究。\'` 在 reference 中不存在。reference 对应片段是 `提出问题及进行观察也可以指导科学研究。`（「观察」与「也可以」之间没有 U+FF0C 全角逗号）。该逗号出现在 slot-1 候选中；本 refQuote 把 reference 的「及」与另一槽的逗号拼成了 reference 与 slot-2 都不含有的字符串。');
  L('- 这是真实切片缺陷，只是先前被 `slots` 形状错误挡住、在合法形状适配后才暴露。不是规则过严。judge-b 本条官方已通过。必须新判断 judge-a。');
  L('');
  L('## 4. Qwen（judge-b）4 条失败：内容/规则对照（未放宽，未改 quote）');
  L('');
  L('官方：32/36 解析成功。失败 4 条如下。独立按官方 `isSlice`（精确子串）和 kind 白名单、note.length<=400（JS UTF-16 长度）复核，不把近匹配当作通过。');
  L('');
  L('### `ascend/00028` — official code `note`（真实超长，不是 quote 问题）');
  L('');
  L('- slot-1 `noteLen=429`（Python 码点与 JS UTF-16 均为 429）> 400；slot-2 为 284，未超。');
  L('- 两条 findings 的 quotes 均为精确切片，kind=`entity` 合法。');
  L('- 400 上限未写进发送提示，这是 **提示未声明、解析器单独强制** 的限制，不是「过严的 quote 规则」，也不是虚构的切片错误。');
  L('- **严禁截断 note 冒充有效**。不可无损恢复，必须新判断。建议在未来新版提示中写明上限。');
  L('');
  L('### `ascend/00055` — official code `quote`（真实切片缺陷）');
  L('');
  L('- slot-2 finding：kind=`format-only`，`refQuote=hypQuote=\'运动。\'`（「运动」+ U+3002 IDEOGRAPHIC FULL STOP）。');
  L('- 该串在 slot-2 候选中存在，在 **reference 中不存在**。reference 为 `um运动啊男生一般不都喜欢运动`，含「运动」但不含句号；句号只出现在 slot-2 候选末尾。');
  L('- 近匹配不能代替精确切片。不得把 quote 改成「运动」或把句号从 reference 侧删掉来掩盖错误。这是真实内容缺陷，不是规则过严。必须新判断。');
  L('');
  L('### `fleurs-public-candidates/cmn_hans_cn/1680` — official code `quote`（真实张冠李戴）');
  L('');
  L('- slot-2 finding 1：kind=`format-only`，`refQuote=\'五倍\'`（在 reference 中）但 `hypQuote=\'5倍\'` **不在 slot-2 候选中**。');
  L('- slot-2 候选写的是「五倍」；「5倍」出现在 **slot-1** 候选。模型把另一槽的数字/汉字对照写到了本槽。');
  L('- 不是空白/大小写近匹配。不得对调 slot 或改写 hypQuote 来补救。真实内容缺陷。必须新判断。');
  L('');
  L('### `fleurs-public-candidates/en_us/1675` — official code `finding-kind`（非法 kind）');
  L('');
  L('- slot-2 finding 1：`kind=punctuation`，`refQuote=hypQuote=\'.\'`，二者都是精确切片。');
  L('- `punctuation` 不在提示给出的 7 个允许 kind 中，解析器拒绝是与已发送 rubric 一致的，不是额外暗规则。');
  L('- **不得把 punctuation 改标为 format-only** 来回收结果。即便该现象在别的标签下或许可写，也只能留给新判断，不能改官方输出。必须新判断。');
  L('');
  L('对官方已通过的 32 条 Qwen 判决，用同一套官方 parse + 独立 isSlice 复核，无额外 quote 失败（与官方 parsed 一致）。未放宽、也未收紧规则。');
  L('');
  L('## 5. 候选规范：纯形状一对一可逆 object→array（不回填、不按赢家挑规则）');
  L('');
  L('规范名：`' + SPEC.name + '`。状态：' + SPEC.protocolStatus + '。');
  L('');
  L('### 适用条件（须全部满足）');
  L('');
  for (const x of SPEC.applicability) L('- ' + x);
  L('');
  L('### 反例 / 拒绝条件（任一条即拒绝，失败保持 null）');
  L('');
  for (const x of SPEC.rejection) L('- ' + x);
  L('');
  L('本 run 的 35 条 GPT 对象形态满足适用条件（内层已有一致 slot，无需插入 identity）。`ascend/00066` 与全部 Qwen 内容失败都不适用。');
  L('');
  L('## 6. 事后格式适配诊断计数（非冻结协议正式通过）');
  L('');
  L('标签：**事后格式适配 / 非冻结原 protocol 正式通过 / 仍不能宣称 36 双盲完成。** `semanticHumanReviewed=false`。');
  L('');
  L('### 两评委官方有效（冻结协议）');
  L('');
  L(d.officialBothValid.length ? d.officialBothValid.map((x) => '- ' + x).join('\n') : '- （空）0 条。官方没有任何一条同时通过双评委。');
  L('');
  L('### 可无损恢复（仅诊断：GPT object→array 后官方 parse+quote 通过，且未改判分内容）');
  L('');
  L('共 ' + d.judgeALosslessRecoverable.length + ' 条 judge-a：');
  for (const id of d.judgeALosslessRecoverable) L('- ' + id);
  L('');
  L('其中适配后仍被官方规则拒绝的 judge-a：' + (d.judgeAAdaptThenParseFail.length ? d.judgeAAdaptThenParseFail.join(', ') : '（无）'));
  L('judge-a 完全不能适配（bad-json 等）：' + d.judgeANotAdaptable.join(', '));
  L('');
  L('### 诊断意义上双评委都有效（GPT 适配通过 **且** Qwen 官方已通过）');
  L('');
  L('共 ' + d.bothDiagnosticallyValid.length + ' 条：');
  for (const id of d.bothDiagnosticallyValid) L('- ' + id);
  L('');
  L('这 **不是** 官方双盲完成。不得写入原 summary / 不得回填。');
  L('');
  L('### 必须新判断（至少一名评委即使在合法形状适配后仍为 null）');
  L('');
  L('共 ' + d.mustNewJudgmentAtLeastOneJudge.length + ' 条：');
  for (const id of d.mustNewJudgmentAtLeastOneJudge) L('- ' + id);
  L('');
  L('拆分：judge-a 不可恢复：' + d.judgeANotAdaptable.concat(d.judgeAAdaptThenParseFail).join(', ') + '；judge-b 必须重评：' + d.judgeBMustRejudge.join(', ') + '。');
  L('');
  L('### 分歧 / 抽样 / 人工审');
  L('');
  L('官方 `human-review.json`：`semanticHumanReviewCount=0`，`disagreement=[]`，`sample=[]`，`notAssessed` 为全部 36 条（因为没有任何 official both-ok）。本诊断视 `semanticHumanReviewed=false`，未做人工语义审，不把 EAR 听评当作语义审。');
  L('对事后适配副本，用与 pack `reviewList` 相同的规则（按槽比较排序后的 kind 列表，含 abstain；seed=20261113，sampleCount=6）得到诊断 human-review（仍 `semanticHumanReviewCount=0`，`semanticHumanReviewed=false`）：');
  L('- disagreement：' + (manifest.diagnosticHumanReview.disagreement.length ? manifest.diagnosticHumanReview.disagreement.join(', ') : '（空）'));
  L('- sample（仅从诊断 agreed 中抽，待审，未评）：' + (manifest.diagnosticHumanReview.sample.length ? manifest.diagnosticHumanReview.sample.join(', ') : '（空）'));
  L('- notAssessed：' + manifest.diagnosticHumanReview.notAssessed.join(', '));
  L('上述 disagreement/sample 只用于诊断，不是官方待审清单的更新。正式人工审仍应在未来授权的官方有效双评委结果上进行。');
  L('');
  L('## 7. 需要重评的数量与未用预算（仅估算，未发请求）');
  L('');
  L('官方剩余计划预算：`planRemainingUsd=' + officialResult.planRemainingUsd + '`（`planConsumedUsd=' + officialResult.planConsumedUsd + '`，其中 probes ' + officialResult.reservedProbesUsd + ' + judge settled ' + officialResult.judgeHeldUsd + '）。本步 **没有** 发出任何推理请求。');
  L('');
  L('信封预留（官方 prices）：GPT `' + b.reservePerRequestUsd['openai/gpt-4.1-mini'] + '` / 次，Qwen `' + b.reservePerRequestUsd['qwen/qwen3-235b-a22b-2507'] + '` / 次。');
  L('');
  L('### A. 若要在冻结原协议下正式完成 36 双盲（不承认事后适配为正式通过）');
  L('');
  L('- 需重评：judge-a 全部 36 次 + judge-b 失败 4 次 = 40 次请求。');
  L('- 预留合计：`' + b.formalCompleteUnderFrozenProtocol.reserveUsd + '`。剩余预算是否覆盖预留：' + (b.formalCompleteUnderFrozenProtocol.remainingCoversReserve ? '是' : '否') + '，余量 `' + b.formalCompleteUnderFrozenProtocol.reserveMarginUsd + '`。');
  L('- 按首轮每模型已结算均值的**预期**花费：`' + b.formalCompleteUnderFrozenProtocol.expectedSettledFromFirstRunMeanUsd + '`（非保证，仅估算）。');
  L('');
  L('### B. 若只重评诊断上不可无损恢复的评委/条目');
  L('');
  L('- judge-a：' + b.diagnosticUnrecoverableOnly.judgeAIds.join(', '));
  L('- judge-b：' + b.diagnosticUnrecoverableOnly.judgeBIds.join(', '));
  L('- 预留合计：`' + b.diagnosticUnrecoverableOnly.reserveUsd + '`，剩余是否覆盖预留：' + (b.diagnosticUnrecoverableOnly.remainingCoversReserve ? '是' : '否') + '。');
  L('- 按均值预期：`' + b.diagnosticUnrecoverableOnly.expectedSettledFromFirstRunMeanUsd + '`。即便做完 B，那 34 条形状适配且校验通过的 GPT 诊断结果仍不是冻结协议正式通过，也仍不能宣称 36 双盲完成。');
  L('');
  L('未改 Latin 规则，未改原 ASR 分。未展开 DeepSeek，未改 Linear，未对外发消息。');
  L('');
  L('## 8. 可复现单命令');
  L('');
  L('```');
  L('node /workspace/baseline-sa-sv-36-20261113/judge-prep/offline-diag-20261113/replay-derived-diag.js');
  L('```');
  L('');
  L('输出只写在 `/workspace/baseline-sa-sv-36-20261113/judge-prep/offline-diag-20261113/out/`（QA 诊断，非仓库、非生产、非官方证据覆盖）。脚本结束前再次核对冻结哈希。');
  L('');
  L('主要产物：`REPORT.md`、`MANIFEST.json`、`SHA256SUMS`、`spec-object-to-array.json`、`FIX-SUGGESTIONS.md`、`fixtures-min/failure-summaries.json`、`replay-derived/`（含 LABEL 与适配后的 parse 结果）。');
  L('');
  return lines.join('\n') + '\n';
}

function listFilesRecursive(dir, prefix) {
  const out = [];
  const base = prefix || '';
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith('._')) continue;
    const rel = base ? base + '/' + name : name;
    const full = path.join(dir, rel.startsWith('/') ? name : path.join(dir === OUT ? '' : '', name));
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push.apply(out, listFilesRecursive(p, rel));
    else out.push(rel);
  }
  return out;
}

main();
