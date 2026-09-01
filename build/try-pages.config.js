// build/try-pages.config.js — 「现在翻一页看看」按目标语言分页的**唯一**数据源。
//
// 为什么按目标语言分页：示例段落的价值在于「这段你读不顺，翻译一下就顺了」。
// 一个把目标语言设成 English 的人，打开一页英文示例，看到的是英文翻英文 —— 那一页
// 什么都证明不了。2026-09-01 用户在真机上走到这一步时提的正是这件事。
//
// 表里只有**源语言**这一个维度。页面的界面文字走站点自己的运行时 i18n（跟随浏览器
// 语言），示例段落**故意不挂 data-i18n** —— 它是给人翻的外语，翻译它就毁了这一页。
//
// 目标语言全集必须与扩展设置页那个下拉逐条一致（test/try-pages.test.js 钉住）。
// 漏一个语言不会报错，只会让那个用户落回英文页，而没有任何东西会说话。

'use strict';

// 源语言的段落。两段，与官网 setup.html 的示例同源 —— 那两段讲的正是这个产品在做的事。
const PASSAGES = {
  en: {
    // 语言的自称（endonym）。界面上原样显示，不翻译 —— 语言的名字用它自己的文字写，
    // 把「简体中文」渲染成 "Simplified Chinese" 帮不到任何人找到自己的语言。
    endonym: 'English',
    dir: 'ltr',
    paras: [
      'Spaced repetition works because forgetting is not a failure of memory but a '
      + 'property of it. Each time a memory is retrieved just before it would have '
      + 'slipped away, the interval until the next review can be stretched further.',
      'The sentences you actually stopped to read are the ones worth keeping. '
      + 'The ones you scrolled past are not.',
    ],
  },
  'zh-CN': {
    endonym: '简体中文',
    dir: 'ltr',
    paras: [
      '间隔重复之所以有效，是因为遗忘并非记忆的失败，而是记忆本身的特性。每次在一段'
      + '记忆即将消退之前把它取出来，下一次复习的间隔就能拉得更长一些。',
      '那些让你真正停下来读完的句子，才是值得留下的。被你划过去的，不是。',
    ],
  },
};

// 目标语言 → 用哪一段源文。默认英文；目标本身是英文时换中文，否则这一页自证不了。
//
// 只有两个源语言是**刻意的**：再多一个就要再养一段译文，而这一页要证明的事
// （「读不顺的东西，一点就变双语」）用任意一门外语都成立。目标是中文的人读英文，
// 目标是英文的人读中文，其余目标语言的人读英文 —— 后者对绝大多数用户为真，
// 而对「英语很好的法语用户」也只是少了一点惊喜，不会变成假话。
const TARGETS = [
  { code: 'zh-CN', src: 'en' },
  { code: 'zh-TW', src: 'en' },
  { code: 'en', src: 'zh-CN' },
  { code: 'ja', src: 'en' },
  { code: 'ko', src: 'en' },
  { code: 'fr', src: 'en' },
  { code: 'de', src: 'en' },
  { code: 'es', src: 'en' },
  { code: 'ar', src: 'en' },
  { code: 'pt', src: 'en' },
  { code: 'ru', src: 'en' },
  { code: 'it', src: 'en' },
];

module.exports = { PASSAGES, TARGETS };
