// build/brands.js — the provider brand words, DERIVED from the registry.
//
// Split out of build.js so a test can require it: build.js is a script that runs a
// whole build on require, so anything only reachable there is, in practice, untestable.
// The gate that uses this (issue #69) is only as good as the derivation, and a
// derivation that silently returns [] would make the gate pass on everything.
//
// Tokens come out of each provider's own `label`, minus the generic words those labels
// also contain. Not a hand-written brand list: a list someone must remember to extend
// is exactly the failure this gate exists to catch.

const LABEL_STOPWORDS = new Set([
  'api', 'key', 'custom', 'chat', 'completions', 'messages', 'compatible',
  '翻译', '免费', '无需', '自定义', '格式',
]);

function providerBrands() {
  const out = new Set();
  for (const p of require('./providers.config.js')) {
    const labels = (p.label && typeof p.label === 'object') ? Object.values(p.label) : [p.label];
    for (const label of labels) {
      for (const tok of String(label || '').split(/[^A-Za-z0-9.一-鿿]+/)) {
        if (!tok) continue;
        if (LABEL_STOPWORDS.has(tok.toLowerCase())) continue;
        // `GLM` is the shortest real brand (3); CJK brands are meaningful at 2 (`智谱`).
        const cjk = /[一-鿿]/.test(tok);
        if (tok.length < (cjk ? 2 : 3)) continue;
        out.add(tok);
      }
    }
  }
  return [...out];
}

module.exports = { providerBrands, LABEL_STOPWORDS };
