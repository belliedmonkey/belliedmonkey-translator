// test/bel270a-client-mapping.test.js — BEL-270 A completion.
//
// A (#697) added `reason` → relay_bad_* and the four new enum values. What was still
// missing: the relay's PRE-EXISTING named errors (grant_revoked, grant_invalid, busy,
// grant_misconfigured, …) still left apiFetch as themselves, and three of those names
// are not in the deployed translate_fail enum. This test pins the mapping at the
// source so every caller sees a legal code, plus the negative event surface: the UI
// may keep serverMessage, but no response body / reason / serverMessage may enter
// translate_fail props.
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq, rejects, loadModule } = require('./harness');
const { makeChrome, makeFetch } = require('./stubs');
const WireFormat = require('../extension/content/wire-format.js');

const ROOT = path.join(__dirname, '..');
const cfg = require('../build/telemetry.config.js');
const gen = require('../supabase/functions/bt-ingest/events.gen.json');

// name, HTTP status, expected code, expected status
const GRANT_CASES = [
  ['grant_revoked', 403, 'auth', 403],
  ['grant_invalid', 401, 'auth', 401],
  ['busy', 429, 'http', 429],
  ['grant_misconfigured', 503, 'grant_unavailable', 503],
  ['model_not_allowed', 403, 'model_not_allowed', 403],
  ['grant_unavailable', 503, 'grant_unavailable', 503],
  ['credit_exhausted', 402, 'credit_exhausted', 402],
];

function load(program) {
  const chrome = makeChrome({});
  const fetch = makeFetch(program);
  const window = {};
  loadModule('providers.gen.js', { window });
  const ctx = loadModule(['translation-core.js', 'engine-state.js', 'request-shape.js', 'translation-api.js'], {
    fetch, chrome, AbortController, URLSearchParams, window, WireFormat,
  });
  return { API: ctx.TranslationAPI, fetch };
}

const relay = (name, status) => ({
  status,
  json: { error: name, message: 'relay says ' + name },
  headers: {},
});

describe('BEL-270 A completion — named relay codes land inside the deployed enum', () => {
  for (const [name, status, code, expectedStatus] of GRANT_CASES) {
    test(`${name} (${status}) → ${code}${name === 'busy' ? ' / status 429' : ''}`, async () => {
      const { API, fetch } = load([relay(name, status)]);
      const e = await rejects(() => API.translate('hello world', 'zh-CN', 'deepseek', 'KEY', ''));
      eq(e.code, code, `${name} 必须映射为 ${code}，实际 ${e.code}`);
      eq(e.status, expectedStatus, `${name} 的 HTTP status 被改了`);
      eq(e.grant, true, '额度/中继具名错误仍带 grant 位');
      eq(e.retryable, false, '具名 relay 错误不可重试');
      eq(fetch.calls.length, 1, '同一段只发一次');
      ok(typeof e.serverMessage === 'string' && e.serverMessage.length > 0,
        'serverMessage 仍是 UI 的句子（不是事件的属性）');
    });
  }

  test('每个输出码都在 build/telemetry.config.js 与 events.gen.json 里', () => {
    for (const [, , code] of GRANT_CASES) {
      ok(cfg.EVENTS.translate_fail.code.indexOf(code) >= 0, 'telemetry.config 缺 ' + code);
      ok(gen.events.translate_fail.code.indexOf(code) >= 0, 'events.gen 缺 ' + code);
    }
    for (const forbidden of ['grant_revoked', 'grant_invalid', 'grant_misconfigured', 'busy']) {
      ok(cfg.EVENTS.translate_fail.code.indexOf(forbidden) < 0,
        forbidden + ' 不该是 translate_fail.code —— 它必须被映射');
      ok(gen.events.translate_fail.code.indexOf(forbidden) < 0,
        forbidden + ' 不该是 translate_fail.code —— 它必须被映射');
    }
  });
});

// The two adapters build the event props. Assert the literal keys they can emit:
// serverMessage is UI-only (it stays on the Error), and body/reason are never props.
const ADAPTERS = ['extension/content/content-webpage.js', 'extension/content/subtitle-adapter.js'];
const ALLOWED_PROP_KEYS = ['code', 'kind', 'ms', 'provider', 'route', 'status'];

describe('BEL-270 A completion — translate_fail props stay allowlist-only', () => {
  for (const file of ADAPTERS) {
    test(`${file}: no body / reason / serverMessage in the emitted props`, () => {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const m = src.match(/const fail = \{([\s\S]*?)\n\s*\};/);
      ok(m, file + ': 找不到 fail 属性字面量');
      const keys = [...m[1].matchAll(/^\s*([A-Za-z_$][\w$]*):/gm)].map((x) => x[1]).sort();
      deepEq(keys, ['code', 'kind', 'provider', 'route'], file + ' 的属性集变了');
      ok(/\.\.\.\(Number\.isInteger\(e && e\.status\) \? \{ status: e\.status \} : \{\}\)/.test(src),
        file + ': status 不再是「有整数才发」（不能写 0）');
      for (const key of ['body', 'reason', 'serverMessage']) {
        ok(!new RegExp('\\b' + key + '\\b').test(m[1]), `${file} 把 ${key} 写进了事件属性`);
      }
      ok(new RegExp('if \\(Number\\.isInteger\\(e && e\\.ms\\)\\) fail\\.ms = e\\.ms').test(src),
        file + ': ms 不再是「有整数才发」');
      for (const key of keys) ok(ALLOWED_PROP_KEYS.indexOf(key) >= 0, '表外属性 ' + key);
    });
  }
});
