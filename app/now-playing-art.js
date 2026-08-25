// app/now-playing-art.js — 播客模式的锁屏封面（§9.5「后台与锁屏播放」）。
//
// 锁屏与灵动岛上那个「问号播放器」只有一个原因：我们没给 `MPMediaItemPropertyArtwork`。
// 这个模块把**正在朗读的那张卡**画成一张 1024×1024 的图，交给原生挂上去。
//
// ── 为什么画在 web 层 ───────────────────────────────────────────────────────
// 排版与配色的唯一真相都在这边：卡片的字号阶梯来自 `learn/review.css`，颜色来自
// `organic-tokens.gen.css`。放到 Swift 里画就等于把它们抄第二遍，然后开始漂移。
//
// ── 三条会炸的约束，别绕过 ─────────────────────────────────────────────────
// 1. **只用图元，绝不 `drawImage` 任何外部素材。** App 是 `file://` origin，画进去的
//    外部图会污染 canvas，`toDataURL()` 直接抛 SecurityError。图标那一档由原生给
//    （它手上就有 Assets.xcassets），不从这里走。
// 2. **颜色从 CSS token 读，不写品牌字面量**（同注册表纪律：品牌色只有一份来源）。读不到时
//    的兜底是纯黑白 —— 刻意的：兜底必须**看起来就不是我们的品牌**，这样一次读取失败
//    是「一眼看出不对」，而不是悄悄偏色。
// 3. **不新造文案。** 徽章那两句由 `driving.js` 算好传进来，那边已经走 `t()`。
var NowPlayingArt = (() => {
  const SIZE = 1024;
  const PAD_OUTER = 48;     // 画布边 → 卡面
  const RADIUS = 60;        // = review.css 的 --radius-lg 24 × 2.5
  const PAD_INNER = 56;     // = .panel 的 padding 22 × 2.5
  const GAP = 30;

  const PILL_FONT = 30, PILL_PAD_X = 24, PILL_PAD_Y = 9, PILL_GAP = 18;

  // 字号阶梯照搬 review.css 的 21 : 19 : 12 并按 2.5× 放大。**比例是要害**，绝对值不是：
  // 原句按句长在 min..max 之间伸缩，译句永远跟着它按 19/21 走，两者的关系不变 ——
  // 那才是「和 App 里是同一张卡」的实质。
  const ORIG = { min: 44, max: 110, lh: 1.5, weight: 500 };
  const TR_RATIO = 19 / 21;
  const TR_LH = 1.55;

  const FONT_STACK = '-apple-system, BlinkMacSystemFont, "PingFang SC", '
    + '"Hiragino Sans GB", system-ui, sans-serif';

  // ─── 断行（纯，可测）──────────────────────────────────────────────────────
  // 中文没有空格，英文有 —— 一套规则要同时吃下两种。切成「可断单元」：CJK 逐字成组，
  // 其余按空格成词。全仓库没有第二处做这件事，`TranslationCore` 的断词helper 不在 App 包里。
  const CJK = /[⺀-鿿豈-﫿＀-￯]/;

  function tokenize(text) {
    const out = [];
    let buf = '';
    for (const ch of String(text || '')) {
      if (CJK.test(ch)) {
        if (buf) { out.push(buf); buf = ''; }
        out.push(ch);
      } else if (ch === ' ') {
        buf += ch;
        out.push(buf); buf = '';
      } else {
        buf += ch;
      }
    }
    if (buf) out.push(buf);
    return out;
  }

  // 贪心折行。`measure(text, size)` 由调用方注入 —— 真实的是 ctx.measureText，
  // 测试里是假的，所以这段排版逻辑不用真机也验得了。
  function wrap(text, maxWidth, size, measure) {
    const lines = [];
    let line = '';
    for (const tk of tokenize(text)) {
      const next = line + tk;
      if (line && measure(next.replace(/\s+$/, ''), size) > maxWidth) {
        lines.push(line.replace(/\s+$/, ''));
        line = tk.replace(/^\s+/, '');
      } else {
        line = next;
      }
    }
    if (line.trim()) lines.push(line.replace(/\s+$/, ''));
    return lines.length ? lines : [''];
  }

  // 单块文字：在 min..max 之间找**最大**的、能放进 box 的字号。
  // 到 min 还放不下就截断并加省略号 —— 宁可截，也不要溢出画布外看不见。
  function fitLines(text, box, measure) {
    const lh = box.lineHeight || 1.5;
    for (let size = box.max; size >= box.min; size -= 2) {
      const lines = wrap(text, box.width, size, measure);
      if (lines.length * size * lh <= box.height) return { size, lines, truncated: false };
    }
    const size = box.min;
    const lines = wrap(text, box.width, size, measure);
    const room = Math.max(1, Math.floor(box.height / (size * lh)));
    if (lines.length <= room) return { size, lines, truncated: false };
    const kept = lines.slice(0, room);
    kept[room - 1] = String(kept[room - 1]).replace(/\s+$/, '') + '…';
    return { size, lines: kept, truncated: true };
  }

  // 整张卡：原句与译句一起定。译句字号**永远**是原句 × 19/21，所以只有一个自由变量。
  // 没有译句的卡（三遍都只读原句）不留空洞 —— 原句自己涨上去占满，这是那种卡的正确
  // 读法，不是要特判的退化情形。
  function fitCard(orig, tr, box, measure) {
    const has = !!String(tr || '').trim();
    for (let size = ORIG.max; size >= ORIG.min; size -= 2) {
      const oLines = wrap(orig, box.width, size, measure);
      const oH = oLines.length * size * ORIG.lh;
      if (!has) {
        if (oH <= box.height) return { orig: { size, lines: oLines }, tr: null };
        continue;
      }
      const tSize = Math.round(size * TR_RATIO);
      const tLines = wrap(tr, box.width, tSize, measure);
      const tH = tLines.length * tSize * TR_LH;
      if (oH + GAP + tH <= box.height) {
        return { orig: { size, lines: oLines }, tr: { size: tSize, lines: tLines } };
      }
    }
    // 到最小字号仍放不下：把空间按两块的自然高度分掉，各自截断。
    const tSize = Math.round(ORIG.min * TR_RATIO);
    const half = has ? (box.height - GAP) : box.height;
    const oBox = { width: box.width, height: has ? half * 0.58 : half,
      min: ORIG.min, max: ORIG.min, lineHeight: ORIG.lh };
    const o = fitLines(orig, oBox, measure);
    if (!has) return { orig: o, tr: null };
    const t = fitLines(tr, { width: box.width, height: half * 0.42,
      min: tSize, max: tSize, lineHeight: TR_LH }, measure);
    return { orig: o, tr: t };
  }

  // ─── 颜色 ────────────────────────────────────────────────────────────────
  // 从 CSS token 读，于是**自动跟随系统深浅色** —— organic-tokens.gen.css 里有整套
  // 深色覆盖，而它已经拼进了 App 的 Style.css。
  function tok(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (_) { return fallback; }
  }

  function palette() {
    return {
      bg: tok('--bg', '#ffffff'),
      card: tok('--card-bg', '#ffffff'),
      ink: tok('--text', '#000000'),
      muted: tok('--text-secondary', '#000000'),
      sage: tok('--sage-text', '#000000'),
      accent: tok('--accent', '#000000'),
    };
  }

  // ─── 画 ──────────────────────────────────────────────────────────────────
  // 手写圆角矩形而不是 `ctx.roundRect`：后者要 Safari 16.4+，而这个 App 的部署目标
  // 比它低。一个查不到原因的「封面是直角」不值得省这几行。
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function font(size, weight) {
    return (weight ? weight + ' ' : '') + size + 'px ' + FONT_STACK;
  }

  function drawLines(ctx, lines, size, lh, color, x, top) {
    ctx.fillStyle = color;
    const step = size * lh;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x, top + i * step + (step - size) / 2);
    }
    return lines.length * step;
  }

  // card: { badge, pass, text, tr }。badge / pass 是已经本地化好的短串。
  // 返回 data URL；画不出来（没有 canvas、被安全策略拦住）就返回空串 —— 调用方据此
  // 什么都不做，绝不因为没有封面而影响播放。
  function render(card) {
    let ctx;
    try {
      const cv = document.createElement('canvas');
      cv.width = SIZE; cv.height = SIZE;
      ctx = cv.getContext('2d');
      if (!ctx) return '';
      const p = palette();

      ctx.fillStyle = p.bg;
      ctx.fillRect(0, 0, SIZE, SIZE);

      const cx = PAD_OUTER, cw = SIZE - PAD_OUTER * 2;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.18)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = p.card;
      roundRect(ctx, cx, cx, cw, cw, RADIUS);
      ctx.fill();
      ctx.restore();

      const innerX = cx + PAD_INNER;
      const innerW = cw - PAD_INNER * 2;
      let y = cx + PAD_INNER;

      ctx.textBaseline = 'top';
      const badge = String((card && card.badge) || '');
      const pass = String((card && card.pass) || '');
      const pillH = PILL_FONT + PILL_PAD_Y * 2;
      if (badge) {
        ctx.font = font(PILL_FONT, 600);
        const w = ctx.measureText(badge).width + PILL_PAD_X * 2;
        ctx.fillStyle = p.accent;
        roundRect(ctx, innerX, y, w, pillH, pillH / 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(badge, innerX + PILL_PAD_X, y + PILL_PAD_Y);
        if (pass) {
          ctx.font = font(PILL_FONT, 400);
          ctx.fillStyle = p.muted;
          ctx.fillText(pass, innerX + w + PILL_GAP, y + PILL_PAD_Y);
        }
        y += pillH + GAP;
      }

      const boxH = (cx + cw - PAD_INNER) - y;
      const measure = (text, size) => { ctx.font = font(size, ORIG.weight); return ctx.measureText(text).width; };
      const fit = fitCard(String((card && card.text) || ''), (card && card.tr) || '',
        { width: innerW, height: boxH }, measure);

      // 文字块在剩下的空间里**垂直居中** —— 短句和长句都成立的唯一版式；顶对齐会让
      // 短句在下半张留一块空白，那正是裸卡最难看的地方。
      const oH = fit.orig.lines.length * fit.orig.size * ORIG.lh;
      const tH = fit.tr ? fit.tr.lines.length * fit.tr.size * TR_LH : 0;
      let ty = y + Math.max(0, (boxH - (oH + (fit.tr ? GAP + tH : 0))) / 2);

      ctx.font = font(fit.orig.size, ORIG.weight);
      ty += drawLines(ctx, fit.orig.lines, fit.orig.size, ORIG.lh, p.ink, innerX, ty);
      if (fit.tr) {
        ty += GAP;
        ctx.font = font(fit.tr.size, 400);
        drawLines(ctx, fit.tr.lines, fit.tr.size, TR_LH, p.sage, innerX, ty);
      }

      return cv.toDataURL('image/png');
    } catch (_) {
      return '';
    }
  }

  const api = { SIZE, ORIG, TR_RATIO, TR_LH, GAP, tokenize, wrap, fitLines, fitCard, render };
  try { window.NowPlayingArt = api; } catch (_) {}
  return api;
})();
