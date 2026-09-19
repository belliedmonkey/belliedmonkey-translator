// test/hotkey-core.test.js — 快速翻译的快捷键纯逻辑（docs/learning-design.md §9.9，M-7）。
//
// 这里会静默出错的：键码表错一个数 ⇒ 用户设的是 ⌃⌥T、真正注册的是别的键，界面上看不出来；
// 把 ⌘C 这类组合放进来 ⇒ 每个 App 的复制都被我们抢走；用户清掉的快捷键下次启动又回来了。
const path = require('path');
const { describe, test, eq, ok, deepEq } = require('./harness');
const H = require(path.join(__dirname, '..', 'app', 'hotkey-core.js'));
const ev = (code, m) => Object.assign({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, m || {});

describe('HotkeyCore — 键码与修饰键（要和 Carbon 对得上）', () => {
  test('锚点：T=17 S=1 A=0 1=18 5=23 6=22 Space=49 F1=122；掩码 ⌘256 ⇧512 ⌥2048 ⌃4096', () => {
    const k = (c) => H.KEYS[c][0];
    deepEq([k('KeyT'), k('KeyS'), k('KeyA'), k('Digit1'), k('Digit5'), k('Digit6'), k('Space'), k('F1')], [17, 1, 0, 18, 23, 22, 49, 122]);
    deepEq(H.MODS, { cmd: 256, shift: 512, option: 2048, control: 4096 });
  });
  test('虚拟键码没有重复（重复 = 两个键注册成同一个）', () => {
    const codes = Object.values(H.KEYS).map((v) => v[0]); eq(new Set(codes).size, codes.length);
  });
  test('默认值：翻译 ⌃⌥T、截图 ⌃⌥S、输入翻译留空；默认值自己过得了校验', () => {
    eq(H.label(H.DEFAULTS.translate), '⌃⌥T'); eq(H.label(H.DEFAULTS.shot), '⌃⌥S'); eq(H.DEFAULTS.input, null);
    eq(H.validate(H.DEFAULTS.translate), ''); eq(H.DEFAULTS.translate.modifiers, 4096 | 2048); eq(H.DEFAULTS.translate.keyCode, 17);
  });
});

describe('HotkeyCore.fromEvent — 录制', () => {
  test('只按了修饰键、或回车 / Tab / 方向键 ⇒ null（录制继续等）', () => {
    for (const c of ['ControlLeft', 'AltLeft', 'ShiftRight', 'MetaLeft', 'Enter', 'Tab', 'ArrowUp', 'Escape']) eq(H.fromEvent(ev(c, { ctrlKey: true })), null, c);
  });
  test('⌃⌥⇧⌘ 都收进去；显示按系统菜单的顺序 ⌃⌥⇧⌘', () => {
    const c = H.fromEvent(ev('KeyD', { metaKey: true, shiftKey: true, altKey: true, ctrlKey: true }));
    eq(c.modifiers, 256 | 512 | 2048 | 4096); eq(H.label(c), '⌃⌥⇧⌘D'); deepEq(H.parts(c), ['⌃', '⌥', '⇧', '⌘', 'D']);
  });
});

describe('HotkeyCore.validate — 哪些组合不让设', () => {
  const v = (code, m) => H.validate(H.fromEvent(ev(code, m)));
  test('没有修饰键 / 只有 ⇧ ⇒ nomod；功能键单按可以', () => { eq(v('KeyT'), 'nomod'); eq(v('KeyT', { shiftKey: true }), 'nomod'); eq(v('F6'), ''); });
  test('★ 只有 ⌥（或 ⌥⇧）加字母 / 数字 ⇒ deny（新系统上对沙盒 App 不稳）', () => {
    eq(v('KeyD', { altKey: true }), 'deny'); eq(v('Digit2', { altKey: true, shiftKey: true }), 'deny');
  });
  test('只有 ⌘（⌘⇧）加字母 / 数字 ⇒ system：会盖掉每个 App 自己的快捷键（⌘C、⌘⇧Z…）', () => {
    eq(v('KeyC', { metaKey: true }), 'system'); eq(v('KeyZ', { metaKey: true, shiftKey: true }), 'system');
  });
  test('系统占着的：⌘⇧3/4/5、⌘Space、⌃Space… ⇒ system', () => {
    eq(v('Digit4', { metaKey: true, shiftKey: true }), 'system'); eq(v('Space', { metaKey: true }), 'system'); eq(v('Space', { ctrlKey: true }), 'system');
  });
  test('带 ⌃ 的、⌘ 再加 ⌥ 或 ⌃ 的 ⇒ 可以', () => {
    eq(v('KeyT', { ctrlKey: true, altKey: true }), ''); eq(v('KeyE', { metaKey: true, altKey: true }), ''); eq(v('KeyE', { ctrlKey: true }), '');
  });
});

describe('HotkeyCore — 三个之间不撞、存储、交给原生的形状', () => {
  test('和另一个功能撞了 ⇒ 说出是哪一个', () => {
    eq(H.duplicateOf('input', H.DEFAULTS.shot, H.DEFAULTS), 'shot'); eq(H.duplicateOf('shot', H.DEFAULTS.shot, H.DEFAULTS), '');
  });
  test('没存过 ⇒ 默认值；★ 存的是 null ⇒ 用户清掉了，保持空；形状不对 / 如今过不了校验的 ⇒ 默认值', () => {
    deepEq(H.normalize(undefined), { translate: H.DEFAULTS.translate, shot: H.DEFAULTS.shot, input: null });
    eq(H.normalize({ translate: null }).translate, null);
    eq(H.label(H.normalize({ shot: { code: 'KeyD', modifiers: 2048 } }).shot), '⌃⌥S', '只有 ⌥ 的旧值不该被原样放行');
    eq(H.label(H.normalize({ input: { code: 'KeyI', modifiers: 4096 | 2048 } }).input), '⌃⌥I');
    eq(H.label(H.normalize({ translate: { code: 'Nope', modifiers: 4096 } }).translate), '⌃⌥T');
  });
  test('交给原生：数字 + 小写字符（菜单上的 keyEquivalent 大写会自带 ⇧）；功能键没有字符；空 ⇒ null', () => {
    deepEq(H.wire(H.DEFAULTS.translate), { keyCode: 17, modifiers: 6144, char: 't' });
    eq(H.wire(H.fromEvent(ev('F6'))).char, ''); eq(H.wire(null), null);
  });
});
