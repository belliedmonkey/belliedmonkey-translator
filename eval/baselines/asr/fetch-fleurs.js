'use strict';

// Download only the two pinned FLEURS test TSV files and check them against
// fleurs-public-v1.json. Audio archives are above the byte cap and are not fetched.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const zlib = require('zlib');
const { parseTsv, selectFirst } = require('./select.js');
const { createTarCollector } = require('./tar-member.js');
const { wavInfo } = require('./wav-info.js');
const { cacheRelative } = require('./run-sa-file.js');

const SET_PATH = path.join(__dirname, 'fleurs-public-v1.json');
const CACHE = path.join(__dirname, '.cache');
const BYTE_CAP = 2 * 1024 * 1024;
// Explicit --audio only. 1 GiB covers both test archives (~815 MB) with headroom.
const AUDIO_TOTAL_CAP = 1024 * 1024 * 1024;
const AUDIO_TIMEOUT_MS = 15 * 60 * 1000;
const AUDIO_MAX_FAILURES = 2;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function get(url, cap) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'belliedmonkey-baseline-fetch' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        resolve(get(next, cap));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
        return;
      }
      const chunks = [];
      let n = 0;
      res.on('data', (chunk) => {
        n += chunk.length;
        if (n > cap) {
          req.destroy(new Error('response exceeded ' + cap + ' bytes'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
  });
}

function streamWanted(url, wanted, budget, timeoutMs) {
  const names = [...wanted];
  return new Promise((resolve, reject) => {
    const collector = createTarCollector(names);
    const gunzip = zlib.createGunzip();
    let settled = false;
    let stop = false;
    let req;
    const timer = setTimeout(() => fail(new Error('timeout after ' + timeoutMs + ' ms')), timeoutMs);
    function done(err, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    }
    function fail(err) {
      if (stop || settled) return;
      stop = true;
      if (req) req.destroy();
      gunzip.destroy();
      done(err);
    }
    function succeed() {
      if (settled) return;
      stop = true;
      if (req) req.destroy();
      gunzip.destroy();
      done(null, { found: collector.found, bytes: budget.used });
    }
    gunzip.on('data', (plain) => {
      try {
        if (collector.push(plain)) succeed();
      } catch (err) { fail(err); }
    });
    gunzip.on('error', (err) => {
      if (collector.found.size === names.length) succeed();
      else fail(err);
    });
    gunzip.on('end', () => {
      if (collector.found.size === names.length) succeed();
      else fail(new Error('archive ended with ' + collector.found.size + ' of ' + names.length));
    });
    function open(target, hops) {
      req = https.get(target, { headers: { 'user-agent': 'belliedmonkey-baseline-fetch' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (hops > 5) { fail(new Error('too many redirects')); return; }
          open(new URL(res.headers.location, target).href, hops + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          fail(new Error('HTTP ' + res.statusCode + ' for ' + target));
          return;
        }
        res.on('data', (chunk) => {
          budget.used += chunk.length;
          if (budget.used > budget.cap) {
            fail(new Error('download exceeded ' + budget.cap + ' bytes'));
            return;
          }
          if (!gunzip.write(chunk)) res.pause();
        });
        res.on('end', () => gunzip.end());
        res.on('error', fail);
        gunzip.on('drain', () => res.resume());
      });
      req.on('error', (err) => {
        if (collector.found.size === names.length) succeed();
        else fail(err);
      });
    }
    open(url, 0);
  });
}

function rebuild(set, byPath) {
  const out = [];
  for (const file of set.sourceFiles) {
    const text = byPath[file.path].toString('utf8');
    const config = file.path.split('/')[1];
    const lang = config === 'en_us' ? 'en' : 'zh';
    for (const row of selectFirst(parseTsv(text), set.selection.nPerLanguage)) {
      out.push({
        id: config + '/' + row.sentenceId + '/' + row.audioName,
        lang,
        reference: row.normalized,
        raw: row.raw,
        audioName: row.audioName,
        sentenceId: row.sentenceId,
      });
    }
  }
  return out;
}

async function main() {
  const set = JSON.parse(fs.readFileSync(SET_PATH, 'utf8'));
  const wantAudio = process.argv.includes('--audio');
  fs.mkdirSync(CACHE, { recursive: true });
  const byPath = {};
  for (const file of set.sourceFiles) {
    if (file.bytes > BYTE_CAP) throw new Error(file.path + ' is above the text cap');
    const url = 'https://huggingface.co/datasets/google/fleurs/resolve/'
      + set.attribution.revision + '/' + file.path;
    const buf = await get(url, BYTE_CAP);
    const got = sha256(buf);
    if (got !== file.sha256 || buf.length !== file.bytes) {
      throw new Error(file.path + ' hash or size mismatch');
    }
    const dest = path.join(CACHE, file.path.replace(/\//g, '__'));
    fs.writeFileSync(dest, buf);
    byPath[file.path] = buf;
    console.log('tsv ok', file.path, buf.length, got);
  }
  const fresh = rebuild(set, byPath);
  if (fresh.length !== set.items.length) throw new Error('selection length ' + fresh.length);
  for (let i = 0; i < fresh.length; i++) {
    const a = fresh[i];
    const b = set.items[i];
    if (a.id !== b.id || a.reference !== b.reference || a.raw !== b.raw) {
      throw new Error('selection drift at ' + a.id);
    }
  }
  console.log('selection matches fleurs-public-v1.json', fresh.length, 'rows');
  if (!wantAudio) {
    console.log('audio not fetched (pass --audio to stream the two test archives into the cache)');
    return;
  }
  const record = process.argv.includes('--record');
  const budget = { used: 0, cap: AUDIO_TOTAL_CAP };
  const failures = [];
  const audioDir = path.join(CACHE, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });
  const byConfig = new Map();
  for (const item of set.items) {
    if (!byConfig.has(item.config)) byConfig.set(item.config, []);
    byConfig.get(item.config).push(item);
  }
  for (const [config, items] of byConfig) {
    const rel = 'data/' + config + '/audio/test.tar.gz';
    const url = 'https://huggingface.co/datasets/google/fleurs/resolve/'
      + set.attribution.revision + '/' + rel;
    const names = items.map((item) => item.audioName);
    let got = null;
    while (!got && failures.length < AUDIO_MAX_FAILURES) {
      try {
        console.log('streaming', rel, 'want', names.length, 'budget', budget.used);
        got = await streamWanted(url, names, budget, AUDIO_TIMEOUT_MS);
      } catch (err) {
        failures.push(rel + ': ' + (err && err.message ? err.message : err));
        console.error('audio attempt failed', failures.length, failures[failures.length - 1]);
        got = null;
      }
    }
    if (!got) break;
    for (const item of items) {
      const buf = got.found.get(item.audioName);
      if (!buf) throw new Error('missing wav after stream ' + item.id);
      const stored = 'eval/baselines/asr/.cache/audio/' + config + '/' + item.audioName;
      const rel = cacheRelative(stored);
      if (!rel) throw new Error('cache path ' + item.id);
      const dest = path.join(audioDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      const info = wavInfo(buf);
      if (!info) throw new Error('unreadable wav ' + item.id);
      if (info.samples !== item.numSamples) {
        throw new Error('sample count ' + info.samples + ' != tsv ' + item.numSamples + ' for ' + item.id);
      }
      item.audioBytes = buf.length;
      item.audioSha256 = sha256(buf);
      item.sampleRate = info.sampleRate;
      item.channels = info.channels;
      item.bitsPerSample = info.bitsPerSample;
      item.wavSamples = info.samples;
      item.durationSeconds = Math.round(info.durationSeconds * 1000) / 1000;
      item.audioCache = stored;
      console.log('wav', item.id, item.audioBytes, item.audioSha256, item.durationSeconds + 's');
    }
  }
  if (failures.length) {
    console.error('audio stopped after ' + failures.length + ' failure(s)');
    for (const line of failures) console.error(line);
    process.exitCode = 2;
    return;
  }
  const receipt = {
    fetchedAt: new Date().toISOString(),
    compressedBytes: budget.used,
    cap: budget.cap,
    timeoutMs: AUDIO_TIMEOUT_MS,
    items: set.items.map((item) => ({
      id: item.id,
      audioName: item.audioName,
      audioBytes: item.audioBytes,
      audioSha256: item.audioSha256,
      sampleRate: item.sampleRate,
      channels: item.channels,
      bitsPerSample: item.bitsPerSample,
      wavSamples: item.wavSamples,
      durationSeconds: item.durationSeconds,
      numSamples: item.numSamples,
      audioCache: item.audioCache,
    })),
  };
  fs.writeFileSync(path.join(CACHE, 'audio-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log('audio cached', receipt.items.length, 'compressedBytes', budget.used);
  if (record) {
    set.audio = {
      fetched: true,
      inGit: false,
      cache: 'eval/baselines/asr/.cache/audio',
      compressedBytes: budget.used,
      cap: AUDIO_TOTAL_CAP,
      timeoutMs: AUDIO_TIMEOUT_MS,
      note: '16 wav files copied out of the two test tar.gz archives. The archives themselves are not stored. This is not a system hypothesis and not a product score.',
    };
    set.hypothesisInput = {
      file: 'JSON array of { id, hypothesis }. id must match this set. hypothesis is recognizer text, never the reference field.',
      command: 'node eval/baselines/asr/score.js --set eval/baselines/asr/fleurs-public-v1.json --hyp hypotheses.json',
      audio: 'Each id maps to audioCache. The cache is gitignored.',
    };
    fs.writeFileSync(SET_PATH, JSON.stringify(set, null, 2) + '\n');
    console.log('recorded audio metadata into fleurs-public-v1.json');
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
