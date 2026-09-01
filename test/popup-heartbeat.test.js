// test/popup-heartbeat.test.js — 弹窗是同步的心跳，且永不挡在那个数字前面。
//
// 为什么这道门禁存在：2026-09-01 探查发现，全仓**只有复习页与设置页**两个入口级
// 同步触发点（`review.js` 的 ENTRY、`options.js` 的被动心跳）。一个天天在网页上
// 翻译、采集攒了几百张卡、但从没点开过那两页的人，服务器上是空的 —— 于是他在 App
// 里读到「同步完成，但服务器上还没有内容 —— 先在浏览器里采集一些」，而他确实什么
// 都没做错。弹窗是他最常点的那一面，所以它必须也算一次心跳。
//
// 这里钉三件事，每一件都对应一个真实的退化方向：
//   1. 心跳还在      —— 有人「精简弹窗依赖」时会第一个删它
//   2. 心跳在数字之后 —— 挪到前面就是让弹窗等一次网络往返才显示待复习数
//   3. 不带 force    —— 带上就绕过 10 分钟节流，每开一次弹窗打一次全量同步

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');
const { stripComments } = require('./lib/strip-comments');

const ROOT = path.join(__dirname, '..');
const JS = stripComments(fs.readFileSync(path.join(ROOT, 'extension/popup/popup.js'), 'utf8'));
const HTML = fs.readFileSync(path.join(ROOT, 'extension/popup/popup.html'), 'utf8');

describe('弹窗心跳', () => {
  test('弹窗加载了同步那条链，且顺序对', () => {
    const need = ['../learn/backend.config.js', '../learn/auth.js',
      '../learn/chunk.js', '../learn/sync.js'];
    const at = need.map((f) => HTML.indexOf(f));
    for (const [i, f] of need.entries()) {
      ok(at[i] >= 0, `popup.html 没加载 ${f} —— 心跳会在 typeof 守卫那里静默跳过`);
    }
    for (let i = 1; i < at.length; i += 1) {
      ok(at[i] > at[i - 1], `popup.html 的脚本顺序不对：${need[i]} 排在 ${need[i - 1]} 前面`);
    }
  });

  test('★ 心跳还在，而且带 MT_BACKEND 守卫（中国版没有后端，不该有死代码在跑）', () => {
    ok(/LearnSync\.autoSync\(/.test(JS), 'popup.js 里没有 LearnSync.autoSync —— 心跳被删了');
    const call = JS.indexOf('LearnSync.autoSync(');
    const before = JS.slice(Math.max(0, call - 300), call);
    ok(/MT_BACKEND[\s\S]*enabled/.test(before),
      '心跳没有 MT_BACKEND.enabled 守卫 —— 中国版构建里 sync.js 仍会被调到');
  });

  test('★ 心跳排在待复习数字之后 —— 弹窗的第一职责是快点给出那个数', () => {
    const paint = JS.indexOf("$('review-count')");
    const beat = JS.indexOf('LearnSync.autoSync(');
    ok(paint >= 0, "找不到 $('review-count') —— 断言的基准错了，这条门禁在空转");
    ok(beat > paint, '心跳排在了画计数之前：弹窗会先等一次网络往返才显示待复习数');
  });

  test('★ 不带 force —— 带上就绕过 10 分钟节流，每开一次弹窗打一次全量同步', () => {
    const beat = JS.indexOf('LearnSync.autoSync(');
    const stmt = JS.slice(beat, JS.indexOf(';', beat) + 1);
    ok(!/force/.test(stmt), '弹窗的 autoSync 带了 force：' + stmt.trim());
  });

  test('弹窗仍然不跑账号→语料库那条策略（bindCorpus 属于有界面解释结果的面）', () => {
    ok(!/bindCorpus/.test(JS),
      'popup.js 调了 bindCorpus —— 它要读会话、要判认领，失败时弹窗无处解释');
  });
});
