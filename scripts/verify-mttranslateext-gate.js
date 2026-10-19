#!/usr/bin/env node
// #592 版本门禁：Debug 查 MTTranslateExt.debug.dylib；Release 查 appex 主二进制。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const GATE_MARKERS = ['uiLangEffective', 'mt.vault.snapshot.v1'];

function usage() {
  process.stderr.write(
    '用法: node scripts/verify-mttranslateext-gate.js <BelliedMonkey Translator.app> [--release]\n',
  );
}

function resolveTarget(appRoot, release) {
  const appex = path.join(appRoot, 'Extensions', 'MTTranslateExt.appex');
  if (!fs.existsSync(appex)) throw new Error('缺少 Extensions/MTTranslateExt.appex');
  const debugDylib = path.join(appex, 'MTTranslateExt.debug.dylib');
  if (!release && fs.existsSync(debugDylib)) {
    return { kind: 'debug-dylib', file: debugDylib };
  }
  const main = path.join(appex, 'MTTranslateExt');
  if (!fs.existsSync(main)) throw new Error('缺少 MTTranslateExt 主二进制');
  return { kind: release ? 'release-main' : 'main', file: main };
}

function readStrings(file) {
  return execFileSync('strings', [file], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function readUuid(file) {
  try {
    const out = execFileSync('dwarfdump', ['--uuid', file], { encoding: 'utf8' });
    const m = out.match(/UUID:\s+([0-9A-F-]+)/i);
    return m ? m[1] : '';
  } catch (_) {
    return '';
  }
}

function verify(appRoot, opts = {}) {
  const release = !!opts.release;
  const target = resolveTarget(appRoot, release);
  const str = readStrings(target.file);
  const missing = GATE_MARKERS.filter((k) => !str.includes(k));
  if (missing.length) {
    throw new Error(`${target.kind} ${target.file} 缺少特征字串: ${missing.join(', ')}`);
  }
  const uuid = readUuid(target.file);
  return { ...target, uuid, markers: GATE_MARKERS };
}

if (require.main === module) {
  const app = process.argv[2];
  if (!app) {
    usage();
    process.exit(2);
  }
  const release = process.argv.includes('--release');
  try {
    const r = verify(path.resolve(app), { release });
    process.stdout.write(
      `OK ${r.kind} uuid=${r.uuid || '(n/a)'} markers=${r.markers.join('+')}\n  ${r.file}\n`,
    );
    process.exit(0);
  } catch (e) {
    process.stderr.write(String(e.message || e) + '\n');
    process.exit(1);
  }
}

module.exports = { verify, GATE_MARKERS, resolveTarget };
