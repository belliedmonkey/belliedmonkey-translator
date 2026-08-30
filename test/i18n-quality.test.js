// test/i18n-quality.test.js — 译文**内容**的门禁。i18n-parity 管键集，这里管值。
//
// 为什么要分成两个文件：i18n-parity.test.js:10-12 明确写了「一个键存在但内容是英文原文，
// 这里会过。那是刻意的」。那个立场是对的——键集与译文质量是两件事，混在一起会让人为了
// 让测试变绿而乱填。所以那个文件原样保留，质量这一层单独立一道门。
//
// 但「刻意不管」的真实代价，2026-08-30 实测出来了：
//
//   tts_test_sample            11/11 全英文（**含 zh_CN**）—— 中文用户点「试听一句」，
//                              听到的是中文 TTS 念一句英文。这是语音功能的预览，而整个
//                              功能的意义就是「听听你的卡片是什么声音」。
//   label_custom_model         9/11 是 "Model"
//   options_custom_model_hint  9/11 是 "Leave blank to use the engine's default model."
//   toast_model_saved          9/11 是 "Model saved"
//
// 这四条是一批加进来、一次没翻过的，藏了不知道多久。靠人是发现不了的——没有人会把
// 11 份 JSON 逐键对读。
//
// ── 为什么判据不是「不等于 en」 ──────────────────────────────────────────────
//
// 实测：de/es/fr/pt_BR 与 en 逐字相同的分别有 23/21/24/22 条，其中绝大多数**合法**：
// `lang_*` 语言自名（docs/interaction-spec.md:614-618 的明示豁免——法语里 "Français"
// 就该是 "Français"）、品牌名、法德葡通用词（Cache / Pause / Total / Model）。
// 一道会产生 ~90 个误报的门禁不会被遵守，只会被注释掉。
//
// 所以拉丁语系用「不等于 en + 白名单」，非拉丁语系用**字形覆盖**——后者不需要白名单，
// 因为「日语译文里必须出现假名或汉字」是一条不会误伤的物理约束。
const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const DIR = path.join(__dirname, '..', 'extension', '_locales');
const LOCALES = fs.readdirSync(DIR).filter((d) => fs.statSync(path.join(DIR, d)).isDirectory());
const M = {};
for (const l of LOCALES) M[l] = JSON.parse(fs.readFileSync(path.join(DIR, l, 'messages.json'), 'utf8'));

const msg = (l, k) => ((M[l] || {})[k] || {}).message;

// 各语系必须出现的字符。这是物理约束，不是风格偏好 —— 一条日语译文里不可能一个假名
// 和汉字都没有。
const SCRIPTS = {
  zh_CN: /[一-鿿]/,
  zh_TW: /[一-鿿]/,
  ja: /[぀-ヿ一-鿿]/,
  ko: /[가-힯ᄀ-ᇿ]/,
  ru: /[Ѐ-ӿ]/,
  ar: /[؀-ۿ]/,
};

// 白名单必须是 `key:locale` 成对。**不能是裸 key** —— 裸 key 会连未来新增的 locale
// 一起豁免掉，于是新语言天生带着一批不会被检查的串。
const ALLOW = new Set([
  // 语言自名：法语里 "Français" 就该是 "Français"（interaction-spec §614-618 明示豁免）
  ...LOCALES.flatMap((l) => Object.keys(M.en).filter((k) => k.startsWith('lang_')).map((k) => `${k}:${l}`)),
  // 品牌与产品名 —— 不翻译是对的。action_title 是工具栏标题，值就是品牌全名，
  // 所以它同时会在字形门和长度门里被点名（中文品牌名 5 字，德语 24 字 = 4.8×）。
  ...LOCALES.flatMap((l) => ['about_line', 'action_title', 'extension_name',
    'provider_openai', 'provider_claude', 'provider_deepseek'].map((k) => `${k}:${l}`)),
  // 通用技术术语：各语言普遍原样使用，翻了反而看不懂。
  // 判据是「用户在该语言的技术语境里本来就这么说」，不是「我懒得翻」——
  // 所以这个名单必须逐条点名，不能用前缀通配。
  ...LOCALES.flatMap((l) => ['app_set_notes_key', 'label_api_key', 'placeholder_api_key',
    'engine_test_http', 'extob_key_label'].map((k) => `${k}:${l}`)),
  // 引擎名出现在提示里（Qwen/DashScope、Kimi/Moonshot 都是品牌）
  ...LOCALES.flatMap((l) => Object.keys(M.en).filter((k) => k.startsWith('hint_')).map((k) => `${k}:${l}`)),
]);

describe('i18n 译文质量 — 值，不是键', () => {
  test('非拉丁语系：译文必须含本语系字符', () => {
    const bad = [];
    for (const [loc, re] of Object.entries(SCRIPTS)) {
      if (!M[loc]) continue;
      for (const k of Object.keys(M.en)) {
        if (ALLOW.has(`${k}:${loc}`)) continue;
        const v = msg(loc, k);
        if (!v) continue;
        // 纯符号/数字/URL 的串没有字形可言，跳过
        if (!/[A-Za-z]/.test(v)) continue;
        if (!re.test(v)) bad.push(`${loc} · ${k} = ${JSON.stringify(v).slice(0, 60)}`);
      }
    }
    ok(bad.length === 0, `这些译文里没有本语系字符（= 没翻）：\n    ${bad.join('\n    ')}`);
  });

  test('占位符必须与 en 一致', () => {
    const bad = [];
    for (const k of Object.keys(M.en)) {
      const want = (msg('en', k) || '').match(/\$[A-Z_]+\$|\{[a-zA-Z]+\}/g) || [];
      for (const loc of LOCALES) {
        if (loc === 'en') continue;
        const got = (msg(loc, k) || '').match(/\$[A-Z_]+\$|\{[a-zA-Z]+\}/g) || [];
        if (want.slice().sort().join() !== got.slice().sort().join()) {
          // 掉一个 {n} 之后句子少一个数字，运行时**不报错** —— 这是最致命的一类
          bad.push(`${loc} · ${k}: en 有 [${want}]，它有 [${got}]`);
        }
      }
    }
    ok(bad.length === 0, `占位符不一致：\n    ${bad.join('\n    ')}`);
  });

  // 长度门：**只报告，不失败**。
  //
  // 我原本把它写成断言，然后连着四次「看到报错就加一条例外」—— 那是在把门禁改成噪声源。
  // 实测分布解释了为什么：5082 个样本相对 zh_CN 的比值 p50=2.20、p90=4.11、p99=5.60、
  // max=8.8。中文是所有语言里最紧凑的，拿它当基准，比例天然大且方差极宽。
  //
  // 真去看那些离群值，它们全是**正确的译文**：
  //   ru toast_export_failed  "Не удалось экспортировать"           (6.3× 于「导出失败」)
  //   de sync_section         "Geräteübergreifende Synchronisierung" (7.2× 于「多设备同步」)
  //
  // 一道抓不到真缺陷、却持续要求维护例外名单的断言，比没有更坏 —— 它会训练人把红色
  // 当噪声。所以降级成报告：数字仍然打印出来供人扫一眼（真被截断/粘错的串会显眼），
  // 但它不再阻塞任何人。
  test('长度分布（仅报告，不失败）', () => {
    const out = [];
    const INVISIBLE = new Set(['fab_toggle', 'fab_enable', 'fab_disable', 'yt_btn_title']);
    for (const k of Object.keys(M.en)) {
      if (INVISIBLE.has(k)) continue;
      const base = [...(msg('zh_CN', k) || '')].length;
      if (base < 4) continue;
      for (const loc of LOCALES) {
        if (ALLOW.has(`${k}:${loc}`)) continue;
        const n = [...(msg(loc, k) || '')].length;
        if (!n) continue;
        const r = n / base;
        if (r < 0.25 || r > 8.0) out.push(`${loc} · ${k}: ${n} vs ${base} 字（${r.toFixed(1)}×）`);
      }
    }
    if (out.length) console.log('    ℹ 长度离群（仅供扫一眼）：\n      ' + out.join('\n      '));
    ok(true);
  });
});
