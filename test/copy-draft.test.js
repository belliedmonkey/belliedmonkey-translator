// test/copy-draft.test.js — 文案改稿的逐字守卫（第三十批回归 C 组 · batch30-regression-v2）。
//
// 为什么单独一个文件：C 组的判据是「一字不差」和「旧串清零」，而这两件事最容易在后续改动里
// 悄悄漂掉 —— 键在、值被改回旧的，或兜底串没跟着走，界面测试（DOM）未必覆盖得到。
// 三份稿：zdhvA（文案改稿 4）、jERJ5 / gitVW（按住说终稿）。P 组的按住说断言在 app-listen 里。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'ja', 'ko', 'pt_BR', 'ru', 'th', 'zh_CN', 'zh_TW'];
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const msg = (loc, key) => JSON.parse(read(`extension/_locales/${loc}/messages.json`))[key].message;
const MODEL = read('src/app/listen-model.js');
const SHELL = read('src/app/shell-model.js');
const SETTINGS = read('src/app/settings-view.jsx');

describe('文案改稿 4（zdhvA）· 逐字', () => {
  test('C-03 ↔ 提示：zh_CN 一字不差，13 个语言都有译文且含 ↔', () => {
    eq(msg('zh_CN', 'listen_who_guessed'), '判错了？点 ↔ 换成另一种语言');
    ok(/listen_who_guessed', '判错了？点 ↔ 换成另一种语言'\)/.test(MODEL), 'listen-model.js 的兜底串没跟着改');
    for (const l of LOCALES) {
      const v = msg(l, 'listen_who_guessed');
      ok(v && v.trim(), `${l} 的 listen_who_guessed 是空的`);
      ok(v.indexOf('↔') >= 0, `${l} 的 listen_who_guessed 丢了 ↔（那是个按钮，必须指得出）`);
    }
  });

  test('C-04 空历史：zh_CN 一字不差，兜底串同步，13 个语言都有译文', () => {
    eq(msg('zh_CN', 'listen_history_empty'), '双方随便说，每句定稿后会出现在这里。判错了？点 ↔ 换成另一种语言');
    ok(/listen_history_empty', '双方随便说，每句定稿后会出现在这里。判错了？点 ↔ 换成另一种语言'\)/.test(MODEL),
      'listen-model.js 的兜底串没跟着改');
    for (const l of LOCALES) ok(msg(l, 'listen_history_empty').trim(), `${l} 的 listen_history_empty 是空的`);
  });

  test('C-05 设置页说明：zh_CN 一字不差，兜底串同步', () => {
    eq(msg('zh_CN', 'listen_lang_note'), '在你选的两门语言之间自动识别。听译页里可以随时改这两门语言。');
    ok(/listen_lang_note',\s*'在你选的两门语言之间自动识别。听译页里可以随时改这两门语言。'\)/.test(SETTINGS),
      'settings-view.jsx 的兜底串没跟着改');
  });

  test('C-06 识别包没装好：zh_CN 一字不差，兜底串同步', () => {
    eq(msg('zh_CN', 'listen_lang_assets_missing'), '这门语言的识别包还没装好。连上网后点一次「开始听」就能补上。');
    ok(/listen_lang_assets_missing', '这门语言的识别包还没装好。连上网后点一次「开始听」就能补上。'\)/.test(MODEL),
      'listen-model.js 的兜底串没跟着改');
  });

  test('包屏与登录说明不再写死「两个 / 手机 / 设下好」', () => {
    eq(msg('zh_CN', 'firstrun_packs_base_note'),
      '语种识别（ECAPA）+ 人声检测（VAD）：分辨谁在说哪门语言，下好才能开始听');
    eq(msg('zh_TW', 'firstrun_packs_base_note'),
      '語種識別（ECAPA）+ 人聲檢測（VAD）：分辨誰在說哪門語言，下好才能開始聽');
    ok(!/手机/.test(msg('zh_CN', 'firstrun_packs_pick_lede')), '简体仍写手机系统语言');
    ok(!/手機/.test(msg('zh_TW', 'firstrun_packs_pick_lede')), '繁体仍写手机系统语言');
    ok(!/这两样/.test(msg('zh_CN', 'firstrun_packs_lede')), '简体仍写这两样');
    ok(!/這兩樣/.test(msg('zh_TW', 'firstrun_packs_lede')), '繁体仍写这两样');
    ok(!/两个语音包|兩個語音包/.test(msg('zh_CN', 'app_signin_why') + msg('zh_TW', 'app_signin_why')),
      '登录说明仍写两个语音包');
    ok(!/\btwo\b/i.test(msg('en', 'app_signin_why') + ' ' + msg('en', 'firstrun_packs_title')),
      '英文登录说明或标题仍写 two');
  });

  test('C-07 首启语音包页：前半句不变，末句按 E9 第二句重写；两处兜底同步', () => {
    const want = '下好这些，之后你不用再做任何设置 —— 翻译、听译、字幕、朗读都能直接用。'
      + '声音在你的设备上识别。识别出的文字会发去翻译：自己配了 key 时直接发给你配的服务商；'
      + '用免费额度时经我们的服务器转发，不保存文字。';
    eq(msg('zh_CN', 'firstrun_packs_lede'), want);
    const hits = SHELL.split(`'${want}'`).length - 1;
    eq(hits, 2, 'shell-model.js 里 firstrun_packs_lede 的兜底串应当有两处（屏级 + 引导页）');
  });

  test('C-08 app_lede 也按 E9 第二句改掉（不再写「只在你的设备上处理」）', () => {
    eq(msg('zh_CN', 'app_lede'),
      '视频、对话、文档 —— 边听边翻，声音在你的设备上识别。识别出的文字会发去翻译：自己配了 key 时直接发给你配的服务商；用免费额度时经我们的服务器转发，不保存文字。');
    ok(/app_lede', '视频、对话、文档 —— 边听边翻，声音在你的设备上识别。/.test(SHELL), 'shell-model.js 的 app_lede 兜底串没跟着改');
  });
});

describe('C-08 旧文案清零 · 死键退场', () => {
  const OLD = [
    '按语言猜的 · 点 ↔ 改',
    '判错了 · 点 ↔ 换到另一门',
    '改边',
    '语言不对？',
    '声音只在你的设备上处理',
    '对方说的：',
    '我正在说',
    '对方正在说',
    '发到你自己配置的翻译引擎',
  ];
  // 源码里只查**字符串字面量**（引号里）——注释里提到旧词不算违规，构建产物也不会带上注释。
  const lit = (body, s) => {
    const e = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:'[^'\\n]*${e}[^'\\n]*'|"[^"\\n]*${e}[^"\\n]*")`).test(body);
  };
  test('语言文件与 App 源码里不再出现旧串', () => {
    for (const l of LOCALES) {
      const body = read(`extension/_locales/${l}/messages.json`);
      for (const s of OLD) ok(body.indexOf(s) < 0, `${l} 的语言文件里还有旧串「${s}」`);
    }
    for (const [where, body] of [['listen-model.js', MODEL], ['shell-model.js', SHELL], ['settings-view.jsx', SETTINGS]]) {
      for (const s of OLD) ok(!lit(body, s), `${where} 里还有旧串的字面量「${s}」`);
    }
  });

  // 补稿 SG2qu（评审：有条件通过 → 两处照改）：这两句是用户能看到的，逐字守。
  test('补稿 ① listen_flip_kept_card：换到另一种语言了（不用备选，备选丢了「已经复习过」这个原因）', () => {
    eq(msg('zh_CN', 'listen_flip_kept_card'), '换到另一种语言了 · 之前那张卡你已经复习过，留在「来源 › 对话」里');
    ok(/listen_flip_kept_card',\s*'换到另一种语言了 · 之前那张卡你已经复习过，留在「来源 › 对话」里'\)/.test(MODEL),
      'listen-model.js 的兜底串没跟着改');
    for (const l of LOCALES) ok(msg(l, 'listen_flip_kept_card').trim(), `${l} 的 listen_flip_kept_card 是空的`);
  });
  test('补稿 ② listen_device_privacy：与 E9 第二句同措辞（服务商 / 两条路 / 不保存文字）', () => {
    eq(msg('zh_CN', 'listen_device_privacy'),
      '本机转写：边说边出字；整句定稿后连同前几句上下文一起发去翻译：自己配了 key 时直接发给你配的服务商，用免费额度时经我们的服务器转发，不保存文字。选「设备内置朗读」时，语音在你的设备上合成，首次使用会下载一次离线模型。');
    ok(/listen_device_privacy', '本机转写：边说边出字；整句定稿后连同前几句上下文一起发去翻译：自己配了 key 时直接发给你配的服务商，/.test(SETTINGS),
      '披露搬去设置页后，settings-view.jsx 的兜底串没跟上（listen-model 里那段已随 footView 退役）');
    for (const l of LOCALES) ok(msg(l, 'listen_device_privacy').trim(), `${l} 的 listen_device_privacy 是空的`);
  });
  test('四个死键在 13 个语言文件里都删掉了', () => {
    for (const l of LOCALES) {
      const d = JSON.parse(read(`extension/_locales/${l}/messages.json`));
      for (const k of ['listen_lang_edit', 'listen_partner_auto', 'listen_now_me', 'listen_now_them']) {
        ok(!(k in d), `${l} 里还有死键 ${k}`);
      }
    }
  });
  // C-01 / C-02：行标签用**本名**（用户 2026-10-08 18:22 拍板：每门语言用它自己的文字写，
  // 这样真正用这门语言的人看得懂）。判据是「13 个界面语言下，lang_* 的值都等于注册表里的
  // 本名」—— 只要有一个界面语言把它翻成「泰语」「Thai」，泰国人就不认得了。
  test('C-01 13 个界面语言下 lang_* 都是那门语言自己的写法（不随界面语言翻译）', () => {
    const LANGS = require('../build/langs.config.js');
    for (const l of LOCALES) {
      const d = JSON.parse(read(`extension/_locales/${l}/messages.json`));
      for (const g of LANGS) {
        const v = (d[g.labelKey] || {}).message;
        ok(v === g.label, `${l} 的 ${g.labelKey} = 「${v}」，应是本名「${g.label}」`);
      }
    }
  });

  test('C-01 / C-02 行标签不会出现「我」「对方」（那是 2026-09-08 的旧语义）', () => {
    // 听译/字幕的行左侧标签走 langLabel()（注册表本名）；只有拿不到语言名时才回落到 whoMe/whoThem。
    ok(/langLabel: r\.who === 'me' \? langLabel\(cfg && cfg\.myLang\)/.test(MODEL), '行标签不是从语言名来的');
    ok(/r\.langLabel \|\| \(r\.who === 'me' \? hv\.whoMe : hv\.whoThem\)/.test(read('src/app/listen-view.jsx')),
      '视图的兜底链变了');
    // 字幕模式不再跳过语言名（E8 之前 `sub ? '' : …` 会让它回落到「我 / 对方」）
    ok(!/langLabel: sub \? ''/.test(MODEL), '字幕行还在跳过语言名');
  });

  test('字幕行也画语言名（E8），不再回落到「我 / 对方」', () => {
    ok(/langLabel: r\.who === 'me' \? langLabel\(cfg && cfg\.myLang\) : langLabel\(cfg && cfg\.otherLang\)/.test(MODEL),
      '字幕行没有语言名');
    ok(!/langLabel: sub \? ''/.test(MODEL), '字幕行还在跳过语言名');
  });
});
