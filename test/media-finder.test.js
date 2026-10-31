// test/media-finder.test.js — 「这一页有哪些媒体元素」的唯一实现（第九期，2026-09-11）。
//
// 三件事钉住：① open shadow root 里的 <video> 被找到（web-component 播放器：用户报的「明明有
// 视频却什么都没有」一半来自这里）；② pick 的偏好顺序：正在播放 › 直播 › 最长 › 元数据未到 › 第一个；
// ③ duration 为 NaN（元数据未到）的元素不被丢掉 —— 此前 isFinite(NaN) 为假等于「没有媒体」。
const { describe, test, eq, ok, loadModule } = require('./harness');

function mediaEl(tag, o) {
  return Object.assign({ tagName: tag, paused: true, currentTime: 0, duration: NaN, readyState: 0, currentSrc: '', src: '', isConnected: true,
    shadowRoot: null, addEventListener() {}, removeEventListener() {} }, o || {});
}
function host(children, shadowChildren) {
  const root = { querySelectorAll: () => shadowChildren, mode: 'open' };
  return { tagName: 'MEDIA-PLAYER', shadowRoot: root, querySelectorAll: () => children };
}
function load(tree) {
  const document = { querySelectorAll: () => tree };
  const ctx = loadModule('media-finder.js', { window: {}, document, setTimeout: (fn) => { fn(); return 0; } });
  return ctx.MediaFinder;
}

describe('MediaFinder', () => {
  test('finds a <video> inside an open shadow root', () => {
    const inner = mediaEl('VIDEO', { duration: 120, readyState: 1 });
    const M = load([host([], [inner])]);
    eq(M.all(true).length, 1);
    eq(M.all(true)[0], inner);
  });
  test('pick: playing › live › longest › metadata-less › first', () => {
    const short = mediaEl('VIDEO', { duration: 5, readyState: 1 });
    const long = mediaEl('VIDEO', { duration: 900, readyState: 1 });
    const live = mediaEl('VIDEO', { duration: Infinity, readyState: 1 });
    const playing = mediaEl('AUDIO', { duration: 30, readyState: 1, paused: false, currentTime: 3 });
    const nan = mediaEl('VIDEO', {});
    const M = load([]);
    eq(M.pick([short, long]), long);
    eq(M.pick([short, long, live]), live);
    eq(M.pick([short, long, live, playing]), playing);
    eq(M.pick([nan, short]), short, 'a finite duration beats metadata-less');
    eq(M.pick([nan]), nan, 'metadata-less is still media, not "no media"');
    eq(M.pick([]), null);
  });
  test('describe: NaN duration ⇒ durationS 0 & ready false, never dropped; live ⇒ live:true', () => {
    const M = load([]);
    const d = M.describe(mediaEl('VIDEO', { currentSrc: 'blob:https://x/y' }));
    eq(d.durationS, 0); eq(d.ready, false); eq(d.srcKind, 'blob'); eq(d.tag, 'video');
    ok(M.describe(mediaEl('VIDEO', { duration: Infinity, readyState: 1 })).live);
    eq(M.describe(mediaEl('AUDIO', { currentSrc: 'https://cdn/x.mp3', duration: 61.4, readyState: 2 })).durationS, 61);
    eq(M.describe(mediaEl('VIDEO', { currentSrc: 'https://cdn/live/master.m3u8' })).srcKind, 'manifest');
  });
  test('whenMeta resolves immediately when metadata is in, and on loadedmetadata (or timeout) otherwise', async () => {
    const M = load([]);
    const ready = mediaEl('VIDEO', { readyState: 1 });
    eq(await M.whenMeta(ready, 10), ready);
    let handler = null;
    const pending = mediaEl('VIDEO', { addEventListener: (n, fn) => { handler = fn; } });
    const p = M.whenMeta(pending, 5000);
    ok(typeof handler === 'function', 'listens for loadedmetadata');
    handler();
    eq(await p, pending);
  });
  test('all() is memoized for TTL_MS; invalidate() / force re-walks', () => {
    let n = 0;
    const document = { querySelectorAll: () => { n++; return [mediaEl('AUDIO')]; } };
    const ctx = loadModule('media-finder.js', { window: {}, document, setTimeout: () => 0 });
    const M = ctx.MediaFinder;
    M.all(); M.all(); eq(n, 1);
    M.all(true); eq(n, 2);
    M.invalidate(); M.all(); eq(n, 3);
  });
});
