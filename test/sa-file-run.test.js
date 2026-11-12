// The 16-clip entry is a script, not an agent checklist.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { describe, test, eq, ok } = require('./harness');
const {
  runDirName, itemWatchDecision, archiveAllowed, exactHypotheses, redactText,
  preflight, runSaFile, cacheRelative, tarCreateSpec, writeEvidenceArchive,
  verifyEvidenceArchive, listArchiveMembers, packExisting,
} = require('../eval/baselines/asr/run-sa-file.js');
const { buildBundle } = require('../eval/baselines/asr/pack-sa-file.js');

const ROOT = path.join(__dirname, '..');

function tinySet() {
  const items = [];
  for (let i = 0; i < 8; i++) {
    items.push({
      id: 'en_us/166' + i + '/a.wav',
      lang: 'en',
      config: 'en_us',
      audioName: 'en-' + i + '.wav',
      reference: 'one two',
      audioSha256: '',
    });
  }
  for (let i = 0; i < 8; i++) {
    items.push({
      id: 'cmn_hans_cn/166' + i + '/b.wav',
      lang: 'zh',
      config: 'cmn_hans_cn',
      audioName: 'zh-' + i + '.wav',
      reference: '甲乙',
      audioSha256: '',
    });
  }
  return {
    schema: 'belliedmonkey.public-asr-set.v1',
    id: 'fixture',
    kind: 'public-comparison',
    productMetric: false,
    attribution: { revision: 'fixture-revision' },
    items: items,
  };
}

function writeAudio(dir, set) {
  const crypto = require('crypto');
  fs.mkdirSync(dir, { recursive: true });
  for (const item of set.items) {
    const buf = Buffer.from('wav-bytes-' + item.id);
    const rel = item.config + '/' + item.audioName;
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buf);
    item.audioSha256 = crypto.createHash('sha256').update(buf).digest('hex');
    item.audioCache = rel;
  }
}

function successBin() {
  return [
    'const fs=require("fs");',
    'const a=process.argv;',
    'function arg(f){return a[a.indexOf(f)+1];}',
    'const set=JSON.parse(fs.readFileSync(arg("--set"),"utf8"));',
    'const rows=set.items.map(function(it){return {id:it.id,hypothesis:"heard "+it.id};});',
    'fs.writeFileSync(arg("--out"), JSON.stringify(rows));',
    'process.exit(0);',
  ].join('');
}

describe('sa file run — one entry, no reused score', () => {
  test('an existing run directory is refused and left untouched', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-root-'));
    const name = runDirName(0, 'abcd1234');
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'old');
    const out = await runSaFile({
      setPath: path.join(root, 'missing.json'),
      audioCache: root,
      outRoot: root,
      now: 0,
      nonce: 'abcd1234',
      platform: 'linux',
    });
    eq(out.code, 'output-exists');
    eq(out.processExit, 2);
    eq(out.rates, null);
    eq(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8'), 'old');
    eq(fs.existsSync(path.join(dir, 'score.json')), false);
  });

  test('linux preflight is not an Apple result', () => {
    const set = tinySet();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-au-'));
    writeAudio(dir, set);
    const checked = preflight({
      platform: 'linux',
      set: set,
      audioCache: dir,
      swiftc: '',
    });
    eq(checked.ok, false);
    eq(checked.code, 'need-apple-speechanalyzer');
    eq(checked.appleResult, false);
    eq(checked.rates, null);
  });

  test('frozen audioCache resolves under the cache root, not inside itself', () => {
    const fleurs = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/fleurs-public-v1.json'), 'utf8'));
    const first = fleurs.items[0];
    eq(first.id, 'en_us/1660/12742373433258665797.wav');
    eq(first.audioCache, 'eval/baselines/asr/.cache/audio/en_us/12742373433258665797.wav');
    eq(cacheRelative(first.audioCache), 'en_us/12742373433258665797.wav');
    eq(cacheRelative('eval/baselines/asr/.cache/audio/../../../tmp/x.wav'), null);
    eq(cacheRelative('/tmp/en_us/x.wav'), null);
    eq(cacheRelative('en_us/../cmn_hans_cn/x.wav'), null);
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-cache-'));
    const real = path.join(cache, 'en_us', '12742373433258665797.wav');
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.writeFileSync(real, Buffer.from('one-real-wav'));
    const nested = path.join(cache, 'eval/baselines/asr/.cache/audio/en_us/12742373433258665797.wav');
    fs.mkdirSync(path.dirname(nested), { recursive: true });
    fs.writeFileSync(nested, Buffer.from('wrong-nest'));
    const set = JSON.parse(JSON.stringify(fleurs));
    set.items.forEach((item) => { item.audioSha256 = 'f'.repeat(64); });
    const crypto = require('crypto');
    set.items[0].audioSha256 = crypto.createHash('sha256').update(Buffer.from('one-real-wav')).digest('hex');
    const hit = preflight({
      platform: 'darwin', set: set, audioCache: cache, swiftc: process.execPath,
    });
    eq(hit.code, 'missing-audio');
    eq(hit.id, set.items[1].id);
    eq(hit.appleResult, false);
  });

  test('a checksum mismatch stops before compile', () => {
    const set = tinySet();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-sum-'));
    writeAudio(dir, set);
    set.items[0].audioSha256 = '0'.repeat(64);
    const checked = preflight({
      platform: 'darwin',
      set: set,
      audioCache: dir,
      swiftc: '/usr/bin/swiftc',
    });
    eq(checked.ok, false);
    eq(checked.code, 'checksum-mismatch');
    eq(checked.id, set.items[0].id);
  });

  test('item and process caps are parent decisions', () => {
    eq(itemWatchDecision({
      started: 0, now: 180000, itemId: 'a', itemSince: 179000,
      processCapMs: 180000, itemCapMs: 45000,
    }), 'process-cap');
    eq(itemWatchDecision({
      started: 0, now: 45000, itemId: 'a', itemSince: 0,
      processCapMs: 180000, itemCapMs: 45000,
    }), 'item-cap');
    eq(itemWatchDecision({
      started: 0, now: 1000, itemId: '', itemSince: 0,
      processCapMs: 180000, itemCapMs: 45000,
    }), null);
  });

  test('hypotheses must be the 16 frozen ids as non-empty strings', () => {
    const set = tinySet();
    const rows = set.items.map((item) => ({ id: item.id, hypothesis: 'heard' }));
    const good = exactHypotheses(set.items, rows);
    eq(good.ok, true);
    eq(good.count, 16);
    const missing = exactHypotheses(set.items, rows.slice(1));
    eq(missing.ok, false);
    eq(missing.code, 'missing-id');
    eq(missing.rates, null);
    const dup = rows.map((row) => Object.assign({}, row));
    dup[1].id = dup[0].id;
    eq(exactHypotheses(set.items, dup).code, 'duplicate-id');
    const unknown = rows.map((row) => Object.assign({}, row));
    unknown[0].id = 'nope';
    eq(exactHypotheses(set.items, unknown).code, 'unknown-id');
    const blank = rows.map((row) => Object.assign({}, row));
    blank[0].hypothesis = '';
    eq(exactHypotheses(set.items, blank).code, 'hypothesis-type');
    const num = rows.map((row) => Object.assign({}, row));
    num[0].hypothesis = 1;
    eq(exactHypotheses(set.items, num).code, 'hypothesis-type');
  });

  test('a child exit 2 leaves no score and exit 0 without a file is not success', async () => {
    const set = tinySet();
    const audio = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-bin-'));
    writeAudio(audio, set);
    const setPath = path.join(audio, 'set.json');
    fs.writeFileSync(setPath, JSON.stringify(set));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-out-'));
    const failed = await runSaFile({
      setPath: setPath,
      audioCache: audio,
      outRoot: root,
      now: 1,
      nonce: 'exit2xxx',
      platform: 'darwin',
      swiftc: process.execPath,
      appleResult: false,
      compile: (outBin) => {
        fs.writeFileSync(outBin, '#!/usr/bin/env node\nprocess.exit(2);\n', { mode: 0o755 });
        return { code: 0, signal: null, cap: null };
      },
    });
    eq(failed.processExit, 2);
    eq(failed.code, 'recognition-failed');
    eq(failed.swiftExit, 2);
    eq(failed.rates, null);
    eq(failed.hypotheses, null);
    eq(fs.existsSync(path.join(failed.runDir, 'hypotheses.json')), false);
    const empty = await runSaFile({
      setPath: setPath,
      audioCache: audio,
      outRoot: root,
      now: 2,
      nonce: 'exit0xxx',
      platform: 'darwin',
      swiftc: process.execPath,
      appleResult: false,
      compile: (outBin) => {
        fs.writeFileSync(outBin, '#!/usr/bin/env node\nprocess.exit(0);\n', { mode: 0o755 });
        return { code: 0, signal: null, cap: null };
      },
    });
    eq(empty.processExit, 2);
    eq(empty.rates, null);
    eq(empty.hypotheses, null);
    eq(empty.code, 'incomplete-hypotheses');
  });

  test('a child that ignores SIGTERM is killed and is not a score', async () => {
    const set = tinySet();
    const audio = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-kill-'));
    writeAudio(audio, set);
    const setPath = path.join(audio, 'set.json');
    fs.writeFileSync(setPath, JSON.stringify(set));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-kout-'));
    const out = await runSaFile({
      setPath: setPath,
      audioCache: audio,
      outRoot: root,
      now: 3,
      nonce: 'killxxxx',
      platform: 'darwin',
      swiftc: process.execPath,
      appleResult: false,
      itemCapMs: 120,
      processCapMs: 5000,
      killGraceMs: 200,
      pollMs: 20,
      compile: (outBin) => {
        const body = [
          '#!/usr/bin/env node',
          'const fs=require("fs");',
          'const a=process.argv;',
          'const status=a[a.indexOf("--status-out")+1];',
          'fs.writeFileSync(require("path").join(require("path").dirname(status),"item-progress.json"),',
          'JSON.stringify({index:0,id:"stuck",stage:"item-start"}));',
          'process.on("SIGTERM",function(){});',
          'setInterval(function(){},1000);',
        ].join('\n');
        fs.writeFileSync(outBin, body + '\n', { mode: 0o755 });
        return { code: 0, signal: null, cap: null };
      },
    });
    eq(out.processExit, 2);
    eq(out.signal, 'SIGKILL');
    eq(out.swiftExit, null);
    eq(out.timedOut, true);
    eq(out.rates, null);
    eq(out.hypotheses, null);
    eq(out.appleResult, false);
  });

  test('a fixture success scores without claiming an Apple result, and a second run is separate', async () => {
    const set = tinySet();
    const audio = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-ok-'));
    writeAudio(audio, set);
    const setPath = path.join(audio, 'set.json');
    fs.writeFileSync(setPath, JSON.stringify(set));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-okout-'));
    const body = '#!/usr/bin/env node\n' + successBin() + '\n';
    const first = await runSaFile({
      setPath: setPath,
      audioCache: audio,
      outRoot: root,
      now: 4,
      nonce: 'firstxxx',
      platform: 'darwin',
      swiftc: process.execPath,
      appleResult: false,
      compile: (outBin) => {
        fs.writeFileSync(outBin, body, { mode: 0o755 });
        return { code: 0, signal: null, cap: null };
      },
    });
    eq(first.processExit, 0);
    eq(first.appleResult, false);
    eq(first.productMetric, false);
    eq(first.sameProductProcess, false);
    eq(first.endToEnd, false);
    eq(first.hypothesisCount, 16);
    eq(first.rates.en.metric, 'wer');
    eq(first.rates.zh.metric, 'cer');
    ok(fs.existsSync(path.join(first.runDir, 'evidence.tar.gz')));
    const listed = spawnSync('tar', ['-tzf', path.join(first.runDir, 'evidence.tar.gz')], { encoding: 'utf8' });
    eq(listed.status, 0);
    ok(listed.stdout.includes('hypotheses.json'));
    ok(listed.stdout.includes('score.json'));
    ok(listed.stdout.includes('MANIFEST.sha256'));
    ok(!listed.stdout.includes('.wav'));
    ok(!listed.stdout.includes('sa-file-bin'));
    const second = await runSaFile({
      setPath: setPath,
      audioCache: audio,
      outRoot: root,
      now: 5,
      nonce: 'secondxx',
      platform: 'darwin',
      swiftc: process.execPath,
      appleResult: false,
      compile: (outBin) => {
        fs.writeFileSync(outBin, body, { mode: 0o755 });
        return { code: 0, signal: null, cap: null };
      },
    });
    eq(second.processExit, 0);
    ok(first.runDir !== second.runDir);
    eq(fs.existsSync(path.join(first.runDir, 'hypotheses.json')), true);
    const again = JSON.parse(fs.readFileSync(path.join(first.runDir, 'run-summary.json'), 'utf8'));
    eq(again.hypothesisCount, 16);
  });

  test('preflight failure still archives evidence and is not an Apple result', async () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-empty-'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-empty-out-'));
    const missing = await runSaFile({
      setPath: path.join(ROOT, 'eval/baselines/asr/fleurs-public-v1.json'),
      audioCache: cache,
      outRoot: root,
      now: 11,
      nonce: 'missing1',
      platform: 'darwin',
      swiftc: process.execPath,
      appleResult: true,
    });
    eq(missing.processExit, 2);
    eq(missing.code, 'missing-audio');
    eq(missing.id, 'en_us/1660/12742373433258665797.wav');
    eq(missing.appleResult, false);
    eq(missing.platformEligible, true);
    eq(missing.appleExecutionStarted, false);
    eq(missing.recognitionCompleted, false);
    eq(missing.rates, null);
    const summary = JSON.parse(fs.readFileSync(path.join(missing.runDir, 'run-summary.json'), 'utf8'));
    eq(summary.appleResult, false);
    eq(summary.rates, null);
    eq(fs.existsSync(path.join(missing.runDir, 'MANIFEST.sha256')), true);
    eq(fs.existsSync(path.join(missing.runDir, 'evidence.tar.gz')), true);
    const text = fs.readFileSync(path.join(missing.runDir, 'run-summary.json'), 'utf8');
    ok(text.includes('/Users/') === false);
    ok(text.includes(cache) === false);
    const listed = spawnSync('tar', ['-tzf', path.join(missing.runDir, 'evidence.tar.gz')], { encoding: 'utf8' });
    ok(listed.stdout.includes('MANIFEST.sha256'));
    ok(listed.stdout.includes('.wav') === false);
    ok(listed.stdout.includes('sa-file-bin') === false);
    const bad = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/fleurs-public-v1.json'), 'utf8'));
    const audio = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-sum2-'));
    for (const item of bad.items) {
      const rel = cacheRelative(item.audioCache);
      const full = path.join(audio, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, Buffer.from('bytes-' + item.id));
    }
    bad.items[0].audioSha256 = '0'.repeat(64);
    const setPath = path.join(audio, 'set.json');
    fs.writeFileSync(setPath, JSON.stringify(bad));
    const summed = await runSaFile({
      setPath: setPath,
      audioCache: audio,
      outRoot: root,
      now: 12,
      nonce: 'sumfail1',
      platform: 'darwin',
      swiftc: process.execPath,
      appleResult: true,
    });
    eq(summed.code, 'checksum-mismatch');
    eq(summed.appleResult, false);
    eq(summed.rates, null);
    eq(fs.existsSync(path.join(summed.runDir, 'evidence.tar.gz')), true);
    eq(fs.existsSync(path.join(summed.runDir, 'MANIFEST.sha256')), true);
  });

  test('an archive failure does not leave a success summary', async () => {
    const set = tinySet();
    const audio = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-pack2-'));
    writeAudio(audio, set);
    const setPath = path.join(audio, 'set.json');
    fs.writeFileSync(setPath, JSON.stringify(set));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-pack2-out-'));
    let calls = 0;
    const packed = await runSaFile({
      setPath: setPath,
      audioCache: audio,
      outRoot: root,
      now: 13,
      nonce: 'packloop',
      platform: 'darwin',
      swiftc: process.execPath,
      appleResult: true,
      compile: (outBin) => {
        fs.writeFileSync(outBin, '#!/usr/bin/env node\n' + successBin() + '\n', { mode: 0o755 });
        return { code: 0, signal: null, cap: null };
      },
      writeArchive: () => { calls += 1; throw new Error('disk full'); },
    });
    eq(packed.processExit, 2);
    eq(packed.ok, false);
    eq(packed.code, 'evidence-pack-failed');
    eq(packed.rates, null);
    eq(packed.appleResult, false);
    ok(calls <= 2 && calls >= 1);
    const summary = JSON.parse(fs.readFileSync(path.join(packed.runDir, 'run-summary.json'), 'utf8'));
    eq(summary.ok, false);
    eq(summary.rates, null);
    eq(fs.existsSync(path.join(packed.runDir, 'score.json')), false);
  });

  test('compile failure and an evidence pack failure are not success', async () => {
    const set = tinySet();
    const audio = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-bad-'));
    writeAudio(audio, set);
    const setPath = path.join(audio, 'set.json');
    fs.writeFileSync(setPath, JSON.stringify(set));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-badout-'));
    const compiled = await runSaFile({
      setPath: setPath,
      audioCache: audio,
      outRoot: root,
      now: 6,
      nonce: 'compilex',
      platform: 'darwin',
      swiftc: process.execPath,
      appleResult: false,
      compile: () => ({ code: 1, signal: null, cap: null }),
    });
    eq(compiled.processExit, 2);
    eq(compiled.code, 'compile-failed');
    eq(compiled.rates, null);
    eq(compiled.swiftExit, 1);
    const packed = await runSaFile({
      setPath: setPath,
      audioCache: audio,
      outRoot: root,
      now: 7,
      nonce: 'packfail',
      platform: 'darwin',
      swiftc: process.execPath,
      appleResult: false,
      compile: (outBin) => {
        fs.writeFileSync(outBin, '#!/usr/bin/env node\n' + successBin() + '\n', { mode: 0o755 });
        return { code: 0, signal: null, cap: null };
      },
      writeArchive: () => { throw new Error('disk full'); },
    });
    eq(packed.processExit, 2);
    eq(packed.code, 'evidence-pack-failed');
    eq(packed.ok, false);
    eq(packed.rates, null);
    eq(JSON.parse(fs.readFileSync(path.join(packed.runDir, 'run-summary.json'), 'utf8')).ok, false);
  });

  test('linux tar members equal the whitelist, and an extra member is not success', async () => {
    const specLinux = tarCreateSpec('linux');
    const specMac = tarCreateSpec('darwin');
    eq(specLinux.env.COPYFILE_DISABLE, '1');
    eq(specMac.env.COPYFILE_DISABLE, '1');
    ok(specLinux.args.indexOf('--disable-copyfile') < 0);
    ok(specMac.args.indexOf('--disable-copyfile') >= 0);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-tar-'));
    fs.writeFileSync(path.join(dir, 'run-summary.json'), '{"ok":true}\n');
    fs.writeFileSync(path.join(dir, 'hypotheses.json'), '[{"id":"a"}]\n');
    const names = ['run-summary.json', 'hypotheses.json'];
    writeEvidenceArchive(dir, names);
    const listed = spawnSync('tar', ['-tzf', path.join(dir, 'evidence.tar.gz')], { encoding: 'utf8' });
    eq(listed.status, 0);
    const got = listed.stdout.split('\n').filter(Boolean).sort();
    eq(JSON.stringify(got), JSON.stringify(names.slice().sort()));
    ok(listed.stdout.includes('._') === false);
    const checked = verifyEvidenceArchive(path.join(dir, 'evidence.tar.gz'), names);
    eq(checked.ok, true);
    fs.writeFileSync(path.join(dir, '._run-summary.json'), Buffer.alloc(163, 1));
    const extraTar = path.join(dir, 'extra.tar.gz');
    const made = spawnSync('tar', ['-czf', extraTar, '-C', dir, 'run-summary.json', 'hypotheses.json', '._run-summary.json']);
    eq(made.status, 0);
    const bad = verifyEvidenceArchive(extraTar, names);
    eq(bad.ok, false);
    eq(bad.code, 'archive-members');
    fs.symlinkSync('run-summary.json', path.join(dir, 'link.json'));
    const linkTar = path.join(dir, 'link.tar.gz');
    const linked = spawnSync('tar', ['-czf', linkTar, '-C', dir, 'run-summary.json', 'link.json']);
    eq(linked.status, 0);
    const linkCheck = verifyEvidenceArchive(linkTar, ['run-summary.json', 'link.json']);
    eq(linkCheck.ok, false);
    eq(linkCheck.code, 'archive-type');
    const set = tinySet();
    const audio = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-extra-'));
    writeAudio(audio, set);
    const setPath = path.join(audio, 'set.json');
    fs.writeFileSync(setPath, JSON.stringify(set));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-extra-out-'));
    const slipped = await runSaFile({
      setPath: setPath,
      audioCache: audio,
      outRoot: root,
      now: 14,
      nonce: 'extramem',
      platform: 'darwin',
      swiftc: process.execPath,
      compile: (outBin) => {
        fs.writeFileSync(outBin, '#!/usr/bin/env node\n' + successBin() + '\n', { mode: 0o755 });
        return { code: 0, signal: null, cap: null };
      },
      writeArchive: (runDir, packNames) => {
        fs.writeFileSync(path.join(runDir, '._run-summary.json'), Buffer.alloc(163, 2));
        const args = ['-czf', path.join(runDir, 'evidence.tar.gz'), '-C', runDir].concat(packNames).concat(['._run-summary.json']);
        const result = spawnSync('tar', args, { encoding: 'utf8' });
        if (result.status !== 0) throw new Error(result.stderr || 'tar failed');
      },
    });
    eq(slipped.ok, false);
    eq(slipped.processExit, 2);
    eq(slipped.code, 'archive-members');
    eq(slipped.rates, null);
    const summary = JSON.parse(fs.readFileSync(path.join(slipped.runDir, 'run-summary.json'), 'utf8'));
    eq(summary.ok, false);
    eq(summary.rates, null);
  });

  test('pax headers fail and ustar keeps exactly the six files', () => {
    const six = [
      'run-summary.json', 'score.json', 'hypotheses.json',
      'child-stdout.txt', 'child-stderr.txt', 'MANIFEST.sha256',
    ];
    const specMac = tarCreateSpec('darwin');
    const specLinux = tarCreateSpec('linux');
    ok(specMac.args.indexOf('--format=ustar') >= 0);
    ok(specLinux.args.indexOf('--format=ustar') >= 0);
    ok(specMac.args.indexOf('--disable-copyfile') >= 0);
    ok(specLinux.args.indexOf('--disable-copyfile') < 0);
    eq(specMac.env.COPYFILE_DISABLE, '1');
    eq(specLinux.env.COPY_EXTENDED_ATTRIBUTES_DISABLE, '1');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-ustar-'));
    for (const name of six) fs.writeFileSync(path.join(dir, name), 'bytes-' + name + '\n');
    const env = Object.assign({}, process.env, specMac.env);
    const pax = path.join(dir, 'pax.tar.gz');
    const paxRun = spawnSync('bsdtar', [
      '--disable-copyfile', '--format', 'pax', '-czf', pax, '-C', dir,
    ].concat(six), { encoding: 'utf8', env: env });
    eq(paxRun.status, 0);
    const paxMembers = listArchiveMembers(pax);
    eq(paxMembers.members.length, 12);
    eq(paxMembers.members.filter((member) => member.typeflag === 'x').length, 6);
    ok(paxMembers.members.some((member) => member.name === 'PaxHeader/run-summary.json'));
    const rejected = verifyEvidenceArchive(pax, six, dir);
    eq(rejected.ok, false);
    eq(rejected.code, 'archive-members');
    const ustar = path.join(dir, 'ustar.tar.gz');
    const ustarRun = spawnSync('bsdtar', specMac.args.concat([ustar, '-C', dir]).concat(six), {
      encoding: 'utf8', env: env,
    });
    eq(ustarRun.status, 0);
    const ustarMembers = listArchiveMembers(ustar);
    eq(ustarMembers.members.length, 6);
    eq(ustarMembers.members.every((member) => member.typeflag === '0'), true);
    eq(verifyEvidenceArchive(ustar, six, dir).ok, true);
    const gnu = path.join(dir, 'gnu.tar.gz');
    const gnuRun = spawnSync('tar', specLinux.args.concat([gnu, '-C', dir]).concat(six), {
      encoding: 'utf8', env: Object.assign({}, process.env, specLinux.env),
    });
    eq(gnuRun.status, 0);
    eq(listArchiveMembers(gnu).members.length, 6);
    eq(verifyEvidenceArchive(gnu, six, dir).ok, true);
    fs.appendFileSync(path.join(dir, 'run-summary.json'), 'changed');
    eq(verifyEvidenceArchive(ustar, six, dir).code, 'archive-checksum');
    const longName = 'a'.repeat(120) + '.json';
    fs.writeFileSync(path.join(dir, longName), 'too-long');
    let longCode = '';
    try { writeEvidenceArchive(dir, [longName]); }
    catch (err) { longCode = err.code || err.message; }
    eq(longCode, 'archive-path');
    const kept = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-keep-'));
    const summary = '{"ok":true,"productMetric":false}\n';
    const score = '{"ok":true}\n';
    const hyp = '[{"id":"kept","hypothesis":"same"}]\n';
    fs.writeFileSync(path.join(kept, 'run-summary.json'), summary);
    fs.writeFileSync(path.join(kept, 'score.json'), score);
    fs.writeFileSync(path.join(kept, 'hypotheses.json'), hyp);
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-tar-bin-'));
    fs.writeFileSync(path.join(bin, 'tar'), [
      '#!/usr/bin/env node',
      'const {spawnSync}=require("child_process");',
      'const args=process.argv.slice(2).filter(function(arg){return arg!=="--format=ustar";});',
      'args.unshift("--format=pax");',
      'const result=spawnSync("bsdtar", args, {stdio:"inherit"});',
      'process.exit(result.status==null?1:result.status);',
      '',
    ].join('\n'), { mode: 0o755 });
    const packed = spawnSync(process.execPath, [
      path.join(ROOT, 'eval/baselines/asr/run-sa-file.js'), '--pack-existing', kept,
    ], {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { PATH: bin + path.delimiter + process.env.PATH }),
    });
    eq(packed.status, 2);
    const body = JSON.parse(packed.stdout);
    eq(body.ok, false);
    eq(body.code, 'archive-members');
    eq(body.rates, null);
    eq(fs.readFileSync(path.join(kept, 'run-summary.json'), 'utf8'), summary);
    eq(fs.readFileSync(path.join(kept, 'score.json'), 'utf8'), score);
    eq(fs.readFileSync(path.join(kept, 'hypotheses.json'), 'utf8'), hyp);
    eq(fs.existsSync(path.join(kept, 'evidence.tar.gz')), false);
  });

  test('repack uses only files already present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-repack-'));
    const summary = { ok: true, rates: { en: { errors: 1, length: 2 } }, productMetric: false };
    fs.writeFileSync(path.join(dir, 'run-summary.json'), JSON.stringify(summary));
    const missing = packExisting(dir);
    eq(missing.ok, false);
    eq(missing.code, 'missing-evidence-file');
    eq(fs.existsSync(path.join(dir, 'score.json')), false);
    eq(fs.existsSync(path.join(dir, 'hypotheses.json')), false);
    eq(fs.existsSync(path.join(dir, 'evidence.tar.gz')), false);
    const hyp = '[{"id":"kept"}]\n';
    const score = '{"ok":true,"rates":null}\n';
    fs.writeFileSync(path.join(dir, 'hypotheses.json'), hyp);
    fs.writeFileSync(path.join(dir, 'score.json'), score);
    const packed = packExisting(dir);
    eq(packed.ok, true);
    eq(fs.readFileSync(path.join(dir, 'hypotheses.json'), 'utf8'), hyp);
    eq(fs.readFileSync(path.join(dir, 'score.json'), 'utf8'), score);
    eq(fs.readFileSync(path.join(dir, 'run-summary.json'), 'utf8'), JSON.stringify(summary));
    const listed = spawnSync('tar', ['-tzf', path.join(dir, 'evidence.tar.gz')], { encoding: 'utf8' });
    const got = listed.stdout.split('\n').filter(Boolean).sort();
    eq(JSON.stringify(got), JSON.stringify(['MANIFEST.sha256', 'hypotheses.json', 'run-summary.json', 'score.json']));
    ok(listed.stdout.includes('._') === false);
  });

  test('archive membership rejects audio, binaries, and secrets', () => {
    eq(archiveAllowed(['run-summary.json', 'hypotheses.json', 'score.json']).ok, true);
    eq(archiveAllowed(['clip.wav']).ok, false);
    eq(archiveAllowed(['.env']).ok, false);
    eq(archiveAllowed(['sa-file-bin']).ok, false);
    eq(archiveAllowed(['/Users/me/run-summary.json']).ok, false);
    eq(redactText('saw /Users/me/a.wav and /home/me/b'), 'saw <path> and <path>');
  });

  test('the standalone bundle lists scripts only', () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-pack-'));
    const built = buildBundle(path.join(dest, 'sa-file-bundle'));
    const manifest = fs.readFileSync(path.join(built.dir, 'MANIFEST.sha256'), 'utf8').trim().split('\n');
    eq(manifest.length, built.files.length - 1);
    for (const line of manifest) {
      const name = line.slice(66);
      const body = fs.readFileSync(path.join(built.dir, name));
      const crypto = require('crypto');
      eq(crypto.createHash('sha256').update(body).digest('hex'), line.slice(0, 64));
      ok(!name.endsWith('.wav'));
    }
    ok(fs.readFileSync(path.join(built.dir, 'README.md'), 'utf8').includes('node run-sa-file.js --audio-cache'));
  });

  test('the file transcriber has no in-process task-group deadline', () => {
    const src = fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/product-asr-mac.swift'), 'utf8');
    const body = src.slice(src.indexOf('static func transcribe'), src.indexOf('static func writeFirstClipDiagnostic'));
    ok(body.includes('analyzer.finalizeAndFinish(through: through)'));
    ok(body.includes('withThrowingTaskGroup') === false);
    ok(body.includes('45_000_000_000') === false);
    ok(src.includes('item-progress.json'));
  });
});
