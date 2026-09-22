// test/grant-one-implementation.test.js — 领额度那条流程**只许有一份**。
//
// 2026-09-22：引导登录成功后要自动领额度（learning-design §8.10.1），而设置页的
// 「领取 / 改回」按钮早就有一条完整流程。当时有两条路可走：在 app.js 里再写一遍，
// 或者把 settings.js 那条抽成共用。选了后者，因为那段里有四件**容易各写各的**事：
//
//   · overwrite 的语义（「领取」不碰用户自己的 key，「改回」才替换）
//   · engine_set 什么时候才算数（写进了槽才算，一个槽都没写不算）
//   · 「已配好」这句话要有证据（跑一次真的自检，不是写完就说通了）
//   · 一个槽都没写时那句话是假的（三槽都是用户自己的 key 时要换一句）
//
// 这四件任何一件在第二份实现里写漏，症状都是「看起来配好了，其实没有」——
// 而那正是 §8.10 这条功能存在的理由的反面。

const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// 先去注释再比：这个仓库的注释里到处是它解释过的调用形状，负向断言会被自己的
// 说明绊倒（同 telemetry-registry.test.js 里那条）。
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

describe('免费额度：领取 → 写槽 → 回执，只有一份实现', () => {
  test('settings.js 把它导出了（共用层的唯一出口）', () => {
    const src = strip(read('app/settings.js'));
    ok(/async function claimAndApply\(/.test(src), 'app/settings.js 里没有 claimAndApply');
    ok(/return \{[^}]*claimAndApply[^}]*\}/.test(src), 'claimAndApply 没有被导出，别处拿不到');
  });

  test('app.js 不自己调 LearnGrant.claim —— 它走共用层', () => {
    const src = strip(read('app/app.js'));
    ok(!src.includes('LearnGrant.claim('),
      'app/app.js 又直接调 LearnGrant.claim() 了 —— 那是第二份实现的开头');
    ok(!src.includes('LearnGrant.plan('),
      'app/app.js 又自己 plan() 了 —— overwrite 的语义会在这里走样');
    ok(src.includes('AppSettings.claimAndApply('),
      'app/app.js 没有走共用层');
  });

  test('自动领取有三个闸，而且一次会话只试一次', () => {
    const src = strip(read('app/app.js'));
    const i = src.indexOf('async function autoClaimGrant');
    ok(i >= 0, '找不到 autoClaimGrant');
    const body = src.slice(i, i + 1400);
    ok(body.includes('LearnGrant.enabled()'),
      '没判「这个 flavor 有没有额度这条路」—— 中国版 MT_GRANT 恒为 null');
    ok(body.includes('EngineState.needsSetup'),
      '没用 EngineState.needsSetup 判「配好了没有」—— 那是唯一出口，不许另写一份');
    ok(/overwrite:\s*false/.test(body),
      'overwrite 不是 false —— 自动领取绝不能碰用户自己的 key');
    ok(/_autoClaimed/.test(body), '没有「一次会话只试一次」的闸');
  });
});
