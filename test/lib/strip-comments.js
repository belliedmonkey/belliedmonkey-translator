// test/lib/strip-comments.js — 把 JS/JSX 源码里的注释抹成等量空格，保留行号。
//
// 原来它只活在 no-hardcoded-copy.test.js 里。第二道门禁（user-gesture.test.js）需要
// 同一件事，而这个状态机踩过的坑不是抄一遍就能带走的：`/['"]/` 里的引号会把扫描器带进
// 字符串态，`build/*.config.js` 写在注释里会开出一个假块注释吞掉三百行。所以它只有一份。
//
// 逐字符走一遍，而不是两条正则。
//
// 原来那两条正则有一个**静默的洞**，2026-08-31 实测：quick-setup.js 的一句注释里写了
// `build/*.config.js`，里面的 `/*` 打开了一个假的块注释，一直吃到 310 行之后的下一个
// `*/`。那 310 行里的每一个 CJK 字面量都没被检查过 —— 门禁绿着，但它什么都没看。
//
// 这是这个仓库反复撞到的同一类事：一个扫不到东西的断言，和没有这条断言是一回事。
// 状态机分得清「注释里的 /*」「字符串里的 //」和真正的注释，原来那条
// `[^:'"\`]` 的前瞻只是在给 `https://` 打补丁，挡不住引号里的其它形状。
//
// 保留偏移：删掉的字符换成等量空格、换行原样留下，所以报出来的行号仍然是真行号。
// 这些字符之后的 `/` 只可能是正则开头，不可能是除号（JS 里两者只能这样分辨）。
const REGEX_OK = /[(,=:[!&|?{};+\-*%~^<>]|^$/;
function stripComments(src) {
  let out = '';
  let state = 'code';   // code | line | block | sq | dq | tpl | rx
  let prev = '';        // 上一个非空白的代码字符，用来分辨「除号」和「正则开头」
  let inClass = false;  // 正则里的 [...] 字符组，里面的 / 不结束正则
  for (let i = 0; i < src.length;) {
    const c = src[i]; const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && d === '*') { state = 'block'; out += '  '; i += 2; continue; }
      // 正则字面量。不认它的话，`/['"]/` 里的引号会把扫描器带进字符串态，从此后面
      // 每一条注释都被当成代码 —— 实测就是这样让 translation-core.js 的一句注释里的
      // 「⏳ 翻译中…」被误报的。判据是「上一个有意义的字符允许正则开头」，这是
      // 除法与正则在 JS 里唯一可分辨的方式。
      // 例外：`</` + 字母是 JSX 闭合标签（PR3 起 .jsx 喂进这个剥离器）。`<` 在
      // REGEX_OK 里，不豁免的话 `</header>` 会开出假正则吞到下一个 `/`。真 JS 里
      // `</` 后跟字母只有 `a</b/.test(x)` 这一种病态写法，值得为 JSX 让路。
      if (c === '/' && REGEX_OK.test(prev) && !(prev === '<' && /[A-Za-z]/.test(d || ''))) { state = 'rx'; out += c; i += 1; continue; }
      if (c === "'") state = 'sq';
      else if (c === '"') state = 'dq';
      else if (c === '`') state = 'tpl';
      if (!/\s/.test(c)) prev = c;
      out += c; i += 1; continue;
    }
    if (state === 'rx') {
      if (c === '\\') { out += c + (d === undefined ? '' : d); i += 2; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) { state = 'code'; prev = c; }
      out += c; i += 1; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; } else out += ' ';
      i += 1; continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += (c === '\n' ? c : ' '); i += 1; continue;
    }
    // 字符串里：只认转义和自己的收尾引号。里面的 // 和 /* 都是内容。
    if (c === '\\') { out += c + (d === undefined ? '' : d); i += 2; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) { state = 'code'; prev = c; }
    out += c; i += 1; continue;
  }
  return out;
}

// ── JSX 预扫（PR5 起）─────────────────────────────────────────────────────────
//
// stripComments 只懂 JS，而 .jsx 文件里 JSX 会把它带进假态，且形状不止一种——
// 逐个打补丁打不完（先撞到 `</header>` 的 `/` 在 `<` 后面，再撞到 `ref={x} />` 的
// `/` 在 `}` 后面）。2026-09-27 实测：options.jsx 从 1700 行起整个 JSX 树都在假正则
// 的吞咽窗口里，CJK 字面量扫描与 JSX 文本扫描整段失明 —— 又是「绿着但什么都没看」。
//
// 所以按语言对待：先用一个小的 JSX 识别器把文件切成区域，产出**两个偏移对齐**的视图：
//   js   — JSX 文本节点与标签骨架抹成空格（属性字符串与 {} 表达式原样保留，表达式里
//          的嵌套标签骨架也递归抹掉），交给 stripComments 得到纯 JS 视图。
//          喂「字符串字面量 + t() 兜底」扫描。
//   text — 只抹 JS 注释。喂 `>…中文…<` 的 JSX 文本节点扫描（JSX 注释 {／* … *／} 被
//          花括号包着，那条正则的 [^<>{}] 天然跳过它们，无需另剥）。
// 两个视图行号与原文件一致。
//
// 已知残余（记下来，别再当新 bug 查）：识别器按「< + 标签形状」验证，验证不过就退回
// 逐字符 —— 极少数嵌套自闭合标签（如 `.map(x => <Img src={u}/>)` 紧跟 `}` 的 `/>`）
// 若嵌在识别器没进到的位置，那一小段仍可能让 stripComments 开假态，窗口只限表达式
// 内部。三个页面（popup/onboard/options）全量门禁跑绿即为验收。

function skipString(src, i) {
  // i 在开引号上。返回收尾引号之后的位置；未闭合返回 -1。
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === q) return j + 1;
    if (q !== '`' && c === '\n') return -1;   // 单双引号串不许跨行
    j += 1;
  }
  return -1;
}

function skipLineComment(src, i) {
  const j = src.indexOf('\n', i);
  return j < 0 ? src.length : j;              // 不含换行本身
}

function skipBlockComment(src, i) {
  const j = src.indexOf('*/', i + 2);
  return j < 0 ? src.length : j + 2;
}

function skipExpr(src, i) {
  // i 在 '{' 上。返回匹配 '}' 之后的位置；未闭合返回 -1。
  // 字符串、注释、正则都感知，正则判据与 stripComments 相同（REGEX_OK）。
  let depth = 1;
  let j = i + 1;
  let prev = '{';
  let inClass = false;
  while (j < src.length) {
    const c = src[j]; const d = src[j + 1];
    if (c === "'" || c === '"' || c === '`') {
      const e = skipString(src, j);
      if (e < 0) return -1;
      prev = c; j = e; continue;
    }
    if (c === '/' && d === '/') { j = skipLineComment(src, j); continue; }
    if (c === '/' && d === '*') { j = skipBlockComment(src, j); continue; }
    if (c === '/' && REGEX_OK.test(prev) && !(prev === '<' && /[A-Za-z]/.test(d || ''))) {
      j += 1;
      while (j < src.length) {
        const r = src[j];
        if (r === '\\') { j += 2; continue; }
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) break;
        j += 1;
      }
      j += 1; prev = '/'; inClass = false; continue;
    }
    if (c === '{') { depth += 1; prev = c; j += 1; continue; }
    if (c === '}') { depth -= 1; if (depth === 0) return j + 1; prev = c; j += 1; continue; }
    if (!/\s/.test(c)) prev = c;
    j += 1;
  }
  return -1;
}

function scanTag(src, i) {
  // i 在 '<' 上。验证从这里开始的是一个 JSX 标签（开/闭/自闭合/fragment），
  // 返回 { end, strings: [[s,e),…], exprs: [[s,e),…] }；不是标签返回 null。
  const n = src.length;
  let j = i + 1;
  const strings = [];
  const exprs = [];
  if (src[j] === '/') j += 1;                          // 闭合标签 </div>
  if (src[j] === '>') return { end: j + 1, strings, exprs };   // fragment <> 与 </>
  if (!/[A-Za-z]/.test(src[j] || '')) return null;
  j += 1;
  while (j < n && /[A-Za-z0-9._:-]/.test(src[j])) j += 1;
  for (;;) {
    while (j < n && /\s/.test(src[j])) j += 1;
    const c = src[j];
    if (c === '>') return { end: j + 1, strings, exprs };
    if (c === '/' && src[j + 1] === '>') return { end: j + 2, strings, exprs };
    if (!/[A-Za-z_]/.test(c || '')) return null;       // 属性名开头（或根本不是标签）
    j += 1;
    while (j < n && /[A-Za-z0-9._:-]/.test(src[j])) j += 1;
    let k = j;
    while (k < n && /\s/.test(src[k])) k += 1;
    if (src[k] === '=') {
      k += 1;
      while (k < n && /\s/.test(src[k])) k += 1;
      const v = src[k];
      if (v === "'" || v === '"') {
        const e = skipString(src, k);
        if (e < 0) return null;
        strings.push([k, e]); j = e;
      } else if (v === '{') {
        const e = skipExpr(src, k);
        if (e < 0) return null;
        exprs.push([k, e]); j = e;
      } else return null;
    }
  }
}

function blankRangesPush(jsBlank, start, end, keeps) {
  // 把 [start,end) 抹黑，keeps（已排序、互不重叠）里的区间原样留下。
  let at = start;
  for (const [s, e] of keeps) {
    if (s > at) jsBlank.push([at, Math.min(s, end)]);
    at = Math.max(at, e);
    if (at >= end) return;
  }
  if (at < end) jsBlank.push([at, end]);
}

function walkJsRegion(src, from, to, jsBlank) {
  // 在一个「纯 JS」区间 [from,to) 里找嵌套的 JSX 标签并抹黑其骨架。
  // 字符串与注释整段跳过（里面的 < 不是标签）。
  let j = from;
  while (j < to) {
    const c = src[j];
    if (c === "'" || c === '"' || c === '`') { const e = skipString(src, j); j = e < 0 ? j + 1 : e; continue; }
    if (c === '/' && src[j + 1] === '/') { j = skipLineComment(src, j); continue; }
    if (c === '/' && src[j + 1] === '*') { j = skipBlockComment(src, j); continue; }
    if (c === '<') {
      const t = scanTag(src, j);
      if (t) { j = emitTag(src, j, t, jsBlank); continue; }
    }
    j += 1;
  }
}

function emitTag(src, i, t, jsBlank) {
  // 抹黑一个标签的骨架（标签区间减去属性字符串与表达式），并递归处理表达式里的
  // 嵌套标签。返回标签结束位置。
  const keeps = t.strings.concat(t.exprs).sort((a, b) => a[0] - b[0]);
  blankRangesPush(jsBlank, i, t.end, keeps);
  for (const [s, e] of t.exprs) walkJsRegion(src, s + 1, e - 1, jsBlank);
  return t.end;
}

function textPhase(src, i, jsBlank, depth) {
  // 标签收尾的 '>' 之后是 JSX 文本相：直到下一个标签、帧收口的 ')' 或文件尾。
  // 文本节点抹进 jsBlank；{} 表达式是 JS，原样保留（里面的嵌套标签递归抹骨架）。
  const n = src.length;
  const frameDepth = depth.paren;
  let textStart = i;
  while (i < n) {
    const c = src[i];
    if (c === '{') {
      const e = skipExpr(src, i);
      if (e < 0) { i += 1; continue; }              // 识别不了就当普通文本字符（防御）
      if (i > textStart) jsBlank.push([textStart, i]);
      walkJsRegion(src, i + 1, e - 1, jsBlank);
      i = e; textStart = i; continue;
    }
    if (c === '<') {
      const t = scanTag(src, i);
      if (t) {
        if (i > textStart) jsBlank.push([textStart, i]);
        i = emitTag(src, i, t, jsBlank);
        textStart = i; continue;                    // 兄弟标签，文本相继续
      }
      i += 1; continue;                             // 保守：当文本字符
    }
    if (c === '(') { depth.paren += 1; i += 1; continue; }
    if (c === ')') {
      if (depth.paren - 1 < frameDepth) {           // 帧收口的括号：留给 JS 世界
        if (i > textStart) jsBlank.push([textStart, i]);
        return i;
      }
      depth.paren -= 1; i += 1; continue;           // 文本里的括号（配对时无害）
    }
    i += 1;
  }
  if (n > textStart) jsBlank.push([textStart, n]);
  return n;
}

function applyBlanks(src, ranges) {
  const out = src.split('');
  for (const [s, e] of ranges) {
    for (let j = s; j < e; j += 1) {
      if (out[j] !== undefined && out[j] !== '\n') out[j] = ' ';
    }
  }
  return out.join('');
}

// stripJsx(src) → { js, text }。.jsx 文件专用；.js 直接用 stripComments。
function stripJsx(src) {
  const jsBlank = [];     // 抹进 js 视图：JSX 文本节点 + 标签骨架
  const jsComment = [];   // 抹进 text 视图：JS 注释
  const depth = { paren: 0 };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { const e = skipString(src, i); i = e < 0 ? i + 1 : e; continue; }
    if (c === '/' && src[i + 1] === '/') { const e = skipLineComment(src, i); jsComment.push([i, e]); i = e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = skipBlockComment(src, i); jsComment.push([i, e]); i = e; continue; }
    if (c === '(') { depth.paren += 1; i += 1; continue; }
    if (c === ')') { depth.paren -= 1; i += 1; continue; }
    if (c === '<') {
      const t = scanTag(src, i);
      if (t) { i = textPhase(src, emitTag(src, i, t, jsBlank), jsBlank, depth); continue; }
    }
    i += 1;
  }
  return {
    js: stripComments(applyBlanks(src, jsBlank)),
    text: applyBlanks(src, jsComment),
  };
}

module.exports = { stripComments, REGEX_OK, stripJsx };
