'use strict';

// Deterministic slice of a FLEURS TSV. The file has no header.
// Columns, observed on google/fleurs revision 70bb2e84 (test split):
//   0 sentence id (shared by every reading of one FLORES sentence)
//   1 wav file name
//   2 raw transcription (punctuation kept)
//   3 normalized transcription (the ASR reference this slice scores)
//   4 character-spaced form (not used)
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

module.exports = { N_PER_LANGUAGE, SELECTION_RULE, parseTsv, selectFirst };
