// agent/copy.js — N25 confirm / failure card copy, verbatim from the copy lock.
//
// A1–A3 and F1–F5 are the locked strings. Near-synonyms are a failure.
// Slots ({动作短名}) are the only part that varies. Banned: 语音包, 收录复习.
'use strict';

const TITLE = '确认调用';
const ALLOW_ONCE = '允许这一次';
const CANCEL = '取消';
const ASSISTANT_ALLOW = '始终允许此助手';
const FOOTNOTE = '确认前不开麦、不读页、不写学习库';
const FAILURE_TITLE = '还差一步';
const CLOSE = '关闭';

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
  'translate_page': {
    name: '整页双语',
    short: '整页双语',
    touches: ['读当前页', '不上传 Key', '不把全文发回聊天（默认）'],
  },
  'translate_video_captions': {
    name: '视频双语字幕',
    short: '视频字幕',
    touches: ['读页内视频字幕', '不把全文发回聊天（默认）'],
  },
  'explain_or_drill': {
    name: '解析或轻量复习',
    short: '解析',
    touches: ['不上传 Key', '不把全文发回聊天（默认）'],
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
};

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
  needLogin: '需要登录',
  needApp: '需要安装 App',
  needOs: '系统版本不够',
  quota: '本机额度或密钥不可用',
  studyOff: '采集已关闭',
  captureUnwired: '这次还写不进学习库',
  explainUnwired: '这次还做不了解析',
  goLogin: '去登录',
};

module.exports = {
  TITLE,
  ALLOW_ONCE,
  CANCEL,
  ASSISTANT_ALLOW,
  FOOTNOTE,
  FAILURE_TITLE,
  CLOSE,
  deviceAllow,
  ACTIONS,
  FAILURES,
  EXT_NOTE_FOR_AI,
  PASTE_PROMPT,
  MESSAGES,
};
