'use strict';

// Stream a tar (optionally already gunzipped) and keep only named members.
// Stops early once every requested basename has been copied.

function basename(name) {
  const n = String(name || '').replace(/\\/g, '/');
  const i = n.lastIndexOf('/');
  return i >= 0 ? n.slice(i + 1) : n;
}

function cstr(buf) {
  const z = buf.indexOf(0);
  return (z >= 0 ? buf.slice(0, z) : buf).toString('utf8').trim();
}

function parseHeader(header) {
  if (header.length < 512) return null;
  let zero = true;
  for (let i = 0; i < 512; i++) if (header[i] !== 0) { zero = false; break; }
  if (zero) return { zero: true };
  const magic = header.slice(257, 263).toString('utf8');
  const name = cstr(header.slice(0, 100));
  const prefix = magic.startsWith('ustar') ? cstr(header.slice(345, 500)) : '';
  const sizeText = cstr(header.slice(124, 136)).trim();
  const size = parseInt(sizeText || '0', 8);
  return {
    name: prefix ? prefix.replace(/\/$/, '') + '/' + name : name,
    size: Number.isFinite(size) ? size : 0,
    typeflag: String.fromCharCode(header[156]),
  };
}

function createTarCollector(wantedBasenames) {
  const wanted = wantedBasenames instanceof Set ? wantedBasenames : new Set(wantedBasenames);
  const found = new Map();
  let buf = Buffer.alloc(0);
  let mode = 'header';
  let pending = null;
  let longName = '';

  function finishMember() {
    const body = pending.chunks.length ? Buffer.concat(pending.chunks, pending.size) : Buffer.alloc(0);
    if (mode === 'longname') longName = cstr(body);
    else if (pending.take) found.set(pending.base, body);
    mode = 'header';
    pending = null;
  }

  function push(chunk) {
    if (!chunk || !chunk.length || mode === 'done') return found.size === wanted.size;
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (mode === 'done') break;
      if (mode === 'header') {
        if (buf.length < 512) break;
        const header = buf.slice(0, 512);
        buf = buf.slice(512);
        const parsed = parseHeader(header);
        if (!parsed || parsed.zero) { mode = 'done'; break; }
        if (parsed.typeflag === 'L') {
          mode = 'longname';
          pending = { size: parsed.size, left: parsed.size, chunks: [], take: true, base: '' };
          continue;
        }
        const name = longName || parsed.name;
        longName = '';
        const base = basename(name);
        const regular = parsed.typeflag === '0' || parsed.typeflag === '\0';
        mode = 'file';
        pending = {
          size: parsed.size,
          left: parsed.size,
          chunks: [],
          take: regular && wanted.has(base) && !found.has(base),
          base,
        };
        continue;
      }
      if (pending.left > 0) {
        if (!buf.length) break;
        const n = Math.min(buf.length, pending.left);
        if (pending.take) pending.chunks.push(buf.slice(0, n));
        buf = buf.slice(n);
        pending.left -= n;
        continue;
      }
      const pad = pending.size % 512 === 0 ? 0 : 512 - (pending.size % 512);
      if (buf.length < pad) break;
      buf = buf.slice(pad);
      finishMember();
      if (found.size === wanted.size) { mode = 'done'; break; }
    }
    return found.size === wanted.size;
  }

  return { push, found };
}

module.exports = { basename, parseHeader, createTarCollector };
