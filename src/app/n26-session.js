// src/app/n26-session.js — App listen / subtitle result-area halt + USD meter.
//
// Contract: ARCH-SHORT-n26-app-parity (session halt; landings grant-card /
// notes-provider; Safari N/A) and ARCH-SHORT-n26-quota-meter-usd-t648
// (cut-arch-n26-quota-meter-usd-t648). Ported from mobiletranslator
// src/app/n26-session.js (main, PR#18). The listen host in this repo wires it.
//
// Halt codes match the extension engine: one failure stops the pump for
// credit_exhausted / grant_unavailable / model_not_allowed / auth; timeout
// halts only after TIMEOUT_STREAK_MAX unit failures; http / network / 429
// stay on the row. The meter reads grantBalance.spentUsd and limitUsd only
// and prints `$spent / $limit` (F-A02: `$0.00 / $0.20`, exhausted `$0.20 / $0.20`).

export const TIMEOUT_STREAK_MAX = 5;

export const HALT_IMMEDIATE = Object.freeze([
  'credit_exhausted', 'grant_unavailable', 'model_not_allowed', 'auth',
]);

const HALT_IMMEDIATE_SET = new Set(HALT_IMMEDIATE);

// Token problems that are not "you used the credit" land on the same card
// as grant_unavailable. A 429 / busy / rate_limit stays a row retry.
const GRANT_POOL = new Set(['grant_invalid', 'grant_revoked', 'grant_misconfigured']);

export function normalizeCode(err) {
  if (!err) return 'unknown';
  if (err.status === 429) return 'http';
  const raw = typeof err.code === 'string' ? err.code : '';
  if (/rate[_ -]?limit|too[_ -]?many[_ -]?requests|^busy$/i.test(raw)) return 'http';
  if (GRANT_POOL.has(raw)) return 'grant_unavailable';
  if (raw) return raw;
  if (err.name === 'AbortError') return 'timeout';
  if (err.name === 'TypeError' || /failed to fetch|network/i.test(String(err.message || ''))) return 'network';
  if (err.status) return 'http';
  return 'unknown';
}

export function createHalt() {
  let halted = false;
  let code = '';
  let streak = 0;

  function snapshot() {
    return { halted, code, streak };
  }

  return {
    get halted() { return halted; },
    get code() { return code; },
    get streak() { return streak; },
    blocksPump() { return halted; },
    noteSuccess() {
      if (!halted) streak = 0;
      return snapshot();
    },
    noteFailure(err) {
      if (halted) return snapshot();
      // A single stalled request is a row retry. It does not move the streak.
      if (err && err.stalled) return snapshot();
      const c = normalizeCode(err);
      if (c === 'timeout') {
        streak += 1;
        if (streak >= TIMEOUT_STREAK_MAX) {
          halted = true;
          code = 'timeout';
        }
        return snapshot();
      }
      streak = 0;
      if (HALT_IMMEDIATE_SET.has(c)) {
        halted = true;
        code = c;
      }
      return snapshot();
    },
    retry() {
      halted = false;
      code = '';
      streak = 0;
      return snapshot();
    },
  };
}

// F-A02 signed meter: `$spent / $limit`, same `$x.xx` printer as grant.js.
// Zero spend is `$0.00 / $0.20`. Exhausted (spent === limit) is `$0.20 / $0.20`.
// Reads grantBalance.spentUsd and grantBalance.limitUsd only.
export function meterText(grantBalance) {
  if (!grantBalance || typeof grantBalance !== 'object') return '';
  const hasUsd = Object.prototype.hasOwnProperty.call(grantBalance, 'limitUsd')
    || Object.prototype.hasOwnProperty.call(grantBalance, 'spentUsd');
  if (!hasUsd) return '';
  const limit = Number(grantBalance.limitUsd);
  const spent = Number(grantBalance.spentUsd || 0);
  if (!(limit > 0) || !Number.isFinite(limit) || !Number.isFinite(spent)) return '';
  const money = (v) => '$' + Number(v).toFixed(2);
  return money(spent) + ' / ' + money(limit);
}

function actionBtn(label, action, extra) {
  return Object.assign({ label: label, action: action, landing: null }, extra || {});
}

// One next sentence and one primary control. showAutoRetry is always false.
// Landings are App controls: grant-card and notes-provider. No Safari guide.
// China (region 'cn') does not offer the free-channel secondary.
export function failSurface(code, opts) {
  const o = opts || {};
  const t = o.t || ((k, d) => d);
  const global = o.region !== 'cn';
  const exhausted = code === 'credit_exhausted';
  const meter = exhausted ? meterText(o.grantBalance) : '';
  const common = {
    code: code || 'unknown',
    halt: false,
    showAutoRetry: false,
    title: '',
    next: '',
    footnote: '',
    meter: meter,
    meterLabel: t('fail_quota_label', '免费额度'),
    rowNote: '',
    primary: null,
    secondary: null,
  };
  if (code === 'credit_exhausted') {
    return Object.assign(common, {
      halt: true,
      title: t('fail_credit_title', '免费额度用完'),
      next: t('fail_credit_next', '去改通道，或填自己的 API Key。'),
      rowNote: t('fail_credit_title', '免费额度用完'),
      primary: actionBtn(t('fail_go_grant', '去改通道'), 'open', { landing: 'grant-card' }),
      secondary: actionBtn(t('fail_fill_key', '填自己的 Key'), 'open', { landing: 'notes-provider' }),
    });
  }
  if (code === 'grant_unavailable') {
    return Object.assign(common, {
      halt: true,
      title: t('fail_grant_title', '池子暂不可用'),
      next: t('fail_grant_next', '不是你用完了，稍后再试或改通道。'),
      rowNote: t('fail_grant_title', '池子暂不可用'),
      primary: actionBtn(t('fail_go_grant', '去改通道'), 'open', { landing: 'grant-card' }),
    });
  }
  if (code === 'model_not_allowed') {
    return Object.assign(common, {
      halt: true,
      title: t('fail_model_title', '模型不在免费名单'),
      next: t('fail_model_next', '免费额度只能用指定模型，请改回。'),
      rowNote: t('fail_model_title', '模型不在免费名单'),
      primary: actionBtn(t('fail_go_model', '去改模型'), 'open', { landing: 'grant-card', clearModel: true }),
    });
  }
  if (code === 'auth') {
    return Object.assign(common, {
      halt: true,
      title: t('fail_auth_title', '密钥无效'),
      next: t('fail_auth_next', 'Key 被服务商拒绝，请检查或重填。'),
      rowNote: t('fail_auth_title', '密钥无效'),
      primary: actionBtn(t('fail_go_engine', '去填 Key'), 'open', { landing: 'notes-provider' }),
      secondary: global ? actionBtn(t('fail_use_free', '改用免费通道'), 'open', { landing: 'grant-card' }) : null,
    });
  }
  if (code === 'timeout') {
    return Object.assign(common, {
      halt: true,
      title: t('fail_timeout_title', '连不上，已暂停'),
      next: global
        ? t('fail_timeout_next', '已暂停自动重试；网络好了再点重试，或改免费通道。')
        : t('fail_timeout_next_cn', '已暂停自动重试。网络好了再点重试。'),
      footnote: t('fail_timeout_footnote', '连续 5 次超时才暂停；单次超时不会停机'),
      rowNote: t('fail_timeout_title', '连不上，已暂停'),
      primary: actionBtn(t('fail_retry', '重试'), 'retry'),
      secondary: global ? actionBtn(t('fail_switch_free', '改免费通道'), 'open', { landing: 'grant-card' }) : null,
    });
  }
  return Object.assign(common, {
    next: t('msg_translate_failed_retry', '⚠️ 翻译失败,点此重试'),
    primary: actionBtn(t('msg_translate_failed_retry', '⚠️ 翻译失败,点此重试'), 'retry-unit'),
  });
}
