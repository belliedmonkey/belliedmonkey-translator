'use strict';

// Text intake for FLEURS readings that are not in the frozen 16.
// Official references only. Audio stays in the gitignored cache.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { parseTsv, selectDisjointPairs } = require('./select.js');
const { streamWanted } = require('./fetch-fleurs.js');
const { wavInfo } = require('./wav-info.js');

const ROOT = path.join(__dirname, '..', '..', '..');
const FROZEN = path.join(__dirname, 'fleurs-public-v1.json');
const OUT = path.join(__dirname, 'public-candidates-v1.json');
const CACHE = path.join(__dirname, '.cache');
const TEXT_TIMEOUT_MS = 20000;
const TEXT_ATTEMPTS = 2;
const AUDIO_SCOPE = 30;
const AUDIO_ATTEMPTS = 2;
const AUDIO_TIMEOUT_MS = 360000;
const AUDIO_BYTE_CAP = 1024 * 1024 * 1024;
const TEXT_SHA256 = 'b6ce867665cb7fb53fe54485ab32f8ac9d07e0bfce3283b6c8d4651fc5f0733f';
const PINNED_AUDIO = {
  'en_us/12519810849995407480.wav': 'd6ab97bb7e3232b60b61910d3ac7e1cf37acbcbfd062773b453c76217682f49e',
  'cmn_hans_cn/14773716009564433047.wav': '7b95a45446dc31d99d50232a7a6dbda26cc9c87eb26aec1263f73e7f9dd6405f',
};
const REVISION = '70bb2e84b976b7e960aa89f1c648e09c59f894dd';

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

function audioKey(row) {
  return row.config + '/' + row.audioName;
}

function audioCoverage(textItems, sidecarItems) {
  const side = Array.isArray(sidecarItems) ? sidecarItems : [];
  if (!Array.isArray(textItems) || textItems.length !== AUDIO_SCOPE) {
    return { ok: false, code: 'audio-scope', audioScope: AUDIO_SCOPE, audioCount: side.length, rates: null, productMetric: false };
  }
  const want = new Set(textItems.map((item) => audioKey(item) + '/' + item.sentenceId));
  const got = new Set(side.map((item) => audioKey(item) + '/' + item.sentenceId));
  if (side.length !== AUDIO_SCOPE || want.size !== AUDIO_SCOPE || got.size !== AUDIO_SCOPE) {
    return { ok: false, code: 'audio-incomplete', audioScope: AUDIO_SCOPE, audioCount: side.length, rates: null, productMetric: false };
  }
  for (const key of want) {
    if (!got.has(key)) {
      return { ok: false, code: 'audio-incomplete', audioScope: AUDIO_SCOPE, audioCount: side.length, rates: null, productMetric: false };
    }
  }
  return { ok: true, code: 'ok', audioScope: AUDIO_SCOPE, audioCount: AUDIO_SCOPE, rates: null, productMetric: false };
}

function verifyAudioFiles(cacheRoot, rows) {
  if (!Array.isArray(rows) || rows.length !== AUDIO_SCOPE) {
    return { ok: false, code: 'audio-scope', audioScope: AUDIO_SCOPE, audioCount: 0, rates: null, productMetric: false };
  }
  let audioCount = 0;
  for (const row of rows) {
    if (!safeAudioName(row.audioName) || (row.config !== 'en_us' && row.config !== 'cmn_hans_cn')) {
      return { ok: false, code: 'audio-path', audioScope: AUDIO_SCOPE, audioCount, rates: null, productMetric: false };
    }
    const cached = checkCached(path.join(cacheRoot, row.config, row.audioName), row.sha256, row.bytes);
    if (!cached.ok) return Object.assign({}, cached, { audioScope: AUDIO_SCOPE, audioCount });
    audioCount += 1;
  }
  return { ok: true, code: 'ok', audioScope: AUDIO_SCOPE, audioCount, rates: null, productMetric: false };
}

function mergeSidecar(previous, measured) {
  const prevItems = previous && Array.isArray(previous.items) ? previous.items : [];
  const prevByKey = new Map(prevItems.map((item) => [audioKey(item), item]));
  const items = [];
  for (const row of measured) {
    const old = prevByKey.get(audioKey(row));
    if (old) {
      if (old.sha256 !== row.sha256 || old.bytes !== row.bytes) {
        const err = new Error('hash-pin');
        err.code = 'hash-pin';
        throw err;
      }
      items.push(old);
    } else {
      items.push(row);
    }
  }
  return Object.assign({}, previous, { items: items });
}

function publishSidecar(dest, body, mode) {
  if (mode !== 'freeze') return false;
  const partial = dest + '.partial';
  fs.writeFileSync(partial, JSON.stringify(body, null, 2) + '\n');
  const written = fs.readFileSync(partial, 'utf8');
  if (written !== JSON.stringify(body, null, 2) + '\n') {
    fs.unlinkSync(partial);
    return false;
  }
  fs.renameSync(partial, dest);
  return true;
}

function publicCandidateCache(dir) {
  const resolved = path.resolve(String(dir || ''));
  const frozen = path.resolve(path.join(__dirname, '.cache', 'audio'));
  if (resolved === frozen || resolved.startsWith(frozen + path.sep) || String(dir || '').includes('..')) {
    return { ok: false, code: 'cache-mix', rates: null, productMetric: false };
  }
  return { ok: true, code: 'ok', cache: resolved, rates: null, productMetric: false };
}

function checkAudioSidecar(cacheRoot, sidecarPath) {
  const text = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const side = JSON.parse(fs.readFileSync(sidecarPath || path.join(__dirname, 'public-candidates-audio-v1.json'), 'utf8'));
  const coverage = audioCoverage(text.items, side.items);
  if (!coverage.ok) return coverage;
  return verifyAudioFiles(cacheRoot, side.items);
}

function audioTotals(items) {
  let totalBytes = 0;
  let totalDurationSeconds = 0;
  for (const item of items) {
    totalBytes += item.bytes;
    totalDurationSeconds += item.durationSeconds;
  }
  return {
    totalBytes: totalBytes,
    totalDurationSeconds: Math.round(totalDurationSeconds * 1000) / 1000,
  };
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

function selectedCache(argv) {
  const index = argv.indexOf('--cache');
  if (index >= 0 && (!argv[index + 1] || String(argv[index + 1]).startsWith('--'))) {
    const err = new Error('cache-path');
    err.code = 'cache-path';
    throw err;
  }
  const chosen = index >= 0 ? argv[index + 1] : path.join(CACHE, 'public-candidates');
  const gate = publicCandidateCache(chosen);
  if (!gate.ok) {
    const err = new Error(gate.code);
    err.code = gate.code;
    throw err;
  }
  return gate.cache;
}

function sidecarDocument(previous, merged, archives, text) {
  return {
    schema: 'belliedmonkey.public-candidate-audio.v1',
    inGit: false,
    cache: 'eval/baselines/asr/.cache/public-candidates',
    revision: REVISION,
    scope: AUDIO_SCOPE,
    note: 'Thirty FLEURS test readings, sentence ids 1668-1682, outside the frozen 16. The wav files stay in this cache and are not the frozen 16 cache. Read speech only. Not accent, noise, code-switch, or dialogue. Not human-reviewed.',
    license: text.license,
    source: {
      dataset: 'google/fleurs',
      revision: REVISION,
      split: 'test',
      archives: archives,
    },
    items: merged.items,
  };
}

async function streamArchive(config, names) {
  const rel = 'data/' + config + '/audio/test.tar.gz';
  const url = 'https://huggingface.co/datasets/google/fleurs/resolve/' + REVISION + '/' + rel;
  let last = null;
  for (let attempt = 1; attempt <= AUDIO_ATTEMPTS; attempt++) {
    const budget = { used: 0, cap: AUDIO_BYTE_CAP };
    let response = null;
    try {
      const got = await streamWanted(url, names, budget, AUDIO_TIMEOUT_MS, {
        onResponse(info) { response = info; },
      });
      let responseHost = null;
      if (response && response.url) {
        responseHost = new URL(response.url).host;
      }
      return {
        found: got.found,
        source: {
          path: rel,
          requestedUrl: url,
          revision: REVISION,
          status: response ? response.status : null,
          responseHost: responseHost,
          etag: response ? response.etag : null,
          contentLength: response ? response.contentLength : null,
          contentType: response ? response.contentType : null,
          compressedBytesRead: budget.used,
        },
      };
    } catch (err) {
      last = err;
    }
  }
  const err = new Error(config + ': ' + ((last && last.message) || 'fetch-failed'));
  err.code = 'fetch-failed';
  throw err;
}

async function freezeAudio(cacheRoot, text, previous) {
  const byKey = new Map((previous.items || []).map((item) => [audioKey(item), item]));
  const needed = { en_us: [], cmn_hans_cn: [] };
  let cacheHits = 0;
  for (const item of text.items) {
    const key = audioKey(item);
    const old = byKey.get(key);
    const file = path.join(cacheRoot, item.config, item.audioName);
    if (old && checkCached(file, old.sha256, old.bytes).ok) {
      cacheHits += 1;
      continue;
    }
    if (old) {
      const err = new Error(key);
      err.code = fs.existsSync(file) ? 'checksum-mismatch' : 'missing-cache';
      throw err;
    }
    needed[item.config].push(item);
  }
  const fresh = new Map();
  const archives = [];
  for (const config of ['en_us', 'cmn_hans_cn']) {
    if (!needed[config].length) continue;
    console.error('streaming ' + config + ' ' + needed[config].length);
    const streamed = await streamArchive(config, needed[config].map((item) => item.audioName));
    archives.push(streamed.source);
    for (const item of needed[config]) {
      const buf = streamed.found.get(item.audioName);
      if (!buf) {
        const err = new Error(item.audioName);
        err.code = 'missing-audio';
        throw err;
      }
      const info = wavInfo(buf);
      if (!info || info.sampleRate !== 16000 || info.samples !== Number(item.numSamples)) {
        const err = new Error(item.id || item.audioName);
        err.code = 'wav-mismatch';
        throw err;
      }
      const digest = sha256(buf);
      if (PINNED_AUDIO[audioKey(item)] && PINNED_AUDIO[audioKey(item)] !== digest) {
        const err = new Error(audioKey(item));
        err.code = 'hash-pin';
        throw err;
      }
      const dest = path.join(cacheRoot, item.config, item.audioName);
      const root = path.resolve(cacheRoot);
      if (!path.resolve(dest).startsWith(root + path.sep)) {
        const err = new Error(dest);
        err.code = 'audio-path';
        throw err;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const partial = dest + '.partial';
      fs.writeFileSync(partial, buf);
      if (sha256(fs.readFileSync(partial)) !== digest) {
        fs.unlinkSync(partial);
        const err = new Error(item.audioName);
        err.code = 'checksum-mismatch';
        throw err;
      }
      fs.renameSync(partial, dest);
      fresh.set(audioKey(item), {
        sentenceId: String(item.sentenceId),
        config: item.config,
        audioName: item.audioName,
        bytes: buf.length,
        sha256: digest,
        sampleRate: info.sampleRate,
        channels: info.channels,
        bitsPerSample: info.bitsPerSample,
        samples: info.samples,
        durationSeconds: Math.round((info.samples / info.sampleRate) * 1000) / 1000,
      });
    }
  }
  const ordered = [];
  for (const item of text.items) {
    const row = fresh.get(audioKey(item)) || byKey.get(audioKey(item));
    if (!row) {
      const err = new Error(audioKey(item));
      err.code = 'missing-audio';
      throw err;
    }
    ordered.push(row);
  }
  const merged = mergeSidecar(previous, ordered);
  for (const key of Object.keys(PINNED_AUDIO)) {
    const row = merged.items.find((item) => audioKey(item) === key);
    if (!row || row.sha256 !== PINNED_AUDIO[key]) {
      const err = new Error(key);
      err.code = 'hash-pin';
      throw err;
    }
  }
  const coverage = audioCoverage(text.items, merged.items);
  if (!coverage.ok) {
    const err = new Error(coverage.code);
    err.code = coverage.code;
    throw err;
  }
  const checked = verifyAudioFiles(cacheRoot, merged.items);
  if (!checked.ok) {
    const err = new Error(checked.code);
    err.code = checked.code;
    throw err;
  }
  return { merged: merged, archives: archives, cacheHits: cacheHits, fetchedNew: fresh.size };
}

function finish(receiptDir, summary) {
  recordFailure(receiptDir, summary);
  console.log(JSON.stringify(summary));
  if (!summary.ok) process.exit(2);
}

async function main(argv) {
  const offline = argv.includes('--offline');
  const freeze = argv.includes('--freeze-audio');
  let cacheRoot = path.join(CACHE, 'public-candidates');
  let receiptDir = path.join(CACHE, 'public-candidates-receipt');
  try {
    cacheRoot = selectedCache(argv);
    receiptDir = path.join(path.dirname(cacheRoot), path.basename(cacheRoot) + '-receipt');
    if (freeze && offline) {
      const err = new Error('freeze-offline');
      err.code = 'freeze-offline';
      throw err;
    }
    if (sha256(fs.readFileSync(OUT)) !== TEXT_SHA256) {
      const err = new Error('text-pin');
      err.code = 'text-pin';
      throw err;
    }
    const set = JSON.parse(fs.readFileSync(FROZEN, 'utf8'));
    if (set.attribution.revision !== REVISION) {
      const err = new Error('revision');
      err.code = 'revision';
      throw err;
    }
    const texts = {};
    for (const file of set.sourceFiles) texts[file.path] = await loadSource(file, set.attribution.revision, offline);
    const built = manifestFrom(
      set,
      texts['data/en_us/test.tsv'].toString('utf8'),
      texts['data/cmn_hans_cn/test.tsv'].toString('utf8'),
      { inGit: false, fetched: false, reason: 'text-only' },
    );
    const committed = fs.readFileSync(OUT, 'utf8');
    if (committed !== JSON.stringify(built, null, 2) + '\n') {
      finish(receiptDir, { ok: false, code: 'manifest-drift', audioScope: AUDIO_SCOPE, rates: null, productMetric: false });
      return;
    }
    const sidecarPath = path.join(__dirname, 'public-candidates-audio-v1.json');
    const before = fs.readFileSync(sidecarPath, 'utf8');
    if (!freeze) {
      const audio = checkAudioSidecar(cacheRoot, sidecarPath);
      if (fs.readFileSync(sidecarPath, 'utf8') !== before) {
        const err = new Error('sidecar-write');
        err.code = 'sidecar-write';
        throw err;
      }
      if (!audio.ok) {
        finish(receiptDir, {
          ok: false,
          code: audio.code,
          audioScope: AUDIO_SCOPE,
          audioCount: audio.audioCount,
          rates: null,
          productMetric: false,
        });
        return;
      }
      const side = JSON.parse(before);
      finish(receiptDir, Object.assign({
        ok: true,
        code: offline ? 'offline-ok' : 'verify-ok',
        rates: null,
        productMetric: false,
        e2eMetric: null,
        publicCandidateCount: built.publicCandidateCount,
        alignedPairCount: built.alignedPairCount,
        humanVerifiedCount: 0,
        approvedPlannedSetCount: 0,
        realFailureCount: 0,
        audioScope: AUDIO_SCOPE,
        audioCacheChecked: true,
        audioCount: audio.audioCount,
        cacheHits: audio.audioCount,
        fetchedNew: 0,
        textSha256: TEXT_SHA256,
      }, audioTotals(side.items)));
      return;
    }
    const previous = JSON.parse(before);
    const frozen = await freezeAudio(cacheRoot, built, previous);
    if (frozen.fetchedNew === 0) {
      if (fs.readFileSync(sidecarPath, 'utf8') !== before) {
        const err = new Error('sidecar-write');
        err.code = 'sidecar-write';
        throw err;
      }
      const side = JSON.parse(before);
      finish(receiptDir, Object.assign({
        ok: true,
        code: 'freeze-unchanged',
        rates: null,
        productMetric: false,
        e2eMetric: null,
        humanVerifiedCount: 0,
        approvedPlannedSetCount: 0,
        realFailureCount: 0,
        audioScope: AUDIO_SCOPE,
        audioCount: side.items.length,
        cacheHits: frozen.cacheHits,
        fetchedNew: 0,
        textSha256: TEXT_SHA256,
      }, audioTotals(side.items)));
      return;
    }
    const body = sidecarDocument(previous, frozen.merged, frozen.archives, built);
    if (!publishSidecar(sidecarPath, body, 'freeze')) {
      const err = new Error('sidecar-write');
      err.code = 'sidecar-write';
      throw err;
    }
    if (sha256(fs.readFileSync(OUT)) !== TEXT_SHA256) {
      const err = new Error('text-pin');
      err.code = 'text-pin';
      throw err;
    }
    const published = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    for (const key of Object.keys(PINNED_AUDIO)) {
      const row = published.items.find((item) => audioKey(item) === key);
      if (!row || row.sha256 !== PINNED_AUDIO[key]) {
        const err = new Error(key);
        err.code = 'hash-pin';
        throw err;
      }
    }
    finish(receiptDir, Object.assign({
      ok: true,
      code: 'freeze-ok',
      rates: null,
      productMetric: false,
      e2eMetric: null,
      publicCandidateCount: built.publicCandidateCount,
      alignedPairCount: built.alignedPairCount,
      humanVerifiedCount: 0,
      approvedPlannedSetCount: 0,
      realFailureCount: 0,
      audioScope: AUDIO_SCOPE,
      audioCacheChecked: true,
      audioCount: published.items.length,
      cacheHits: frozen.cacheHits,
      fetchedNew: frozen.fetchedNew,
      textSha256: TEXT_SHA256,
    }, audioTotals(published.items)));
  } catch (err) {
    const code = err && err.code ? err.code : 'fetch-failed';
    finish(receiptDir, {
      ok: false,
      code: code,
      audioScope: AUDIO_SCOPE,
      rates: null,
      productMetric: false,
    });
  }
}

if (require.main === module) main(process.argv);

module.exports = {
  checkCached, safeAudioName, summarizeCandidates, recordFailure, manifestFrom, buildFromTexts,
  checkAudioSidecar, audioCoverage, verifyAudioFiles, mergeSidecar, publishSidecar, publicCandidateCache,
};
