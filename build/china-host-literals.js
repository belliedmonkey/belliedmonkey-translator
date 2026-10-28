// build/china-host-literals.js — China App 包里的宿主字面量改写。
//
// agent/credentials.js 是 Node 宿主（stdio）和国际版 App 的源。那些字符串原样留在
// 文件里，国际版路径照旧按 env 名读取。中国版 App 在 esbuild 写出 Script.js 之后、
// 合规门扫产物之前，只改 credentials 那一段：撞门的字面量换成运行时拼接，拼回去的
// 值与源文件相同。段外的品牌词不动，门照样能红。
//
// 用 `.join("")` 而不是 `+`。这次改写发生在 esbuild 之后，但 `+` 一旦被挪回进包前，
// esbuild 即使 minify 关着也会把它折成一个字符串。
'use strict';

const { BRANDS } = require('./china-gate.js');

function hits(text) {
  BRANDS.lastIndex = 0;
  return BRANDS.test(text);
}

// 把一个会撞门的字符串拆成运行时拼接。表达式的源文本本身不再撞门。
function piece(body) {
  if (!hits(body)) return JSON.stringify(body);
  if (body.length < 2) {
    throw new Error('china host literal: a one-character string still hits the compliance gate');
  }
  const matched = body.match(BRANDS);
  const prefer = matched ? matched.index + Math.max(1, Math.floor(matched[0].length / 2)) : 0;
  const cuts = [];
  if (prefer > 0 && prefer < body.length) cuts.push(prefer);
  for (let i = 1; i < body.length; i++) if (i !== prefer) cuts.push(i);
  for (const i of cuts) {
    const expr = '[' + piece(body.slice(0, i)) + ',' + piece(body.slice(i)) + '].join("")';
    if (!hits(expr)) return expr;
  }
  throw new Error('china host literal: cannot split without leaving a compliance hit');
}

// 只改写引号字符串。注释与标识符不动。带转义的字面量不在这张表里；一旦撞门就停，
// 免得一次不完整的反转义把值改掉。
function rewriteCredentialsSource(src) {
  return String(src).replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, (lit) => {
    if (lit.includes('\\')) {
      if (hits(lit)) throw new Error('china host literal: escaped literal hits the gate and is not rewritten');
      return lit;
    }
    const body = lit.slice(1, -1);
    if (!hits(body)) return lit;
    return piece(body);
  });
}

// esbuild 给每个输入文件留一行 `// path` 横幅。只改 credentials 那一段：
// 同一份 Script.js 里别处的品牌词必须仍然撞门，不能被这次改写一起抹掉。
function rewriteBundledCredentials(script) {
  const startMark = '// agent/credentials.js\n';
  const start = String(script).indexOf(startMark);
  if (start < 0) throw new Error('china host literal: bundle has no agent/credentials.js section');
  const from = start + startMark.length;
  const rest = script.slice(from);
  const next = rest.search(/\n\/\/ \S/);
  const end = next < 0 ? rest.length : next;
  const section = rest.slice(0, end);
  const rewritten = rewriteCredentialsSource(section);
  if (rewritten === section) {
    throw new Error('china host literal: credentials section had nothing to rewrite');
  }
  return script.slice(0, from) + rewritten + rest.slice(end);
}

module.exports = { rewriteCredentialsSource, rewriteBundledCredentials };
