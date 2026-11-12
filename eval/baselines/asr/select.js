'use strict';

// Deterministic slice of a FLEURS TSV. The file has no header.
// Columns, observed on google/fleurs revision 70bb2e84 (test split):
//   0 sentence id (shared by every reading of one FLORES sentence)
//   1 wav file name
//   2 raw transcription (punctuation kept)
//   3 normalized transcription (the ASR reference this slice scores; copied as published, not re-spaced)
//   4 another published form, unused here. It is not a promise that column 3 is character-spaced.
//   5 num samples at 16 kHz
//   6 speaker label as published (MALE / FEMALE / OTHER)

const N_PER_LANGUAGE = 8;

function parseTsv(text) {
  const rows = [];
  const lines = String(text || '').split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const c = line.split('\t');
    if (c.length !== 7) {
      const err = new Error('tsv column count');
      err.line = i + 1;
      err.count = c.length;
      throw err;
    }
    rows.push({
      sentenceId: c[0],
      audioName: c[1],
      raw: c[2],
      normalized: c[3],
      numSamples: Number(c[5]),
      speakerLabel: c[6],
    });
  }
  return rows;
}

const SELECTION_RULE = 'Parse the test TSV. Keep rows whose raw and normalized transcriptions are non-empty and whose audio name ends in .wav. Sort by numeric sentence id, then audio file name. Keep the first audio file of each sentence id. Take the first 8 sentence ids of each language. Later readings of the same sentence stay out of this slice.';

function selectFirst(rows, n) {
  const limit = n == null ? N_PER_LANGUAGE : n;
  const usable = (rows || []).filter((r) => {
    return r && String(r.normalized || '').trim() && String(r.raw || '').trim()
      && String(r.audioName || '').endsWith('.wav')
      && Number.isFinite(Number(r.sentenceId));
  });
  usable.sort((a, b) => {
    const d = Number(a.sentenceId) - Number(b.sentenceId);
    if (d) return d;
    if (a.audioName < b.audioName) return -1;
    if (a.audioName > b.audioName) return 1;
    return 0;
  });
  const seen = new Set();
  const out = [];
  for (const row of usable) {
    if (seen.has(row.sentenceId)) continue;
    seen.add(row.sentenceId);
    out.push(row);
    if (out.length === limit) break;
  }
  return out;
}

function selectDisjointPairs(enRows, zhRows, excludedIds, pairLimit) {
  const limit = pairLimit == null ? 15 : pairLimit;
  const excluded = new Set((excludedIds || []).map(String));
  function index(rows) {
    const map = new Map();
    for (const row of selectFirst(rows, 1000000)) map.set(String(row.sentenceId), row);
    return map;
  }
  const en = index(enRows);
  const zh = index(zhRows);
  const ids = [...en.keys()].filter((id) => zh.has(id) && !excluded.has(id));
  ids.sort((a, b) => Number(a) - Number(b));
  const pairs = [];
  for (const id of ids) {
    if (pairs.length >= limit) break;
    pairs.push({ sentenceId: id, en: en.get(id), zh: zh.get(id) });
  }
  const items = [];
  for (const pair of pairs) {
    items.push(Object.assign({ lang: 'en', config: 'en_us' }, pair.en));
    items.push(Object.assign({ lang: 'zh', config: 'cmn_hans_cn' }, pair.zh));
  }
  return {
    pairs: pairs,
    items: items,
    alignment: 'shared-flores-sentence-id',
    humanVerifiedCount: 0,
    approvedPlannedSetCount: 0,
    realFailureCount: 0,
    buckets: {
      readSpeech: { count: items.length, status: 'read-speech-only' },
      accent: { count: 0, status: 'unknown' },
      noise: { count: 0, status: 'unknown' },
      codeSwitch: { count: 0, status: 'unknown' },
      continuousDialogue: { count: 0, status: 'unknown' },
    },
  };
}

module.exports = { N_PER_LANGUAGE, SELECTION_RULE, parseTsv, selectFirst, selectDisjointPairs };
