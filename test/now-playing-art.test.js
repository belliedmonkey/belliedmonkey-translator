// test/now-playing-art.test.js — 锁屏封面的排版（§9.5「后台与锁屏播放」）。
//
// 画图本身在真机上才验得了，但**排版决定**是纯的，而它恰恰是最容易悄悄坏掉的一半：
// 一句长句子放不下时是缩、是折、还是溢出画布外看不见？裸卡（没有译文的卡）会不会
// 在下半张留一块白？中英混排断在哪里？
//
// 这些如果不测，唯一的验证手段就是锁屏截图 —— 而那是最贵、最慢、最容易「看着差不多
// 就过」的一种。所以字号搜索、折行、截断三件事全部走注入的假测量器，在这里钉死。
const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');

const A = loadModule('../app/now-playing-art.js', { window: {} }).NowPlayingArt;

// 假测量器：每个字符固定宽度。真实的是 ctx.measureText，形状一样（文本 + 字号 → 宽度），
// 所以排版逻辑测得到，而不必把 canvas 搬进 vm。
const measure = (perChar) => (text, size) => String(text).length * size * perChar;
const M = measure(0.55);

const BOX = { width: 816, height: 738 };   // = 1024 - 2×48 外边距 - 2×56 内边距

describe('NowPlayingArt.tokenize — 中英一套规则', () => {
  test('中文逐字成组，英文按空格成词', () => {
    deepEq(A.tokenize('你好'), ['你', '好']);
    eq(A.tokenize('hello world').length, 2);
  });

  test('中英混排里，断点同时存在于两种文字上', () => {
    const t = A.tokenize('Hi 你好 world');
    ok(t.indexOf('你') >= 0 && t.indexOf('好') >= 0, '中文必须能逐字断: ' + JSON.stringify(t));
    ok(t.some((x) => x.indexOf('Hi') >= 0), '英文单词不能被拆开: ' + JSON.stringify(t));
  });
});

describe('NowPlayingArt.wrap — 折行', () => {
  test('放不下就换行，且不把英文单词劈开', () => {
    const lines = A.wrap('alpha beta gamma delta', 100, 20, measure(0.55));
    ok(lines.length > 1, '应该折行');
    for (const l of lines) ok(!/^[a-z]*$/.test(l) || l.length > 2, l);
    eq(lines.join(' ').replace(/\s+/g, ' ').trim(), 'alpha beta gamma delta');
  });

  test('中文没有空格也要能断开 —— 否则一句中文永远是一行，直接溢出去', () => {
    const lines = A.wrap('安全必须成为平台的一部分', 60, 20, measure(1));
    ok(lines.length > 1, '中文必须断得开: ' + JSON.stringify(lines));
    eq(lines.join(''), '安全必须成为平台的一部分');
  });
});

describe('NowPlayingArt.fitCard — 按句长定字号', () => {
  test('短句涨到最大字号，不缩在角落里', () => {
    const f = A.fitCard('Short.', '短句。', BOX, M);
    eq(f.orig.size, A.ORIG.max);
  });

  test('长句缩下来，且整块真的放得进 box', () => {
    const long = 'Once people began sharing workspaces, apps, and outputs, we needed to '
      + 'ensure that collaboration could not expose information someone was not permitted to see.';
    const zh = '一旦人们开始共享工作区、应用和输出内容，我们就必须确保协作不会暴露某人不被允许查看的信息。';
    const f = A.fitCard(long, zh, BOX, M);
    ok(f.orig.size < A.ORIG.max, '长句必须缩');
    ok(f.orig.size >= A.ORIG.min, '不能缩到比下限还小');
    const h = f.orig.lines.length * f.orig.size * A.ORIG.lh
      + A.GAP + f.tr.lines.length * f.tr.size * A.TR_LH;
    ok(h <= BOX.height, '整块高度 ' + Math.round(h) + ' 超出了 ' + BOX.height);
  });

  test('译句字号永远是原句的 19/21 —— 那个比例就是「和 App 里是同一张卡」的实质', () => {
    for (const [en, zh] of [['Short.', '短。'], ['A somewhat longer sentence here.', '稍微长一点的一句话。']]) {
      const f = A.fitCard(en, zh, BOX, M);
      eq(f.tr.size, Math.round(f.orig.size * A.TR_RATIO), en);
    }
  });

  test('裸卡（没有译文）不留空洞：原句自己涨上去占满', () => {
    const bare = A.fitCard('Agent Products, Benchmarks, and Enterprise Evaluation', '', BOX, M);
    eq(bare.tr, null);
    const withTr = A.fitCard('Agent Products, Benchmarks, and Enterprise Evaluation', '一段译文。', BOX, M);
    ok(bare.orig.size > withTr.orig.size,
      '同一句话，没有译文时字号应该更大（' + bare.orig.size + ' vs ' + withTr.orig.size + '）');
  });

  test('极端长文本：截断 + 省略号，绝不溢出画布', () => {
    const huge = 'word '.repeat(400);
    const f = A.fitCard(huge, '', BOX, M);
    eq(f.orig.size, A.ORIG.min, '先缩到下限');
    const h = f.orig.lines.length * f.orig.size * A.ORIG.lh;
    ok(h <= BOX.height, '截断后仍然溢出：' + Math.round(h));
    ok(/…$/.test(f.orig.lines[f.orig.lines.length - 1]), '截断必须有省略号，否则读的人以为句子就这么长');
  });

  test('空卡不炸', () => {
    const f = A.fitCard('', '', BOX, M);
    ok(f.orig.lines.length >= 1);
  });
});

describe('NowPlayingArt.render — 没有 canvas 的宿主上安静退场', () => {
  test('拿不到 document 时返回空串，而不是抛异常', () => {
    // 播放是主线，封面是装饰。画不出来必须是「没有封面」，绝不能变成「播不了」。
    eq(A.render({ text: 'x' }), '');
  });
});
