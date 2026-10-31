// test/asc-units.test.js — 下载量只算「首次下载」，更新与重新下载分开。
//
// 为什么要有这道门：2026-09-27 之前 `aggregateSales()` 把 SALES 报表每一行的 `Units`
// 一律相加，而那一列里**混着三种东西**（靠 `Product Type Identifier` 区分）：首次下载 /
// 重新下载 / **更新**。报出来的「30 天下载 1776」里 **1156 是更新** —— 而 App Store
// Connect 趋势页同口径只有 ~630。这个 bug 不抛异常、不让任何界面变红，只会让**每一个
// 读数悄悄大 3 倍**。所以要一道门把它钉住。
//
// 分类表来自 Apple 官方：developer.apple.com/help/app-store-connect/reference/
// reporting/product-type-identifiers/。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const ASC = require(path.join(ROOT, 'scripts/lib/asc-client.js'));
const SRC_CLIENT = fs.readFileSync(path.join(ROOT, 'scripts/lib/asc-client.js'), 'utf8');
const SRC_ASC = fs.readFileSync(path.join(ROOT, 'scripts/asc.js'), 'utf8');
const SRC_STORE = fs.readFileSync(path.join(ROOT, 'scripts/store-stats.js'), 'utf8');

describe('asc 下载量 —— 按 Product Type Identifier 分类', () => {
  test('首次下载：1 / 1F / 1T / 1EU / F1 / F1-B（F1 是 Mac 首次下载）', () => {
    for (const t of ['1', '1F', '1T', '1EU', 'F1', 'F1-B']) eq(ASC.kindOf(t), 'install', t);
  });

  test('更新：7 / 7F / 7T / F7 —— F7 是 Mac 更新，最容易漏', () => {
    for (const t of ['7', '7F', '7T', 'F7']) eq(ASC.kindOf(t), 'update', t);
  });

  test('重新下载：3 / 3F / F3', () => {
    for (const t of ['3', '3F', 'F3']) eq(ASC.kindOf(t), 'redownload', t);
  });

  test('认不出的一律 other —— 宁可少算，绝不默认算下载', () => {
    for (const t of ['', '   ', 'ZZ', undefined, null]) eq(ASC.kindOf(t), 'other', String(t));
  });

  test('aggregateSales：headline 不含更新，设备/国家/App 也只数首次下载', () => {
    const R = (pt, units, dev, cc) => ({
      'Apple Identifier': 'A', 'Product Type Identifier': pt, Units: String(units),
      Device: dev, 'Country Code': cc,
    });
    const rows = [
      R('1F', 10, 'iPhone', 'US'),
      R('F7', 100, 'iPhone', 'US'),   // 更新：必须不进「下载」
      R('F1', 2, 'Desktop', 'DE'),    // Mac 首次下载：进
      R('3F', 5, 'iPhone', 'US'),     // 重新下载：不进
      R('ZZ', 7, 'iPhone', 'US'),     // 认不出：不进
    ];
    const agg = ASC.aggregateSales(rows, { A: 'App A' });
    eq(agg.total, 12, 'total = 首次下载 10 + 2');
    eq(agg.installs, 12);
    eq(agg.updates, 100);
    eq(agg.redownloads, 5);
    eq(agg.other, 7);
    eq(agg.byApp.get('App A'), 12);
    eq(agg.byDev.get('App A\u0000iPhone'), 10);
    eq(agg.byDev.get('App A\u0000Desktop'), 2);
    eq([...agg.terr.keys()].sort().join(','), 'DE,US');
    eq(agg.terr.get('US').get('App A'), 10);
  });

  test('两个调用方都不再自己加 Units —— 这一列只有 asc-client 碰', () => {
    for (const [name, src] of [['asc.js', SRC_ASC], ['store-stats.js', SRC_STORE]]) {
      ok(!/\.Units\b/.test(src), `${name} 直接读了 Units —— 下载量必须走 aggregateSales`);
    }
    ok(/kindOf\(r\['Product Type Identifier'\]\)/.test(SRC_CLIENT),
      'aggregateSales 没有按 Product Type Identifier 分类');
  });
});
