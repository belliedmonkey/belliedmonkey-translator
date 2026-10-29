// agent/copy.js — N25 confirm / failure card copy, verbatim from the copy lock.
//
// A1–A3, F1–F5, and the BEL-104 appendix are the locked strings.
// Near-synonyms are a failure. Slots ({动作短名}) are the only part that varies.
// Banned: 语音包, 收录复习.
//
// User-facing action names exist only for the two locked actions. The other
// five tools keep their action ids and do not grow a short name here.
'use strict';

const TITLE = '确认调用';
const ALLOW_ONCE = '允许这一次';
const CANCEL = '取消';
const ASSISTANT_ALLOW = '始终允许此助手';
const FOOTNOTE = '确认前不开麦、不读页、不写学习库';
const FAILURE_TITLE = '还差一步';
const CLOSE = '关闭';
const ORIGIN_PREFIX = '来自：';
const ORIGIN_KNOWN = '已识别助手';
const ORIGIN_UNKNOWN = '未知助手';

// t291u. Host subscription or API key is a first-class path. The in-app grant
// is auxiliary. P-01…P-04 carry HOST_KEY_HONEST. P-14b carries HOST_KEY_NOTE.
const HOST_KEY_HONEST = '宿主可用自有订阅或 API Key · 大肚猴额度不是唯一路径';
const HOST_KEY_NOTE = '亦可在宿主配置自有 Key 或订阅';

function deviceAllow(shortName) {
  return '本机始终允许（' + shortName + '）';
}

const ACTIONS = {
  'start_live_subtitles': {
    name: '开实时双语字幕',
    short: '实时字幕',
    touches: ['使用麦克风/系统音频', '显示双语字幕', '不把全文发回聊天（默认）'],
  },
  'capture_to_study': {
    name: '收进复习',
    short: '收进复习',
    touches: ['写入学习库', '使用选中句子', '不上传 Key'],
  },
};

const FAILURES = {
  need_permission_mic: {
    line: '需要麦克风 / 系统音频权限',
    primary: '去开启权限',
    secondary: '取消',
  },
  need_packs: {
    line: '需要下载语言包',
    primary: '去下载语言包',
    secondary: '取消',
  },
  need_ext: {
    line: '需要浏览器扩展',
    primary: '安装扩展说明',
    secondary: '复制给 AI 的说明',
  },
  site_unsupported: {
    line: '当前网站暂不支持视频双语字幕',
    primary: '改用实时字幕',
    secondary: '关闭',
  },
  need_engine: {
    line: '还没配置翻译引擎',
    primary: '去配置引擎与密钥',
    secondary: '取消',
  },
  need_app: {
    line: '需要安装 App',
    primary: '去安装 App',
    secondary: '取消',
  },
  need_login: {
    line: '需要登录',
    primary: '去登录',
    secondary: '取消',
  },
  // Receipt wire codes quota_or_key and subscription_cannot_pay. The card code is this key.
  grant_or_key_unavailable: {
    line: '本机额度或密钥不可用',
    primary: '去配置引擎与密钥',
    secondary: '取消',
    footnote: HOST_KEY_NOTE,
  },
  network_unavailable: {
    line: '网络暂时不可用',
    primary: '重试',
    secondary: '取消',
  },
};

// Wire codes that render a card under a different COPY-LOCK code.
const RECEIPT_CARD = {
  quota_or_key: 'grant_or_key_unavailable',
  subscription_cannot_pay: 'grant_or_key_unavailable',
};

function failureRow(code) {
  const key = RECEIPT_CARD[code] || code;
  const row = FAILURES[key];
  if (!row) return null;
  return {
    code: key,
    line: row.line,
    primary: row.primary,
    secondary: row.secondary,
    footnote: row.footnote || '',
  };
}

// Clipboard body for F3's secondary. No page text, no key, no store install link.
const EXT_NOTE_FOR_AI = '需要浏览器扩展。请在本机安装扩展后再试。不要把密钥发给助手。';

const PASTE_PROMPT = '贴上要收进复习的句子';

const MESSAGES = {
  readyOk: '本机就绪',
  gapPrefix: '缺口 ',
  openedSetup: '已打开设置',
  openedSubtitles: '已打开实时双语字幕。点「开始」后才会使用麦克风。',
  captured: '已收进复习',
  explained: '已开始解析',
  drilled: '已开始轻量复习',
  cancelled: '已取消',
  needConfirm: '需要你在本机点确认',
  untrusted: '这次调用还没有确认',
  badRequest: '缺少必要参数',
  textTooLong: '句子超过长度上限',
  unsupported: '这个动作还没实现',
  needLogin: FAILURES.need_login.line,
  needApp: FAILURES.need_app.line,
  needOs: '系统版本不够',
  quota: FAILURES.grant_or_key_unavailable.line,
  studyOff: '采集已关闭',
  goLogin: FAILURES.need_login.primary,
  network: FAILURES.network_unavailable.line,
  retry: FAILURES.network_unavailable.primary,
};

module.exports = {
  TITLE,
  ALLOW_ONCE,
  CANCEL,
  ASSISTANT_ALLOW,
  FOOTNOTE,
  FAILURE_TITLE,
  CLOSE,
  ORIGIN_PREFIX,
  ORIGIN_KNOWN,
  ORIGIN_UNKNOWN,
  HOST_KEY_HONEST,
  HOST_KEY_NOTE,
  deviceAllow,
  ACTIONS,
  FAILURES,
  RECEIPT_CARD,
  failureRow,
  EXT_NOTE_FOR_AI,
  PASTE_PROMPT,
  MESSAGES,
};
