'use strict';

// Text intake for FLEURS readings that are not in the frozen 16.
// Official references only. Audio stays in the gitignored cache.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { parseTsv, selectDisjointPairs } = require('./select.js');

const ROOT = path.join(__dirname, '..', '..', '..');
const FROZEN = path.join(__dirname, 'fleurs-public-v1.json');
const OUT = path.join(__dirname, 'public-candidates-v1.json');
const CACHE = path.join(__dirname, '.cache');
const TEXT_TIMEOUT_MS = 20000;
const TEXT_ATTEMPTS = 2;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function safeAudioName(name) {
  return typeof name === 'string' && /^[0-9]+\.wav$/.test(name) && !name.includes('..') && !path.isAbsolute(name);
}

function checkCached(file, expectedSha, expectedBytes) {
  if (!fs.existsSync(file)) return { ok: false, code: 'missing-cache', rates: null, productMetric: false };
  const buf = fs.readFileSync(file);
  if (buf.length !== expectedBytes || sha256(buf) !== expectedSha) {
    return { ok: false, code: 'checksum-mismatch', rates: null, productMetric: false };
  }
  return { ok: true, code: 'ok', rates: null, productMetric: false };
}

function recordFailure(dir, summary) {
  fs.mkdirSync(dir, { recursive: true });
  const body = Object.assign({
    ok: false,
    rates: null,
    productMetric: false,
    e2eMetric: null,
    synthetic: false,
  }, summary, { rates: null, productMetric: false, e2eMetric: null });
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(body, null, 2) + '\n');
  const line = sha256(fs.readFileSync(path.join(dir, 'summary.json'))) + '  summary.json\n';
  fs.writeFileSync(path.join(dir, 'MANIFEST.sha256'), line);
  return body;
}

function itemRecord(lang, config, row) {
  if (!safeAudioName(row.audioName)) {
    const err = new Error('audio-name');
    err.code = 'audio-path';
    throw err;
  }
  const reference = row.normalized;
  const raw = row.raw;
  return {
    id: config + '/' + row.sentenceId + '/' + row.audioName,
    lang: lang,
    config: config,
    sentenceId: String(row.sentenceId),
    audioName: row.audioName,
    raw: raw,
    reference: reference,
    rawSha256: sha256(Buffer.from(raw, 'utf8')),
    referenceSha256: sha256(Buffer.from(reference, 'utf8')),
    numSamples: row.numSamples,
    speakerLabel: row.speakerLabel,
    alignment: 'shared-flores-sentence-id',
    humanReviewed: false,
    audioInGit: false,
    audioSha256: null,
  };
}

function buildFromTexts(enText, zhText, excludedIds) {
  const selected = selectDisjointPairs(parseTsv(enText), parseTsv(zhText), excludedIds, 15);
  const items = [];
  for (let i = 0; i < selected.pairs.length; i++) {
    const pair = selected.pairs[i];
    items.push(itemRecord('en', 'en_us', pair.en));
    items.push(itemRecord('zh', 'cmn_hans_cn', pair.zh));
  }
  return { selected: selected, items: items };
}

function frozenExcluded(set) {
  return set.items.map((item) => String(item.sentenceId));
}

function manifestFrom(set, enText, zhText, audio) {
  const built = buildFromTexts(enText, zhText, frozenExcluded(set));
  return {
    schema: 'belliedmonkey.public-candidate-set.v1',
    id: 'fleurs-public-candidates-v1',
    kind: 'public-candidate',
    productMetric: false,
    notAUserFailureSet: true,
    notAnEndToEndBaseline: true,
    synthetic: false,
    humanVerified: false,
    humanVerifiedCount: 0,
    approvedPlannedSetCount: 0,
    realFailureCount: 0,
    publicCandidateCount: built.items.length,
    alignedPairCount: built.selected.pairs.length,
    alignment: 'shared-flores-sentence-id',
    alignmentNote: 'The same FLEURS sentence id is the publisher id for one FLORES sentence. It is not a time alignment and it was not reviewed by a person here.',
    license: { spdx: set.license.spdx, sameRecord: 'eval/baselines/asr/fleurs-public-v1.json' },
    attribution: {
      dataset: set.attribution.dataset,
      revision: set.attribution.revision,
      split: 'test',
    },
    sourceFiles: set.sourceFiles,
    selection: {
      excludedSentenceIds: [...new Set(frozenExcluded(set))].sort((a, b) => Number(a) - Number(b)),
      pairLimit: 15,
      rule: 'Skip sentence ids used by fleurs-public-v1.json. Keep a sentence id only when both en_us and cmn_hans_cn have a readable row. Sort by sentence id and take the next 15. One wav name per id per language, the first name in sort order.',
    },
    buckets: built.selected.buckets,
    audio: audio || { inGit: false, fetched: false, reason: 'not-requested' },
    items: built.items,
  };
}

function checkAudioSidecar(cacheRoot) {
  const side = JSON.parse(fs.readFileSync(path.join(__dirname, 'public-candidates-audio-v1.json'), 'utf8'));
  if (!Array.isArray(side.items) || side.items.length !== 2) {
    return { ok: false, code: 'audio-sidecar', rates: null, productMetric: false };
  }
  for (const row of side.items) {
    if (!safeAudioName(row.audioName) || (row.config !== 'en_us' && row.config !== 'cmn_hans_cn')) {
      return { ok: false, code: 'audio-path', rates: null, productMetric: false };
    }
    const file = path.join(cacheRoot, row.config, row.audioName);
    const cached = checkCached(file, row.sha256, row.bytes);
    if (!cached.ok) return cached;
  }
  return { ok: true, code: 'ok', rates: null, productMetric: false, count: side.items.length };
}

function summarizeCandidates() {
  const body = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  return {
    humanVerifiedCount: body.humanVerifiedCount,
    approvedPlannedSetCount: body.approvedPlannedSetCount,
    realFailureCount: body.realFailureCount,
    publicCandidateCount: body.publicCandidateCount,
    synthetic: body.synthetic,
    productMetric: body.productMetric,
    buckets: body.buckets,
  };
}

function getText(url, timeoutMs, hops) {
  const left = hops == null ? 2 : hops;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'belliedmonkey-baseline-fetch' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (left <= 0) {
          reject(new Error('redirect'));
          return;
        }
        resolve(getText(new URL(res.headers.location, url).href, timeoutMs, left - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    const timer = setTimeout(() => req.destroy(new Error('timeout after ' + timeoutMs + ' ms')), timeoutMs);
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.on('close', () => clearTimeout(timer));
  });
}

function cacheName(rel) {
  if (rel.includes('..') || path.isAbsolute(rel)) {
    const err = new Error('cache-path');
    err.code = 'cache-path';
    throw err;
  }
  return path.join(CACHE, rel.replace(/\//g, '__'));
}

async function loadSource(file, revision, offline) {
  const dest = cacheName(file.path);
  const cached = checkCached(dest, file.sha256, file.bytes);
  if (cached.ok) return fs.readFileSync(dest);
  if (offline) {
    const err = new Error(cached.code);
    err.code = cached.code;
    throw err;
  }
  const url = 'https://huggingface.co/datasets/google/fleurs/resolve/' + revision + '/' + file.path;
  let last = null;
  for (let attempt = 1; attempt <= TEXT_ATTEMPTS; attempt++) {
    try {
      const buf = await getText(url, TEXT_TIMEOUT_MS);
      if (buf.length !== file.bytes || sha256(buf) !== file.sha256) {
        throw new Error('checksum-mismatch');
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const partial = dest + '.partial';
      fs.writeFileSync(partial, buf);
      if (sha256(fs.readFileSync(partial)) !== file.sha256) {
        fs.unlinkSync(partial);
        throw new Error('checksum-mismatch');
      }
      fs.renameSync(partial, dest);
      return buf;
    } catch (err) {
      last = err;
    }
  }
  const err = new Error(last && last.message ? last.message : 'fetch-failed');
  err.code = 'fetch-failed';
  throw err;
}

async function main(argv) {
  const offline = argv.includes('--offline');
  const set = JSON.parse(fs.readFileSync(FROZEN, 'utf8'));
  const receiptDir = path.join(CACHE, 'public-candidates-receipt');
  try {
    const texts = {};
    for (const file of set.sourceFiles) texts[file.path] = await loadSource(file, set.attribution.revision, offline);
    const built = manifestFrom(
      set,
      texts['data/en_us/test.tsv'].toString('utf8'),
      texts['data/cmn_hans_cn/test.tsv'].toString('utf8'),
      { inGit: false, fetched: false, reason: 'text-only' },
    );
    if (!fs.existsSync(OUT)) {
      fs.writeFileSync(OUT, JSON.stringify(built, null, 2) + '\n');
    }
    const committed = fs.readFileSync(OUT, 'utf8');
    const again = JSON.stringify(built, null, 2) + '\n';
    if (committed !== again) {
      recordFailure(receiptDir, { ok: false, code: 'manifest-drift', rates: null, productMetric: false });
      console.log(JSON.stringify({ ok: false, code: 'manifest-drift', rates: null, productMetric: false }));
      process.exit(2);
    }
    const audio = checkAudioSidecar(path.join(CACHE, 'public-candidates'));
    if (!audio.ok) {
      recordFailure(receiptDir, { ok: false, code: audio.code, rates: null, productMetric: false });
      console.log(JSON.stringify({ ok: false, code: audio.code, rates: null, productMetric: false }));
      process.exit(2);
    }
    const summary = {
      ok: true,
      code: offline ? 'offline-ok' : 'fetch-ok',
      rates: null,
      productMetric: false,
      e2eMetric: null,
      publicCandidateCount: built.publicCandidateCount,
      alignedPairCount: built.alignedPairCount,
      humanVerifiedCount: 0,
      approvedPlannedSetCount: 0,
      realFailureCount: 0,
      audioCacheChecked: true,
      audioCount: audio.count,
    };
    recordFailure(receiptDir, summary);
    console.log(JSON.stringify(summary));
  } catch (err) {
    const code = err && err.code ? err.code : 'fetch-failed';
    const summary = recordFailure(receiptDir, { ok: false, code: code, rates: null, productMetric: false });
    console.log(JSON.stringify(summary));
    process.exit(2);
  }
}

if (require.main === module) main(process.argv);

module.exports = {
  checkCached, safeAudioName, summarizeCandidates, recordFailure, manifestFrom, buildFromTexts,
  checkAudioSidecar,
};
