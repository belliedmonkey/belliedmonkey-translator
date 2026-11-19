// build/china-gate.js — the **public** China-build invariant only.
//
// BEL-172 split: this file no longer carries the region policy (allowed in-country hosts,
// MT_GRANT shape, grantOnly endpoints). That implementation lives in the private
// compliance repository (`china-gate/index.js`, with its falsification suite and
// `check-dist.js` for a built artifact). See BOUNDARY.md §4.
//
// What remains public is the invariant the public artifact must be able to prove on its own:
//   ① no OpenAI / ChatGPT / Claude brand reference (App Store Guideline 5), and
//   ② no `*.supabase.co` host (the Tokyo backend) anywhere in the China artifact.
// Both are public promises, not operator policy. A China store release additionally runs the
// private `check-dist.js`; the public gate is not a substitute for it, and the private gate
// is not a substitute for this one.
//
// `scan(files)` is a pure function: `[{ name, text }] → ['file:line  fragment', …]`.
// The second argument (`opts`) is accepted for call compatibility but is not used.

// Thai Grok peel (BEL-169 / SPEC-THAI-GROK-RELEASE-PEEL): the China artifact must not
// carry the Grok STT protocol event or the xAI endpoints. This is a product peel, not
// the region policy that moved to the private compliance repo (BOUNDARY.md §4).
const BRANDS = /ChatGPT|OpenAI|\bClaude\b|api\.openai\.com|api\.anthropic\.com|api\.x\.ai|wss:\/\/api\.x\.ai|grok-stt-open/i;
// BEL-303 US_INGEST：任何路径的 sentry.io 主机都红。这是**主机**规则，不是品牌词，
// 所以不塞进 BRANDS（BRANDS 是 App Store Guideline 5 的品牌指代）。`.invalid` 占位与
// 裸词 `sentry` 不命中：前者不是 sentry.io，后者不是主机名。
const US_INGEST = /(^|\.)sentry\.io$/i;
const TOKYO = /(^|\.)supabase\.co$/i;
const URL_RE = /https?:\/\/[^\s"'`)\\]+/g;

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase(); } catch (_) { return ''; }
}

// scan([{ name, text }]) → hits. A hit means the line contains a brand token or a URL whose
// host is *.supabase.co. Nothing else is policy here.
function scan(files, _opts) {
  const hits = [];
  for (const f of files || []) {
    String(f.text || '').split('\n').forEach((line, i) => {
      const at = `${f.name}:${i + 1}  ${line.trim().slice(0, 100)}`;
      if (BRANDS.test(line)) { hits.push(at); return; }
      for (const raw of line.match(URL_RE) || []) {
        const host = hostOf(raw);
        if (US_INGEST.test(host)) { hits.push(at + '   ← sentry.io host'); return; }
        if (TOKYO.test(host)) { hits.push(at + '   ← *.supabase.co host'); return; }
      }
    });
  }
  return hits;
}

module.exports = { scan, BRANDS, TOKYO, US_INGEST };
