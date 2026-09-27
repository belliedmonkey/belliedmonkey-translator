// test/content-ui.test.js — PR8a 的结构门：懒加载边界的一致式 + Trusted Types 面。
//
// 判据都是「文件/清单里有什么」，不是「页面上画了什么」—— 页面上的部分由
// scripts/verify-content-menu.js（真 Chrome，isolated world 里动态 import + 开/关
// 菜单）和 test:layout 的 FAB 断言负责；这里守的是配置与源码的结构不变量，
// npm test 就红，不用等浏览器。
'use strict';
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const manifestPath = path.join(ROOT, 'extension', 'manifest.json');
const entries = require('../build/ui-entries.config.js').ENTRIES;

describe('content-ui — PR8a 懒加载边界（结构门）', () => {
  const LAZY = 'content/sub-menu.bundle.js';
  const entry = entries.find((e) => e.out === LAZY);

  test('懒加载 bundle：ESM 入口在登记处，且不在任何 content_scripts js 列表里', () => {
    ok(entry, `ui-entries.config.js 缺 ${LAZY} 条目`);
    eq(entry.format, 'esm', '懒加载产物必须是 ESM（动态 import 的形态）');
    for (const block of JSON.parse(fs.readFileSync(manifestPath, 'utf8')).content_scripts) {
      ok(!block.js.includes(LAZY),
        `${LAZY} 混进了同步 content_scripts 列表 —— 同步注入面字节门会被撑爆。` +
        '回退开关（IIFE 静态注入）的两个动作（format 改回 + 列表尾插）必须同一 PR');
    }
  });

  test('懒加载 bundle 在 web_accessible_resources（import(chrome.runtime.getURL) 的前提）', () => {
    const war = JSON.stringify(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).web_accessible_resources);
    ok(war.includes(LAZY), `${LAZY} 不在 web_accessible_resources —— 内容脚本的动态 import 会 404`);
  });

  test('floating-button.js 不再走 innerHTML（Trusted Types 面），ABI 原样', () => {
    const t = fs.readFileSync(path.join(ROOT, 'extension', 'content', 'floating-button.js'), 'utf8');
    eq(t.includes('innerHTML'), false, 'floating-button.js 里还有 innerHTML —— 注入面 TT 隐患回潮');
    ok(t.includes('createElementNS'), 'FAB SVG 应走 createElementNS');
    for (const fn of ['create', 'setEnabled', 'remove', 'showTranslateChip']) {
      ok(new RegExp(`\\b${fn}\\b`).test(t), `FloatingButton.${fn} 不见了 —— content-main.js 的调用 ABI 破坏`);
    }
  });

  test('subtitle-adapter.js：菜单行判据留在旧侧，bundle 只拿行数据', () => {
    const t = fs.readFileSync(path.join(ROOT, 'extension', 'content', 'subtitle-adapter.js'), 'utf8');
    for (const key of ['yt_mode_both', 'yt_mode_trans', 'yt_mode_orig', 'yt_download_srt', 'asr_stop', 'yt_display_type']) {
      ok(t.includes(`'${key}'`), `菜单文案键 ${key} 从 adapter 消失了 —— 行判据必须留在旧侧（i18n 与行序的单一来源）`);
    }
    ok(t.includes(LAZY), '懒加载 import 的指向丢了');
    ok(t.includes('getElementById(ID.menu)'), 'closeMenu 的 DOM 兜底丢了 —— import 竞态窗口里要能关');
  });
});
