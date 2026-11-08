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
  test('README ×2 披露 bt_auth_ok / 不用于跨站追踪 / opt-out 删除 / 计费流水 90 天', () => {
    ok(/bt_auth_ok/.test(EN), 'README.md 没有披露第一方登录台账 bt_auth_ok');
    ok(/cross-site tracking/i.test(EN), 'README.md 没有「不用于跨站追踪」的限定');
    ok(/bt_grant_usage/.test(EN), 'README.md 没有披露仍保留的计费流水 bt_grant_usage');
    ok(/90 days/.test(EN), 'README.md 没有计费流水的 90 天保留期');
    ok(/deletes this device's event rows/.test(EN), 'README.md 没有写 opt-out 删除事件行');
    ok(/matching\s+`bt_auth_ok` rows/.test(EN), 'README.md 没有写 opt-out 删除 bt_auth_ok 对应行');
    ok(/opting out does not delete it/.test(EN), 'README.md 没有写关遥测不删计费流水');
    ok(/bt_auth_ok/.test(ZH), 'README.zh-CN.md 没有披露第一方登录台账 bt_auth_ok');
    ok(/跨站追踪/.test(ZH), 'README.zh-CN.md 没有「不用于跨站追踪」的限定');
    ok(/bt_grant_usage/.test(ZH), 'README.zh-CN.md 没有披露仍保留的计费流水 bt_grant_usage');
    ok(/90 天/.test(ZH), 'README.zh-CN.md 没有计费流水的 90 天保留期');
    ok(/与这个安装 id 对应的行/.test(ZH), 'README.zh-CN.md 没有写 opt-out 删除 bt_auth_ok 对应行');
    ok(/关遥测不会删它/.test(ZH), 'README.zh-CN.md 没有写关遥测不删计费流水');
  });

  test('README ×2 的「anonymous usage / 匿名用量」词干仍在（Gate D 不倒退）', () => {
    ok(/anonymous usage/i.test(EN), 'README.md 丢了 "anonymous usage" 词干');
    ok(/匿名用量/.test(ZH), 'README.zh-CN.md 丢了「匿名用量」词干');
  });

  test('公开 README ×2 已清零旧的不可连接 / 台账仍在写入承诺', () => {
    ok(!/never joined to an account/i.test(EN), 'README.md 仍写着 "never joined to an account"');
    ok(!/永不与账号关联/.test(ZH), 'README.zh-CN.md 仍写着「永不与账号关联」');
    ok(!/sign-in ledger is still written/i.test(EN), 'README.md 仍写着 "sign-in ledger is still written"');
    ok(!/first-party rows already written/i.test(EN), 'README.md 仍写着 "first-party rows already written"');
    ok(!/登录台账仍在登录时写入/.test(ZH), 'README.zh-CN.md 仍写着「登录台账仍在登录时写入」');
    ok(!/已写入的\s*第一方行按保留期/.test(ZH), 'README.zh-CN.md 仍写着「已写入的第一方行按保留期」');
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

  test('公仓 schema 镜像 bt_forget_install：删事件 + bt_auth_ok，不删计费流水', () => {
    const s = read('supabase/schema.sql');
    const start = s.indexOf('create or replace function public.bt_forget_install');
    const end = s.indexOf('revoke all on function public.bt_forget_install', start);
    ok(start >= 0 && end > start, 'schema.sql 没有 bt_forget_install');
    const body = s.slice(s.indexOf('as $$', start), s.indexOf('$$;', s.indexOf('as $$', start)));
    ok(/delete from public\.bt_events where install_id = p_install_id/.test(body), '函数体没删 bt_events');
    ok(/delete from public\.bt_auth_ok where install_id = p_install_id/.test(body), '函数体没删 bt_auth_ok');
    ok(!/bt_grant_usage/.test(body), '函数体不能删 bt_grant_usage');
    ok(/get diagnostics\s+n_events\s*=\s*row_count/.test(body), '缺 events 的 row_count');
    ok(/get diagnostics\s+n_auth\s*=\s*row_count/.test(body), '缺 auth_ok 的 row_count');
    ok(s.includes('revoke all on function public.bt_forget_install(uuid) from public, anon, authenticated;'), '缺 service-role-only revoke');
  });

  test('App 侧设置 hint 兜底串已改成新口径（extension/ 冻结，渲染文本另列缺口）', () => {
    const s = read('src/app/settings-view.jsx');
    ok(/账号↔安装 id/.test(s), 'settings-view.jsx 的 telemetry_hint 兜底串没写账号↔安装 id');
    ok(/90 天保留期/.test(s), 'settings-view.jsx 的 telemetry_hint 兜底串没写第一方保留期');
  });
});
