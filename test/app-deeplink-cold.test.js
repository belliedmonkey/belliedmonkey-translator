// test/app-deeplink-cold.test.js — DEV-25：冷启动 deeplink 须等 show(session) 后再 apply。
'use strict';

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'src', 'app', 'shell-model.js'), 'utf8');

describe('DEV-25: deeplink cold boot deferral', () => {
  test('★ boot 完成前只暂存，show 之后再 flush（shell-model 接线）', () => {
    ok(/let shellBootDone = false/.test(SHELL), 'shellBootDone 旗标');
    ok(/let deferredDeepLink = null/.test(SHELL), 'deferredDeepLink 槽');
    ok(/if \(!shellBootDone\) \{ deferredDeepLink = d; return; \}/.test(SHELL),
      'deeplink 回调在 boot 完成前应 defer');
    const showIdx = SHELL.indexOf('await show(session);');
    ok(showIdx >= 0, 'await show(session) 存在');
    const flushIdx = SHELL.indexOf('await flushDeferredDeepLink();');
    ok(flushIdx > showIdx, 'flush 须在 show(session) 之后');
    ok(/shellBootDone = true/.test(SHELL), 'flush 前须置 shellBootDone');
  });

  test('★ 模拟冷启动时序：defer → show 赋值 session → flush 才 apply', async () => {
    let currentSession = null;
    let shellBootDone = false;
    let deferredDeepLink = null;
    const applied = [];

    function parseDeepLink(raw) {
      const u = new URL(String(raw));
      if (!/^belliedmonkey:$/.test(u.protocol)) return null;
      const has = u.searchParams.has('uid');
      return {
        action: u.hostname || 'review',
        hasUid: has,
        uid: has ? String(u.searchParams.get('uid') || '') : null,
      };
    }

    async function applyDeepLink(d) {
      const mine = (currentSession && currentSession.userId) || '';
      if (mine && (!d.hasUid || !d.uid || d.uid === mine)) applied.push('review');
      else if (!mine) applied.push('signin');
      else applied.push('mismatch');
    }

    async function flushDeferredDeepLink() {
      if (!deferredDeepLink) return;
      const d = deferredDeepLink;
      deferredDeepLink = null;
      await applyDeepLink(d);
    }

    function onDeeplink(raw) {
      const d = parseDeepLink(raw);
      if (!d) return;
      if (!shellBootDone) { deferredDeepLink = d; return; }
      void applyDeepLink(d);
    }

    async function show(session) {
      currentSession = session;
    }

    // 冷启动：deeplink 在 show 之前到达
    onDeeplink('belliedmonkey://review?uid=u1');
    eq(applied.length, 0, 'show 前不得 apply');
    ok(deferredDeepLink && deferredDeepLink.action === 'review', '应先暂存');

    await show({ userId: 'u1' });
    shellBootDone = true;
    await flushDeferredDeepLink();
    deepEq(applied, ['review'], 'show 赋 session 后 flush 应进复习');

    // 热启动：boot 已完，实时 apply（不再写入 deferred）
    onDeeplink('belliedmonkey://review?uid=u1');
    await new Promise((r) => setTimeout(r, 0));
    eq(deferredDeepLink, null, 'boot 完成后不应再 defer');
    eq(applied.length, 2, '第二链接应即时 apply');
    eq(applied[1], 'review');
  });
});

function deepEq(a, b, msg) {
  eq(JSON.stringify(a), JSON.stringify(b), msg || 'deepEq');
}

describe('D19: listen deeplink waits for entry card reveal', () => {
  test('★ listen 分支在入口全 hidden 时轮询等待，揭开后再点', () => {
    ok(/const LISTEN_DL_WAIT_MS = \d+;/.test(SHELL), 'LISTEN_DL_WAIT_MS 上限');
    const i = SHELL.indexOf("if (d.action === 'listen') {");
    ok(i >= 0, 'listen 分支存在');
    const body = SHELL.slice(i, i + 2600);
    ok(/while \(!pick\(\) && !settled\(\) && Date\.now\(\) < until\)/.test(body), '未落定时等待');
    ok(/if \(btn\) btn\.click\(\);/.test(body), '揭开后点入口');
  });

  test('★ 模拟：入口晚 200ms 揭开 → 仍点进；揭开但 disabled → 停首页', async () => {
    async function run(revealAfter, disabled) {
      const b = { hidden: true, disabled: false, clicked: 0, click() { this.clicked++; } };
      setTimeout(() => { b.hidden = false; b.disabled = disabled; }, revealAfter);
      const pick = () => (!b.hidden && !b.disabled ? b : null);
      const settled = () => !b.hidden;
      const until = Date.now() + 2000;
      while (!pick() && !settled() && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
      const btn = pick(); if (btn) btn.click();
      return b.clicked;
    }
    eq(await run(200, false), 1, '晚揭开也要点进实时字幕');
    eq(await run(50, true), 0, '门没过不点');
  });
});

describe('D19: native deeplink bridge must not stash pending on the pre-load blank document', () => {
  const SW = fs.readFileSync(path.join(ROOT, 'app', 'native', 'open-url-bridge.swift'), 'utf8');
  test('★ 非 Main.html 文档回 wait，原生重送（有上限）', () => {
    ok(/indexOf\('Main\.html'\) < 0\) \{ return 'wait'; \}/.test(SW), '空白文档上不写 pending');
    ok(/if r != "ok" && attempt < \d+/.test(SW), '未 ok 时有界重送');
    ok(/deliver\(raw, attempt: attempt \+ 1\)/.test(SW), '重送递增 attempt');
  });
});
