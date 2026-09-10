// test/asr-entry.test.js — 弹窗「🎙 实时转写 + 翻译」的五态判定（第九期，2026-09-11）。
// interaction-spec「AI 转写字幕 › Offer」那张表逐行钉住；file_only 的判据只读 liveEndpoint+liveType
//（domain-design §7：实时接口从这两个字段推导，不加 live 旗标）。
const { describe, test, eq, ok, loadModule } = require('./harness');
const A = loadModule('popup/asr-entry.js', { window: {} }).AsrEntry;

const ENGINES = [
  { id: 'or', label: 'OpenRouter', needsKey: true, liveEndpoint: null, liveType: null },
  { id: 'oa', label: 'OpenAI', needsKey: true, liveEndpoint: 'wss://x/realtime', liveType: 'ws-realtime' },
  { id: 'local', label: 'Local', needsKey: false, requiresEndpoint: true, liveEndpoint: null },
];
const media = { durationS: 120, live: false, ready: true, playing: true, srcKind: 'blob', tag: 'video' };

describe('AsrEntry.state — 五态', () => {
  test('no_script: 没有内容脚本（pageStatus 为空）', () => {
    eq(A.state({ pageStatus: null, settings: {}, engines: ENGINES }).kind, 'no_script');
  });
  test('no_engine: 没选引擎 / 要 key 没 key / 要端点没端点', () => {
    eq(A.state({ pageStatus: { media }, settings: {}, engines: ENGINES }).kind, 'no_engine');
    eq(A.state({ pageStatus: { media }, settings: { sttEngine: 'oa', sttApiKey: '' }, engines: ENGINES }).kind, 'no_engine');
    eq(A.state({ pageStatus: { media }, settings: { sttEngine: 'local', sttBaseUrl: '' }, engines: ENGINES }).kind, 'no_engine');
  });
  test('ready vs file_only 只看 liveEndpoint + liveType', () => {
    eq(A.state({ pageStatus: { media }, settings: { sttEngine: 'oa', sttApiKey: 'k' }, engines: ENGINES }).kind, 'ready');
    eq(A.state({ pageStatus: { media }, settings: { sttEngine: 'or', sttApiKey: 'k' }, engines: ENGINES }).kind, 'file_only');
    eq(A.state({ pageStatus: { media }, settings: { sttEngine: 'local', sttBaseUrl: 'http://x' }, engines: ENGINES }).kind, 'file_only');
  });
  test('元数据未到（durationS 0、ready false）也是 ready —— 不再因 NaN 消失', () => {
    const st = A.state({ pageStatus: { media: { durationS: 0, live: false, ready: false } }, settings: { sttEngine: 'oa', sttApiKey: 'k' }, engines: ENGINES });
    eq(st.kind, 'ready');
    eq(A.durationText(st.media, (k, d) => d), '时长未知');
  });
  test('iframe_only: 顶层没有媒体、探针报了 frame ⇒ 给「新标签页打开」出口；否则 no_media', () => {
    const s = { sttEngine: 'oa', sttApiKey: 'k' };
    const st = A.state({ pageStatus: { media: null, frames: [{ href: 'https://player.example/e/1', media: { durationS: 300 } }] }, settings: s, engines: ENGINES });
    eq(st.kind, 'iframe_only'); eq(st.frames[0].href, 'https://player.example/e/1');
    eq(A.state({ pageStatus: { media: null, frames: [] }, settings: s, engines: ENGINES }).kind, 'no_media');
    eq(A.state({ pageStatus: { media: null }, settings: s, engines: ENGINES }).kind, 'no_media');
  });
  test('优先级：没配引擎排在有没有媒体之前', () => {
    eq(A.state({ pageStatus: { media: null, frames: [{ href: 'x' }] }, settings: {}, engines: ENGINES }).kind, 'no_engine');
  });
  test('durationText: 直播 / mm:ss / 时长未知', () => {
    const t = (k, d) => d;
    eq(A.durationText({ live: true }, t), '直播');
    eq(A.durationText({ durationS: 125 }, t), '2:05');
    eq(A.durationText({ durationS: 0 }, t), '时长未知');
    eq(A.durationText(null, t), '');
  });
});
