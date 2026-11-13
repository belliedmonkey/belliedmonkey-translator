'use strict';

// Research-only parser for sherpa-onnx-offline stdout.
// The 2024 SenseVoice doc shows one JSON object per line, with a string text field.
// A binary existing on disk does not prove that shape. This function does not run a binary.

function parseSenseVoiceStdout(text) {
  const lines = String(text || '').split(/\n/).filter((line) => line.trim() !== '');
  const hypotheses = [];
  for (let i = 0; i < lines.length; i++) {
    let row = null;
    try { row = JSON.parse(lines[i]); } catch (_) { row = null; }
    if (!row || typeof row.text !== 'string' || row.text === '') {
      return { ok: false, code: 'output-unparsed', index: i, hypotheses: null };
    }
    hypotheses.push(row.text);
  }
  if (!hypotheses.length) return { ok: false, code: 'output-unparsed', index: 0, hypotheses: null };
  return { ok: true, code: 'ok', hypotheses: hypotheses };
}

module.exports = { parseSenseVoiceStdout };
