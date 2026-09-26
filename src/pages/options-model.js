// pages/options-model.js — options 页的纯逻辑层（PR5）。
//
// 前身 extension/options/options.js 里的零散函数：saveAll 实写的键清单（原
// SAVE_FIELDS 的后继）、字号档位、高级参数的钳制、每日新卡数、api-hint 拼接、
// 以及 syncError 的 20 码人话表。全部收进一个不碰 DOM、不碰 chrome.storage、
// 不 import React 的模块 —— node 里可测（test/options-model.test.js），
// options.jsx 只做编排。
//
// 键清单为什么还留着一份：SETTINGS_SCHEMA 是「有哪些键」的登记处，但「这一页
// 的保存动作写哪些键」是 options 自己的行为约定（schema 里 38 键，saveAll 只写
// 33 —— engineChosen 由 provider 变更单独写、bilingualMode 与 learnRules 不归
// 这张页管）。这个差集就是历史上「一键配置写了个 saveAll 读不回来的键」那条
// 事故（test/grant.test.js）的守卫面，test/options-model.test.js 对着 schema
// 把差集钉死，谁一边改了另一边没改就红。

// saveNow() 实写的全部键（原 saveAll 映射表的键域，33 个）。顺序无语义，集合
// 才有 —— 单测拿它对账 schema。
export const SAVE_KEYS = [
  'provider', 'apiKey', 'apiBaseUrl', 'apiModel',
  'targetLang', 'uiLang', 'textColor', 'ytTextColor', 'fontSize', 'showFab',
  'learnEnabled', 'docCapture', 'learnDailyNew',
  'ttsMode', 'ttsAutoPlay', 'ttsEngine', 'ttsBaseUrl', 'ttsApiKey', 'ttsModel', 'ttsVoice', 'ttsRate',
  'notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesModel',
  'reqTemperature', 'reqMaxTokens', 'reqTimeoutSec', 'reqConcurrency',
  'sttEngine', 'sttApiKey', 'sttBaseUrl', 'sttModel',
];

// 字号档位（原 SCALE_OPTS）。存量里出现的任何其它值（旧版写过的）一律落 1.0。
export const SCALE_OPTS = ['0.8', '0.9', '1.0', '1.1', '1.25'];
export function scaleValue(v) {
  const s = String(v == null ? '' : v);
  return SCALE_OPTS.includes(s) ? s : '1.0';
}

// 高级参数输入框 → 存储值（原 advNum）。空串/非法/超界分别落在「不发送」、
// 「不发送」、钳制端点 —— 与原版逐字同义；clamp 是 [lo, hi]。
export function advNum(raw, clamp) {
  const s = String(raw == null ? '' : raw).trim();
  if (s === '') return '';
  const n = Number(s);
  if (!isFinite(n)) return '';
  const lo = clamp[0]; const hi = clamp[1];
  return Math.max(lo, Math.min(hi, n));
}

// 每日新卡数（原 saveAll 里那行内联钳制，逐字同义）：`Number(v) || dflt` 的
// falsy 全家（空串、0、NaN）落默认；负数是 truthy，走钳制下界 1 —— 不是默认。
export function learnDailyNew(raw, dflt) {
  const n = Number(raw);
  return n ? Math.max(1, Math.min(200, n)) : dflt;
}

// #api-hint 那一行（原 apiHint）。hint 后接「默认模型：X」，中文句号后不加空格。
export function apiHint(providerId, t, byId) {
  const p = byId(providerId);
  if (!p) return '';
  const hint = p.hintKey ? t(p.hintKey, '') : '';
  if (!p.defaultModel) return hint;
  const label = t('label_default_model', '默认模型：');
  const gap = /[。．！？]$/.test(hint) ? '' : ' ';
  return `${hint}${hint ? gap : ''}${label}${p.defaultModel}`;
}

// 同步/登录错误 → 状态行文案（原 syncError）。18 个具名码 + 兜底，**顺序即优先级**
// 没有语义，但每一行都得在 —— error-copy 门禁按 code 名逐个对账（这些码来自
// sync.js / auth.js，少一个分支它就会以英文原文落到用户眼前）。
export function syncError(e, t) {
  const code = (e && e.code) || '';
  if (code === 'offline') return t('sync_err_offline', '连不上服务器，稍后会自动重试。已学的内容都在本机。');
  if (code === 'quota') return t('sync_err_quota', '云端空间已满，新内容暂时不再上传（本机不受影响）。清理已掌握的卡可以腾出空间。');
  if (code === 'signed_out') return t('sync_err_signed_out', '登录已失效，请重新登录。');
  if (code === 'enc_unsupported') return t('sync_err_upgrade', '云端有这个版本还读不了的内容（可能来自更新版本的扩展）。请升级扩展后再同步——那些内容没有丢，只是暂时读不了。');
  if (code === 'rate_limited') return t('sync_err_rate', '验证码发得太频繁了，等几分钟再试。');
  // 归属闸的两个 code（sync.js 的 ownerGate）。少了这两行，它们会以英文 code 原文
  // 落到用户眼前 —— 最后那个 e.message 是兜底，不是文案。
  if (code === 'owner_mismatch') return t('sync_err_owner_mismatch', '这台设备上的学习库属于另一个账号。用原来那个邮箱登录，或先清除本机全部数据再重来。');
  if (code === 'owner_unknown') return t('sync_err_owner_unknown', '这台设备上的学习库有归属，但现在没有登录。登录之后才能继续同步。');
  // 第三方登录回来时的两种「接不上」（§8.4.1.2）。都不是用户做错了事，
  // 所以文案给的是下一步，不是指责。
  if (code === 'pkce_missing') return t('sync_err_pkce_missing', '这次登录没能接上 —— 中途换了浏览器、或清过数据。回到这一页重新点一次登录就行。');
  if (code === 'pkce_state') return t('sync_err_pkce_state', '这次登录的来源对不上，已经停下了。请重新点一次登录。');
  // 存储读失败**不是**「没登录」。混同的话，一次读失败会被画成登出，
  // 而用户明明刚走完一整圈（同 auth.js load() 里 loadError 的纪律）。
  if (code === 'storage_error') return t('sync_err_storage', '读不到本机存储，这一步暂时做不了。重开这一页再试；如果一直这样，请把这条信息告诉我们。');
  // ── 免费额度（§8.10）。中继与提供方都会回 402，含义相反，所以码必须分开、
  // 话也必须分开：「你用完了」给的是继续用下去的两条路；「我们的池子空了」
  // 头一句必须先说**不是你的问题**，否则用户会去查自己的账户，查一晚上也查不出来。
  if (code === 'credit_exhausted') return t('grant_err_exhausted', '免费额度已经用完了。你可以填一把自己的 key 继续用（一把通吃翻译、朗读、转写），或者到社群里问问。');
  if (code === 'grant_unavailable') return t('grant_err_unavailable', '不是你用完了 —— 是我们这边的免费额度池空了，正在补。先用自己的 key，或者稍后再来。');
  if (code === 'grant_misconfigured') return t('grant_err_misconfigured', '免费额度这条路我们这边配错了，已经记下。这不是你的问题；先用自己的 key。');
  if (code === 'grant_revoked') return t('grant_err_revoked', '这份免费额度已经停用了（退出登录或删除账号会停用它）。重新登录同一个账号就会回来，余额不变。');
  if (code === 'grant_invalid') return t('grant_err_invalid', '这份免费额度认不出来了。到设置里重新领一次。');
  if (code === 'model_not_allowed') return t('grant_err_model', '免费额度只能用它指定的那个模型。你在「详细」里改过模型 —— 改回去，或者填一把自己的 key。');
  if (code === 'busy') return t('grant_err_busy', '这会儿请求太密了，等几秒再试。');
  if (code === 'auth') return t('auth_err_key', '服务商拒绝了这把 key（HTTP 401/403）。检查 key 是否填对、有没有这个模型的权限。');
  return (e && e.message) || t('sync_err_generic', '同步没能完成');
}
