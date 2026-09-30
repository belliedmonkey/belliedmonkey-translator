// test/timed-text.test.js — 时间轴解析只有一份实现（content/timed-text.js）。
//
// 2026-09-30 前 podcast / twitter / CLI 各抄了一份 tcToMs / stripCueTags / parse —— 两份
// 迟早会漂，而漂开的症状是「一种字幕站有字幕、另一种没有」，只有真机看得见。这道门钉两件事：
// 解析行为，以及**三个消费者都指向同一份实现**（不回抄）。
'use strict';
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const TimedText = require(path.join(ROOT, 'extension/content/timed-text.js'));

describe('timed-text: 解析行为', () => {
  test('VTT 与 SRT（逗号毫秒）都认，按时间排序', () => {
    const vtt = 'WEBVTT\n\n00:00:04.000 --> 00:00:06.000\nSecond.\n\n00:00:01.000 --> 00:00:03.000\nFirst.\n';
    const cues = TimedText.parseTimedText(vtt);
    eq(cues.length, 2);
    eq(cues[0].text, 'First.');
    eq(cues[0].start, 1000);
    eq(cues[1].start, 4000);
    const srt = '1\n00:00:01,500 --> 00:00:02,000\nBonjour.\n';
    eq(TimedText.parseTimedText(srt)[0].start, 1500);
  });

  test('去标签（X 的 <X-word-ms>）与 cue 设置', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000 align:start\n<X-word-ms t="0">Hello</X-word-ms> <X-word-ms>world</X-word-ms>\n';
    eq(TimedText.parseTimedText(vtt)[0].text, 'Hello world');
    eq(TimedText.parseTimedText(vtt)[0].start, 1000);
  });

  test('offsetMs 叠加；sort:false 保持段序', () => {
    const vtt = '00:00:01.000 --> 00:00:02.000\nB\n\n00:00:05.000 --> 00:00:06.000\nA\n';
    const off = TimedText.parseTimedText(vtt, { offsetMs: 1000, sort: false });
    eq(off[0].start, 2000, '偏移叠加');
    eq(off[0].text, 'B', 'sort:false 不打乱（X 多段拼接）');
    eq(TimedText.parseTimedText(vtt)[0].text, 'B', '默认按时间排序');
  });

  test('坏行跳过，不炸', () => {
    eq(TimedText.parseTimedText('not a vtt at all').length, 0);
    eq(TimedText.parseTimedText('').length, 0);
  });
});

describe('timed-text: 三个消费者都指向同一份实现', () => {
  test('内容脚本不自己实现 parseTimedText', () => {
    for (const f of ['content/content-podcast.js', 'content/content-twitter.js']) {
      const s = fs.readFileSync(path.join(ROOT, 'extension', f), 'utf8');
      ok(!/function parseTimedText\s*\(/.test(s), f + ' 又自己实现了 parseTimedText');
      ok(!/function tcToMs\s*\(/.test(s), f + ' 又自己实现了 tcToMs');
      ok(/TimedText\.parseTimedText/.test(s), f + ' 没走共享实现');
    }
  });

  test('CLI 不自己实现解析', () => {
    const s = fs.readFileSync(path.join(ROOT, 'cli/subtitle.js'), 'utf8');
    ok(/timed-text\.js/.test(s), 'cli/subtitle.js 没引用共享模块');
    ok(/TimedText\.parseTimedText/.test(s), 'cli/subtitle.js 没走共享实现');
    ok(!/function tcToMs\s*\(/.test(s), 'cli/subtitle.js 又自己实现了 tcToMs');
  });

  test('manifest 在本文件之前加载它', () => {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
    for (const cs of m.content_scripts) {
      const js = cs.js || [];
      for (const consumer of ['content/content-podcast.js', 'content/content-twitter.js']) {
        if (!js.includes(consumer)) continue;
        ok(js.indexOf('content/timed-text.js') >= 0 && js.indexOf('content/timed-text.js') < js.indexOf(consumer),
          consumer + ' 之前没有先加载 content/timed-text.js');
      }
    }
  });
});
