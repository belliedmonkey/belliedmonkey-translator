// build/os-floor.config.js — 宿主 App 支持的系统下限（唯一登记处）。
//
// 谁读它：
//   · scripts/sync-app-assets.js  把两棵 Xcode 工程的 IPHONEOS_DEPLOYMENT_TARGET / MACOSX_DEPLOYMENT_TARGET
//                                 钉到这里的值（转换器每次重生成都会写回它自己的默认值 15.0 / 10.14）
//   · build.js                    「解析期语法门」：dist/ 与 dist-app/ 里任何一个 .js 用了比下限 WebKit
//                                 更新的**解析期**语法就红 —— 一份拼接的 Script.js 里一处解析失败，整个 App
//                                 就是一扇空窗（2026-09-12 用户来信：iOS 15.8.8 打开 App 只有空白）
//   · docs/verification-spec.md   §0 设备矩阵的下限说明
//
// 为什么是 iOS 16.4 / macOS 13.3（2026-09-13 用户裁定「限定下我们支持的版本下限，确保高质量语音能用」）：
//   · 「优质」档系统语音（AVSpeechSynthesisVoiceQuality.premium）iOS 16 起才有；对话朗读 2026-09-13 起
//     在 App 内走原生 AVSpeechSynthesizer、按 优质 > 增强 > 默认 挑（learning-design §9.1）
//   · Safari 16.4 的 WebKit 把正则后行断言、CompressionStream、Array.prototype.at 等一次补齐；
//     能装 16.0 的每一台设备都能升到 16.7，所以 16.4 比 16.0 不多排除任何硬件
//   · macOS 13.3 = Safari 16.4 同一代 WebKit
//   · 代价：iOS 15 的设备（iPhone 6s / 7 / SE 一代）拿不到新版本；它们已装的版本继续可用
'use strict';

const FLOOR = { ios: '16.4', macos: '13.3', safari: '16.4', decided: '2026-09-13' };

// 解析期语法 × 首个支持它的 Safari 版本。只登记**解析期**就炸的东西：运行时 API（structuredClone、
// CompressionStream…）要么有特性检测、要么只在某条路上跑，grep 会误报，不在这里。
// 每条 pattern 对源码逐行扫，去掉了行注释与块注释；命中即报（文件:行）。
const SYNTAX = [
  { id: 'regex-lookbehind', since: '16.4', pattern: /\(\?<[=!]/, note: '正则后行断言 (?<= / (?<!' },
  { id: 'class-static-block', since: '16.4', pattern: /\bstatic\s*\{/, note: 'class 静态初始化块 static { }' },
  { id: 'regex-v-flag', since: '17.0', pattern: /\/[gimsuyd]*v[gimsuyd]*(?=[\s.,;)\]}])/, note: '正则 v 标志（unicodeSets）', needsRegexContext: true },
  { id: 'using-declaration', since: '26.0', pattern: /^\s*(?:await\s+)?using\s+[A-Za-z_$]/, note: 'using 声明（显式资源管理）' },
];

function cmp(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

function stripComments(src) {
  // 够用的去注释：块注释整段去掉，行注释从 // 起去掉（字符串里的 // 会误伤，但只会漏报不会误报语法）
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/**
 * 找出 text 里比 floor（Safari 版本）更新的解析期语法。返回 [{ id, line, note, since, text }]。
 * 纯函数，给 build.js 与 test/ 共用。
 */
function syntaxViolations(text, floor) {
  const out = [];
  const lines = stripComments(String(text)).split('\n');
  for (const s of SYNTAX) {
    if (cmp(s.since, floor || FLOOR.safari) <= 0) continue;   // 下限已经支持 ⇒ 不是问题
    for (let i = 0; i < lines.length; i++) {
      if (!s.pattern.test(lines[i])) continue;
      if (s.needsRegexContext && !/\/[^\/\n]+\/[gimsuyd]*v/.test(lines[i])) continue;
      out.push({ id: s.id, line: i + 1, note: s.note, since: s.since, text: lines[i].trim().slice(0, 120) });
    }
  }
  return out;
}

module.exports = { FLOOR, SYNTAX, syntaxViolations, cmp, stripComments };
