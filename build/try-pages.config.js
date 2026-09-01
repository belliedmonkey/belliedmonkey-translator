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

// 源语言的段落：**一篇介绍这个产品本身的短文**（2026-09-01 用户裁定）。
//
// 为什么是产品介绍而不是随便一段外语：这一页要同时办两件事 —— 证明翻译能用，
// 以及让一个刚装完、还不知道自己装了什么的人读懂他装了什么。用一段讲间隔重复的
// 通用文字，第二件事就白丢了。译文出来的那一刻，他读到的正是这东西是干什么的。
const PASSAGES = {
  en: {
    // 语言的自称（endonym）。界面上原样显示，不翻译 —— 语言的名字用它自己的文字写，
    // 把「简体中文」渲染成 "Simplified Chinese" 帮不到任何人找到自己的语言。
    endonym: 'English',
    dir: 'ltr',
    paras: [
      'BelliedMonkey Translator is a browser extension that puts a translation under '
      + 'every paragraph you read, in your own language, without taking you out of the '
      + 'page. You bring your own API key, so the text goes straight from your device '
      + 'to the engine you picked — nothing passes through us.',
      'It also remembers. The sentences you actually slowed down to read become review '
      + 'cards, and those cards follow you to your phone. The article you read this '
      + 'morning is what you practise tonight.',
    ],
  },
  'zh-CN': {
    endonym: '简体中文',
    dir: 'ltr',
    paras: [
      '大肚猴翻译是一个浏览器扩展：你读到的每一段下面，都会出现一句你自己的语言，'
      + '而不必离开这一页。翻译用的是你自己的 API key，文字从你的设备直接送到你选的'
      + '引擎 —— 不经过我们。',
      '它还会记住。那些你真正放慢速度读完的句子会变成复习卡，并跟着你到手机上。'
      + '今天早上读的那篇文章，就是今晚要练的东西。',
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
