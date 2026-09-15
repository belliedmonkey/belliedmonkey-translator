// test/subtitle-tip-brands.test.js — 「实时字幕」页上的提示与说明不点名具体 App。
//
// iPhone 的实时字幕听的是「任意 App」外放的声音，商店文案（store-assets/aso.md）早就定了
// 「写任意 App，不点名 Safari」。App 里那句提示却写着（Safari、Chrome、YouTube、播客…），
// 而同一张字符串表也出货在中国版 —— 2026-09-15 拍中国版商店截图时，iPad 字幕页上印着
// YouTube；中国版商店图的纪律是不出现境内打不开的站点（screenshots-cn/src/scene.html 顶部）。
//
// 只看字幕页自己的四句：扩展里「YouTube 字幕颜色」这类说的就是 YouTube，不在此列。

const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const DIR = path.join(__dirname, '..', 'extension', '_locales');
const KEYS = ['subtitle_tip_ios', 'subtitle_tip_mac', 'subtitle_privacy_ios', 'subtitle_privacy'];
const BRANDS = /\b(Safari|Chrome|YouTube|Google|Netflix|Bilibili)\b/i;

describe('实时字幕页 — 提示与说明不点名具体 App', () => {
  test('每个语种的四句里都没有具体 App 的名字', () => {
    const bad = [];
    for (const l of fs.readdirSync(DIR)) {
      const m = JSON.parse(fs.readFileSync(path.join(DIR, l, 'messages.json'), 'utf8'));
      for (const k of KEYS) {
        const hit = String((m[k] || {}).message || '').match(BRANDS);
        if (hit) bad.push(`${l}.${k}: ${hit[0]}`);
      }
    }
    // 一行写完：harness 只打印报错的前三行
    ok(bad.length === 0, `${bad.length} 处点名了具体 App：` + bad.join(' ｜ '));
  });
});
