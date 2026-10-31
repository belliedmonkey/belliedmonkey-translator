// app/hotkey-core.js — 快速翻译的全局快捷键：纯逻辑（docs/learning-design.md §9.9，M-7）。
// 没有 DOM、没有存储、没有桥。键盘事件 → 组合；组合 → 校验 / 显示 / 交给原生的数字。
//
// 原生那头是 Carbon RegisterEventHotKey：它要 macOS 的**虚拟键码**与 Carbon 的修饰键位掩码，所以这张表必须在这里
// （KeyboardEvent.code 是物理键位，与键盘布局无关，正好对应虚拟键码）。test/hotkey-core.test.js 钉住几个锚点。
(function (root) {
  'use strict';

  const MODS = { cmd: 256, shift: 512, option: 2048, control: 4096 };
  const SYMBOL = [['control', '⌃'], ['option', '⌥'], ['shift', '⇧'], ['cmd', '⌘']];   // 系统菜单里的书写顺序

  // KeyboardEvent.code → [macOS 虚拟键码, 显示用的字符]
  const KEYS = {
    KeyA: [0, 'A'], KeyS: [1, 'S'], KeyD: [2, 'D'], KeyF: [3, 'F'], KeyH: [4, 'H'], KeyG: [5, 'G'], KeyZ: [6, 'Z'], KeyX: [7, 'X'], KeyC: [8, 'C'], KeyV: [9, 'V'],
    KeyB: [11, 'B'], KeyQ: [12, 'Q'], KeyW: [13, 'W'], KeyE: [14, 'E'], KeyR: [15, 'R'], KeyY: [16, 'Y'], KeyT: [17, 'T'], KeyO: [31, 'O'], KeyU: [32, 'U'],
    KeyI: [34, 'I'], KeyP: [35, 'P'], KeyL: [37, 'L'], KeyJ: [38, 'J'], KeyK: [40, 'K'], KeyN: [45, 'N'], KeyM: [46, 'M'],
    Digit1: [18, '1'], Digit2: [19, '2'], Digit3: [20, '3'], Digit4: [21, '4'], Digit6: [22, '6'], Digit5: [23, '5'], Digit9: [25, '9'], Digit7: [26, '7'], Digit8: [28, '8'], Digit0: [29, '0'],
    Equal: [24, '='], Minus: [27, '-'], BracketRight: [30, ']'], BracketLeft: [33, '['], Quote: [39, '\''], Semicolon: [41, ';'], Backslash: [42, '\\'],
    Comma: [43, ','], Slash: [44, '/'], Period: [47, '.'], Backquote: [50, '`'], Space: [49, 'Space'],
    F1: [122, 'F1'], F2: [120, 'F2'], F3: [99, 'F3'], F4: [118, 'F4'], F5: [96, 'F5'], F6: [97, 'F6'], F7: [98, 'F7'], F8: [100, 'F8'], F9: [101, 'F9'], F10: [109, 'F10'], F11: [103, 'F11'], F12: [111, 'F12'],
  };
  const IDS = ['translate', 'shot', 'input'];
  const combo = (code, mods) => ({ code, keyCode: KEYS[code][0], modifiers: mods.reduce((n, m) => n | MODS[m], 0), char: KEYS[code][1] });
  // 默认值：翻译 ⌃⌥T · 截图 ⌃⌥S · 输入翻译留空（画布裁定）。不用纯 ⌥ 组合：新系统上对沙盒 App 不稳。
  const DEFAULTS = Object.freeze({ translate: combo('KeyT', ['control', 'option']), shot: combo('KeyS', ['control', 'option']), input: null });

  // 键盘事件 → 组合。只按了修饰键、或按的是我们不收的键（回车、Tab、方向键…）⇒ null：录制继续等。
  function fromEvent(e) {
    if (!e || !KEYS[e.code]) return null;
    const mods = [];
    if (e.ctrlKey) mods.push('control'); if (e.altKey) mods.push('option'); if (e.shiftKey) mods.push('shift'); if (e.metaKey) mods.push('cmd');
    return combo(e.code, mods);
  }

  const has = (c, m) => (c.modifiers & MODS[m]) !== 0;
  const isFn = (c) => /^F\d+$/.test(c.code);
  const SYSTEM = [   // 系统自己占着的：注册不会报错，但永远轮不到我们
    ['Digit3', MODS.cmd | MODS.shift], ['Digit4', MODS.cmd | MODS.shift], ['Digit5', MODS.cmd | MODS.shift],
    ['Space', MODS.cmd], ['Space', MODS.control], ['Space', MODS.cmd | MODS.option], ['Space', MODS.control | MODS.option],
    ['KeyQ', MODS.cmd | MODS.control], ['KeyD', MODS.cmd | MODS.option], ['KeyF', MODS.cmd | MODS.control],
  ];

  // '' = 可以用。别的都是「为什么不行」的码，界面各有一句话：
  //   'nomod'   没有修饰键（功能键 F1–F12 除外）—— 会把这个键从所有 App 里抢走
  //   'deny'    只有 ⌥（或 ⌥⇧）加字母 / 数字 —— 新系统上对沙盒 App 不稳，而且它本来是打特殊字符用的
  //   'system'  系统占着，或只有 ⌘（⌘⇧）加字母 / 数字 —— 会盖掉每个 App 自己的 ⌘ 快捷键
  function validate(c) {
    if (!c || !KEYS[c.code]) return 'nomod';
    const m = c.modifiers;
    if (!m || m === MODS.shift) return isFn(c) && !m ? '' : 'nomod';
    if (!has(c, 'control') && !has(c, 'cmd')) return isFn(c) ? '' : 'deny';
    if (SYSTEM.some(([code, mods]) => code === c.code && mods === m)) return 'system';
    if (!has(c, 'control') && !has(c, 'option') && !isFn(c)) return 'system';
    return '';
  }

  const same = (a, b) => !!a && !!b && a.keyCode === b.keyCode && a.modifiers === b.modifiers;
  // 三个快捷键之间不能撞：返回撞上的那个 id，或 ''。
  function duplicateOf(id, c, all) {
    for (const other of IDS) if (other !== id && same(c, (all || {})[other])) return other;
    return '';
  }

  const label = (c) => (c ? SYMBOL.filter(([m]) => has(c, m)).map(([, s]) => s).join('') + c.char : '');
  const parts = (c) => (c ? SYMBOL.filter(([m]) => has(c, m)).map(([, s]) => s).concat([c.char]) : []);

  // 存储里的值 → 三个组合。没存过 ⇒ 默认值；存的是 null ⇒ 用户清掉了（保持空，不回落到默认）；形状不对 ⇒ 默认值。
  function normalize(stored) {
    const out = {};
    for (const id of IDS) {
      const v = stored && Object.prototype.hasOwnProperty.call(stored, id) ? stored[id] : undefined;
      if (v === null) { out[id] = null; continue; }
      const ok = v && KEYS[v.code] && Number.isInteger(v.modifiers) && !validate(combo(v.code, Object.keys(MODS).filter((m) => v.modifiers & MODS[m])));
      out[id] = ok ? combo(v.code, Object.keys(MODS).filter((m) => v.modifiers & MODS[m])) : DEFAULTS[id];
    }
    return out;
  }

  // 交给原生的形状：数字 + 菜单上要写的那个字符（小写，NSMenuItem 的 keyEquivalent 要小写才不带 ⇧）。
  const wire = (c) => (c ? { keyCode: c.keyCode, modifiers: c.modifiers, char: c.char.length === 1 ? c.char.toLowerCase() : '' } : null);

  const api = { MODS, KEYS, IDS, DEFAULTS, fromEvent, validate, duplicateOf, same, label, parts, normalize, wire };
  root.HotkeyCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
