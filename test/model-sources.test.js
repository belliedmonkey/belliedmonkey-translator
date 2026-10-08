// test/model-sources.test.js — 离线模型下载地址从哪来（learning-design §9.6.1.1，2026-09-17）。
// 钉住用户口述的五种情形 + 「服务器只能说去哪下，不能说下什么」+ 备用不落缓存。
const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');

const MODELS = [
  { lang: 'zh', dir: 'piper-zh', files: [{ path: 'piper-zh.zip', size: 10, sha256: 'a'.repeat(64), url: 'https://builtin/piper-zh.zip', urlAlt: 'https://builtin-alt/piper-zh.zip' }] },
  { lang: 'en', dir: 'piper-en', files: [{ path: 'piper-en.zip', size: 20, sha256: 'b'.repeat(64), url: 'https://builtin/piper-en.zip' }] },
];
const ROWS = [
  { path: 'piper-zh.zip', url: 'https://srv/piper-zh.zip', url_alt: 'https://alt/piper-zh.zip', sha256: 'EVIL', size: 1 },
  { path: 'piper-en.zip', url: 'https://srv/piper-en.zip', url_alt: 'https://alt/piper-en.zip' },
];

function setup(o) {
  const M = loadModule('../app/model-sources.js', { window: {} }).ModelSources;
  const store = { data: Object.assign({}, o.cache ? { deviceModelSources: { china: o.cache } } : {}) };
  const calls = { fetch: 0, probe: [], downloads: [], switches: [] };
  M.configure({
    backend: o.backend === null ? null : { url: 'https://b', anonKey: 'k' },
    storage: { get: async (k) => store.data[k] || null, set: async (k, v) => { store.data[k] = v; } },
    fetch: async (u) => {
      calls.fetch++; calls.lastUrl = u;
      if (o.server === 'down') throw new Error('net');
      if (o.server === 'slow') return new Promise(() => {});
      if (o.server === '500') return { ok: false };
      if (o.server === 'empty') return { ok: true, json: async () => [] };
      return { ok: true, json: async () => (o.rows || ROWS) };
    },
    probe: async (u) => { calls.probe.push(u); return o.probeOk !== false; },
  });
  // download(spec)：按主机名决定成败；记下每次尝试用的地址与 sha256
  const download = async (spec) => {
    const files = spec.map((m) => (m.files || [])[0] || {});
    const urls = files.map((f) => f.url);
    calls.downloads.push({ urls, sha: files.map((f) => f.sha256), size: files.map((f) => f.size) });
    const bad = (o.failHosts || []).some((h) => urls.some((u) => u.startsWith('https://' + h + '/')));
    if (bad) throw { reason: 'download' };
  };
  const MS = o.models || MODELS;
  return { M, store, calls, run: () => M.run(MS, 'china', download, (s) => calls.switches.push(s)) };
}

describe('ModelSources.run —— 用户口述的五种情形', () => {
  test('① 没缓存 ⇒ 先问服务器，用默认地址下，并把默认地址缓存下来（备用不缓存）', async () => {
    const { calls, store, run } = setup({});
    const r = await run();
    ok(r.ok && r.source === 'server', JSON.stringify(r));
    eq(calls.fetch, 1); eq(calls.probe.length, 0, '没缓存不探');
    deepEq(calls.downloads[0].urls, ['https://srv/piper-zh.zip', 'https://srv/piper-en.zip']);
    deepEq(store.data.deviceModelSources.china, { 'piper-zh.zip': 'https://srv/piper-zh.zip', 'piper-en.zip': 'https://srv/piper-en.zip' });
    ok(!JSON.stringify(store.data).includes('https://alt/'), '备用地址不进缓存');
    // 2026-10-08：kind 从只管 tts 放开到 tts + lid（语种识别包走同一套查表）
    ok(/kind=in\.\(tts,lid\)&flavor=eq\.china&active=is\.true/.test(calls.lastUrl), calls.lastUrl);
  });
  test('② 有缓存 ⇒ 先探；可用直接下，不问服务器', async () => {
    const cache = { 'piper-zh.zip': 'https://cached/piper-zh.zip', 'piper-en.zip': 'https://cached/piper-en.zip' };
    const { calls, run } = setup({ cache });
    const r = await run();
    ok(r.ok && r.source === 'cache'); eq(calls.fetch, 0); eq(calls.probe.length, 2);
    deepEq(calls.downloads[0].urls, ['https://cached/piper-zh.zip', 'https://cached/piper-en.zip']);
  });
  test('② 缓存探不通 ⇒ 重新问服务器，用新默认地址下并更新缓存', async () => {
    const cache = { 'piper-zh.zip': 'https://cached/piper-zh.zip', 'piper-en.zip': 'https://cached/piper-en.zip' };
    const { calls, store, run } = setup({ cache, probeOk: false });
    const r = await run();
    ok(r.ok && r.source === 'server', JSON.stringify(r)); eq(calls.fetch, 1);
    eq(calls.downloads.length, 1, '探不通的缓存地址不该去下');
    deepEq(calls.downloads[0].urls, ['https://srv/piper-zh.zip', 'https://srv/piper-en.zip']);
    eq(store.data.deviceModelSources.china['piper-zh.zip'], 'https://srv/piper-zh.zip');
  });
  test('③ 新默认地址下载失败 ⇒ 用当次的备用地址；换地址前调 onSwitch 一次', async () => {
    const { calls, run } = setup({ failHosts: ['srv'] });
    const r = await run();
    ok(r.ok && r.source === 'server-alt', JSON.stringify(r));
    deepEq(calls.downloads.map((d) => d.urls[0]), ['https://srv/piper-zh.zip', 'https://alt/piper-zh.zip']);
    deepEq(calls.switches, ['server-alt']);
  });
  test('④ 下载中途失败与探测失败同一处理：缓存下载失败 ⇒ 重问 ⇒ 新默认 ⇒ 备用；三处都失败才是失败态，why 记最后一次', async () => {
    const cache = { 'piper-zh.zip': 'https://cached/piper-zh.zip', 'piper-en.zip': 'https://cached/piper-en.zip' };
    const { calls, run } = setup({ cache, failHosts: ['cached', 'srv', 'alt', 'builtin', 'builtin-alt'] });
    const r = await run();
    ok(!r.ok && r.why === 'download', JSON.stringify(r));
    deepEq(calls.downloads.map((d) => d.urls[0]), ['https://cached/piper-zh.zip', 'https://srv/piper-zh.zip', 'https://alt/piper-zh.zip', 'https://builtin/piper-zh.zip', 'https://builtin-alt/piper-zh.zip']);
    eq(r.attempts.filter((a) => !a.ok).length, 5);
  });
  test('⑤ 服务器连不上：有缓存用缓存（探过）；没缓存用清单内置默认值 —— 这一步不产生失败态', async () => {
    const cache = { 'piper-zh.zip': 'https://cached/piper-zh.zip', 'piper-en.zip': 'https://cached/piper-en.zip' };
    const a = setup({ cache, server: 'down' });
    const ra = await a.run();
    ok(ra.ok && ra.source === 'cache', JSON.stringify(ra));
    const b = setup({ server: 'down' });
    const rb = await b.run();
    ok(rb.ok && rb.source === 'builtin', JSON.stringify(rb)); eq(b.calls.downloads.length, 1);
    const c = setup({ server: '500' }); ok((await c.run()).source === 'builtin');
    const d = setup({ server: 'empty' }); ok((await d.run()).source === 'builtin');
    const e = setup({ backend: null }); const re = await e.run(); ok(re.source === 'builtin'); eq(e.calls.fetch, 0, '后端关着不问');
  });
  test('服务器慢（超时）⇒ 回清单，不挂死', async () => {
    const { M, run } = setup({ server: 'slow' });
    const saved = M.TIMEOUT_MS;
    const r = await Promise.race([run(), new Promise((res) => setTimeout(() => res({ ok: false, why: 'test-hang' }), saved + 2000))]);
    ok(r.ok && r.source === 'builtin', JSON.stringify(r));
  });
});

describe('ModelSources —— 服务器只能说「去哪下」，不能说「下什么」', () => {
  test('服务器回的 sha256 / size 一律忽略；每次尝试的 sha256 与清单逐字相同', async () => {
    const { calls, run } = setup({ failHosts: ['srv'] });
    await run();
    for (const d of calls.downloads) { deepEq(d.sha, ['a'.repeat(64), 'b'.repeat(64)]); deepEq(d.size, [10, 20]); }
  });
  test('服务器给的非 https 地址当作没有；行里缺 path 的忽略', async () => {
    const { run } = setup({ rows: [{ path: 'piper-zh.zip', url: 'http://srv/x.zip', url_alt: 'ftp://x' }, { url: 'https://nopath/x.zip' }] });
    const r = await run();
    eq(r.source, 'builtin');
  });
  test('withUrls 只换 url，其它字段原样', () => {
    const M = loadModule('../app/model-sources.js', { window: {} }).ModelSources;
    const out = M.withUrls(MODELS, (f) => 'https://x/' + f.path);
    eq(out[0].files[0].url, 'https://x/piper-zh.zip'); eq(out[0].files[0].sha256, 'a'.repeat(64)); eq(out[0].dir, 'piper-zh');
    eq(MODELS[0].files[0].url, 'https://builtin/piper-zh.zip', '不改原清单');
  });
});


// ── 第三十批 M-02…M-04（H4）：lid（ECAPA）与 tts 走**同一条**通道 ────────────────
// 判据全部来自回归清单；表里那两行 kind='lid' 的地址是**中继地址**（真实托管由服务端按 IP 选）。
describe('M-02…M-04 · 语种识别包（kind=lid）也走同一条查表/探测/换源', () => {
  const ECAPA = [{
    dir: 'speechbrain-ecapa-voxlingua107', engine: 'ecapa', langs: ['zh', 'th'], threshold: 6,
    files: [{ path: 'speechbrain-ecapa-voxlingua107.zip', size: 39614532, sha256: 'f'.repeat(64),
      url: 'https://api.belliedmonkey.com/models/speechbrain-ecapa-voxlingua107.zip',
      urlAlt: 'https://api.belliedmonkey.com/models/speechbrain-ecapa-voxlingua107.zip?src=other' }],
  }];
  const LID_ROW = [{ path: 'speechbrain-ecapa-voxlingua107.zip', url: 'https://srv/ecapa.zip', url_alt: 'https://alt/ecapa.zip' }];

  test('M-02 表里有 lid 行 ⇒ 用表里的 url（不是清单里的内置地址）', async () => {
    const { calls, run } = setup({ models: ECAPA, rows: LID_ROW });
    const r = await run();
    ok(r.ok && r.source === 'server', JSON.stringify(r));
    eq(calls.downloads[0].urls[0], 'https://srv/ecapa.zip');
    eq(calls.downloads[0].sha[0], 'f'.repeat(64), '用了表里的 sha256（服务器不能说「下什么」）');
  });

  test('M-02 表里 url_alt 不是 https ⇒ 丢掉、当作没有（换源时不会用它）', async () => {
    const { calls, run } = setup({ models: ECAPA, rows: [{ path: 'speechbrain-ecapa-voxlingua107.zip', url: 'http://plain/ecapa.zip', url_alt: 'http://plain-alt/ecapa.zip' }] });
    const r = await run();
    // 表里两行都不是 https ⇒ 整行被忽略 ⇒ 回清单内置值
    ok(r.ok && r.source === 'builtin', JSON.stringify(r));
    eq(calls.downloads[0].urls[0], ECAPA[0].files[0].url);
  });

  test('M-02 表里只有 tts 行 ⇒ lid 走清单地址', async () => {
    const { calls, run } = setup({ models: ECAPA, rows: [{ path: 'piper-zh.zip', url: 'https://srv/piper-zh.zip' }] });
    const r = await run();
    ok(r.ok, JSON.stringify(r));
    eq(calls.downloads[0].urls[0], ECAPA[0].files[0].url, '拿不到 lid 行 ⇒ 用清单里的内置地址');
  });

  test('M-03 主地址失败 ⇒ 自动换 url_alt，sha256 仍是清单里那一个', async () => {
    const { calls, run } = setup({ models: ECAPA, rows: LID_ROW, failHosts: ['srv'] });
    const r = await run();
    ok(r.ok && r.source === 'server-alt', JSON.stringify(r));
    eq(calls.downloads[1].urls[0], 'https://alt/ecapa.zip');
    eq(calls.downloads[1].sha[0], 'f'.repeat(64));
    eq(calls.switches.length, 1, '换地址前要调一次 onSwitch');
  });

  test('M-03 主源与备用都失败 ⇒ 报真实原因，且不挂死（把清单兜底也试完）', async () => {
    const { run } = setup({ models: ECAPA, rows: LID_ROW, failHosts: ['srv', 'alt', 'api.belliedmonkey.com'] });
    const r = await run();
    ok(!r.ok, '两个来源都失败时不该报成功');
    eq(r.why, 'download', 'why 要是真实原因（下载失败），不能是笼统的「连不上服务器」');
    ok(r.attempts.length >= 2, 'attempts 里要看得到每一级');
  });

  test('M-04 表超时 / 500 / 空表 ⇒ 用清单的内置地址与 urlAlt，LID 不会因此停下', async () => {
    for (const server of ['slow', '500', 'empty', 'down']) {
      const { calls, run } = setup({ models: ECAPA, server });
      const r = await run();
      ok(r.ok && r.source === 'builtin', server + ' ⇒ 兜到清单的内置地址下完（' + JSON.stringify(r).slice(0, 120) + '）');
      ok(calls.downloads.every((d) => d.sha[0] === 'f'.repeat(64)), server + '：每一级用的都是清单里的 sha256');
    }
  });
});
