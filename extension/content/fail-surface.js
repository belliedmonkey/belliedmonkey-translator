// fail-surface.js — one next step for an extension halt code.
//
// The engine (translation-core.js) decides when the pump stops. This file only
// says what the row shows and where the click goes. Anchors are the settings
// page's existing ones: #grant (quick card) and #engine (detail card).
// China (MT_FLAVOR === 'china') does not offer the free-channel secondary.
// showAutoRetry is always false: a halt never schedules another request.

var FailSurface = (() => {
  function t(key, fallback) {
    try {
      if (typeof TranslationCore !== 'undefined' && TranslationCore.t) return TranslationCore.t(key, fallback);
    } catch (_) {}
    return fallback;
  }

  function regionOf() {
    try { return window.MT_FLAVOR === 'china' ? 'cn' : 'global'; } catch (_) { return 'global'; }
  }

  function actionBtn(label, action, extra) {
    return Object.assign({ label: label, action: action, anchor: '' }, extra || {});
  }

  function surface(code, opts) {
    const o = opts || {};
    const global = (o.region || regionOf()) !== 'cn';
    const anchor = code === 'auth' ? '#engine'
      : (code === 'timeout' ? '' : '#grant');
    const common = {
      code: code || '',
      halt: false,
      showAutoRetry: false,
      title: '',
      next: '',
      footnote: '',
      rowNote: '',
      anchor: '',
      primary: null,
      secondary: null,
    };
    if (code === 'credit_exhausted') {
      return Object.assign(common, {
        halt: true,
        anchor: anchor,
        title: t('fail_credit_title', '免费额度用完'),
        next: t('fail_credit_next', '去改通道，或填自己的 API Key。'),
        rowNote: t('fail_credit_title', '免费额度用完'),
        primary: actionBtn(t('fail_go_grant', '去改通道'), 'open', { anchor: anchor }),
        secondary: actionBtn(t('fail_fill_key', '填自己的 Key'), 'open', { anchor: '#engine' }),
      });
    }
    if (code === 'grant_unavailable') {
      return Object.assign(common, {
        halt: true,
        anchor: anchor,
        title: t('fail_grant_title', '池子暂不可用'),
        next: t('fail_grant_next', '不是你用完了，稍后再试或改通道。'),
        rowNote: t('fail_grant_title', '池子暂不可用'),
        primary: actionBtn(t('fail_go_grant', '去改通道'), 'open', { anchor: anchor }),
      });
    }
    if (code === 'model_not_allowed') {
      return Object.assign(common, {
        halt: true,
        anchor: anchor,
        title: t('fail_model_title', '模型不在免费名单'),
        next: t('fail_model_next', '免费额度只能用指定模型，请改回。'),
        rowNote: t('fail_model_title', '模型不在免费名单'),
        primary: actionBtn(t('fail_go_model', '去改模型'), 'open', { anchor: anchor }),
      });
    }
    if (code === 'auth') {
      return Object.assign(common, {
        halt: true,
        anchor: anchor,
        title: t('fail_auth_title', '密钥无效'),
        next: t('fail_auth_next', 'Key 被服务商拒绝，请检查或重填。'),
        rowNote: t('fail_auth_title', '密钥无效'),
        primary: actionBtn(t('fail_go_engine', '去填 Key'), 'open', { anchor: anchor }),
        secondary: global ? actionBtn(t('fail_use_free', '改用免费通道'), 'open', { anchor: '#grant' }) : null,
      });
    }
    if (code === 'timeout') {
      return Object.assign(common, {
        halt: true,
        anchor: '',
        title: t('fail_timeout_title', '连不上，已暂停'),
        next: global
          ? t('fail_timeout_next', '已暂停自动重试；网络好了再点重试，或改免费通道。')
          : t('fail_timeout_next_cn', '已暂停自动重试。网络好了再点重试。'),
        footnote: t('fail_timeout_footnote', '连续 5 次超时才暂停；单次超时不会停机'),
        rowNote: t('fail_timeout_title', '连不上，已暂停'),
        primary: actionBtn(t('fail_retry', '重试'), 'retry'),
        secondary: global ? actionBtn(t('fail_switch_free', '改免费通道'), 'open', { anchor: '#grant' }) : null,
      });
    }
    return Object.assign(common, {
      next: t('msg_translate_failed_retry', '⚠️ 翻译失败,点此重试'),
      primary: actionBtn(t('msg_translate_failed_retry', '⚠️ 翻译失败,点此重试'), 'retry-unit'),
    });
  }

  // What the paragraph / subtitle row needs: one line, one click.
  function row(code, opts) {
    const s = surface(code, opts);
    if (!s.halt) return null;
    const retry = !!(s.primary && s.primary.action === 'retry');
    return {
      code: s.code,
      text: s.rowNote || s.title,
      anchor: retry ? '' : (s.anchor || ''),
      retry: retry,
      showAutoRetry: false,
    };
  }

  return { surface, row };
})();
