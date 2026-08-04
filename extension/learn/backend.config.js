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
  // 2026-08-04: temporarily shares the `champagne` project; every object of ours
  // carries the `bt_` prefix. Move to a dedicated project while the table is still
  // empty — the cost of splitting is measured in users, and there are none yet.
  url: 'https://uqeqngjkwybxnfsgivze.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxZXFuZ2prd3lieG5mc2dpdnplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzMDk1MDksImV4cCI6MjA4Njg4NTUwOX0.0bh8M0Ft4345RM78dXFqsmFmteIcmk-S_7rVoZJI77c',
  table: 'bt_chunks',
  quotaBytes: 50 * 1024 * 1024,
};

if (typeof module !== 'undefined' && module.exports) module.exports = MT_BACKEND;
