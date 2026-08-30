// test/aso-copy.test.js — App Store 商店文案（store-assets/aso.md）的本地门禁。
//
// 为什么这道门禁比 build.js 的 nameLengthGate 优先级更高：
//
//   extension_name 超限   → altool 上传时被拒 → 分钟级反馈 → 重传即可
//   keywords/描述有问题   → **提审后数天**被 App Review 拒 → 排队位置清零
//                          （中国版首提排过 40 天）
//
// 两者都是「本地没门禁 ⇒ 唯一会告诉你的是最贵的那一环」，但这一条的「最贵」贵得多。
//
// 2026-08-30 促成它的具体缺陷：国际版 iOS 的 zh-Hans keywords 与 description **整份
// 是英文**（macOS 同一 locale 是中文的）。它不报错、不被拒，只是安静地把一个市场的
// 搜索量清零 —— 这正是最难发现的一类。所以下面有一条按语种查的断言。
const { describe, test, ok, eq } = require('./harness');
const fs = require('fs');
const path = require('path');

const MD = fs.readFileSync(path.join(__dirname, '..', 'store-assets', 'aso.md'), 'utf8');

// Apple 的上限。数**码点**不数字节，和它的报错口径一致（同 build.js 的 nameLengthGate）。
const LIMITS = { name: 30, subtitle: 30, keywords: 100, promotionalText: 170, description: 4000 };

// 竞品全称绝不能进 keywords —— Metadata Rejection 里最典型的一类。
// 「沉浸式」是通用形容词，可以；「沉浸式翻译」是竞品全称，不行。
const COMPETITORS = ['沉浸式翻译', '彩云小译', 'DeepL', 'Immersive Translate', '欧路', '有道'];

function parseAso(md) {
  const out = {};
  const re = /^##\s+(国际版|中国版)\s*·\s*([A-Za-z-]+)\s*·\s*(\w+)\s*$/gm;
  let m;
  while ((m = re.exec(md))) {
    const rest = md.slice(m.index + m[0].length);
    const f = rest.match(/```[a-z]*\n([\s\S]*?)```/);
    if (!f) continue;
    const key = `${m[1]}·${m[2]}`;
    (out[key] || (out[key] = {}))[m[3]] = f[1].trim();
  }
  return out;
}

const ASO = parseAso(MD);
const GROUPS = Object.keys(ASO);

describe('ASO 文案 — store-assets/aso.md', () => {
  test('三组 locale 齐全（商店上真实存在的全集）', () => {
    for (const g of ['国际版·en-US', '国际版·zh-Hans', '中国版·zh-Hans']) {
      ok(GROUPS.includes(g), `缺少「${g}」—— 商店上有这个 locale，文案文件里没有`);
    }
  });

  test('每个字段都在 Apple 的上限内', () => {
    for (const g of GROUPS) {
      for (const [field, v] of Object.entries(ASO[g])) {
        const lim = LIMITS[field];
        ok(lim, `${g} 出现未知字段 ${field}`);
        const n = [...v].length;
        ok(n <= lim, `${g} · ${field}: ${n} 字，超过上限 ${lim}`);
        ok(n > 0, `${g} · ${field} 是空的`);
      }
    }
  });

  test('keywords：逗号两侧无空格、无空 token、无重复', () => {
    for (const g of GROUPS) {
      const kw = ASO[g].keywords;
      if (!kw) continue;
      // 空格计入那 100 个字符，而且会让 Apple 把 " 双语" 当成一个**另外的**词。
      ok(!/,\s|\s,/.test(kw), `${g} · keywords 的逗号两侧有空格 —— 会浪费字符且切错词`);
      const toks = kw.split(',');
      ok(toks.every((t) => t.length > 0), `${g} · keywords 有空 token（连续逗号或首尾逗号）`);
      eq(new Set(toks).size, toks.length, `${g} · keywords 有重复词 —— 重复即浪费`);
    }
  });

  test('keywords 不与同 locale 的 name/subtitle 重复（同一个索引池，重复即浪费）', () => {
    for (const g of GROUPS) {
      const { keywords, name, subtitle } = ASO[g];
      if (!keywords) continue;
      const pool = ((name || '') + ' ' + (subtitle || '')).toLowerCase();
      for (const t of keywords.split(',')) {
        ok(!pool.includes(t.toLowerCase()),
          `${g} · keywords 里的「${t}」已出现在 name/subtitle 里 —— 它们是同一个索引池`);
      }
    }
  });

  test('keywords 里没有竞品全称', () => {
    for (const g of GROUPS) {
      const kw = (ASO[g].keywords || '').toLowerCase();
      for (const c of COMPETITORS) {
        ok(!kw.includes(c.toLowerCase()), `${g} · keywords 含竞品名「${c}」—— 会被 Metadata Rejection`);
      }
    }
  });

  // 这一条就是 2026-08-30 那个 bug 的机器判据。
  test('zh-* 的文案必须是中文（ASCII 字母占比 < 80%）', () => {
    for (const g of GROUPS) {
      if (!/·zh-/.test(g)) continue;
      for (const field of ['keywords', 'subtitle', 'description']) {
        const v = ASO[g][field];
        if (!v) continue;
        const letters = [...v].filter((c) => /[A-Za-z一-鿿぀-ヿ]/.test(c));
        if (!letters.length) continue;
        const ascii = letters.filter((c) => /[A-Za-z]/.test(c)).length / letters.length;
        ok(ascii < 0.8,
          `${g} · ${field} 的 ASCII 字母占比 ${(ascii * 100).toFixed(0)}% —— 中文 locale 下写成了英文，`
          + '这不会被拒，只会安静地把一个市场的搜索量清零');
      }
    }
  });

  test('没有 emoji（Apple 在这些字段拒 emoji）', () => {
    for (const g of GROUPS) {
      for (const [field, v] of Object.entries(ASO[g])) {
        ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(v), `${g} · ${field} 含 emoji`);
      }
    }
  });
});
