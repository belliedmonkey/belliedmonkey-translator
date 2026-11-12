'use strict';

// Download only the two pinned FLEURS test TSV files and check them against
// fleurs-public-v1.json. Audio archives are above the byte cap and are not fetched.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { parseTsv, selectFirst } = require('./select.js');

const SET_PATH = path.join(__dirname, 'fleurs-public-v1.json');
const CACHE = path.join(__dirname, '.cache');
const BYTE_CAP = 2 * 1024 * 1024;
const AUDIO_CAP = 8 * 1024 * 1024;

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

function headLength(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'HEAD', headers: { 'user-agent': 'belliedmonkey-baseline-fetch' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(headLength(new URL(res.headers.location, url).href));
        return;
      }
      res.resume();
      resolve(Number(res.headers['content-length'] || 0));
    });
    req.on('error', reject);
    req.end();
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
    console.log('audio not fetched');
    console.log(set.audio.blocker);
    return;
  }
  const archives = [
    'data/en_us/audio/test.tar.gz',
    'data/cmn_hans_cn/audio/test.tar.gz',
  ];
  for (const rel of archives) {
    const url = 'https://huggingface.co/datasets/google/fleurs/resolve/'
      + set.attribution.revision + '/' + rel;
    const len = await headLength(url);
    if (!(len > 0) || len > AUDIO_CAP) {
      console.error('audio blocked', rel, 'content-length', len, 'cap', AUDIO_CAP);
      process.exitCode = 2;
      continue;
    }
  }
  if (process.exitCode) {
    console.error(set.audio.blocker);
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
