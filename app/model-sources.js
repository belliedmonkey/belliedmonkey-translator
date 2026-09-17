// app/model-sources.js — 离线朗读模型的下载地址从哪来（learning-design §9.6.1.1，2026-09-17）。
//
// 托管会变（GitHub 在境内拉不动；镜像站也可能有一天关掉），而地址写死在清单里，换一次就要发一版。
// 所以地址由后端表 `bt_model_sources` 决定，这里只做三件事，缺一件就是另一个设计：
//   1. **服务器只能说「去哪下」，不能说「下什么」。** sha256 / size 永远取自 `app/device-models.config.js`，
//      这里只替换 `files[].url`；服务器回的任何别的字段一律忽略。换了文件过不了校验照旧丢。
//   2. **用户口述的下载顺序（逐条对应）：** 没缓存 ⇒ 先问服务器，用默认地址下并缓存默认地址（不设过期）；
//      有缓存 ⇒ 先探可用性，可用直下，不可用 ⇒ 重新问服务器，用新默认地址下并更新缓存；新默认也不可用 ⇒
//      用**当次**拿到的备用地址（备用不缓存）；下载中途失败与探测失败同一处理；服务器连不上 ⇒ 有缓存用缓存、
//      没缓存用清单内置默认值（最后兜底，不是常规路）。
//   3. **这一步永远不能成为下载失败的原因。** 问服务器超时 / 出错 / 空表 / 后端关着，都静默回到下一级。
//
// 只在宿主 App 里加载（模型只有 App 用）；扩展侧没有这个文件，tts.js 会走原来的单地址路。
// 探测与切换都在这里做，原生下载器只收一个地址、不知道有几个。

var ModelSources = (() => {
  'use strict';

  const KEY = 'deviceModelSources';   // chrome.storage.local：{ [flavor]: { [path]: url } } —— 只缓存默认地址
  const TIMEOUT_MS = 5000;
  let deps = {};                       // { fetch, probe, storage, backend } —— 测试与 verify-listen 注入
  function configure(next) { deps = Object.assign({}, deps, next || {}); return deps; }

  function backend() {
    if (deps.backend !== undefined) return deps.backend;
    const B = (typeof MT_BACKEND !== 'undefined') ? MT_BACKEND : null;
    return (B && B.enabled && B.url && B.anonKey) ? { url: B.url, anonKey: B.anonKey } : null;
  }
  function storage() {
    if (deps.storage) return deps.storage;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return {
        get: (k) => new Promise((res) => chrome.storage.local.get([k], (v) => res((v && v[k]) || null))),
        set: (k, v) => new Promise((res) => chrome.storage.local.set({ [k]: v }, res)),
      };
    }
    return { get: async () => null, set: async () => {} };
  }
  function withTimeout(p, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), ms);
      Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }
  const isHttps = (u) => typeof u === 'string' && /^https:\/\//.test(u);

  /** 问服务器：→ { [path]: { url, alt } }，任何失败都是 null（调用方回下一级）。 */
  async function ask(flavor) {
    const b = backend(); if (!b) return null;
    const f = deps.fetch || (typeof fetch === 'function' ? fetch : null); if (!f) return null;
    try {
      const u = b.url + '/rest/v1/bt_model_sources?select=path,url,url_alt&kind=eq.tts&flavor=eq.' + encodeURIComponent(flavor) + '&active=is.true';
      const r = await withTimeout(f(u, { headers: { apikey: b.anonKey, Authorization: 'Bearer ' + b.anonKey, Accept: 'application/json' } }), TIMEOUT_MS);
      if (!r || !r.ok) return null;
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) return null;
      const out = {};
      for (const row of rows) {
        if (!row || !row.path || !isHttps(row.url)) continue;
        out[row.path] = { url: row.url, alt: isHttps(row.url_alt) ? row.url_alt : null };
      }
      return Object.keys(out).length ? out : null;
    } catch (_) { return null; }
  }

  /** 探一下可用性。App 里由 NativeSpeech.probeUrl 提供（Range 0-0，5 s）；没有探针就当可用，让下载本身去判。 */
  async function probe(url) {
    const p = deps.probe || ((typeof NativeSpeech !== 'undefined' && NativeSpeech.probeUrl) ? NativeSpeech.probeUrl : null);
    if (!p) return true;
    try { return !!(await withTimeout(p(url), TIMEOUT_MS + 1000)); } catch (_) { return false; }
  }

  /** 只换 url；sha256 / size / 其它字段原样 —— 规则 1。 */
  function withUrls(models, pick) {
    return (models || []).map((m) => Object.assign({}, m, {
      files: (m.files || []).map((f) => Object.assign({}, f, { url: pick(f) || f.url })),
    }));
  }
  const urlsOf = (spec) => spec.reduce((a, m) => a.concat((m.files || []).map((f) => f.url)), []);

  /**
   * run(models, flavor, download, onSwitch) → { ok, attempts:[{ source, urls, ok, why? }], why? }
   *   download(spec) 是真正下载的一次尝试（App 里 = NativeSpeech.ensureAssets('tts', spec, onProgress)），失败 reject({ reason })。
   *   onSwitch(source) 在换地址重试前调一次，调用方把「地址不可用，换一个重试…」写到进度行。
   *   source ∈ cache | server | server-alt | builtin | builtin-alt
   */
  async function run(models, flavor, download, onSwitch) {
    const paths = (models || []).reduce((a, m) => a.concat((m.files || []).map((f) => f.path)), []);
    const st = storage();
    const all = (await st.get(KEY).catch(() => null)) || {};
    const cache = Object.assign({}, all[flavor] || {});
    const attempts = [];
    let server, asked = false;

    const askOnce = async () => {
      if (asked) return server;
      asked = true;
      server = await ask(flavor);
      if (server) {
        // 只缓存默认地址；备用永远是当次最新的（规则 2）
        let changed = false;
        for (const p of paths) if (server[p] && cache[p] !== server[p].url) { cache[p] = server[p].url; changed = true; }
        if (changed) { try { await st.set(KEY, Object.assign({}, all, { [flavor]: cache })); } catch (_) {} }
      }
      return server;
    };
    const tryTier = async (source, pick) => {
      const spec = withUrls(models, pick);
      const urls = urlsOf(spec);
      if (!urls.length || attempts.some((a) => JSON.stringify(a.urls) === JSON.stringify(urls))) return null;   // 同一组地址不重试
      if (attempts.length && typeof onSwitch === 'function') { try { onSwitch(source); } catch (_) {} }
      try { await download(spec); attempts.push({ source, urls, ok: true }); return { ok: true, attempts, source }; }
      catch (e) { attempts.push({ source, urls, ok: false, why: (e && e.reason) || (e && e.message) || 'download' }); return null; }
    };
    const fromCache = (f) => cache[f.path];
    const fromServer = (f) => server && server[f.path] && server[f.path].url;
    const fromServerAlt = (f) => server && server[f.path] && server[f.path].alt;

    const hasCache = paths.length > 0 && paths.every((p) => isHttps(cache[p]));
    if (hasCache) {
      // ② 有缓存：先探，可用直下
      const okAll = (await Promise.all(paths.map((p) => probe(cache[p])))).every(Boolean);
      if (okAll) { const r = await tryTier('cache', fromCache); if (r) return r; }
      else attempts.push({ source: 'cache', urls: paths.map((p) => cache[p]), ok: false, why: 'probe' });
      // 不可用 ⇒ 重新问；新默认不可用 ⇒ 当次的备用
      if (await askOnce()) {
        const r = await tryTier('server', fromServer); if (r) return r;
        const r2 = await tryTier('server-alt', fromServerAlt); if (r2) return r2;
      }
    } else {
      // ① 没缓存：先问服务器
      if (await askOnce()) {
        const r = await tryTier('server', fromServer); if (r) return r;
        const r2 = await tryTier('server-alt', fromServerAlt); if (r2) return r2;
      } else if (paths.some((p) => isHttps(cache[p]))) {
        // ⑤ 服务器连不上而有（部分）缓存：先用缓存的
        const r = await tryTier('cache', fromCache); if (r) return r;
      }
    }
    // ⑤ 最后兜底：清单内置默认值（及清单里的 urlAlt）
    const r = await tryTier('builtin', (f) => f.url); if (r) return r;
    const r2 = await tryTier('builtin-alt', (f) => f.urlAlt); if (r2) return r2;
    const last = attempts[attempts.length - 1];
    return { ok: false, attempts, why: (last && last.why) || 'download' };
  }

  return { KEY, TIMEOUT_MS, configure, ask, probe, withUrls, run };
})();

if (typeof window !== 'undefined') window.ModelSources = ModelSources;
if (typeof module !== 'undefined' && module.exports) module.exports = ModelSources;
