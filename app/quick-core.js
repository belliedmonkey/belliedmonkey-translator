// app/quick-core.js — 「交来的文字」这一种来源的纯逻辑（docs/domain-design.md §2.6；模块表里的 HandoffCore）。
// 没有 DOM、没有存储、没有网络 —— 全部可在 vm 里测。面板页（app/quick.js）与之后的原生接线只调这里。
(function (root) {
  'use strict';

  const MAX_CAPTURE_CHARS = 2000;      // 超过照翻、不进复习库（与 AppHandoff.MAX_CHARS 同值，测试钉住）
  const MAX_UNIT_CHARS = 1200;         // 长文按段切；一段再长就在句末切（同文档翻译 §2.5 的每段上限）
  const VIAS = ['system', 'select', 'input', 'shot', 'service'];

  // ── 目标语言（§2.6 规则 1）────────────────────────────────────────────────
  // 系统与宿主 App 都不告诉我们语种。原文已经是目标语言 ⇒ 反向（中↔英），而不是回一句「无需翻译」。
  // isAlready 由调用方注入（生产里是 TranslationCore.isAlreadyTargetLanguage —— 它只在目标语言的文字系统
  // 能单独判定时才说「是」；拉丁字母的目标语言判不出 ⇒ 照常翻译，不为判语种多发一次请求）。
  function chooseTarget(text, target, isAlready) {
    const t = String(target || 'zh-CN');
    if (typeof isAlready === 'function' && isAlready(text, t)) {
      return { lang: /^en\b/i.test(t) ? 'zh-CN' : 'en', reversed: true, from: t };
    }
    return { lang: t, reversed: false, from: '' };
  }

  // ── 零权限路径的三个陷阱（§2.6 规则 4）────────────────────────────────────
  // clip: { text, concealed, types }；last: 上一次交来的文字。返回 { kind, text }：
  //   'concealed' 带隐藏 / 临时标记（密码管理器打的）—— 不读、不发、不存。硬规则，不是设置项。
  //   'empty'     空，或不是文字
  //   'same'      与上一次完全相同 —— 多半是忘了 ⌘C；显示上次的结果，不重发请求
  //   'ok'
  function classifyClipboard(clip, last) {
    const c = clip || {};
    if (c.concealed) return { kind: 'concealed', text: '' };
    const text = typeof c.text === 'string' ? c.text.trim() : '';
    if (!text) return { kind: 'empty', text: '' };
    if (typeof last === 'string' && last.trim() === text) return { kind: 'same', text };
    return { kind: 'ok', text };
  }

  // 「没有可翻译的文字」：只有空白、数字与符号。
  function hasLetters(text) { return /\p{Letter}/u.test(String(text || '')); }

  // ── 长文：按段切，段内过长在句末切 ─────────────────────────────────────────
  function splitUnits(text, maxChars) {
    const cap = maxChars || MAX_UNIT_CHARS;
    const out = [];
    for (const para of String(text || '').split(/\n\s*\n|\r\n\s*\r\n/)) {
      let p = para.replace(/\s*\n\s*/g, ' ').trim();
      while (p.length > cap) {
        const head = p.slice(0, cap);
        // 最后一个句末标点；找不到就退到最后一个空白；再找不到只能硬切
        const m = head.match(/^[\s\S]*[\p{Sentence_Terminal}]["'”’）)]?\s*/u);
        let cut = m && m[0].length > cap * 0.4 ? m[0].length : head.lastIndexOf(' ');
        if (cut <= 0) cut = cap;
        out.push(p.slice(0, cut).trim()); p = p.slice(cut).trim();
      }
      if (p) out.push(p);
    }
    return out;
  }

  // ── 截图识别：行框 → 阅读顺序的段落 ────────────────────────────────────────
  // lines: [{ text, box: {x, y, w, h} }]，坐标归一化到 0–1、原点在左上（原生侧换算好再交过来）。
  // 同一行的判据是纵向中心相差不到半个行高；行距大于 0.8 个行高 ⇒ 另起一段。CJK 行之间不加空格。
  function assembleLines(lines) {
    const ls = (lines || []).filter((l) => l && typeof l.text === 'string' && l.text.trim() && l.box)
      .map((l) => ({ text: l.text.trim(), x: l.box.x, y: l.box.y, w: l.box.w, h: l.box.h || 0.02 }));
    if (!ls.length) return '';
    ls.sort((a, b) => (Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) < Math.min(a.h, b.h) / 2 ? a.x - b.x : a.y - b.y));
    const cjkEnd = (s) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。、！？：；）」』]$/u.test(s);
    const cjkStart = (s) => /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}（「『]/u.test(s);
    let out = ls[0].text;
    for (let i = 1; i < ls.length; i++) {
      const prev = ls[i - 1], cur = ls[i];
      const sameRow = Math.abs((prev.y + prev.h / 2) - (cur.y + cur.h / 2)) < Math.min(prev.h, cur.h) / 2;
      const gap = cur.y - (prev.y + prev.h);
      if (!sameRow && gap > 0.8 * Math.max(prev.h, cur.h)) { out += '\n\n' + cur.text; continue; }
      out += (cjkEnd(out) && cjkStart(cur.text) ? '' : ' ') + cur.text;
    }
    return out;
  }

  // 这句进不进复习库（面板底栏要当场告诉用户；真正的门在 AppHandoff，这里只是同一判据的前置显示）。
  //   'saved' | 'off'（采集关着）| 'long'（太长）| ''（没翻成 / 译文等于原文：不显示任何状态）
  function captureState(text, tr, captureOn) {
    if (!tr || !String(tr).trim() || String(tr).trim() === String(text).trim()) return '';
    if (String(text).length > MAX_CAPTURE_CHARS) return 'long';
    return captureOn ? 'saved' : 'off';
  }

  const api = { MAX_CAPTURE_CHARS, MAX_UNIT_CHARS, VIAS, chooseTarget, classifyClipboard, hasLetters, splitUnits, assembleLines, captureState };
  root.HandoffCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
