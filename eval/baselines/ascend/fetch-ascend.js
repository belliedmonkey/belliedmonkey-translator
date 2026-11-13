'use strict';

// Small ASCEND test-split intake. Text screening only. Audio stays in the cache.

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawnSync } = require('child_process');
const { checkCached, recordFailure } = require('../asr/fetch-public-candidates.js');
const { wavInfo } = require('../asr/wav-info.js');

const CARD_REVISION = '737e9800ae31be9932ba8464c80366559bd28424';
const PARQUET_SHA256 = 'a4c81d2b5ed6124f052089a695972808c16e0ce0c365ec9773c5d1a8fcf043a7';
const PARQUET_BYTES = 105756434;
const PARQUET_URL = 'https://huggingface.co/datasets/CAiRE/ASCEND/resolve/'
  + CARD_REVISION + '/main/test-00000-of-00001.parquet';
const BYTE_CAP = Math.floor(1.5 * 1024 * 1024 * 1024);
const ATTEMPTS = 2;
const TIMEOUT_MS = 180000;
const CACHE = path.join(__dirname, '.cache');
const MANIFEST_PATH = path.join(__dirname, 'ascend-test-v1.json');
const LICENSE = {
  spdx: 'CC-BY-SA-4.0',
  url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  source: 'CAiRE/ASCEND dataset card, Licensing Information, at the pinned card revision',
};

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function codeSwitchText(text) {
  const value = String(text || '');
  return /\p{Script=Han}/u.test(value) && /[A-Za-z]/.test(value);
}

function selectCandidates(rows, limit) {
  const n = limit == null ? 6 : limit;
  const kept = (rows || []).filter((row) => row && codeSwitchText(row.transcription));
  kept.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const items = kept.slice(0, n);
  return {
    items: items,
    textScreenCount: items.length,
    humanVerifiedCount: 0,
    approvedPlannedSetCount: 0,
    realFailureCount: 0,
    buckets: {
      accent: { count: 0, status: 'unknown' },
      noise: { count: 0, status: 'unknown' },
      codeSwitchHuman: { count: 0, status: 'unknown' },
      codeSwitchText: { count: items.length, status: 'text-screen-only' },
      continuousDialogue: { count: 0, status: 'unknown' },
    },
  };
}

function verifyAudioSet(cacheRoot, items) {
  let audioCount = 0;
  for (const item of items) {
    if (!/^[0-9]+\.wav$/.test(item.audioName || '')) {
      return { ok: false, code: 'audio-path', audioCount: audioCount, rates: null, productMetric: false };
    }
    const digest = item.sha256 || item.audioSha256;
    const cached = checkCached(path.join(cacheRoot, item.audioName), digest, item.bytes);
    if (!cached.ok) return Object.assign({}, cached, { audioCount: audioCount });
    audioCount += 1;
  }
  return { ok: true, code: 'ok', audioCount: audioCount, rates: null, productMetric: false };
}

function publishManifest(dest, body, mode) {
  if (mode !== 'freeze') return false;
  if (fs.existsSync(dest)) {
    const old = JSON.parse(fs.readFileSync(dest, 'utf8'));
    const oldItems = old.items || [];
    const nextItems = body.items || [];
    if (oldItems.length !== nextItems.length) {
      const err = new Error('hash-pin');
      err.code = 'hash-pin';
      throw err;
    }
    for (let i = 0; i < oldItems.length; i++) {
      const a = oldItems[i];
      const b = nextItems[i];
      if (a.audioSha256 !== b.audioSha256 || a.bytes !== b.bytes || a.transcription !== b.transcription) {
        const err = new Error('hash-pin');
        err.code = 'hash-pin';
        throw err;
      }
    }
    return false;
  }
  const partial = dest + '.partial';
  fs.writeFileSync(partial, JSON.stringify(body, null, 2) + '\n');
  fs.renameSync(partial, dest);
  return true;
}

function attributionText() {
  return [
    'Dataset: CAiRE/ASCEND',
    'Card revision: ' + CARD_REVISION,
    'Data file: main/test-00000-of-00001.parquet',
    'Data sha256: ' + PARQUET_SHA256,
    'License: CC-BY-SA-4.0',
    'License URL: https://creativecommons.org/licenses/by-sa/4.0/',
    'The GitHub repository license is MIT. MIT is not the data license.',
    'Citation: Lovenia et al., ASCEND, LREC 2022, arXiv:2112.06223.',
    'Clips are the publisher wav bytes. They were not resampled, denoised, or joined.',
    '',
  ].join('\n');
}

function writeBlankPack(outDir, entries) {
  for (const entry of entries) {
    const cached = checkCached(entry.sourcePath, entry.audioSha256, entry.bytes);
    if (!cached.ok) return { ok: false, code: cached.code, humanVerifiedCount: 0, productMetric: false };
  }
  fs.mkdirSync(outDir, { recursive: true });
  const items = [];
  for (const entry of entries) {
    const dest = path.join(outDir, 'audio', entry.audioName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const partial = dest + '.partial';
    fs.copyFileSync(entry.sourcePath, partial);
    const again = checkCached(partial, entry.audioSha256, entry.bytes);
    if (!again.ok) {
      fs.unlinkSync(partial);
      return { ok: false, code: again.code, humanVerifiedCount: 0, productMetric: false };
    }
    fs.renameSync(partial, dest);
    items.push({
      id: entry.id,
      relativeAudio: 'audio/' + entry.audioName,
      transcription: entry.transcription,
      audioSha256: entry.audioSha256,
      bytes: entry.bytes,
      durationSeconds: entry.durationSeconds,
      verdict: '',
      humanReviewer: '',
      humanTime: '',
      humanTranscript: '',
      humanEvidence: '',
      accent: '',
      noise: '',
      codeSwitch: '',
      approved: false,
      humanReviewed: false,
    });
  }
  const manifest = {
    schema: 'belliedmonkey.ascend-review-pack.v1',
    notAHumanReview: true,
    productMetric: false,
    humanVerifiedCount: 0,
    approvedPlannedSetCount: 0,
    realFailureCount: 0,
    license: LICENSE,
    items: items,
  };
  fs.writeFileSync(path.join(outDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'ATTRIBUTION.txt'), attributionText());
  const header = ['id', 'relativeAudio', 'transcription', 'audioSha256', 'humanReviewer', 'humanTime', 'humanTranscript', 'humanEvidence', 'accent', 'noise', 'codeSwitch', 'verdict'];
  const lines = [header.join(',')];
  for (const item of items) lines.push(header.map((key) => csvCell(item[key])).join(','));
  fs.writeFileSync(path.join(outDir, 'annotations.csv'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'README.md'), [
    '# ASCEND 空白听审',
    '',
    '这不是人审。官方转写原样保留。口音、噪声、混语是否听得到，都还是空的。',
    '',
    '```bash',
    'node eval/baselines/ascend/fetch-ascend.js --offline',
    '```',
    '',
  ].join('\n'));
  return { ok: true, code: 'pack-ok', humanVerifiedCount: 0, clipCount: items.length, productMetric: false };
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function cacheRootFrom(argv) {
  const index = argv.indexOf('--cache');
  if (index >= 0 && (!argv[index + 1] || String(argv[index + 1]).startsWith('--'))) {
    const err = new Error('cache-path');
    err.code = 'cache-path';
    throw err;
  }
  const chosen = index >= 0 ? argv[index + 1] : path.join(CACHE, 'audio');
  const resolved = path.resolve(chosen);
  const blocked = [
    path.resolve(path.join(__dirname, '../asr/.cache/audio')),
    path.resolve(path.join(__dirname, '../asr/.cache/public-candidates')),
    path.resolve(path.join(__dirname, '../asr/runs')),
  ];
  for (const root of blocked) {
    if (resolved === root || resolved.startsWith(root + path.sep)) {
      const err = new Error('cache-mix');
      err.code = 'cache-mix';
      throw err;
    }
  }
  return resolved;
}

function receiptFor(cacheRoot) {
  return path.join(path.dirname(cacheRoot), path.basename(cacheRoot) + '-receipt');
}

function getBinary(url, hops) {
  const depth = hops || 0;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'belliedmonkey-baseline-fetch' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url);
        const commit = res.headers['x-repo-commit'] || null;
        res.resume();
        if (depth >= 2) {
          reject(Object.assign(new Error('redirect'), { code: 'redirect' }));
          return;
        }
        getBinary(next.href, depth + 1).then((got) => {
          if (!got.xRepoCommit && commit) got.xRepoCommit = commit;
          resolve(got);
        }, reject);
        return;
      }
      if (res.statusCode === 401 || res.statusCode === 403) {
        res.resume();
        reject(Object.assign(new Error('auth-required'), { code: 'auth-required' }));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(Object.assign(new Error('HTTP ' + res.statusCode), { code: 'fetch-failed' }));
        return;
      }
      const announced = Number(res.headers['content-length'] || 0);
      if (announced > BYTE_CAP) {
        res.resume();
        reject(Object.assign(new Error('over-cap'), { code: 'over-cap' }));
        return;
      }
      const chunks = [];
      let seen = 0;
      res.on('data', (chunk) => {
        seen += chunk.length;
        if (seen > BYTE_CAP) {
          req.destroy();
          reject(Object.assign(new Error('over-cap'), { code: 'over-cap' }));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({
        buf: Buffer.concat(chunks),
        status: 200,
        host: new URL(url).host,
        etag: res.headers.etag || null,
        contentLength: res.headers['content-length'] || null,
        contentType: res.headers['content-type'] || null,
        xRepoCommit: res.headers['x-repo-commit'] || null,
      }));
      res.on('error', reject);
    });
    const timer = setTimeout(() => {
      req.destroy(Object.assign(new Error('timeout'), { code: 'fetch-failed' }));
    }, TIMEOUT_MS);
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.on('close', () => clearTimeout(timer));
  });
}

async function downloadParquet(dest) {
  if (fs.existsSync(dest)) {
    const cached = checkCached(dest, PARQUET_SHA256, PARQUET_BYTES);
    if (cached.ok) return { cached: true };
  }
  let last = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const got = await getBinary(PARQUET_URL, 0);
      if (got.buf.length !== PARQUET_BYTES || sha256(got.buf) !== PARQUET_SHA256) {
        throw Object.assign(new Error('checksum-mismatch'), { code: 'checksum-mismatch' });
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const partial = dest + '.partial';
      fs.writeFileSync(partial, got.buf);
      if (sha256(fs.readFileSync(partial)) !== PARQUET_SHA256) {
        fs.unlinkSync(partial);
        throw Object.assign(new Error('checksum-mismatch'), { code: 'checksum-mismatch' });
      }
      fs.renameSync(partial, dest);
      return {
        cached: false,
        evidence: {
          requestedUrl: PARQUET_URL,
          cardRevision: CARD_REVISION,
          status: got.status,
          responseHost: got.host,
          etag: got.etag,
          contentLength: got.contentLength,
          contentType: got.contentType,
          xRepoCommit: got.xRepoCommit,
          sha256: PARQUET_SHA256,
          bytes: PARQUET_BYTES,
        },
      };
    } catch (err) {
      last = err;
      if (err && (err.code === 'auth-required' || err.code === 'over-cap')) throw err;
    }
  }
  const err = new Error((last && last.message) || 'fetch-failed');
  err.code = last && last.code ? last.code : 'fetch-failed';
  throw err;
}

function python(args) {
  const res = spawnSync('python3', [path.join(__dirname, 'extract_parquet.py')].concat(args), {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.status !== 0) {
    const err = new Error((res.stderr || '').trim() || 'extractor');
    err.code = (res.stderr || '').indexOf('extractor-missing') >= 0 ? 'extractor-missing' : 'extractor';
    throw err;
  }
  return res.stdout || '';
}

function roundDuration(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function buildManifest(metaRows, audioRows, audioDir, evidence) {
  const picked = selectCandidates(metaRows, 6);
  if (picked.items.length !== 6) {
    const err = new Error('selection-short');
    err.code = 'selection-short';
    throw err;
  }
  const audioById = new Map(audioRows.map((row) => [row.id, row]));
  const items = [];
  let totalBytes = 0;
  let totalDurationSeconds = 0;
  for (const row of picked.items) {
    const audio = audioById.get(row.id);
    if (!audio) {
      const err = new Error('missing-audio');
      err.code = 'missing-audio';
      throw err;
    }
    const wav = wavInfo(fs.readFileSync(path.join(audioDir, audio.audioName)));
    if (!wav) {
      const err = new Error('wav-mismatch');
      err.code = 'wav-mismatch';
      throw err;
    }
    const durationSeconds = roundDuration(row.duration);
    totalBytes += audio.bytes;
    totalDurationSeconds += durationSeconds;
    items.push({
      id: row.id,
      split: 'test',
      sessionId: row.sessionId,
      originalSpeakerId: row.originalSpeakerId,
      topic: row.topic,
      publisherLanguage: row.language,
      transcription: row.transcription,
      transcriptionSha256: sha256(Buffer.from(row.transcription, 'utf8')),
      durationSeconds: durationSeconds,
      sourceAudioPath: audio.sourceAudioPath,
      audioName: audio.audioName,
      audioSha256: audio.sha256,
      bytes: audio.bytes,
      sampleRate: wav.sampleRate,
      channels: wav.channels,
      bitsPerSample: wav.bitsPerSample,
      samples: wav.samples,
      textScreen: 'han-plus-latin-letter',
      ear: { accent: 'unknown', noise: 'unknown', codeSwitch: 'unknown', continuousDialogue: 'unknown' },
      humanReviewed: false,
    });
  }
  return {
    schema: 'belliedmonkey.ascend-candidate-set.v1',
    id: 'ascend-test-codeswitch-v1',
    kind: 'public-candidate',
    productMetric: false,
    notAUserFailureSet: true,
    notAnEndToEndBaseline: true,
    humanVerified: false,
    humanVerifiedCount: 0,
    approvedPlannedSetCount: 0,
    realFailureCount: 0,
    donationActualCount: 0,
    publicCandidateCount: items.length,
    totalBytes: totalBytes,
    totalDurationSeconds: Math.round(totalDurationSeconds * 1000) / 1000,
    license: LICENSE,
    codeLicenseNote: 'MIT is not the data license.',
    publisher: {
      dataset: 'CAiRE/ASCEND',
      cardRevision: CARD_REVISION,
      description: 'The dataset card calls this spontaneous Chinese-English code-switching in multi-turn conversation, collected in Hong Kong. The paper abstract calls the speech clean. Those sentences describe the collection. They are not a finding about these six clips.',
    },
    source: Object.assign({
      split: 'test',
      path: 'main/test-00000-of-00001.parquet',
      cardRevision: CARD_REVISION,
      sha256: PARQUET_SHA256,
      bytes: PARQUET_BYTES,
    }, evidence || {}),
    selection: {
      split: 'test',
      sort: 'id ascending',
      limit: 6,
      rule: 'Keep a test row only when the official transcription has a Han character and a Latin letter. Sort by id. Take the first 6. This is a text screen, not an ear check. The six clips are not adjacent recordings, so continuous dialogue stays unknown.',
    },
    buckets: picked.buckets,
    items: items,
  };
}

function finish(receiptDir, summary) {
  recordFailure(receiptDir, summary);
  console.log(JSON.stringify(summary));
  if (!summary.ok) process.exit(2);
}

async function main(argv) {
  const freeze = argv.includes('--freeze');
  const offline = argv.includes('--offline');
  const packIndex = argv.indexOf('--pack');
  const cacheRoot = cacheRootFrom(argv);
  const receiptDir = receiptFor(cacheRoot);
  try {
    if (freeze && offline) {
      throw Object.assign(new Error('freeze-offline'), { code: 'freeze-offline' });
    }
    if (!freeze) {
      if (!fs.existsSync(MANIFEST_PATH)) {
        throw Object.assign(new Error('manifest-missing'), { code: 'manifest-missing' });
      }
      const before = fs.readFileSync(MANIFEST_PATH, 'utf8');
      const body = JSON.parse(before);
      const audio = verifyAudioSet(cacheRoot, body.items);
      if (fs.readFileSync(MANIFEST_PATH, 'utf8') !== before) {
        throw Object.assign(new Error('manifest-write'), { code: 'manifest-write' });
      }
      if (!audio.ok) {
        finish(receiptDir, {
          ok: false,
          code: audio.code,
          humanVerifiedCount: 0,
          approvedPlannedSetCount: 0,
          realFailureCount: 0,
          donationActualCount: 0,
          rates: null,
          productMetric: false,
        });
        return;
      }
      if (packIndex >= 0) {
        const out = argv[packIndex + 1];
        const entries = body.items.map((item) => Object.assign({}, item, {
          sourcePath: path.join(cacheRoot, item.audioName),
        }));
        const packed = writeBlankPack(out, entries);
        if (!packed.ok) {
          finish(receiptDir, packed);
          return;
        }
      }
      finish(receiptDir, {
        ok: true,
        code: offline ? 'offline-ok' : 'verify-ok',
        humanVerifiedCount: 0,
        approvedPlannedSetCount: 0,
        realFailureCount: 0,
        donationActualCount: 0,
        publicCandidateCount: body.publicCandidateCount,
        totalBytes: body.totalBytes,
        totalDurationSeconds: body.totalDurationSeconds,
        sourceIds: body.items.map((item) => item.id),
        rates: null,
        productMetric: false,
        e2eMetric: null,
      });
      return;
    }
    const parquetPath = path.join(CACHE, 'parquet', 'test-00000-of-00001.parquet');
    const downloaded = await downloadParquet(parquetPath);
    const metaPath = path.join(CACHE, 'meta.json');
    fs.mkdirSync(path.dirname(metaPath), { recursive: true });
    python(['meta', parquetPath, metaPath]);
    const metaRows = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const picked = selectCandidates(metaRows, 6);
    fs.mkdirSync(cacheRoot, { recursive: true });
    const raw = python(['audio', parquetPath, picked.items.map((row) => row.id).join(','), cacheRoot]);
    const audioRows = JSON.parse(raw);
    const manifest = buildManifest(metaRows, audioRows, cacheRoot, downloaded.evidence || null);
    const wrote = publishManifest(MANIFEST_PATH, manifest, 'freeze');
    finish(receiptDir, {
      ok: true,
      code: wrote ? 'freeze-ok' : 'freeze-unchanged',
      humanVerifiedCount: 0,
      approvedPlannedSetCount: 0,
      realFailureCount: 0,
      donationActualCount: 0,
      publicCandidateCount: manifest.publicCandidateCount,
      totalBytes: manifest.totalBytes,
      totalDurationSeconds: manifest.totalDurationSeconds,
      sourceIds: manifest.items.map((item) => item.id),
      cacheHit: Boolean(downloaded.cached),
      rates: null,
      productMetric: false,
      e2eMetric: null,
    });
  } catch (err) {
    finish(receiptDir, {
      ok: false,
      code: err && err.code ? err.code : 'fetch-failed',
      humanVerifiedCount: 0,
      donationActualCount: 0,
      rates: null,
      productMetric: false,
    });
  }
}

if (require.main === module) main(process.argv);

module.exports = {
  codeSwitchText, selectCandidates, verifyAudioSet, publishManifest, attributionText, writeBlankPack,
};
