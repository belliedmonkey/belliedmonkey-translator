// test/harness.js — zero-dependency test harness.
//
// The extension ships as browser IIFE modules (no ES modules, no npm deps — see
// AGENTS.md). To regress their pure logic in plain Node we eval each source file
// inside a `vm` sandbox with just enough browser globals stubbed, then read the
// global the IIFE assigns (e.g. `TranslationCore`). No jsdom / no devDependencies:
// DOM-heavy modules are covered by docs/regression-tests.md (manual) instead.

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const EXT_ROOT = path.join(__dirname, '..', 'extension');
const EXT_DIR = path.join(EXT_ROOT, 'content');

// Load an extension source file into a fresh vm context seeded with the given
// sandbox globals. Returns the context (read exported globals off it).
//
// A bare name resolves under extension/content/ (the content scripts). A name with
// a slash resolves under extension/ — extension-PAGE modules live outside content/
// (learn/tts.js, learn/store.js) and are just as worth regressing.
function loadModule(relFile, sandbox = {}) {
  const abs = relFile.includes('/') ? path.join(EXT_ROOT, relFile) : path.join(EXT_DIR, relFile);
  const code = fs.readFileSync(abs, 'utf8');
  const base = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  const ctx = vm.createContext(Object.assign(base, sandbox));
  vm.runInContext(code, ctx, { filename: relFile });
  return ctx;
}

// ─── Assertions ─────────────────────────────────────────────────────────
class AssertionError extends Error {}

function ok(cond, msg) {
  if (!cond) throw new AssertionError(msg || `expected truthy, got ${cond}`);
}
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new AssertionError(msg || `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function deepEq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new AssertionError(msg || `expected ${e}, got ${a}`);
}
function match(str, re, msg) {
  if (!re.test(str)) throw new AssertionError(msg || `expected ${JSON.stringify(str)} to match ${re}`);
}
// A RegExp second argument is MATCHED against the error; a string is only the failure
// message. That asymmetry exists because `rejects(fn, /429/)` reads like a matcher and
// used to be silently ignored — the call passed on ANY rejection, so a test asserting
// "the status survives" still passed after the status was thrown away. Found by
// mutating the code and watching the test stay green (2026-08-07).
async function rejects(promiseOrFn, msgOrPattern) {
  const pattern = msgOrPattern instanceof RegExp ? msgOrPattern : null;
  const msg = pattern ? null : msgOrPattern;
  try {
    await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
  } catch (e) {
    if (pattern) {
      const text = String((e && e.message) || e);
      if (!pattern.test(text)) {
        throw new AssertionError(`rejected, but with ${JSON.stringify(text)} — expected to match ${pattern}`);
      }
    }
    // The error itself, so a caller can go on to assert its `code`/`status`/`url`.
    // A named failure is half of this project's error contract (transport layers name
    // their codes so the UI can say what to fix); asserting only that SOMETHING was
    // thrown checks the weaker half.
    return e; // expected
  }
  throw new AssertionError(msg || 'expected promise to reject, but it resolved');
}

// Flush pending microtasks + a macrotask so engine setTimeout(...) callbacks land.
function tick(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Registry + runner ──────────────────────────────────────────────────
const suites = [];
let current = null;

function describe(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}
function test(name, fn) {
  if (!current) { current = { name: '(root)', tests: [] }; suites.push(current); }
  current.tests.push({ name, fn });
}

async function run() {
  let pass = 0, fail = 0;
  const failures = [];
  for (const suite of suites) {
    process.stdout.write(`\n${suite.name}\n`);
    for (const t of suite.tests) {
      try {
        await t.fn();
        pass++;
        process.stdout.write(`  \x1b[32m✓\x1b[0m ${t.name}\n`);
      } catch (err) {
        fail++;
        failures.push({ suite: suite.name, test: t.name, err });
        process.stdout.write(`  \x1b[31m✗\x1b[0m ${t.name}\n`);
      }
    }
  }
  process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
  if (fail) {
    process.stdout.write('\nFailures:\n');
    for (const f of failures) {
      process.stdout.write(`\n  ${f.suite} › ${f.test}\n    ${f.err && f.err.stack ? f.err.stack.split('\n').slice(0, 3).join('\n    ') : f.err}\n`);
    }
  }
  return fail === 0;
}

module.exports = {
  loadModule, describe, test, run,
  ok, eq, deepEq, match, rejects, tick,
  AssertionError,
};
