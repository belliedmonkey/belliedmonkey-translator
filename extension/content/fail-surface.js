// fail-surface.js — one next step for an extension halt code.
//
// The engine (translation-core.js) decides when the pump stops. This file only
// says what the row shows and where the click goes. Anchors are the settings
// page's existing ones: #grant (quick card), #engine (detail card / Key), and the
// BEL-274 control-specific ones #engine-base / #engine-balance / #engine-streak.
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
    const anchor = (code === 'auth') ? '#engine'
      : (code === 'no_base') ? '#engine-base'
        : (code === 'provider_402') ? '#engine-balance'
          : (code === 'streak') ? '#engine-streak'
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
    // provider_402（BEL-274）：提供方回的 402 —— **用户自己的账户**没钱了。与
    // credit_exhausted（我们的免费额度）是两句：这里的主按钮是「换引擎」，次按钮是
    // 「填自己的 Key」，卡里不出现「点此重试」（重试还是同一个 402）。
    if (code === 'provider_402') {
      return Object.assign(common, {
        halt: true,
        anchor: anchor,
        title: t('fail_balance_title', '这个引擎的账户没有余额'),
        next: t('fail_balance_next', '服务商回了 402：这把 Key 的账户没钱了。充值后点下面的「测试连接」；也可以换一把有余额的 Key，或者换引擎。'),
        rowNote: t('halt_balance_row', '这个引擎没余额了 —— 点此去换'),
        primary: actionBtn(t('fail_switch_engine', '换引擎'), 'open', { anchor: anchor }),
        secondary: actionBtn(t('fail_fill_key', '填自己的 Key'), 'open', { anchor: '#engine' }),
      });
    }
    // no_base（BEL-274）：缺的是端点地址，不是额度也不是 key。行上只留一句「填地址」，
    // 锚点直接落在地址输入框（#engine-base），而不是引擎块顶部。第一次就停，行上
    // 不再给「点此重试」—— 地址没填，重试还是同一个 no_base。
    if (code === 'no_base') {
      return Object.assign(common, {
        halt: true,
        anchor: anchor,
        title: t('engine_test_no_base', '还没填端点地址'),
        next: t('no_base_field_hint', '还没填地址：这个引擎必须先有服务地址才会工作。地址要带协议和路径，例如 https://your-host/v1'),
        rowNote: t('halt_no_base_row', '这个引擎要填地址 —— 点此去填'),
        primary: actionBtn(t('halt_open_settings', '去设置'), 'open', { anchor: anchor }),
      });
    }
    // streak（BEL-274）：同一配置连续 3 次 400/429。行上是一次点击去引擎卡；卡里
    // 主按钮「换引擎」、次按钮「重试」（重跑测试连接）。1、2 次仍是普通失败句。
    if (code === 'streak') {
      return Object.assign(common, {
        halt: true,
        anchor: anchor,
        title: t('fail_streak_title', '连续 3 次都失败'),
        next: t('fail_streak_next', '同一个引擎连续 3 次没成功，最近一次是 HTTP 429（限流）。多数时候是配置或限额的问题，换引擎更快；想再试一次也可以。'),
        rowNote: t('halt_streak_row', '连续 3 次失败 —— 点此去处理'),
        primary: actionBtn(t('fail_switch_engine', '换引擎'), 'open', { anchor: anchor }),
        secondary: actionBtn(t('fail_retry', '重试'), 'retry'),
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
