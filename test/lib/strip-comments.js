// test/lib/strip-comments.js — 把 JS 源码里的注释抹成等量空格，保留行号。
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
      if (c === '/' && REGEX_OK.test(prev)) { state = 'rx'; out += c; i += 1; continue; }
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

module.exports = { stripComments, REGEX_OK };
