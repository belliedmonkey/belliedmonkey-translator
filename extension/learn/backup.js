// learn/backup.js — 语料的本地备份与空库自恢复（LearnBackup）。
// See docs/learning-design.md §7.5.
//
// WHY THIS EXISTS: on Safari the extension pages' IndexedDB — the corpus — sits
// on a `safari-web-extension://<random-UUID>` origin that ROTATES on reinstall
// or re-signing, orphaning the whole bucket with no error (two live orphan
// buckets found on one simulator, 2026-08-09). `chrome.storage.local` is keyed
// by the extension bundle id and survives. A signed-in user heals by pulling;
// this module is the lifeline for everyone else — and belt-and-braces for all.
//
// FORMAT ZERO: the payload IS `LearnChunk.exportBytes()` — the same `mt-learn/1`
// bytes the export button and sync speak, base64'd. It already carries cards,
// sources, reviews, the dels ledger and learnRules; `importBytes` replays
// idempotently, applies dels, and never stamps `syncedAt` (a restored corpus
// re-uploads, healing the server too). No second format to maintain.
//
// EXTENSION PAGES ONLY, and deliberately NOT in the app bundle: the app's
// IndexedDB is proven durable (§7.5's forensics table), and a multi-MB base64
// value would strain the shim's localStorage for nothing. Callers guard with
// `typeof LearnBackup !== 'undefined'` so the shared bytes stay app-safe.

var LearnBackup = (() => {
  'use strict';

  // ─── Per-corpus keys (§ account switch) ──────────────────────────────────
  // The backup lives in chrome.storage, which does NOT partition along with the
  // IndexedDB corpus. Left device-global it would defeat the partition in the
  // worst possible direction: restoreIfEmpty() runs BEFORE the entry sync, and
  // §7.5 deliberately leaves restored material WITHOUT a `syncedAt` stamp so that
  // it re-uploads and heals the server. So account A's backup would refill account
  // B's empty corpus and then push every card of it into B's cloud.
  //
  // The primary corpus keeps the historic key names: existing devices must not
  // lose the backup they already have, which is §7.5's only lifeline against a
  // Safari UUID rotation.
  const BASE = 'learnBackup';
  const BASE_META = 'learnBackupMeta';
  function suffix() {
    const db = LearnStore.currentDbName();
    return db === LearnStore.DB_NAME ? '' : ':' + db;
  }
  function bkKey() { return BASE + suffix(); }          // {v, at, format, b64, bytes, counts}
  function metaKey() { return BASE_META + suffix(); } // {at, bytes, counts, lastError} — tiny; the
                                      // throttle check never deserializes the payload
  const BACKUP_MIN_MS = 6 * 3600e3;
  // §8.5 puts a full 20k-item corpus at ~1.7MB compressed → ~2.3MB base64.
  // 4MB leaves headroom without requesting `unlimitedStorage` (§7's standing
  // decision). Oversize skips and says so in the meta record's lastError.
  const MAX_B64 = 4 * 1024 * 1024;

  // ── base64 ⇄ bytes, chunked so a multi-MB corpus cannot blow the arg limit ──
  const SLICE = 0x8000;

  function encode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += SLICE) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE));
    }
    return btoa(s);
  }

  function decode(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // Pure decision, exported for the vm suite: run when there is no backup yet,
  // when the last one is older than the cadence, or never when the payload is
  // over the cap (that is a SKIP with a reason, decided by the caller).
  function shouldBackup(meta, now) {
    if (!meta || !meta.at) return true;
    return (now - meta.at) >= BACKUP_MIN_MS;
  }

  // ── fire-and-forget snapshot ──────────────────────────────────────────────
  // Never throws, never blocks a surface. An empty corpus is skipped (a backup
  // of nothing must not overwrite a backup of something — the empty state is
  // exactly when restore needs the old payload).
  async function maybeRun(now) {
    const at = now || Date.now();
    try {
      const m = await PageSettings.read([metaKey()]);
      const meta = (m.ok && m.data[metaKey()]) || null;
      if (!shouldBackup(meta, at)) return { ran: false, reason: 'throttled' };

      const items = await LearnStore.allItems();
      if (!items.length) return { ran: false, reason: 'empty' };

      const { bytes, header } = await LearnChunk.exportBytes(at);
      const b64 = encode(bytes);
      if (b64.length > MAX_B64) {
        await PageSettings.write({ [metaKey()]: {
          at, bytes: bytes.length, counts: header.counts,
          lastError: 'oversize:' + b64.length,
        } });
        return { ran: false, reason: 'oversize' };
      }
      const w = await PageSettings.write({
        [bkKey()]: { v: 1, at, format: header.format, b64, bytes: bytes.length, counts: header.counts },
        [metaKey()]: { at, bytes: bytes.length, counts: header.counts, lastError: null },
      });
      return w.ok ? { ran: true, counts: header.counts }
                  : { ran: false, reason: 'write-failed: ' + (w.error || '') };
    } catch (e) {
      // Backup failure is not loss — the corpus is still live. Record, never block.
      try {
        await PageSettings.write({ [metaKey()]: { at, lastError: String((e && e.message) || e) } });
      } catch (_) {}
      return { ran: false, reason: String((e && e.message) || e) };
    }
  }

  // ── empty-DB restore ──────────────────────────────────────────────────────
  // Runs BEFORE drain and before the entry-forced sync (review/options boot):
  // restore covers signed-out users; the pull that follows heals signed-in ones.
  // `importBytes` is idempotent and applies the dels ledger, so a stale backup
  // cannot resurrect what the user deleted (§7.4).
  async function restoreIfEmpty() {
    try {
      const items = await LearnStore.allItems();
      if (items.length) return { restored: false, reason: 'not-empty' };
      const r = await PageSettings.read([bkKey()]);
      const payload = (r.ok && r.data[bkKey()]) || null;
      if (!payload || !payload.b64) return { restored: false, reason: 'no-backup' };
      const stats = await LearnChunk.importBytes(decode(payload.b64));
      return { restored: true, stats, backupAt: payload.at };
    } catch (e) {
      return { restored: false, reason: String((e && e.message) || e) };
    }
  }

  // 清空学习库 must also clear the backup — a purge the user asked for does not
  // get to resurrect on the next page open.
  function clear() {
    return PageSettings.removeKeys([bkKey(), metaKey()]);
  }

  async function meta() {
    const m = await PageSettings.read([metaKey()]);
    return (m.ok && m.data[metaKey()]) || null;
  }

  return {
    BACKUP_MIN_MS, MAX_B64,
    encode, decode, shouldBackup,     // pure — exported for the suite
    maybeRun, restoreIfEmpty, clear, meta,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnBackup;
