// test/learn-rules.test.js — user-governance rules (learning-design §4.1/§7.4/§8.9).
//
// Like the salience gate, most of this module's value is NEGATIVE — the sites it
// refuses to block, the languages it refuses to drop. Table-driven where the spec
// is a table (the matcher), direct where the spec is a sentence.

const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');

function load() {
  // URL is a platform global in every real host (content script, extension page,
  // WKWebView); the bare vm sandbox is the only place it needs seeding.
  const ctx = loadModule('learn-rules.js', { window: {}, URL });
  return ctx.LearnRules;
}

const REGISTRY = [
  { code: 'en', scripts: ['Latin'] },
  { code: 'ja', scripts: ['Han', 'Kana'] },
  { code: 'zh', scripts: ['Han'] },
  { code: 'ko', scripts: ['Hangul', 'Han'] },
  { code: 'ru', scripts: ['Cyrillic'] },
];

describe('LearnRules — normalizePattern', () => {
  test('strips scheme, www, lowercases; keeps host/path split', () => {
    const R = load();
    eq(R.normalizePattern('HTTPS://WWW.Example.COM/News/*'), 'example.com/news/*');
    eq(R.normalizePattern('  example.com  '), 'example.com');
    eq(R.normalizePattern('example.com/'), 'example.com');
    eq(R.normalizePattern('example.com/*'), 'example.com');
    eq(R.normalizePattern('*.example.com'), '*.example.com');
  });

  test('rejects garbage: empty, spaces, empty host, scheme-only', () => {
    const R = load();
    eq(R.normalizePattern(''), '');
    eq(R.normalizePattern('   '), '');
    eq(R.normalizePattern('https://'), '');
    eq(R.normalizePattern('exa mple.com'), '');
    eq(R.normalizePattern('example.com/a b'), '');
    eq(R.normalizePattern(null), '');
  });
});

describe('LearnRules — matchesUrl (the matcher spec, as a table)', () => {
  const CASES = [
    // [pattern, url, expected]
    ['example.com', 'https://example.com/page', true],
    ['example.com', 'https://www.example.com/page', true],
    ['example.com', 'https://sub.example.com/page', true],          // bare host = subdomains too
    ['example.com', 'https://notexample.com/page', false],          // no substring matching
    ['example.com', 'https://example.com.evil.io/', false],
    ['*.example.com', 'https://sub.example.com/', true],            // explicit spelling, same rule
    ['*.example.com', 'https://example.com/', true],
    ['example.com/news/*', 'https://example.com/news/2026/story', true],
    ['example.com/news/*', 'https://example.com/sports/story', false],
    ['example.com/news/*', 'https://example.com/news/x?t=42', true], // query ignored
    ['example.com/news', 'https://example.com/news', true],          // exact path
    ['example.com/news', 'https://example.com/news/2026', false],
    ['https://www.example.com', 'https://m.example.com/x', true],    // pattern side normalized
    ['e*e.com', 'https://example.com/', true],                       // embedded wildcard in host
    ['e*e.com', 'https://sample.com/', false],
    ['example.com', 'not a url', false],
    ['', 'https://example.com/', false],
  ];
  for (const [pat, url, want] of CASES) {
    test(`'${pat}' vs ${url} → ${want}`, () => {
      eq(load().matchesUrl(pat, url), want);
    });
  }
});

describe('LearnRules — isBlocked / siteRuleFor', () => {
  test('no rules / empty block list blocks nothing (fail-open, §7.4.5)', () => {
    const R = load();
    eq(R.isBlocked('https://example.com/', null), false);
    eq(R.isBlocked('https://example.com/', {}), false);
    eq(R.isBlocked('https://example.com/', { block: [] }), false);
  });

  test('any matching rule blocks; a broken rule in the list is inert, not fatal', () => {
    const R = load();
    const rules = { block: ['bad rule!!', 'reddit.com'] };
    eq(R.isBlocked('https://www.reddit.com/r/languagelearning', rules), true);
    eq(R.isBlocked('https://example.com/', rules), false);
  });

  test('siteRuleFor: bare host, www stripped — one tap covers the whole site', () => {
    const R = load();
    eq(R.siteRuleFor('https://www.example.com/deep/page?q=1'), 'example.com');
    eq(R.siteRuleFor('https://m.example.com/x'), 'm.example.com');
    eq(R.siteRuleFor('garbage'), '');
    // The rule it produces must round-trip through the matcher.
    ok(R.matchesUrl(R.siteRuleFor('https://www.example.com/a'), 'https://example.com/b'));
  });
});

describe('LearnRules — doomedFor (delete selection is a join, not a scan of items)', () => {
  const SOURCES = [
    { id: 's1', url: 'https://example.com/article-1' },
    { id: 's2', url: 'https://example.com/article-2' },
    { id: 's3', url: 'https://other.io/post' },
  ];
  const ITEMS = [
    { id: 'i1', sourceId: 's1' },
    { id: 'i2', sourceId: 's2' },
    { id: 'i3', sourceId: 's3' },
    { id: 'i4', sourceId: '' },       // outbox item with no source — never doomed
  ];

  test('one domain pattern dooms every item from every matching URL', () => {
    const got = load().doomedFor(ITEMS, SOURCES, 'example.com');
    deepEq(got.itemIds.sort(), ['i1', 'i2']);
    deepEq(got.sourceIds.sort(), ['s1', 's2']);
  });

  test('a path pattern narrows the selection', () => {
    const got = load().doomedFor(ITEMS, SOURCES, 'example.com/article-1');
    deepEq(got.itemIds, ['i1']);
  });

  test('no match → empty, never throws on empty inputs', () => {
    const R = load();
    deepEq(R.doomedFor(ITEMS, SOURCES, 'nomatch.net'), { itemIds: [], sourceIds: [] });
    deepEq(R.doomedFor([], [], 'example.com'), { itemIds: [], sourceIds: [] });
  });
});

describe('LearnRules — mergeRules (LWW over the whole set, §8.9)', () => {
  test('newer updatedAt wins wholesale; ties keep local', () => {
    const R = load();
    const a = { v: 1, block: ['a.com'], langs: null, updatedAt: 100 };
    const b = { v: 1, block: ['b.com'], langs: ['en'], updatedAt: 200 };
    deepEq(R.mergeRules(a, b), b);
    deepEq(R.mergeRules(b, a), b);
    deepEq(R.mergeRules(a, { ...b, updatedAt: 100 }), a);   // tie → local (no churn)
  });

  test('either side missing → the other, never a throw', () => {
    const R = load();
    const a = { v: 1, block: [], langs: null, updatedAt: 5 };
    deepEq(R.mergeRules(null, a), a);
    deepEq(R.mergeRules(a, null), a);
    eq(R.mergeRules(null, null), null);
  });
});

describe('LearnRules — dominantScript', () => {
  test('recognizes the product scripts', () => {
    const R = load();
    eq(R.dominantScript('The quick brown fox'), 'Latin');
    eq(R.dominantScript('这是一段中文句子'), 'Han');
    eq(R.dominantScript('これはにほんごのぶんです'), 'Kana');
    eq(R.dominantScript('한국어 문장입니다'), 'Hangul');
    eq(R.dominantScript('Это русское предложение'), 'Cyrillic');
    eq(R.dominantScript('هذه جملة عربية'), 'Arabic');
    eq(R.dominantScript('1234 !!! …'), null);
    eq(R.dominantScript(''), null);
  });

  test('mixed ja text: kanji-heavy → Han, kana-heavy → Kana (both pass a [ja] whitelist)', () => {
    const R = load();
    eq(R.dominantScript('日本語の文章を勉強する'), 'Han');
    eq(R.dominantScript('これはとてもながい文'), 'Kana');
  });
});

describe('LearnRules — langAllowed (the whitelist gate, §4.1)', () => {
  test('null / empty whitelist admits everything — the default is "all"', () => {
    const R = load();
    eq(R.langAllowed('ja', 'x', null, REGISTRY), true);
    eq(R.langAllowed('und', 'x', [], REGISTRY), true);
  });

  test('a detected language is judged by code, base-code compared', () => {
    const R = load();
    eq(R.langAllowed('en', 'Hello', ['en'], REGISTRY), true);
    eq(R.langAllowed('en-GB', 'Hello', ['en'], REGISTRY), true);
    eq(R.langAllowed('ja', 'こんにちは', ['en'], REGISTRY), false);
    eq(R.langAllowed('zh-CN', 'x', ['zh'], REGISTRY), true);
  });

  test("'und' (every Safari) falls back to script compatibility", () => {
    const R = load();
    // Learning English on iOS: Latin passes, Japanese does not.
    eq(R.langAllowed('und', 'An English sentence.', ['en'], REGISTRY), true);
    eq(R.langAllowed('und', 'これはにほんごのぶんです', ['en'], REGISTRY), false);
    // Learning Japanese: kana and kanji both pass; Latin does not.
    eq(R.langAllowed('und', 'これはにほんごのぶんです', ['ja'], REGISTRY), true);
    eq(R.langAllowed('und', '日本語の文章', ['ja'], REGISTRY), true);
    eq(R.langAllowed('und', 'An English sentence.', ['ja'], REGISTRY), false);
  });

  test('documented looseness: pure-kanji ja passes a [zh] whitelist (Han is shared)', () => {
    eq(load().langAllowed('und', '日本語文章勉強', ['zh'], REGISTRY), true);
  });

  test('every unknown falls OPEN: no registry, unknown whitelisted code, unscriptable text', () => {
    const R = load();
    eq(R.langAllowed('und', 'Hello', ['en'], null), true);
    eq(R.langAllowed('und', 'Hello', ['tlh'], REGISTRY), true);   // registry can't judge → open
    eq(R.langAllowed('und', '1234', ['en'], REGISTRY), true);      // no script → open
  });
});
