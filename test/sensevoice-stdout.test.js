'use strict';

const { describe, test, eq } = require('./harness');
const { parseSenseVoiceStdout } = require('../eval/baselines/asr/sensevoice-stdout.js');

describe('sensevoice stdout parser', () => {
  test('one JSON line per file is accepted and a log line is not', () => {
    const sample = [
      '{"lang":"<|zh|>","emotion":"<|NEUTRAL|>","event":"<|Speech|>","text":"开饭时间早上九点至下午五点","timestamps":[],"tokens":[],"words":[]}',
      '{"lang":"<|en|>","emotion":"<|NEUTRAL|>","event":"<|Speech|>","text":"the tribal chieftain called for the boy","timestamps":[],"tokens":[],"words":[]}',
    ].join('\n') + '\n';
    const parsed = parseSenseVoiceStdout(sample);
    eq(parsed.ok, true);
    eq(parsed.hypotheses.length, 2);
    eq(parsed.hypotheses[0], '开饭时间早上九点至下午五点');
    const mixed = parseSenseVoiceStdout(sample + 'recognizer created in 0.576 s\n');
    eq(mixed.ok, false);
    eq(mixed.code, 'output-unparsed');
    eq(mixed.hypotheses, null);
    eq(parseSenseVoiceStdout('{"text":""}\n').ok, false);
  });
});
