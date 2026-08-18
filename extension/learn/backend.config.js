// learn/backend.config.js — where the optional sync backend lives.
// See docs/learning-design.md §8.4.1.
//
// EVERYTHING here is public by design: the URL is a hostname and the key is the
// *publishable* anon key, which grants nothing on its own — every table is behind RLS
// keyed on `auth.uid()`, so an anon key with no session can read and write nothing.
// It ships in the extension bundle, which anyone can unzip; that is fine and expected.
// A key that must stay secret must never appear in this file.
//
// This is also the whole "which backend" decision, in one object. §8.4.1 explains why
// the client is written so that changing it is a one-file change.

var MT_BACKEND = {
  // ─── SHIPPING SWITCH ─────────────────────────────────────────────────────
  // true since v1.4.0 (Gate B, 2026-08-09): sync is PUBLIC. The flip landed in
  // the same commit as the honest privacy copy — README ×2, the in-product
  // learn_section_hint ×11 locales, and the Firefox data_collection_permissions
  // growing to three entries — exactly as learning-design §10 required. The
  // build gates that used to block this flag now guard the OPPOSITE direction:
  // enabled:true with any stale "never uploaded / no account" sentence anywhere
  // in the repo fails the build (see build.js validateManifest, Gate B block).
  //
  // The CHINA flavor's EXTENSION ships with this flipped back to false at build
  // time (build.js china override). The China HOST APP, however, ships the one
  // shared app bundle — enabled:true, sign-in included — by explicit decision
  // (2026-08-17, App Review Route A: reviewers require a username+password demo
  // account, so the login stays). Known asymmetry: a China user's extension does
  // not upload, so the app's sync only pulls what other (global-flavor) devices
  // pushed. Unifying the china extension's sync is a separate decision with its
  // own PIPL/cross-border gate.
  //
  // Sign-in stays optional: signed out, every feature except multi-device sync
  // works fully and locally (§8.2 stance — sync is an upgrade, not a gate).
  enabled: true,

  // Dedicated project, Tokyo (ap-northeast-1) — 2026-08-04. Tokyo rather than the
  // us-east-1 the other projects use: sync is not latency-critical, but the users
  // are, and from mainland China us-east-1 is ~250-350ms and unreliable where Tokyo
  // is ~50-80ms. Region cannot be changed after creation, so it is a decision, not
  // a default.
  url: 'https://cavezcufztzqsohpjmup.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhdmV6Y3VmenR6cXNvaHBqbXVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4MTczNTAsImV4cCI6MjEwMTM5MzM1MH0.VdL1B_jYLySEkhecL6WHOLV_vYbnRItpciFx7ZSxO4M',
  table: 'bt_chunks',
  quotaBytes: 50 * 1024 * 1024,
};

if (typeof module !== 'undefined' && module.exports) module.exports = MT_BACKEND;
