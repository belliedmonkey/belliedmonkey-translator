// build/test400.js — BEL-280 TEST-BUILD-ONLY relay 400 probe.
//
// `MT_TEST_400=<reason>` turns on a header that only grant requests carry:
//
//     x-mt-test-400: json_syntax | messages_json | audio_decode | input_invalid
//
// The relay honours it only for an allowlisted token hash, and only when its own
// RELAY_TEST_400_TOKENS is set. This file is the CLIENT half: it rewrites the two
// sentinels in extension/content/request-shape.js at BUILD time.
//
// WHY SENTINELS INSTEAD OF A RUNTIME `process.env` CHECK
//   request-shape.js runs in a browser (and is concatenated into dist-app/Script.js
//   and the system-translate bundle). `process` does not exist there, and a runtime
//   branch would leave the literal header name in EVERY shipped bundle even when the
//   feature is off. The release requirement is stronger: with MT_TEST_400 unset the
//   string `x-mt-test-400` must not appear anywhere under dist*/ — a build-time
//   substitution is the only shape that can prove that by grep.
//
// The build also forces SKIP_ZIP (a .not-shippable marker) whenever the flag is set,
// and scripts/check-shippable.js independently fails if the literal marker is found
// in any dist* tree. Two independent reasons a test build cannot be uploaded.
'use strict';

const HEADER = 'x-mt-test-400';
const SENTINEL_HEADER = '__MT_TEST400_HEADER__';
const SENTINEL_REASON = '__MT_TEST400_REASON__';
const REASONS = Object.freeze(['json_syntax', 'messages_json', 'audio_decode', 'input_invalid']);

// `MT_TEST_400` is an exact enum, not a free string. A typo must fail the build —
// silently building a "test" bundle that sends no header would reproduce exactly the
// BEL-270 gap this task exists to close (a probe that never probes).
function reasonFromEnv(env = process.env) {
  const raw = String(env.MT_TEST_400 == null ? '' : env.MT_TEST_400).trim();
  if (!raw) return '';
  if (REASONS.indexOf(raw) < 0) {
    throw new Error(`MT_TEST_400 must be one of ${REASONS.join(', ')}; got ${JSON.stringify(raw)}`);
  }
  return raw;
}

// Replace the two sentinels exactly once each. Text without sentinels is returned
// unchanged so callers can apply this to every bundle input (only request-shape.js
// carries them). A half-present pair is a build error: a silent no-op here would
// ship a probe with no reason.
function apply(text, reason) {
  let out = String(text == null ? '' : text);
  const hasHeader = out.indexOf(SENTINEL_HEADER) >= 0;
  const hasReason = out.indexOf(SENTINEL_REASON) >= 0;
  if (!hasHeader && !hasReason) return out;
  if (!hasHeader || !hasReason) {
    throw new Error('test400: request-shape.js has only one of the two sentinels — refusing to half-apply');
  }
  const headerCount = out.split(SENTINEL_HEADER).length - 1;
  const reasonCount = out.split(SENTINEL_REASON).length - 1;
  if (headerCount !== 1 || reasonCount !== 1) {
    throw new Error(`test400: expected exactly one of each sentinel, got header=${headerCount} reason=${reasonCount}`);
  }
  if (reason && REASONS.indexOf(reason) < 0) throw new Error('test400: invalid reason ' + JSON.stringify(reason));
  out = out.replace(SENTINEL_HEADER, reason ? HEADER : '');
  out = out.replace(SENTINEL_REASON, reason ? reason : '');
  return out;
}

module.exports = { HEADER, SENTINEL_HEADER, SENTINEL_REASON, REASONS, reasonFromEnv, apply };
