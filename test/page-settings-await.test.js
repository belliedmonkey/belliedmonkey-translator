// test/page-settings-await.test.js — PageSettings.read 是异步的，返回 {ok, data}。
//
// 2026-09-10 用户实测：options.js 两处把它的返回值（一个 Promise）直接当设置对象用 ——
// `cur.apiKey` 恒 undefined，于是领完免费额度卡上永远显示「你现在用的是自己的 key」，
// 而 plan() 把三槽全看成空、把用户自己的 key 盖掉了。这种错误没有任何一处会红：
// 不抛异常、不打日志，Promise 上读属性只是 undefined。这里扫全部扩展页 + learn 模块：
// 每一处 `PageSettings.read(` 前面必须是 await / return / =>（箭头函数直接返回），
// 或后面紧跟 .then(。
const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');
const { stripComments } = require('./lib/strip-comments');
const ROOT = path.join(__dirname, '..', 'extension');

function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (!/_locales|styles|icons/.test(f)) walk(p, out); }
    else if (/\.js$/.test(f) && !/\.gen\.js$|i18n-messages\.js/.test(f)) out.push(p);
  }
  return out;
}

describe('PageSettings.read 的每一处调用都要 await（或 return / .then）', () => {
  for (const file of walk(ROOT, [])) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    if (!src.includes('PageSettings.read(')) continue;
    test(path.relative(ROOT, file), () => {
      const bad = [];
      const re = /PageSettings\.read\(/g;
      let m;
      while ((m = re.exec(src))) {
        const before = src.slice(Math.max(0, m.index - 40), m.index);
        const after = src.slice(m.index);
        // 跳过定义处本身（page-settings.js 里的 `function read(`）—— 那里不会出现 PageSettings.read(
        const okBefore = /(await|return|=>|\?|:)\s*$/.test(before);
        const okAfter = /^PageSettings\.read\([^)]*\)\s*\.then\(/.test(after);
        if (!okBefore && !okAfter) {
          const line = src.slice(0, m.index).split('\n').length;
          bad.push(`第 ${line} 行`);
        }
      }
      ok(bad.length === 0, `PageSettings.read 的返回值被当成设置对象用了：${bad.join('、')} —— 它是 Promise<{ok,data}>`);
    });
  }
});
