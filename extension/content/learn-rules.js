// learn-rules.js — pure user-governance rules for the learning layer (记忆层).
// See docs/learning-design.md §4.1 (language whitelist), §7.4 (user delete),
// §8.9 (rules sync) and docs/domain-design.md §9.1 law 3's carve-out: these are
// USER-authored consent rules, never shipped site knowledge. They gate whether
// the capture sink runs — nothing here touches the segmenter or the translation
// path, and nothing here reads storage or the DOM.
//
// PURE by construction, like learn-model.js: no chrome.*, no ambient state. The
// language registry (window.MT_LANGS) is passed IN by callers, mirroring how
// LangDetect is injected rather than probed.
//
// ─── Pattern semantics (the whole spec) ─────────────────────────────────────
// A pattern is `host` or `host/path`, wildcard `*` allowed in either part.
//   • Normalization: trim; drop a `scheme://` prefix; lowercase; strip ONE
//     leading `www.`; the first `/` splits host from path; no path means `*`.
//   • Host: bare `example.com` matches the host itself AND every subdomain.
//     `*.example.com` is the same rule, kept as an accepted explicit spelling.
//     Any other embedded `*` matches greedily (`.*`).
//   • Path: matched against `pathname` only — query string and fragment are
//     deliberately ignored (`?t=42` must not defeat a block). `*` spans
//     segments. `example.com/news/*` requires the `/news/` prefix;
//     `example.com/news` is that exact path.
// The URL side is normalized identically (lowercase host, one `www.` stripped).

var LearnRules = (() => {
  'use strict';

  function escapeRe(s) { return s.replace(/[.+^${}()|[\]\\?]/g, '\\$&'); }
  function wildRe(s) { return new RegExp('^' + escapeRe(s).split('*').join('.*') + '$'); }

  // '' for anything that cannot be a rule. Kept strict on the HOST half (letters,
  // digits, dots, hyphens, `*`) so a pasted full URL with a path survives but
  // garbage ("only a scheme", spaces, an empty host) dies at the door.
  function normalizePattern(p) {
    let s = String(p == null ? '' : p).trim().toLowerCase();
    if (!s) return '';
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
    const slash = s.indexOf('/');
    let host = slash < 0 ? s : s.slice(0, slash);
    let path = slash < 0 ? '' : s.slice(slash);
    host = host.replace(/^www\./, '');
    if (!host || /[^a-z0-9.*-]/.test(host)) return '';
    if (/\s/.test(path)) return '';
    if (path === '/' || path === '/*') path = '';
    return host + path;
  }

  function urlParts(url) {
    let u;
    try { u = new URL(String(url || '')); } catch (_) { return null; }
    return {
      host: u.hostname.toLowerCase().replace(/^www\./, ''),
      path: u.pathname || '/',
    };
  }

  function hostMatches(hostPat, host) {
    if (hostPat.startsWith('*.')) hostPat = hostPat.slice(2);
    if (hostPat.indexOf('*') >= 0) return wildRe(hostPat).test(host);
    return host === hostPat || host.endsWith('.' + hostPat);
  }

  function matchesUrl(pattern, url) {
    const pat = normalizePattern(pattern);
    const parts = urlParts(url);
    if (!pat || !parts) return false;
    const slash = pat.indexOf('/');
    const hostPat = slash < 0 ? pat : pat.slice(0, slash);
    const pathPat = slash < 0 ? '' : pat.slice(slash);
    if (!hostMatches(hostPat, parts.host)) return false;
    if (!pathPat) return true;
    return wildRe(pathPat).test(parts.path);
  }

  // The capture gate's blocklist check. `rules` is the whole learnRules object
  // (or null); absence blocks nothing — fail-open per learning-design §7.4.5.
  function isBlocked(url, rules) {
    const block = rules && Array.isArray(rules.block) ? rules.block : null;
    if (!block || !block.length) return false;
    for (const p of block) { if (matchesUrl(p, url)) return true; }
    return false;
  }

  // The canonical one-tap rule for "this site" (popup 本站). Bare host: matches
  // the whole domain including subdomains, which is what "本站不收录" means to a
  // person — m.example.com and example.com are the same site to them.
  function siteRuleFor(url) {
    const parts = urlParts(url);
    return parts ? parts.host : '';
  }

  // Pure delete selection for 来源管理 (§7.4): which stored items die if this
  // pattern is purged. sources → matching source ids → items pointing at them.
  // Also reports matched sourceIds so the caller can drop orphaned source rows.
  function doomedFor(items, sources, pattern) {
    const srcIds = new Set();
    for (const s of sources || []) {
      if (s && s.id && matchesUrl(pattern, s.url)) srcIds.add(s.id);
    }
    const itemIds = [];
    for (const it of items || []) {
      if (it && it.sourceId && srcIds.has(it.sourceId)) itemIds.push(it.id);
    }
    return { itemIds, sourceIds: Array.from(srcIds) };
  }

  // §8.9 — last-writer-wins over the WHOLE rule set, never per-entry merge.
  function mergeRules(local, incoming) {
    if (!incoming || typeof incoming !== 'object') return local || null;
    if (!local || typeof local !== 'object') return incoming;
    return (incoming.updatedAt || 0) > (local.updatedAt || 0) ? incoming : local;
  }

  // ─── Language whitelist (§4.1) ────────────────────────────────────────────

  // Counted per character over a prefix; the winner needs at least one hit.
  // Kana before Han in the table order is cosmetic — the scripts don't overlap.
  const SCRIPT_RES = [
    ['Kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
    ['Han', /\p{Script=Han}/u],
    ['Hangul', /\p{Script=Hangul}/u],
    ['Latin', /\p{Script=Latin}/u],
    ['Cyrillic', /\p{Script=Cyrillic}/u],
    ['Arabic', /\p{Script=Arabic}/u],
    ['Devanagari', /\p{Script=Devanagari}/u],
    ['Thai', /\p{Script=Thai}/u],
    ['Greek', /\p{Script=Greek}/u],
    ['Hebrew', /\p{Script=Hebrew}/u],
  ];
  const SCAN_MAX = 200;

  function dominantScript(text) {
    const s = String(text == null ? '' : text).slice(0, SCAN_MAX);
    const counts = new Map();
    for (const ch of s) {
      for (const [name, re] of SCRIPT_RES) {
        if (re.test(ch)) { counts.set(name, (counts.get(name) || 0) + 1); break; }
      }
    }
    let best = null, bestN = 0;
    for (const [name, n] of counts) { if (n > bestN) { best = name; bestN = n; } }
    return best;
  }

  function baseCode(lang) {
    return String(lang == null ? '' : lang).toLowerCase().split('-')[0];
  }

  // The whitelist gate. `langs` is learnRules.langs (null = everything that is
  // not targetLang — the default, §4.1); `registry` is window.MT_LANGS. Every
  // unknown falls OPEN: an unrecognized detector code, a whitelisted code the
  // registry doesn't know, a text with no recognizable script. Over-capture is
  // recoverable (delete); silent under-capture is not (§4.1).
  function langAllowed(lang, text, langs, registry) {
    if (!langs || !Array.isArray(langs) || !langs.length) return true;
    const base = baseCode(lang);
    if (base && base !== 'und') {
      return langs.some((c) => baseCode(c) === base);
    }
    if (!registry || !registry.length) return true;
    const allowed = new Set();
    let known = false;
    for (const code of langs) {
      const entry = registry.find((l) => l && baseCode(l.code) === baseCode(code));
      if (!entry) continue;
      known = true;
      for (const sc of entry.scripts || []) allowed.add(sc);
    }
    if (!known) return true;
    const script = dominantScript(text);
    if (!script) return true;
    return allowed.has(script);
  }

  // 规则记录的**唯一**成形处（§8.9）。本地编辑一律走它。
  //
  // 两个字段少了都不会报错，但都会静默出事：
  //   · 少 v      —— 那就不是这个 schema 的记录了
  //   · 少 updatedAt —— mergeRules 的 `(incoming.updatedAt || 0) > (local.updatedAt || 0)`
  //     会把它当成远古记录：**永远输给任何远端**；sync.js 的 rulesDue 判据同样是
  //     `updatedAt > since`，所以它也**永远不会被推上去**。用户的选择就这么没了，
  //     而全程没有一行报错。
  //
  // 这个函数存在是因为同一段逻辑已经被抄了三份（options.js / review.js /
  // app/settings.js），而第四份（引导页）抄错了 —— 它两个字段都没写。
  //
  // ⚠️ **同步收到的记录不要走这里**：chunk.js 写的是远端那一份，重新盖时间戳会让
  // 每一次入站都显得更新，last-writer-wins 就此失效。那条路故意原样落盘。
  function withUpdate(base, patch, now) {
    return Object.assign({ v: 1, block: [], langs: null }, base || {}, patch || {},
      { v: 1, updatedAt: typeof now === 'number' ? now : Date.now() });
  }

  return {
    normalizePattern, matchesUrl, isBlocked, siteRuleFor,
    doomedFor, mergeRules, dominantScript, langAllowed, withUpdate,
  };
})();

if (typeof window !== 'undefined') window.LearnRules = LearnRules;
if (typeof module !== 'undefined' && module.exports) module.exports = LearnRules;
