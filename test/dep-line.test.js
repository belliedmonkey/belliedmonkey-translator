// test/dep-line.test.js — 功能块首行的「依赖」行（interaction-spec「设置页信息架构」②，2026-09-17）。
// 判据来自既有判据，标签来自注册表，快速档一句话，不可用的实时转写没有「去配置」。
const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');

const PROVIDERS = [{ id: 'google', label: 'Google', needsKey: false }, { id: 'deepseek', label: 'DeepSeek', needsKey: true }];
const TTS = [{ id: 'browser', label: '设备内置语音', labelKey: 'tts_engine_browser' }, { id: 'device', label: '设备内置朗读', type: 'device-speech' }];
const STT = [{ id: 'openrouter_transcribe', label: 'OpenRouter · transcription' }];
const T = (k, d) => (k === 'tts_engine_browser' ? '系统语音' : d);

function load() {
  const window = { MT_PROVIDERS: PROVIDERS, MT_TTS_ENGINES: TTS, MT_STT_ENGINES: STT };
  return loadModule(['content/engine-state.js', 'learn/engine-fields.js', 'learn/dep-line.js'], { window }).DepLine;
}

describe('DepLine.items — 五种槽、四种状态', () => {
  test('翻译：配了 key ⇒ ok + 注册表标签；没配 ⇒ unset', () => {
    const D = load();
    deepEq(D.items({ provider: 'deepseek', apiKey: 'k' }, { slots: ['chat'], t: T }).map((x) => [x.state, x.label]), [['ok', 'DeepSeek']]);
    eq(D.items({ provider: 'deepseek' }, { slots: ['chat'], t: T })[0].state, 'unset');
  });
  test('朗读 / 整段转写：引擎 id 在注册表里 ⇒ ok（标签走 labelKey）；空 ⇒ unset', () => {
    const D = load();
    const r = D.items({ ttsEngine: 'browser', sttEngine: '' }, { slots: ['tts', 'stt'], t: T });
    deepEq(r.map((x) => [x.slot, x.state, x.label]), [['tts', 'ok', '系统语音'], ['stt', 'unset', '']]);
    eq(r[1].text, '未配置');
  });
  test('解析：notesProvider 为空 = 跟随翻译引擎（follow，不是 unset）', () => {
    const D = load();
    eq(D.items({}, { slots: ['notes'], t: T })[0].state, 'follow');
    eq(D.items({ notesProvider: 'deepseek' }, { slots: ['notes'], t: T })[0].label, 'DeepSeek');
  });
  test('实时转写：由宿主传 NativeSpeech 的结论 —— ok 是本机；不可用是 na，文案分系统 / 语言', () => {
    const D = load();
    eq(D.items({}, { slots: ['live'], live: { ok: true }, t: T })[0].state, 'ok');
    const os = D.items({}, { slots: ['live'], live: { ok: false, reason: 'os' }, t: T })[0];
    ok(os.state === 'na' && /iOS 26/.test(os.text), JSON.stringify(os));
    ok(/语言/.test(D.items({}, { slots: ['live'], live: { ok: false, reason: 'locale' }, t: T })[0].text));
  });
  test('快速档且一键卡表示得了这份配置 ⇒ 只有一句「由一键配置提供 ✓」', () => {
    const D = load();
    const r = D.items({ provider: 'deepseek', apiKey: 'k' }, { slots: ['chat', 'tts'], quick: true, t: T });
    eq(r.length, 1); eq(r[0].state, 'quick');
  });
});

describe('DepLine.render — 只读，未配置的槽才有「去配置 →」，实时转写不可用没有', () => {
  function fakeEl() {
    const kids = [];
    const mk = () => ({ children: [], className: '', textContent: '', dataset: {}, listeners: {}, appendChild(c) { this.children.push(c); }, addEventListener(ev, fn) { this.listeners[ev] = fn; } });
    return { ownerDocument: { createElement: () => mk() }, classList: { add() {} }, textContent: '', appendChild: (c) => kids.push(c), kids };
  }
  test('渲染出「依赖」+ 每槽一段；unset 的带按钮、ok 的不带、na 的不带', () => {
    const D = load();
    const el = fakeEl(); const gone = [];
    D.render(el, { ttsEngine: 'browser', sttEngine: '' }, { slots: ['tts', 'stt', 'live'], live: { ok: false, reason: 'os' }, t: T, onGo: (s) => gone.push(s) });
    eq(el.kids[0].textContent, '依赖');
    const segs = el.kids.slice(1);
    eq(segs.length, 3);
    ok(/朗读：系统语音 ✓/.test(segs[0].textContent), segs[0].textContent);
    eq(segs[0].children.length, 0, 'ok 的槽不带「去配置」');
    eq(segs[1].children.length, 1, 'unset 的槽带「去配置」');
    segs[1].children[0].listeners.click();
    deepEq(gone, ['stt']);
    eq(segs[2].children.length, 0, '实时转写不可用不是配置问题，没有「去配置」');
    ok(/iOS 26/.test(segs[2].textContent));
  });
  test('元素为空 ⇒ 不抛、返回空表', () => {
    const D = load();
    deepEq(D.render(null, {}, {}), []);
  });
});
