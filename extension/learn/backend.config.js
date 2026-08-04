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
  // false ⇒ the 多设备同步 section is not rendered at all, so there is no path to
  // an account or to our server. V1 ships with sync OFF: the release is capture +
  // review + TTS, all local, which lets every privacy claim in README/privacy.html
  // stay TRUE VERBATIM. Turning this on breaks four sentences at once
  // ("no account", "we receive nothing", "never uploaded"), so it is a release
  // decision, not a config tweak.
  //
  // `build.js` refuses to build with this true while the README still carries the
  // "No account, no tracking, no telemetry" line — see learning-design.md §10 Gate B.
  // The flag and the promise are coupled mechanically because a promise that depends
  // on someone remembering is the kind that gets broken.
  enabled: false,

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
