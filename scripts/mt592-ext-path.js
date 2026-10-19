#!/usr/bin/env node
// #592 — 只读：devicectl 进程表里 MTTranslateExt 可执行路径（Mac 侧）。
const { execFileSync } = require('child_process');

const UDID = process.env.MT_UDID || '00008120-000465443A98C01E';

function listProcessText(udid = UDID) {
  return execFileSync('xcrun', ['devicectl', 'device', 'info', 'processes', '--device', udid], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** @returns {string|null} newest-looking MTTranslateExt executable path */
function findMTTranslateExtPath(text) {
  const hits = [];
  const re = /\/private\/var\/containers\/Bundle\/Application\/[^\n]*?MTTranslateExt\.appex\/MTTranslateExt/g;
  for (const m of text.matchAll(re)) hits.push(m[0].trim());
  for (const line of text.split('\n')) {
    if (!line.includes('MTTranslateExt') || line.includes('.appex/')) continue;
    const m = line.match(/(\/private\/var\/containers\/Bundle\/Application\/[^\n]*?\/MTTranslateExt)/);
    if (m) hits.push(m[1].trim());
  }
  if (!hits.length) return null;
  return hits[hits.length - 1];
}

function classifyExtPath(path) {
  if (!path) return { path: '', intl: false, cn: false, ok: false };
  const cn = path.includes('Translator CN.app');
  const intl = path.includes('BelliedMonkey Translator.app') && !cn;
  return { path, cn, intl, ok: intl };
}

function probe(udid = UDID) {
  const raw = listProcessText(udid);
  const path = findMTTranslateExtPath(raw);
  return { ...classifyExtPath(path), udid };
}

if (require.main === module) {
  const r = probe();
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(r) + '\n');
  } else {
    process.stdout.write((r.path || '(no MTTranslateExt process)') + '\n');
  }
  process.exit(r.ok ? 0 : (r.path ? 2 : 1));
}

module.exports = { listProcessText, findMTTranslateExtPath, classifyExtPath, probe, UDID };
