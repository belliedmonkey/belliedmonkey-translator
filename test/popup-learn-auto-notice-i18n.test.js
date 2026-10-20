// D16：升级横幅正文须随界面语言刷新（useMemo([t, s.uiLang]) 会在 setUiLang 通知后漏重算）。
const fs = require('fs');
const path = require('path');
const { describe, test, eq, ok, loadSrc } = require('./harness');

const ROOT = path.join(__dirname, '..');

function learnAutoNoticeBody(t) {
  const name = t('learn_enable', '采集学习材料');
  return t(
    'notice_learn_auto_on',
    '已为你打开「采集学习材料」：你读过的句子会存在这台设备上，用来复习。不想要可以随时在设置里关掉。',
  ).replace(/\{learn_enable\}/g, name);
}

function bootPageText(table, chromeUi = 'en-US') {
  const sandbox = { MT_I18N_MESSAGES: table };
  sandbox.chrome = {
    i18n: {
      getUILanguage: () => chromeUi,
      getMessage: () => '',
    },
  };
  return loadSrc('src/lib/i18n.js', 'PageText', sandbox).PageText;
}

const TABLE = {
  en: {
    learn_enable: 'Collect learning material',
    notice_learn_auto_on:
      '"Collect learning material" is now on: sentences you read are kept on this device for review.',
  },
  zh_CN: {
    learn_enable: '采集学习材料',
    notice_learn_auto_on: '已为你打开「采集学习材料」：你读过的句子会存在这台设备上，用来复习。',
  },
  de: {
    learn_enable: 'Lernmaterial sammeln',
    notice_learn_auto_on: '„{learn_enable}" ist jetzt an: Gelesene Sätze werden auf diesem Gerät gespeichert.',
  },
};

describe('popup learn-auto notice i18n (D16)', () => {
  test('popup 正文在渲染时 t()，不用 useMemo 缓存', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/pages/popup.jsx'), 'utf8');
    ok(!/learnAutoNoticeBody\s*=\s*useMemo/.test(src),
      'learnAutoNoticeBody 不应 useMemo —— setUiLang 后 t 引用不变会卡住英文正文');
    ok(/notice_learn_auto_on/.test(src) && !/learnAutoNoticeBody\s*=\s*useMemo/.test(src),
      'notice_learn_auto_on 须在组件体内直接 t()');
  });

  test('setUiLang 后正文随 zh_CN / de 切换（模拟 settings 已写入而 i18n 晚一拍）', () => {
    const P = bootPageText(TABLE);
    const settingsUiLang = 'zh_CN';
    let memoDeps = null;
    let memoBody = null;
    const memoized = () => {
      const deps = [P.t, settingsUiLang];
      if (memoDeps && memoDeps[0] === deps[0] && memoDeps[1] === deps[1]) return memoBody;
      memoDeps = deps;
      memoBody = learnAutoNoticeBody(P.t);
      return memoBody;
    };

    const enBody = learnAutoNoticeBody(P.t);
    ok(enBody.includes('Collect learning material'), '首帧跟浏览器 en');

    const staleMemo = memoized();
    eq(staleMemo, enBody);
    P.setUiLang('zh_CN');
    eq(memoized(), enBody, 'useMemo([t, uiLang]) 在 setUiLang 后仍返回英文 —— 即 D16 根因');

    const zhBody = learnAutoNoticeBody(P.t);
    ok(zhBody.includes('采集学习材料') && !zhBody.includes('Collect learning material'));

    P.setUiLang('de');
    const deBody = learnAutoNoticeBody(P.t);
    ok(deBody.includes('Lernmaterial sammeln') && deBody.includes('ist jetzt an'));
  });
});
