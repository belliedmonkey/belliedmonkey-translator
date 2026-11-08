// test/privacy-link.test.js — BEL-222（2026-11-08）隐私口径回归。
//
// 背景：bt_auth_ok 把 user_id 与 install_id 写进同一张第一方表，bt_grant_usage 也带
// install_id ⇒ 匿名用量与我们自己的账号可连接。仓库里「never joined to an account /
// 永不与账号关联」的公开承诺因此变成假话；两份 README 必须改成可连接披露，内部规则与
// 设计文档也不能再写「永不 join」。ASC 标签（linked，tracking 仍 no）是 UI 侧手填，
// 不在这个测试里 —— 它没有代码可断言。
//
// 这里只锁**声明**，不锁实现：事件正文仍然不带 user_id / 内容（规则 1 不变）。
const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const EN = read('README.md');
const ZH = read('README.zh-CN.md');

describe('BEL-222 隐私口径：第一方账号↔安装 id 可连接', () => {
  test('README ×2 披露 bt_auth_ok / 不用于跨站追踪 / 90 天保留期', () => {
    ok(/bt_auth_ok/.test(EN), 'README.md 没有披露第一方登录台账 bt_auth_ok');
    ok(/cross-site tracking/i.test(EN), 'README.md 没有「不用于跨站追踪」的限定');
    ok(/90-day retention/i.test(EN), 'README.md 没有第一方行的 90 天保留期');
    ok(/bt_auth_ok/.test(ZH), 'README.zh-CN.md 没有披露第一方登录台账 bt_auth_ok');
    ok(/跨站追踪/.test(ZH), 'README.zh-CN.md 没有「不用于跨站追踪」的限定');
    ok(/90 天/.test(ZH), 'README.zh-CN.md 没有第一方行的 90 天保留期');
  });

  test('README ×2 的「anonymous usage / 匿名用量」词干仍在（Gate D 不倒退）', () => {
    ok(/anonymous usage/i.test(EN), 'README.md 丢了 "anonymous usage" 词干');
    ok(/匿名用量/.test(ZH), 'README.zh-CN.md 丢了「匿名用量」词干');
  });

  test('公开 README ×2 已清零旧的不可连接承诺', () => {
    ok(!/never joined to an account/i.test(EN), 'README.md 仍写着 "never joined to an account"');
    ok(!/永不与账号关联/.test(ZH), 'README.zh-CN.md 仍写着「永不与账号关联」');
  });

  test('内部规则 / 设计文档不再写「永不 join」，且保留可连接披露', () => {
    const files = [
      'AGENTS.md',
      'docs/decisions.md',
      'docs/telemetry-design.md',
      'docs/learning-design.md',
      'build/telemetry.config.js',
      'supabase/schema.sql',
    ];
    for (const f of files) {
      const t = read(f);
      ok(!/never joined to an account/i.test(t), `${f} 仍有 "never joined to an account"`);
      ok(!/永不 join/.test(t), `${f} 仍有「永不 join」`);
      ok(!/永不与账号关联/.test(t), `${f} 仍有「永不与账号关联」`);
    }
    ok(/可连接/.test(read('docs/telemetry-design.md')), 'telemetry-design.md 没有「可连接」的替代口径');
    ok(/Product Interaction, linked to you/.test(read('docs/learning-design.md')), 'learning-design.md 的 ASC 标签仍是 not linked');
    ok(/可对上|可连接/.test(read('supabase/schema.sql')), 'schema.sql 没有记录 install_id 与账号可对上');
  });

  test('App 侧设置 hint 兜底串已改成新口径（extension/ 冻结，渲染文本另列缺口）', () => {
    const s = read('src/app/settings-view.jsx');
    ok(/账号↔安装 id/.test(s), 'settings-view.jsx 的 telemetry_hint 兜底串没写账号↔安装 id');
    ok(/90 天保留期/.test(s), 'settings-view.jsx 的 telemetry_hint 兜底串没写第一方保留期');
  });
});
