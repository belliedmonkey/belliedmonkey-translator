// test/app-i18n-keys.test.js — App 侧每个 t('key', 兜底) 的 key 都必须在 _locales 里。
//
// no-hardcoded-copy 只管「中文必须是 t() 的兜底参数」，不管 key 在不在表里 —— 于是
// 1.19.4 第 4/5 轮加的 36 个 key（名额卡、让出框、听译名额态…）一个都没进 _locales，
// 13 种界面语言的用户看到的全是中文兜底，测试一直是绿的（r6 补齐时才发现）。
// i18n-parity 管各语言键集一致，所以这里只对 en 查。
const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');
const { stripComments, stripJsx } = require('./lib/strip-comments');

const ROOT = path.join(__dirname, '..');
const EN = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/_locales/en/messages.json'), 'utf8'));

// 不是界面文字：发给模型的提示词。翻译逻辑不随界面语言变（CLAUDE.md「Internationalization」），
// 所以它们**故意**不进 _locales —— 进了反而会让法语界面的用户拿到一份法语提示词。
const NOT_UI = new Set(['listen_seg_system', 'listen_seg_user']);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'native' && e.name !== 'appicon') walk(p, out); }
    else if (/\.(js|jsx)$/.test(e.name) && !/\.gen\.js$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('App 文案 key 都在 _locales 里', () => {
  test('src/app 与 app/ 里每个 t(\'key\', …) 的 key 都存在于 en/messages.json', () => {
    const files = walk(path.join(ROOT, 'src/app'), []).concat(walk(path.join(ROOT, 'app'), []));
    const re = /\bt\(\s*'([a-z][a-z0-9_]*)'\s*,\s*['"`]/g;
    const miss = [];
    for (const f of files) {
      const raw = fs.readFileSync(f, 'utf8');
      const s = f.endsWith('.jsx') ? stripJsx(raw).js : stripComments(raw);
      let m;
      while ((m = re.exec(s))) {
        if (NOT_UI.has(m[1]) || EN[m[1]]) continue;
        miss.push(m[1] + ' (' + path.relative(ROOT, f) + ')');
      }
    }
    ok(!miss.length, '这些 key 只有代码里的中文兜底、_locales 里没有：\n  ' + Array.from(new Set(miss)).join('\n  '));
  });
});
